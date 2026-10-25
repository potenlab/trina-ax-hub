// Schedules: a prompt that runs as a hub session on a cron (server local time) and saves its answer as Markdown into
// a team folder the person can write. The folder is checked with authorize() when the schedule is made and again
// when each result is saved (permissions may have changed in between).
import fs from 'node:fs'
import path from 'node:path'
import { Cron } from 'croner'
import type { Ctx } from '../context'
import { nowIso } from '../db'
import { newId } from '../ids'
import { audit } from '../audit'
import { HttpError } from '../http/errors'
import { authorize } from '../policy/authorize'
import { Denied, ToolError } from '../policy/errors'
import { loadPrincipal, type Principal } from '../policy/access'
import { badSegment } from '../policy/names'
import { verifyChain } from '../policy/resolve'
import { PRODUCT } from '../product'
import { buildSystemPrompt } from './prompt'
import type { JobStatus, KindHooks } from './runner'

export const PRESETS = [
  { key: 'daily9', label: '매일 오전 9시', cron: '0 9 * * *' },
  { key: 'weekday9', label: '평일 오전 9시', cron: '0 9 * * 1-5' },
  { key: 'monday9', label: '매주 월요일 오전 9시', cron: '0 9 * * 1' },
] as const
/** schedules may not run more often than this (the hub runs 2–3 sessions at once) */
export const MIN_GAP_MINUTES = 30
export const MAX_SCHEDULES_PER_PERSON = 20
export const NAME_MAX = 60
export const PROMPT_MAX = 8_000
/** a run missed by up to this much (hub restarted around the time) still starts; older ones are skipped */
export const CATCH_UP_MS = 60 * 60_000

export interface Schedule {
  id: string; user_id: string; name: string; cron: string; prompt: string; output_dir: string | null
  enabled: number; last_run_at: string | null; next_run_at: string | null; created_at: string
}
export interface ScheduleRun { id: string; status: JobStatus; result: string | null; error: string | null; output_path: string | null; created_at: string; started_at: string | null; finished_at: string | null }

const v = (msg: string, field: string) => new HttpError(400, 'validation', msg, { [field]: msg })

/** Next run strictly after `from`, in the server's local time; null when the expression never fires again. */
export function nextRunAt(expr: string, from: Date = new Date()): Date | null {
  try { return new Cron(expr, { paused: true }).nextRun(from) } catch { return null }
}

/** A cron expression people may use: five fields (or six with a fixed second), runs again, not too often. */
export function validateCron(input: unknown): string {
  const expr = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : ''
  if (!expr) throw v('실행 시간을 정해 주세요.', 'cron')
  const parts = expr.split(' ')
  if (expr.length > 100 || parts.length < 5 || parts.length > 6) throw v('cron 형식이 아니에요. 예: 0 9 * * 1-5 (평일 오전 9시)', 'cron')
  if (parts.length === 6 && !/^\d{1,2}$/.test(parts[0]!)) throw v('초 단위 반복은 쓸 수 없어요.', 'cron')
  let cron: Cron
  try { cron = new Cron(expr, { paused: true }) } catch { throw v('cron 형식이 아니에요. 예: 0 9 * * 1-5 (평일 오전 9시)', 'cron') }
  const runs = cron.nextRuns(12)
  if (!runs.length) throw v('이 일정으로는 실행될 날이 없어요.', 'cron')
  for (let i = 1; i < runs.length; i++) {
    if (runs[i]!.getTime() - runs[i - 1]!.getTime() < MIN_GAP_MINUTES * 60_000) throw v(`${MIN_GAP_MINUTES}분보다 자주 실행할 수는 없어요.`, 'cron')
  }
  return expr
}

export function describeCron(expr: string): string {
  return PRESETS.find((p) => p.cron === expr)?.label ?? expr
}

/** What people see and type for their personal folder users/<id>/ on the phone pages. */
export const MY_FOLDER = '내 폴더'

