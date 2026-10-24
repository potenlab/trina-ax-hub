// Hub sessions: the job runner with a fake claude (never the real CLI, never the network).
import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { sha256 } from '../../src/ids'
import { verifyToken } from '../../src/auth/tokens'
import { updateUser } from '../../src/auth/users'
import { ALLOWED_TOOLS, LOCK_SETTINGS, MSG, type JobEvent } from '../../src/hub/runner'
import { createChat, addMessage, chatMessages } from '../../src/hub/chats'
import { hubFor } from '../../src/hub/service'
import { testHub } from '../lib/hub'
import { fakeHub, jobRow, orderLog, record, starts, waitFor, type FakeHub } from './hub-fixtures'

const hubs: FakeHub[] = []
afterAll(async () => { for (const h of hubs) await h.stop() })
const make = async (o: Parameters<typeof fakeHub>[0] = {}) => { const h = await fakeHub(o); hubs.push(h); return h }

const tokenRow = (h: FakeHub, token: string) => h.t.ctx.db.query('SELECT * FROM tokens WHERE token_hash = ?').get(sha256(token)) as any

/** collect ctx.events 'job' payloads for one job */
function listen(h: FakeHub) {
  const evs: JobEvent[] = []
  h.t.ctx.events.on('job', (e: JobEvent) => evs.push(e))
  return { evs, of: (id: string) => evs.filter((e) => e.jobId === id) }
}

