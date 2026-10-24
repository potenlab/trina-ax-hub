// Hub sessions: `claude -p` runs on the hub for phone chat and schedules, one FIFO queue with a small concurrency
// (a 16 GB Mac mini froze at ~10 sessions). Each job runs as one person:
//   - built-in tools off (--tools ""), only the hub's own MCP file tools, so that person's folder rules apply;
//   - a fresh hub token (2 h) for the relay and the MCP endpoint, revoked when the job ends;
//   - HOME / CLAUDE_CONFIG_DIR = <dataDir>/hub/claude/<userId> (their sessions, never the Mac's own login);
//   - cwd = an empty per-job folder under <dataDir>/hub/work/<jobId>/ (removed afterwards);
//   - a minimal environment built from scratch (nothing of the server's own environment leaks in).
// Progress goes out on ctx.events ('job'). Jobs of a previous process are marked failed at start.
import fs from 'node:fs'
import path from 'node:path'
import type { Subprocess } from 'bun'
import type { Ctx } from '../context'
import { nowIso } from '../db'
import { newId } from '../ids'
import { issueToken, revokeToken } from '../auth/tokens'
import { loadPrincipal, type Principal } from '../policy/access'
import { PRODUCT } from '../product'
import { StreamParser, TextTail, Utf8Lines } from './stream'

/** The MCP tools of the files module (contract). They show up as mcp__trina__<name>. */
export const TRINA_TOOLS = ['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'make_folder', 'move_file', 'delete_file', 'read_skill'] as const
export const ALLOWED_TOOLS = TRINA_TOOLS.map((t) => `mcp__${PRODUCT.mcpName}__${t}`)

/** Settings passed with --settings (no user/project settings are loaded): no auto memory (it needs the Write tool,
 * which is off), no hooks, no git context of whatever folder the hub runs in. From Team AX's lockdown runs. */
export const LOCK_SETTINGS = { autoMemoryEnabled: false, disableAllHooks: true, includeGitInstructions: false }

/** Switches that close file mentions, attachments, CLAUDE.md files, background tasks, telemetry and self-update. */
export const LOCK_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: '1',
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
  CLAUDE_CODE_DISABLE_FILE_MENTIONS: '1',
  CLAUDE_CODE_DISABLE_ATTACHMENTS: '1',
}

export const SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

export const MSG = {
  restarted: '서버가 다시 시작되어 중단됐어요',
  noClaude: '이 허브에 Claude Code가 없어서 실행할 수 없어요. 관리자에게 알려 주세요.',
  disabled: '계정이 꺼져 있어서 실행하지 않았어요.',
  spawn: 'Claude를 실행하지 못했어요. 관리자에게 알려 주세요.',
  cancelled: '취소했어요.',
  internal: '작업 중에 서버에서 문제가 생겼어요.',
} as const

export interface HubOptions {
  /** a job is stopped after this long (SIGTERM, then SIGKILL after killGraceMs) */
  timeoutMs: number
  killGraceMs: number
  /** lifetime of the per-job hub token (revoked as soon as the job ends) */
  tokenTtlMs: number
}
export const DEFAULT_OPTIONS: HubOptions = { timeoutMs: 15 * 60_000, killGraceMs: 5_000, tokenTtlMs: 2 * 3_600_000 }

export type JobKind = 'chat' | 'schedule'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface JobRow {
  id: string; kind: JobKind; user_id: string; chat_id: string | null; schedule_id: string | null; prompt: string
  status: JobStatus; result: string | null; error: string | null; cost_usd: number
  created_at: string; started_at: string | null; finished_at: string | null; output_path: string | null
}

/** ctx.events 'job' payload */
export interface JobEvent {
  jobId: string; chatId: string | null; scheduleId: string | null; userId: string
  type: 'text' | 'status' | 'done' | 'error'
  /** text delta, status line, final answer or the error message (Korean) */
  text: string
  state: JobStatus
  /** queued jobs: how many jobs are ahead (running + queued before it) */
  position?: number
}

export interface Prepared {
  systemPrompt: string
  /** continue a chat's Claude Code session (model pinned: a resumed run otherwise falls back to another default) */
  resume: { sessionId: string; model: string | null } | null
  /** false = --no-session-persistence (schedules never resume) */
  persist: boolean
  /** 'all' = everything the assistant wrote (chat); 'last' = the final message only (a schedule's report) */
  finalText: 'all' | 'last'
}