/** "내 폴더/보고" (what people type) → users/<id>/보고; any other path unchanged (trimmed, NFC). A top-level team
 *  folder literally named "내 폴더" cannot be picked as an output folder by that name. */
export function fromMyFolder(userId: string, input: string): string {
  const t = input.normalize('NFC').trim().replace(/^\/+|\/+$/g, '')
  if (t === MY_FOLDER) return `users/${userId}`
  if (t.startsWith(MY_FOLDER + '/')) return `users/${userId}/${t.slice(MY_FOLDER.length + 1)}`
  return t
}

/** users/<id>/보고 → "내 폴더/보고" for that person's own pages; other paths unchanged. */
export function toMyFolder(userId: string, p: string): string {
  const base = `users/${userId}`
  if (p === base) return MY_FOLDER
  return p.startsWith(base + '/') ? MY_FOLDER + p.slice(base.length) : p
}

/** Normalize a team-folder path for the output folder and check the person may write there. */
export function validateOutputDir(ctx: Ctx, user: Principal, input: unknown): string {
  const typed = typeof input === 'string' ? input.trim().replace(/^\/+|\/+$/g, '') : ''
  if (!typed) throw v('결과를 저장할 폴더를 적어 주세요.', 'outputDir')
  const raw = fromMyFolder(user.id, typed)
  let dir
  try {
    dir = authorize(ctx.fx, ctx.rules(), user, raw, 'write', { createDirs: true })
  } catch (e) {
    if (e instanceof Denied || e instanceof ToolError) throw v(`'${typed}' 폴더에는 쓸 권한이 없어요. 쓸 수 있는 폴더를 골라 주세요. (예: ${MY_FOLDER}/예약 작업)`, 'outputDir')
    throw e
  }
  if (!dir.segs.length) throw v('팀 폴더 맨 위에는 저장할 수 없어요. 그 아래 폴더를 골라 주세요.', 'outputDir')
  if (dir.exists && !dir.st?.isDirectory()) throw v(`'${typed}'는 폴더가 아니에요.`, 'outputDir')
  return dir.rel
}

export interface ScheduleInput { name?: unknown; when?: unknown; cron?: unknown; prompt?: unknown; outputDir?: unknown }

export function createSchedule(ctx: Ctx, user: Principal, input: ScheduleInput): Schedule {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : ''
  if (!name) throw v('이름을 적어 주세요.', 'name')
  if (name.length > NAME_MAX) throw v(`이름은 ${NAME_MAX}자까지 쓸 수 있어요.`, 'name')
  if (/[\u0000-\u001f\u007f]/.test(name)) throw v('이름에 쓸 수 없는 글자가 있어요.', 'name')
  const preset = PRESETS.find((p) => p.key === input.when)
  const cron = validateCron(preset ? preset.cron : input.cron)
  const prompt = typeof input.prompt === 'string' ? input.prompt.replace(/\r\n?/g, '\n').trim() : ''
  if (!prompt) throw v('할 일을 적어 주세요.', 'prompt')
  if (prompt.length > PROMPT_MAX) throw v(`할 일은 ${PROMPT_MAX.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`, 'prompt')
  const outputDir = validateOutputDir(ctx, user, input.outputDir)
  const count = (ctx.db.query('SELECT COUNT(*) AS n FROM schedules WHERE user_id = ?').get(user.id) as { n: number }).n
  if (count >= MAX_SCHEDULES_PER_PERSON) throw v(`예약 작업은 한 사람당 ${MAX_SCHEDULES_PER_PERSON}개까지 만들 수 있어요.`, 'name')
  const id = newId()
  ctx.db.query('INSERT INTO schedules (id, user_id, name, cron, prompt, output_dir, enabled, next_run_at, created_at) VALUES (?,?,?,?,?,?,1,?,?)')
    .run(id, user.id, name, cron, prompt, outputDir, nextRunAt(cron)?.toISOString() ?? null, nowIso())
  return getSchedule(ctx, id, user.id)!
}