describe('hub runner: command line and environment', async () => {
  const h = await make()
  const kim = await h.t.user('kim')
  const chat = createChat(h.t.ctx, kim.id, '안녕')
  const events = listen(h)
  const leak = 'TRINA_TEST_PARENT_SECRET'
  process.env[leak] = 'do-not-leak'
  const job1 = h.hub.runner.enqueue({ kind: 'chat', userId: kim.id, chatId: chat.id, prompt: '-첫 질문 [slow]' })
  addMessage(h.t.ctx, chat.id, 'user', '-첫 질문 [slow]', job1)
  // while it runs: the token works for that person
  const running = await waitFor(() => { try { return record(h.fake, job1) } catch { return null } }, 8000, 'fake start')
  const liveAuth = verifyToken(h.t.ctx.db, running.env.ANTHROPIC_AUTH_TOKEN)
  await h.hub.runner.wait(job1)
  delete process.env[leak]
  const r1 = record(h.fake, job1)
  const home = path.join(h.t.ctx.config.dataDir, 'hub', 'claude', kim.id)
  const work = path.join(h.t.ctx.config.dataDir, 'hub', 'work', job1)

  test('exact flags', () => {
    const sys = r1.args[r1.args.indexOf('--append-system-prompt') + 1]!
    expect(r1.args).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '',
      '--strict-mcp-config', '--mcp-config', path.join(work, 'mcp.json'),
      '--allowedTools', ALLOWED_TOOLS.join(','),
      '--permission-mode', 'dontAsk',
      '--setting-sources', '',
      '--settings', JSON.stringify(LOCK_SETTINGS),
      '--disable-slash-commands',
      '--append-system-prompt', sys,
    ])
    expect(ALLOWED_TOOLS).toEqual(['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'make_folder', 'move_file', 'delete_file', 'read_skill'].map((t) => `mcp__trina__${t}`))
    // the prompt goes on stdin (a prompt starting with '-' would otherwise be read as a flag)
    expect(r1.stdin).toBe('-첫 질문 [slow]')
    expect(r1.cwd).toBe(path.join(work, 'cwd'))
  })

  test('system prompt: who, Korean, trina tools only, personal folder', () => {
    const sys = r1.args[r1.args.indexOf('--append-system-prompt') + 1]!
    expect(sys).toContain('kim님')
    expect(sys).toContain('한국어')
    expect(sys).toContain('mcp__trina__read_file')
    expect(sys).toContain(`users/${kim.id}/`)
    expect(sys.length).toBeLessThan(4000)
  })

  test('MCP config points at the hub with the job token', () => {
    const token = r1.env.ANTHROPIC_AUTH_TOKEN!
    expect(r1.mcp).toEqual({ mcpServers: { trina: { type: 'http', url: h.t.url + '/mcp', headers: { Authorization: `Bearer ${token}` } } } })
  })

  test('environment is built from scratch', () => {
    const env = { ...r1.env }
    for (const k of ['PWD', 'SHLVL', '_', 'OLDPWD']) delete env[k] // set by bash itself
    const token = env.ANTHROPIC_AUTH_TOKEN!
    expect(env).toEqual({
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: home,
      CLAUDE_CONFIG_DIR: home,
      LANG: 'en_US.UTF-8',
      TMPDIR: path.join(work, 'tmp'),
      CLAUDE_CODE_TMPDIR: path.join(work, 'tmp'),
      ANTHROPIC_BASE_URL: h.t.url,
      ANTHROPIC_AUTH_TOKEN: token,
      ANTHROPIC_CUSTOM_HEADERS: `x-trina-job: ${job1}`,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: '1',
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
      CLAUDE_CODE_DISABLE_FILE_MENTIONS: '1',
      CLAUDE_CODE_DISABLE_ATTACHMENTS: '1',
      ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
    })
    expect(r1.env[leak]).toBeUndefined()
    expect(r1.env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('a 2-hour hub token of that person, revoked when the job ends', () => {
    const row = tokenRow(h, r1.env.ANTHROPIC_AUTH_TOKEN!)
    expect(liveAuth?.user.id).toBe(kim.id)
    expect(liveAuth?.token.kind).toBe('hub')
    expect(row.user_id).toBe(kim.id)
    expect(row.kind).toBe('hub')
    expect(row.name).toBe(`hub:${job1}`)
    const ttl = Date.parse(row.expires_at) - Date.parse(row.created_at)
    expect(ttl).toBeGreaterThan(2 * 3600_000 - 5000)
    expect(ttl).toBeLessThanOrEqual(2 * 3600_000 + 1000)
    expect(row.revoked_at).not.toBeNull()
    expect(verifyToken(h.t.ctx.db, r1.env.ANTHROPIC_AUTH_TOKEN!)).toBeNull()
  })

  test('result, cost, session and progress events', () => {
    const j = jobRow(h, job1)
    expect(j.status).toBe('done')
    expect(j.result).toBe('안녕하세요. 1번째 답이에요.')
    expect(j.cost_usd).toBeCloseTo(0.0123)
    const c = h.t.ctx.db.query('SELECT session_id, model FROM hub_chats WHERE id = ?').get(chat.id) as any
    expect(c.session_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(c.model).toBe('claude-opus-5-5')
    const evs = events.of(job1)
    expect(evs.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('안녕하세요. 1번째 답이에요.')
    expect(evs.every((e) => e.chatId === chat.id && e.userId === kim.id)).toBe(true)
    expect(evs.some((e) => e.type === 'status' && e.state === 'running')).toBe(true)
    expect(evs.at(-1)).toMatchObject({ type: 'done', text: '안녕하세요. 1번째 답이에요.', state: 'done' })
    expect(chatMessages(h.t.ctx, chat.id).map((m) => [m.role, m.text])).toEqual([['user', '-첫 질문 [slow]'], ['assistant', '안녕하세요. 1번째 답이에요.']])
  })

  test('work folder removed, Claude home kept per person', () => {
    expect(fs.existsSync(work)).toBe(false)
    expect(fs.statSync(home).mode & 0o777).toBe(0o700)
  })

  test('the next turn resumes the session with the same model', async () => {
    const sid = (h.t.ctx.db.query('SELECT session_id FROM hub_chats WHERE id = ?').get(chat.id) as any).session_id
    const job2 = h.hub.runner.enqueue({ kind: 'chat', userId: kim.id, chatId: chat.id, prompt: '두 번째 질문' })
    await h.hub.runner.wait(job2)
    const r2 = record(h.fake, job2)
    expect(r2.args.slice(-4)).toEqual(['--resume', sid, '--model', 'claude-opus-5-5'])
    expect(r2.env.CLAUDE_CONFIG_DIR).toBe(home)
    expect(r2.env.ANTHROPIC_AUTH_TOKEN).not.toBe(r1.env.ANTHROPIC_AUTH_TOKEN)
    expect(jobRow(h, job2).result).toBe('안녕하세요. 2번째 답이에요.')
  })

  test('a lost session starts a new one instead of failing', async () => {
    const before = (h.t.ctx.db.query('SELECT session_id FROM hub_chats WHERE id = ?').get(chat.id) as any).session_id
    fs.rmSync(path.join(home, 'projects'), { recursive: true, force: true })
    const job3 = h.hub.runner.enqueue({ kind: 'chat', userId: kim.id, chatId: chat.id, prompt: '세 번째' })
    await h.hub.runner.wait(job3)
    expect(starts(h.fake, job3)).toBe(2)
    expect(record(h.fake, job3, 1).args).toContain('--resume')
    expect(record(h.fake, job3, 2).args).not.toContain('--resume')
    const j = jobRow(h, job3)
    expect(j.status).toBe('done')
    expect(j.result).toBe('안녕하세요. 1번째 답이에요.')
    const after = (h.t.ctx.db.query('SELECT session_id FROM hub_chats WHERE id = ?').get(chat.id) as any).session_id
    expect(after).not.toBe(before)
  })
})

describe('hub runner: queue', async () => {
  const h = await make({ concurrency: 2 })
  const u = await h.t.user('queue')
  const events = listen(h)

  test('at most `hubConcurrency` at once, first in first out, queue positions announced', async () => {
    const ids = [1, 2, 3, 4].map((i) => h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: `작업 ${i} [slow]` }))
    // positions right after enqueueing (before anything started): 0,1,2,3 ahead
    expect(ids.map((id) => h.hub.runner.position(id))).toEqual([0, 1, 2, 3])
    await Promise.all(ids.map((id) => h.hub.runner.wait(id)))
    const startOrder = events.evs.filter((e) => e.type === 'status' && e.state === 'running').map((e) => e.jobId)
    expect(startOrder).toEqual(ids)
    // overlap of the fake processes never above 2
    let live = 0, max = 0
    for (const l of orderLog(h.fake)) { live += l.startsWith('start') ? 1 : -1; max = Math.max(max, live) }
    expect(max).toBe(2)
    // the 4th job was told how many were ahead of it while waiting
    const waits = events.of(ids[3]!).filter((e) => e.type === 'status' && e.state === 'queued').map((e) => e.text)
    expect(waits).toContain('앞에 3개 작업이 있어요.')
    expect(waits).toContain('앞에 2개 작업이 있어요.')
    for (const id of ids) expect(jobRow(h, id).status).toBe('done')
  })

  test('cancel a queued job and a running one', async () => {
    const a = h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: '[hang]' })
    const b = h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: '[hang]' })
    const c = h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: 'never runs' })
    await waitFor(() => h.hub.runner.isRunning(a) && h.hub.runner.isRunning(b), 5000, 'two running')
    expect(h.hub.runner.cancel(c)).toBe(true)
    expect(jobRow(h, c).status).toBe('cancelled')
    expect(h.hub.runner.cancel(a)).toBe(true)
    expect(h.hub.runner.cancel(b)).toBe(true)
    await Promise.all([h.hub.runner.wait(a), h.hub.runner.wait(b)])
    expect(jobRow(h, a).status).toBe('cancelled')
    expect(jobRow(h, b).status).toBe('cancelled')
    expect(starts(h.fake, c)).toBe(0)
  })
})