export interface Outcome {
  status: 'done' | 'failed' | 'cancelled'
  text: string | null
  error: string | null
  costUsd: number
  sessionId: string | null
  model: string | null
  /** the session was started by this job (not resumed) */
  newSession: boolean
  outputPath?: string | null
}

/** What a job kind does around the run (chat: session + messages; schedule: save the report). */
export interface KindHooks {
  prepare(job: JobRow, user: Principal): Prepared
  /** runs for every job that ends, including failed/cancelled/recovered ones; may turn done into failed */
  finish(job: JobRow, out: Outcome): Outcome
}

export interface JobDirs { work: string; cwd: string; tmp: string; mcpFile: string; home: string }

export interface LaunchInput {
  bin: string; selfUrl: string; jobId: string; token: string; systemPrompt: string
  resume: Prepared['resume']; persist: boolean; dirs: JobDirs; tz?: string
}

/** The exact command line and environment of a hub session (pure; tests compare against it). */
export function buildLaunch(i: LaunchInput): { cmd: string[]; env: Record<string, string>; mcpConfig: unknown } {
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '',
    '--strict-mcp-config', '--mcp-config', i.dirs.mcpFile,
    '--allowedTools', ALLOWED_TOOLS.join(','),
    '--permission-mode', 'dontAsk',
    '--setting-sources', '',
    '--settings', JSON.stringify(LOCK_SETTINGS),
    '--disable-slash-commands',
    '--append-system-prompt', i.systemPrompt,
  ]
  if (!i.persist) args.push('--no-session-persistence')
  if (i.resume) {
    args.push('--resume', i.resume.sessionId)
    if (i.resume.model) args.push('--model', i.resume.model)
  }
  const env: Record<string, string> = {
    PATH: SAFE_PATH,
    HOME: i.dirs.home,
    CLAUDE_CONFIG_DIR: i.dirs.home,
    LANG: 'en_US.UTF-8',
    TMPDIR: i.dirs.tmp,
    CLAUDE_CODE_TMPDIR: i.dirs.tmp,
    ANTHROPIC_BASE_URL: i.selfUrl,
    ANTHROPIC_AUTH_TOKEN: i.token,
    ANTHROPIC_CUSTOM_HEADERS: `x-trina-job: ${i.jobId}`,
    ...LOCK_ENV,
  }
  // the person's "today" is the server's calendar
  if (i.tz) env.TZ = i.tz
  const mcpConfig = {
    mcpServers: { [PRODUCT.mcpName]: { type: 'http', url: `${i.selfUrl}/mcp`, headers: { Authorization: `Bearer ${i.token}` } } },
  }
  return { cmd: [i.bin, ...args], env, mcpConfig }
}

const SAFE_ID = /^[a-z0-9]{4,64}$/
export const isSessionId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const okModel = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9.\-_[\]]{0,79}$/i.test(s)

/** Signal a process group (the child is its leader: spawned detached), falling back to the process itself. */
function signalGroup(pid: number, sig: NodeJS.Signals) {
  try { process.kill(-pid, sig) } catch { try { process.kill(pid, sig) } catch { /* gone */ } }
}