export function getSchedule(ctx: Ctx, id: string, userId: string): Schedule | null {
  return ctx.db.query('SELECT * FROM schedules WHERE id = ? AND user_id = ?').get(id, userId) as Schedule | null
}

export function listSchedules(ctx: Ctx, userId: string): Schedule[] {
  return ctx.db.query('SELECT * FROM schedules WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(userId) as Schedule[]
}

export function lastRun(ctx: Ctx, scheduleId: string): ScheduleRun | null {
  return ctx.db.query("SELECT id, status, result, error, output_path, created_at, started_at, finished_at FROM hub_jobs WHERE schedule_id = ? AND status IN ('done','failed','cancelled') ORDER BY created_at DESC, rowid DESC LIMIT 1").get(scheduleId) as ScheduleRun | null
}

export function activeRun(ctx: Ctx, scheduleId: string): { id: string; status: 'queued' | 'running' } | null {
  return ctx.db.query("SELECT id, status FROM hub_jobs WHERE schedule_id = ? AND status IN ('queued','running') LIMIT 1").get(scheduleId) as { id: string; status: 'queued' | 'running' } | null
}

export function setEnabled(ctx: Ctx, s: Schedule, on: boolean) {
  ctx.db.query('UPDATE schedules SET enabled = ?, next_run_at = ? WHERE id = ?').run(on ? 1 : 0, on ? nextRunAt(s.cron)?.toISOString() ?? null : null, s.id)
}

export function deleteSchedule(ctx: Ctx, s: Schedule) {
  ctx.db.query('DELETE FROM schedules WHERE id = ? AND user_id = ?').run(s.id, s.user_id)
}

// saving results ----------------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')
/** "2026-10-25 0900" in the server's local time */
export const fileStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`

/** A schedule name made safe as part of a file name (the policy's name rules apply to the result). */
export function fileSafeName(name: string): string {
  let s = name
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*\\/／＼∕⁄⧸⧹∖﹨╱╲〳〵]/g, ' ')
    .replace(/[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g, '')
    .replace(/~(\d)/g, '-$1')
    .replace(/\s+/g, ' ')
    .trim()
    // no leading dot: never hidden, never the server's temp prefix
    .replace(/^[.\s]+|[.\s]+$/g, '')
  s = s.slice(0, NAME_MAX)
  return s && badSegment(`2026-01-01 0000 ${s}.md`) === null ? s : '예약 작업'
}

export class SaveRefused extends Error {}

/**
 * Save a schedule result as `<dir>/YYYY-MM-DD HHmm <name>.md` for `user`, through authorize() (write) and an atomic
 * write (temp file with PRODUCT.tmpPrefix in the same folder, then rename). Never replaces an existing file.
 * Returns the team-folder path. Throws SaveRefused (Korean message) when the person may not write there anymore.
 */
export function saveResult(ctx: Ctx, user: Principal, outputDir: string, name: string, text: string, at: Date): string {
  const rules = ctx.rules()
  const root = ctx.fx.root
  const shown = toMyFolder(user.id, outputDir)
  let dir
  try {
    dir = authorize(ctx.fx, rules, user, outputDir, 'write', { createDirs: true })
  } catch (e) {
    if (e instanceof Denied || e instanceof ToolError) throw new SaveRefused(`'${shown}' 폴더에 쓸 권한이 없어서 결과를 저장하지 못했어요.`)
    throw e
  }
  if (!dir.segs.length) throw new SaveRefused('팀 폴더 맨 위에는 결과를 저장할 수 없어요.')
  if (dir.exists && !dir.st?.isDirectory()) throw new SaveRefused(`'${shown}'가 폴더가 아니라서 결과를 저장하지 못했어요.`)
  // create the missing folders one level at a time, re-checking the chain before each step
  for (let k = dir.existing; k < dir.segs.length; k++) {
    verifyChain(root, dir.segs.slice(0, k))
    try { fs.mkdirSync(path.join(root, ...dir.segs.slice(0, k + 1))) } catch (e: any) { if (e?.code !== 'EEXIST') throw e }
  }
  const body = [`# ${name}`, '', `> ${PRODUCT.displayName} 예약 작업 · ${fileStamp(at)} 실행`, '', text.trim(), ''].join('\n')
  const base = `${fileStamp(at)} ${fileSafeName(name)}`
  for (let n = 1; n <= 50; n++) {
    const fileName = n === 1 ? `${base}.md` : `${base} (${n}).md`
    let target
    try {
      target = authorize(ctx.fx, rules, user, [...dir.segs, fileName].join('/'), 'write')
    } catch (e) {
      if (e instanceof Denied || e instanceof ToolError) continue // a look-alike name next to it: try the next one
      throw e
    }
    if (target.exists) continue
    const tmp = path.join(root, ...dir.segs, `${PRODUCT.tmpPrefix}${newId()}.md`)
    fs.writeFileSync(tmp, body, { flag: 'wx', mode: 0o644 })
    try {
      verifyChain(root, target.segs, true)
      if (fs.existsSync(target.abs)) continue
      fs.renameSync(tmp, target.abs)
    } finally {
      fs.rmSync(tmp, { force: true })
    }
    audit(ctx.db, { actor: user.id, action: 'hub.schedule.save', target: target.rel })
    return target.rel
  }
  throw new SaveRefused('같은 이름의 파일이 너무 많아서 결과를 저장하지 못했어요.')
}