describe('hub runner: timeouts and failures', async () => {
  const h = await make({ timeoutMs: 700, killGraceMs: 300 })
  const u = await h.t.user('slowpoke')
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

  test('a hanging run is stopped (SIGTERM) and fails with a Korean reason', async () => {
    const id = h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: '[hang]' })
    const t0 = Date.now()
    await h.hub.runner.wait(id)
    expect(Date.now() - t0).toBeLessThan(4000)
    const j = jobRow(h, id)
    expect(j.status).toBe('failed')
    expect(j.error).toContain('시간이 너무 오래 걸려서 멈췄어요')
    expect(j.result).toBe('생각하는 중')
    expect(alive(record(h.fake, id).pid)).toBe(false)
  })

  test('a run that ignores SIGTERM gets SIGKILL, with its children', async () => {
    const id = h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: '[hang-hard]' })
    await h.hub.runner.wait(id)
    expect(jobRow(h, id).status).toBe('failed')
    const pid = record(h.fake, id).pid
    expect(alive(pid)).toBe(false)
    // no stray `sleep` of that process group either
    const ps = Bun.spawnSync(['/bin/ps', '-o', 'pid=', '-g', String(pid)]).stdout.toString().trim()
    expect(ps).toBe('')
  })

  test('an API error shows the relay message; a crash shows a plain message', async () => {
    const a = h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: '[fail]' })
    const b = h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: '[crash]' })
    await Promise.all([h.hub.runner.wait(a), h.hub.runner.wait(b)])
    expect(jobRow(h, a)).toMatchObject({ status: 'failed', error: '이번 달 사용 한도를 넘었어요. 관리자에게 문의해 주세요.' })
    expect(jobRow(h, b).status).toBe('failed')
    expect(jobRow(h, b).error).toContain('Claude가 답하지 못했어요')
  })

  test('tokens of finished jobs are all revoked', () => {
    const open = h.t.ctx.db.query("SELECT COUNT(*) AS n FROM tokens WHERE kind = 'hub' AND revoked_at IS NULL").get() as any
    expect(open.n).toBe(0)
  })

  test('a disabled account does not run', async () => {
    const off = await h.t.user('offline')
    updateUser(h.t.ctx.db, off.id, { status: 'disabled' })
    const id = h.hub.runner.enqueue({ kind: 'schedule', userId: off.id, prompt: 'hi' })
    await h.hub.runner.wait(id)
    expect(jobRow(h, id)).toMatchObject({ status: 'failed', error: MSG.disabled })
    expect(starts(h.fake, id)).toBe(0)
  })
})

