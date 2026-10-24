// Test fixtures for hub sessions: a fake `claude` (bash) and a test hub wired to it. The fake never touches the
// network; it records how it was started and prints stream-json shaped like Claude Code 2.1.309's output.
//
// Modes, picked by markers in the prompt (stdin):
//   [slow]       three text deltas 0.4 s apart        [tool]    a read_file tool call before the answer
//   [report]     a preamble message, then a Markdown report as the final message (schedules keep only the last)
//   [fail]       an API error (relay 403 with a Korean message), exit 1
//   [crash]      stderr only, exit 3                 [hang]    prints a little, then never ends (SIGTERM stops it)
//   [hang-hard]  ignores SIGTERM (needs SIGKILL)
// Sessions: a new run creates $CLAUDE_CONFIG_DIR/projects/-fake-project/<uuid>.jsonl; --resume <id> needs that file
// (else "No conversation found", like the real CLI) and answers "<n>번째 답이에요" for the n-th turn.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { hubFor, type HubService } from '../../src/hub/service'
import type { Config } from '../../src/config'

const FAKE = fs.readFileSync(path.join(import.meta.dir, 'hub-fake-claude.sh'), 'utf8')

export interface Fake { bin: string; rec: string; dir: string }

export function writeFakeClaude(): Fake {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trina-ax-fake-claude-')))
  const rec = path.join(dir, 'rec')
  fs.mkdirSync(rec)
  const bin = path.join(dir, 'claude')
  fs.writeFileSync(bin, FAKE.replace('__REC__', rec), { mode: 0o755 })
  return { bin, rec, dir }
}

export interface Record_ { args: string[]; env: Record<string, string>; cwd: string; stdin: string; mcp: any; pid: number }

/** What the fake saw on its n-th start for a job. */
export function record(fake: Fake, jobId: string, n = 1): Record_ {
  const base = path.join(fake.rec, `${jobId}.${n}`)
  const args = fs.readFileSync(base + '.args', 'utf8').split('\0')
  args.pop()
  const env: Record<string, string> = {}
  for (const line of fs.readFileSync(base + '.env', 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1)
  }
  let mcp: any = null
  try { mcp = JSON.parse(fs.readFileSync(base + '.mcp', 'utf8')) } catch {}
  return { args, env, cwd: fs.readFileSync(base + '.cwd', 'utf8').trim(), stdin: fs.readFileSync(base + '.stdin', 'utf8'), mcp, pid: Number(fs.readFileSync(base + '.pid', 'utf8')) }
}

export const starts = (fake: Fake, jobId: string) => fs.readdirSync(fake.rec).filter((f) => f.startsWith(jobId + '.') && f.endsWith('.args')).length
export const orderLog = (fake: Fake) => { try { return fs.readFileSync(path.join(fake.rec, 'order.log'), 'utf8').trim().split('\n').filter(Boolean) } catch { return [] } }

export interface FakeHub { t: TestHub; hub: HubService; fake: Fake; stop(): Promise<void> }

/** A test hub whose hub sessions run the fake claude (runner started, scheduler off unless asked). */
export async function fakeHub(o: { concurrency?: number; timeoutMs?: number; killGraceMs?: number; claude?: boolean; start?: boolean; scheduler?: boolean; config?: Partial<Config> } = {}): Promise<FakeHub> {
  const fake = writeFakeClaude()
  const t = await testHub({ config: { claudeBin: o.claude === false ? null : fake.bin, hubConcurrency: o.concurrency ?? 2, ...o.config } })
  const hub = hubFor(t.ctx, { timeoutMs: o.timeoutMs ?? 20_000, killGraceMs: o.killGraceMs ?? 500 })
  if (o.start !== false) hub.start(t.url, { scheduler: o.scheduler ?? false })
  return {
    t, hub, fake,
    async stop() {
      await hub.stop()
      await t.stop()
      fs.rmSync(fake.dir, { recursive: true, force: true })
    },
  }
}

export async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs = 8000, label = 'condition'): Promise<T> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(25)
  }
}

export const jobRow = (h: FakeHub, id: string) => h.t.ctx.db.query('SELECT * FROM hub_jobs WHERE id = ?').get(id) as any

/** Form post with the session cookie (no redirect following). */
export async function post(h: FakeHub, cookie: string, pathname: string, fields: Record<string, string>) {
  return fetch(h.t.url + pathname, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
    body: new URLSearchParams(fields).toString(),
  })
}

export async function get(h: FakeHub, cookie: string, pathname: string) {
  return fetch(h.t.url + pathname, { redirect: 'manual', headers: { cookie, accept: 'text/html' } })
}