export function scheduleHooks(ctx: Ctx): KindHooks {
  const scheduleOf = (id: string | null) => (id ? (ctx.db.query('SELECT * FROM schedules WHERE id = ?').get(id) as Schedule | null) : null)
  return {
    prepare(job, user) {
      const s = scheduleOf(job.schedule_id)
      return {
        systemPrompt: buildSystemPrompt(ctx, user, { kind: 'schedule', name: s?.name ?? '예약 작업', outputDir: s?.output_dir ?? '', at: new Date(job.started_at ?? Date.now()) }),
        resume: null,
        persist: false,
        finalText: 'last',
      }
    },
    finish(job, out) {
      if (out.status !== 'done' || !job.schedule_id) return out
      const s = scheduleOf(job.schedule_id)
      if (!s) return { ...out, status: 'cancelled', error: '예약 작업이 지워져서 결과를 저장하지 않았어요.' }
      if (!s.output_dir) return out
      const user = loadPrincipal(ctx.db, job.user_id)
      if (!user) return { ...out, status: 'failed', error: '계정이 꺼져 있어서 결과를 저장하지 않았어요.' }
      try {
        const rel = saveResult(ctx, user, s.output_dir, s.name, out.text ?? '', new Date(job.started_at ?? Date.now()))
        return { ...out, outputPath: rel }
      } catch (e) {
        if (e instanceof SaveRefused) return { ...out, status: 'failed', error: e.message }
        ctx.log.error('hub schedule save failed', { job: job.id, err: String((e as Error)?.message ?? e).slice(0, 300) })
        return { ...out, status: 'failed', error: '결과를 파일로 저장하지 못했어요.' }
      }
    },
  }
}

// housekeeping -------------------------------------------------------------------------------------------------------

/** finished hub jobs (prompts and answers) are kept this long */
export const JOB_KEEP_DAYS = 90

/** Delete finished jobs older than JOB_KEEP_DAYS, except each schedule's latest run (its "last result"). Chat
 *  messages live in hub_messages and stay. Returns how many were removed. */