const durationLabel = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)}분` : `${Math.max(1, Math.round(ms / 1000))}초`)

/** A Korean message for a failed run. The relay answers in Korean (budget, missing key): show its words. */
export function failureMessage(p: StreamParser, stderr: string, code: number | null): string {
  const raw = (p.apiError ?? (p.result?.isError ? (p.result.text ?? p.result.subtype) : null) ?? stderr.trim().split('\n').pop() ?? '').trim()
  let msg = raw
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)
  if (m) { try { msg = JSON.parse(`"${m[1]}"`) } catch { msg = m[1]! } }
  msg = msg.replace(/tax_[A-Za-z0-9_-]+/g, 'tax_…').replace(/\s+/g, ' ').trim()
  if (/[가-힣]/.test(msg)) return msg.slice(0, 400)
  if (/\b401\b|authentication|unauthorized|invalid (x-)?api.?key/i.test(msg)) return '허브 인증에 실패했어요. 관리자에게 알려 주세요.'
  if (/rate.?limit|\b429\b|\b529\b|overloaded/i.test(msg)) return 'Anthropic 서버가 바빠서 답하지 못했어요. 잠시 뒤 다시 해 주세요.'
  if (/prompt is too long|context (window|length)|too many tokens/i.test(msg)) return '대화가 너무 길어졌어요. 새 대화에서 다시 물어봐 주세요.'
  if (/max.?turns/i.test(msg)) return '작업 단계가 너무 많아서 멈췄어요. 질문을 나눠서 다시 해 주세요.'
  if (!msg) return code === null ? 'Claude가 답하지 못했어요.' : `Claude가 답하지 못했어요. (종료 코드 ${code})`
  return `Claude가 답하지 못했어요. (${msg.slice(0, 200)})`
}

function toolStatus(name: string, input: Record<string, unknown>): string {
  const tool = name.startsWith(`mcp__${PRODUCT.mcpName}__`) ? name.slice(`mcp__${PRODUCT.mcpName}__`.length) : name
  const p = typeof input.path === 'string' ? input.path : typeof input.from === 'string' ? input.from : ''
  const where = p ? `: ${p.slice(0, 80)}` : ''
  switch (tool) {
    case 'list_files': return `폴더를 살펴보고 있어요${where}`
    case 'read_file': return `파일을 읽고 있어요${where}`
    case 'search_files': return `파일을 찾고 있어요${typeof input.query === 'string' ? `: ${input.query.slice(0, 40)}` : ''}`
    case 'write_file': case 'edit_file': return `파일을 저장하고 있어요${where}`
    case 'make_folder': return `폴더를 만들고 있어요${where}`
    case 'move_file': return `파일을 옮기고 있어요${where}`
    case 'delete_file': return `파일을 휴지통으로 옮기고 있어요${where}`
    case 'read_skill': return `스킬을 열고 있어요${typeof input.name === 'string' ? `: ${input.name.slice(0, 40)}` : ''}`
    default: return '작업하고 있어요'
  }
}

interface Waiting { job: JobRow; settle: () => void; settled: Promise<void> }
interface Active extends Waiting {
  proc: Subprocess | null
  parser: StreamParser | null
  stop: 'user' | 'shutdown' | null
  timedOut: boolean
  killTimer: Timer | null
}

const MAX_RESULT = 500_000

export class HubRunner {
  private queue: Waiting[] = []
  private active = new Map<string, Active>()
  private selfUrl: string | null = null
  private stopping = false
  opts: HubOptions

  constructor(private ctx: Ctx, private hooks: Record<JobKind, KindHooks>, opts: Partial<HubOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts }
  }

  get started() { return this.selfUrl !== null }
  private get hubDir() { return path.join(this.ctx.config.dataDir, 'hub') }
  private get limit() { return Math.max(1, Math.min(10, Math.floor(this.ctx.config.hubConcurrency) || 1)) }

  /** Mark what a previous process left queued/running as failed, clean its folders, then start running jobs. */
  start(selfUrl: string) {
    this.selfUrl = selfUrl.replace(/\/+$/, '')
    this.stopping = false
    this.recover()
    this.pump()
  }

  recover(): number {
    const known = (id: string) => this.active.has(id) || this.queue.some((q) => q.job.id === id)
    const rows = (this.ctx.db.query("SELECT * FROM hub_jobs WHERE status IN ('queued','running')").all() as JobRow[]).filter((r) => !known(r.id))
    for (const r of rows) {
      this.ctx.db.query("UPDATE tokens SET revoked_at = ? WHERE kind = 'hub' AND name = ? AND revoked_at IS NULL").run(nowIso(), `hub:${r.id}`)
      this.finalize(r, this.failed(MSG.restarted))
    }
    const work = path.join(this.hubDir, 'work')
    try { for (const d of fs.readdirSync(work)) if (!known(d)) fs.rmSync(path.join(work, d), { recursive: true, force: true }) } catch { /* none yet */ }
    if (rows.length) this.ctx.log.info('hub jobs of the previous run marked failed', { count: rows.length })
    return rows.length
  }

  enqueue(o: { kind: JobKind; userId: string; chatId?: string | null; scheduleId?: string | null; prompt: string }): string {
    const id = newId()
    this.ctx.db.query("INSERT INTO hub_jobs (id, kind, user_id, chat_id, schedule_id, prompt, status, created_at) VALUES (?,?,?,?,?,?,'queued',?)")
      .run(id, o.kind, o.userId, o.chatId ?? null, o.scheduleId ?? null, o.prompt, nowIso())
    const job = this.ctx.db.query('SELECT * FROM hub_jobs WHERE id = ?').get(id) as JobRow
    let settle = () => {}
    const settled = new Promise<void>((r) => { settle = r })
    this.queue.push({ job, settle, settled })
    this.announceQueue()
    // the caller finishes its own writes (the chat message) before the job can start
    queueMicrotask(() => this.pump())
    return id
  }

  /** Resolves when the job has ended (any final status). */
  wait(jobId: string): Promise<void> {
    return this.active.get(jobId)?.settled ?? this.queue.find((q) => q.job.id === jobId)?.settled ?? Promise.resolve()
  }

  /** Jobs ahead of a queued job (running ones + queued before it); null when it is not waiting. */
  position(jobId: string): number | null {
    const i = this.queue.findIndex((q) => q.job.id === jobId)
    return i < 0 ? null : this.active.size + i
  }

  /** What a running job has written so far (live view after a reconnect). */
  liveText(jobId: string): string | null {
    return this.active.get(jobId)?.parser?.text ?? null
  }

  isRunning(jobId: string) { return this.active.has(jobId) }

  stats() { return { running: this.active.size, queued: this.queue.length, limit: this.limit } }

  /** Cancel a queued or running job. */
  cancel(jobId: string): boolean {
    const i = this.queue.findIndex((q) => q.job.id === jobId)
    if (i >= 0) {
      const [w] = this.queue.splice(i, 1)
      this.finalize(w!.job, { ...this.failed(MSG.cancelled), status: 'cancelled' })
      w!.settle()
      this.announceQueue()
      return true
    }
    const a = this.active.get(jobId)
    if (!a) return false
    a.stop ??= 'user'
    this.kill(a)
    return true
  }

  /** Server shutdown: queued jobs fail, running ones are stopped; resolves when every job has settled. */
  async stop() {
    this.stopping = true
    const waits: Promise<void>[] = []
    for (const w of this.queue.splice(0)) { this.finalize(w.job, this.failed(MSG.restarted)); w.settle() }
    for (const a of this.active.values()) { a.stop ??= 'shutdown'; this.kill(a); waits.push(a.settled) }
    await Promise.all(waits)
  }

  // ---------------------------------------------------------------------------------------------------------------

  private pump() {
    if (!this.started || this.stopping) return
    let startedAny = false
    while (this.active.size < this.limit && this.queue.length) {
      const w = this.queue.shift()!
      const a: Active = { ...w, proc: null, parser: null, stop: null, timedOut: false, killTimer: null }
      this.active.set(w.job.id, a)
      startedAny = true
      void this.execute(a)
    }
    if (startedAny) this.announceQueue()
  }

  private emit(job: JobRow, type: JobEvent['type'], text: string, state: JobStatus, position?: number) {
    const ev: JobEvent = { jobId: job.id, chatId: job.chat_id, scheduleId: job.schedule_id, userId: job.user_id, type, text, state, ...(position === undefined ? {} : { position }) }
    try { this.ctx.events.emit('job', ev) } catch (e) { this.ctx.log.warn('hub event listener failed', { err: String(e) }) }
  }

  private announceQueue() {
    this.queue.forEach((w, i) => {
      const ahead = this.active.size + i
      this.emit(w.job, 'status', ahead > 0 ? `앞에 ${ahead}개 작업이 있어요.` : '곧 시작해요.', 'queued', ahead)
    })
  }

  private failed(error: string): Outcome {
    return { status: 'failed', text: null, error, costUsd: 0, sessionId: null, model: null, newSession: false }
  }

  private async execute(a: Active) {
    const job = a.job
    const startedAt = nowIso()
    this.ctx.db.query("UPDATE hub_jobs SET status = 'running', started_at = ? WHERE id = ?").run(startedAt, job.id)
    job.status = 'running'
    job.started_at = startedAt
    this.emit(job, 'status', job.kind === 'chat' ? '답을 쓰고 있어요…' : '실행하고 있어요…', 'running')
    let out: Outcome
    try {
      out = await this.run(a)
    } catch (e) {
      this.ctx.log.error('hub job crashed', { job: job.id, err: String((e as Error)?.message ?? e).slice(0, 300) })
      out = this.failed(MSG.internal)
    }
    this.finalize(job, out)
    this.active.delete(job.id)
    a.settle()
    this.pump()
  }

  /** The kind's finish hook, then the job row and the final event. Never throws. */
  private finalize(job: JobRow, out: Outcome) {
    try { out = this.hooks[job.kind].finish(job, out) } catch (e) {
      this.ctx.log.error('hub job finish failed', { job: job.id, err: String((e as Error)?.message ?? e).slice(0, 300) })
      if (out.status === 'done') out = { ...out, status: 'failed', error: MSG.internal }
    }
    const text = out.text && out.text.length > MAX_RESULT ? out.text.slice(0, MAX_RESULT) + '\n\n…(너무 길어서 잘랐어요)' : out.text
    try {
      this.ctx.db.query('UPDATE hub_jobs SET status = ?, result = ?, error = ?, cost_usd = ?, finished_at = ?, output_path = ? WHERE id = ?')
        .run(out.status, text, out.status === 'done' ? null : out.error, out.costUsd, nowIso(), out.outputPath ?? null, job.id)
    } catch (e) {
      this.ctx.log.error('hub job update failed', { job: job.id, err: String((e as Error)?.message ?? e).slice(0, 300) })
    }
    job.status = out.status
    this.emit(job, out.status === 'done' ? 'done' : 'error', out.status === 'done' ? text ?? '' : out.error ?? '', out.status)
  }

  private dirsFor(jobId: string, userId: string): JobDirs {
    if (!SAFE_ID.test(jobId) || !SAFE_ID.test(userId)) throw new Error('unsafe id')
    const work = path.join(this.hubDir, 'work', jobId)
    const home = path.join(this.hubDir, 'claude', userId)
    for (const d of [this.hubDir, path.join(this.hubDir, 'work'), path.join(this.hubDir, 'claude')]) fs.mkdirSync(d, { recursive: true, mode: 0o700 })
    fs.mkdirSync(home, { recursive: true, mode: 0o700 })
    fs.mkdirSync(work, { mode: 0o700 })
    const cwd = path.join(work, 'cwd')
    const tmp = path.join(work, 'tmp')
    fs.mkdirSync(cwd, { mode: 0o700 })
    fs.mkdirSync(tmp, { mode: 0o700 })
    return { work, cwd, tmp, home, mcpFile: path.join(work, 'mcp.json') }
  }

  private async run(a: Active): Promise<Outcome> {
    const job = a.job
    const bin = this.ctx.config.claudeBin
    if (!bin) return this.failed(MSG.noClaude)
    const user = loadPrincipal(this.ctx.db, job.user_id)
    if (!user) return this.failed(MSG.disabled)
    if (a.stop) return this.stopped(a, null)
    const prep = this.hooks[job.kind].prepare(job, user)
    const resume = prep.resume && isSessionId(prep.resume.sessionId) ? { sessionId: prep.resume.sessionId, model: okModel(prep.resume.model) ? prep.resume.model : null } : null
    const dirs = this.dirsFor(job.id, user.id)
    const tok = issueToken(this.ctx.db, user.id, 'hub', `hub:${job.id}`, this.opts.tokenTtlMs)
    try {
      let r = await this.attempt(a, bin, prep, resume, tok.token, dirs)
      if (r.resumeMissing) {
        // the chat's Claude session is gone (config folder cleared): start a new one instead of failing
        this.ctx.log.info('hub session to resume not found, starting a new one', { job: job.id })
        r = await this.attempt(a, bin, prep, null, tok.token, dirs)
      }
      return r.outcome
    } finally {
      revokeToken(this.ctx.db, tok.id)
      fs.rmSync(dirs.work, { recursive: true, force: true })
    }
  }

  private stopped(a: Active, p: StreamParser | null): Outcome {
    const base = { costUsd: p?.result?.costUsd ?? 0, sessionId: p?.sessionId ?? null, model: p?.model ?? null, newSession: false, text: p?.text || null }
    return a.stop === 'user' ? { ...base, status: 'cancelled', error: MSG.cancelled } : { ...base, status: 'failed', error: MSG.restarted }
  }

  private async attempt(a: Active, bin: string, prep: Prepared, resume: Prepared['resume'], token: string, dirs: JobDirs): Promise<{ outcome: Outcome; resumeMissing: boolean }> {
    const job = a.job
    const launch = buildLaunch({ bin, selfUrl: this.selfUrl!, jobId: job.id, token, systemPrompt: prep.systemPrompt, resume, persist: prep.persist, dirs, tz: process.env.TZ })
    fs.writeFileSync(dirs.mcpFile, JSON.stringify(launch.mcpConfig), { mode: 0o600 })
    const parser = new StreamParser()
    a.parser = parser
    if (a.stop) return { outcome: this.stopped(a, parser), resumeMissing: false }
    let proc: Subprocess<Blob, 'pipe', 'pipe'>
    try {
      proc = Bun.spawn(launch.cmd, { cwd: dirs.cwd, env: launch.env, stdin: new Blob([job.prompt]), stdout: 'pipe', stderr: 'pipe', detached: true })
    } catch (e) {
      this.ctx.log.error('hub job spawn failed', { job: job.id, err: String((e as Error)?.message ?? e).slice(0, 200) })
      return { outcome: this.failed(MSG.spawn), resumeMissing: false }
    }
    a.proc = proc
    a.timedOut = false
    const timer = setTimeout(() => { a.timedOut = true; this.kill(a) }, this.opts.timeoutMs)
    const stderr = new TextTail(4000)
    const readOut = (async () => {
      const lines = new Utf8Lines()
      try {
        for await (const chunk of proc.stdout) for (const l of lines.push(chunk)) this.onLine(a, parser, l)
      } catch { /* pipe closed */ }
      for (const l of lines.end()) this.onLine(a, parser, l)
    })()
    const readErr = (async () => { try { for await (const chunk of proc.stderr) stderr.push(chunk) } catch { /* closed */ } })()
    const code = await proc.exited
    clearTimeout(timer)
    if (a.killTimer) { clearTimeout(a.killTimer); a.killTimer = null }
    // a child left behind holding the pipes open goes with its group
    const drained = await Promise.race([Promise.all([readOut, readErr]).then(() => true), Bun.sleep(2000).then(() => false)])
    if (!drained) { signalGroup(proc.pid, 'SIGKILL'); await Promise.race([Promise.all([readOut, readErr]), Bun.sleep(1000)]) }
    a.proc = null

    if (a.stop) return { outcome: this.stopped(a, parser), resumeMissing: false }
    const base = { costUsd: parser.result?.costUsd ?? 0, sessionId: isSessionId(parser.sessionId) ? parser.sessionId : null, model: okModel(parser.model) ? parser.model : null, newSession: !resume }
    if (a.timedOut) {
      return { outcome: { ...base, status: 'failed', text: parser.text || null, error: `시간이 너무 오래 걸려서 멈췄어요 (최대 ${durationLabel(this.opts.timeoutMs)}). 질문을 나눠서 다시 해 보세요.` }, resumeMissing: false }
    }
    if (resume && !parser.sawInit && /no conversation found/i.test(stderr.value)) return { outcome: this.failed(MSG.internal), resumeMissing: true }
    if (parser.result && !parser.result.isError && !parser.apiError) {
      const text = prep.finalText === 'last' ? (parser.result.text || parser.lastText || parser.text) : (parser.text || parser.result.text || '')
      return { outcome: { ...base, status: 'done', text: text.trim(), error: null }, resumeMissing: false }
    }
    const error = failureMessage(parser, stderr.value, code)
    this.ctx.log.warn('hub job failed', { job: job.id, code, sawInit: parser.sawInit, stderr: stderr.value.replace(/tax_[A-Za-z0-9_-]+/g, 'tax_…').slice(-300) })
    return { outcome: { ...base, status: 'failed', text: parser.text || null, error }, resumeMissing: false }
  }

  private onLine(a: Active, parser: StreamParser, line: string) {
    for (const ev of parser.push(line)) {
      if (ev.type === 'text') this.emit(a.job, 'text', ev.delta, 'running')
      else if (ev.type === 'tool') this.emit(a.job, 'status', toolStatus(ev.name, ev.input), 'running')
    }
  }

  private kill(a: Active) {
    const p = a.proc
    if (!p || p.exitCode !== null || p.signalCode !== null) return
    signalGroup(p.pid, 'SIGTERM')
    a.killTimer ??= setTimeout(() => { if (p.exitCode === null && p.signalCode === null) signalGroup(p.pid, 'SIGKILL') }, this.opts.killGraceMs)
  }
}