describe('hub runner: no claude, restart recovery', () => {
  test('without claude a job fails with a clear message', async () => {
    const h = await make({ claude: false })
    const u = await h.t.user('noclaude')
    const chat = createChat(h.t.ctx, u.id, 'x')
    const id = h.hub.runner.enqueue({ kind: 'chat', userId: u.id, chatId: chat.id, prompt: 'x' })
    await h.hub.runner.wait(id)
    expect(jobRow(h, id)).toMatchObject({ status: 'failed', error: MSG.noClaude })
    expect(chatMessages(h.t.ctx, chat.id).at(-1)).toMatchObject({ role: 'error', text: MSG.noClaude })
    const tokens = h.t.ctx.db.query("SELECT COUNT(*) AS n FROM tokens WHERE kind = 'hub'").get() as any
    expect(tokens.n).toBe(0)
  })

  test('jobs left queued/running by a previous process fail at start', async () => {
    const t = await testHub()
    try {
      const u = await t.user('restart')
      const db = t.ctx.db
      const chat = createChat(t.ctx, u.id, '질문')
      const now = new Date().toISOString()
      db.query("INSERT INTO hub_jobs (id, kind, user_id, chat_id, prompt, status, created_at, started_at) VALUES ('oldrun1', 'chat', ?, ?, 'q', 'running', ?, ?)").run(u.id, chat.id, now, now)
      db.query("INSERT INTO hub_jobs (id, kind, user_id, prompt, status, created_at) VALUES ('oldwait1', 'schedule', ?, 'q', 'queued', ?)").run(u.id, now)
      db.query("INSERT INTO hub_jobs (id, kind, user_id, prompt, status, created_at, finished_at) VALUES ('olddone1', 'schedule', ?, 'q', 'done', ?, ?)").run(u.id, now, now)
      const tok = t.token(u.id, 'hub')
      db.query("UPDATE tokens SET name = 'hub:oldrun1' WHERE token_hash = ?").run(sha256(tok))
      const stale = path.join(t.ctx.config.dataDir, 'hub', 'work', 'oldrun1')
      fs.mkdirSync(path.join(stale, 'cwd'), { recursive: true })
      const hub = hubFor(t.ctx)
      hub.start(t.url, { scheduler: false })
      const row = (id: string) => db.query('SELECT status, error FROM hub_jobs WHERE id = ?').get(id) as any
      expect(row('oldrun1')).toEqual({ status: 'failed', error: '서버가 다시 시작되어 중단됐어요' })
      expect(row('oldwait1')).toEqual({ status: 'failed', error: '서버가 다시 시작되어 중단됐어요' })
      expect(row('olddone1').status).toBe('done')
      expect(chatMessages(t.ctx, chat.id).at(-1)).toMatchObject({ role: 'error', text: '서버가 다시 시작되어 중단됐어요' })
      expect(verifyToken(db, tok)).toBeNull()
      expect(fs.existsSync(stale)).toBe(false)
      await hub.stop()
    } finally { await t.stop() }
  })

  test('stopping the server fails what is queued and stops what runs', async () => {
    const h = await fakeHub({ concurrency: 1 })
    const u = await h.t.user('shutdown')
    const a = h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: '[hang]' })
    const b = h.hub.runner.enqueue({ kind: 'schedule', userId: u.id, prompt: 'waiting' })
    await waitFor(() => h.hub.runner.isRunning(a), 5000, 'running')
    await h.hub.stop()
    expect(jobRow(h, a)).toMatchObject({ status: 'failed', error: '서버가 다시 시작되어 중단됐어요' })
    expect(jobRow(h, b)).toMatchObject({ status: 'failed', error: '서버가 다시 시작되어 중단됐어요' })
    await h.t.stop()
    fs.rmSync(h.fake.dir, { recursive: true, force: true })
  })
})