export function sweepOldJobs(ctx: Ctx, now = Date.now()): number {
  const cutoff = new Date(now - JOB_KEEP_DAYS * 86_400_000).toISOString()
  return ctx.db.query(`DELETE FROM hub_jobs WHERE status IN ('done','failed','cancelled') AND COALESCE(finished_at, created_at) < ?
    AND id NOT IN (SELECT keep FROM (SELECT (SELECT j.id FROM hub_jobs j WHERE j.schedule_id = s.id AND j.status IN ('done','failed','cancelled')
      ORDER BY j.created_at DESC, j.rowid DESC LIMIT 1) AS keep FROM schedules s) WHERE keep IS NOT NULL)`).run(cutoff).changes
}

// the scheduler -----------------------------------------------------------------------------------------------------

export type Enqueue = (o: { kind: 'schedule'; userId: string; scheduleId: string; prompt: string }) => string

/** Start one run of a schedule now (run-now button and the scheduler). Null when one is already waiting/running. */
export function runSchedule(ctx: Ctx, enqueue: Enqueue, s: Schedule, now = new Date()): string | null {
  if (activeRun(ctx, s.id)) return null
  ctx.db.query('UPDATE schedules SET last_run_at = ? WHERE id = ?').run(now.toISOString(), s.id)
  return enqueue({ kind: 'schedule', userId: s.user_id, scheduleId: s.id, prompt: s.prompt })
}

/** Checks the schedules table at the start of every minute (croner) and starts what is due. */
export class Scheduler {
  private cron: Cron | null = null
  private lastSweep = 0
  constructor(private ctx: Ctx, private enqueue: Enqueue) {}

  start() {
    this.skipMissed()
    this.sweep()
    this.cron = new Cron('* * * * *', { protect: true, catch: (e) => this.ctx.log.error('hub scheduler failed', { err: String(e).slice(0, 300) }) }, () => { this.tick(); this.sweep() })
  }

  /** Old finished jobs go, at most once an hour (runs on the scheduler's minute tick). */
  sweep(now = Date.now()) {
    if (now - this.lastSweep < 3600_000) return
    this.lastSweep = now
    try {
      const n = sweepOldJobs(this.ctx, now)
      if (n) this.ctx.log.info('old hub jobs removed', { count: n, olderThanDays: JOB_KEEP_DAYS })
    } catch (e) {
      this.ctx.log.warn('hub job sweep failed', { err: String((e as Error)?.message ?? e).slice(0, 300) })
    }
  }

  stop() { this.cron?.stop(); this.cron = null }

  /** Runs missed by more than CATCH_UP_MS (hub was off) are skipped: their next run moves to the future. */
  skipMissed(now = new Date()) {
    const rows = this.ctx.db.query('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at < ?').all(new Date(now.getTime() - CATCH_UP_MS).toISOString()) as Schedule[]
    for (const s of rows) this.ctx.db.query('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(nextRunAt(s.cron, now)?.toISOString() ?? null, s.id)
  }

  /** Start every enabled schedule that is due (owner still active) and move its next run forward. */
  tick(now = new Date()): string[] {
    const due = this.ctx.db.query(`SELECT s.* FROM schedules s JOIN users u ON u.id = s.user_id AND u.status = 'active'
      WHERE s.enabled = 1 AND s.next_run_at IS NOT NULL AND s.next_run_at <= ? ORDER BY s.next_run_at`).all(new Date(now.getTime() + 1000).toISOString()) as Schedule[]
    const started: string[] = []
    for (const s of due) {
      const from = new Date(Math.max(now.getTime(), Date.parse(s.next_run_at!)))
      const moved = this.ctx.db.query('UPDATE schedules SET next_run_at = ? WHERE id = ? AND next_run_at = ?').run(nextRunAt(s.cron, from)?.toISOString() ?? null, s.id, s.next_run_at)
      if (moved.changes !== 1) continue
      const id = runSchedule(this.ctx, this.enqueue, s, now)
      if (id) started.push(id)
      else this.ctx.log.info('hub schedule still running, skipped this time', { schedule: s.id })
    }
    return started
  }
}
