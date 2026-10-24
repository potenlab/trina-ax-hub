// Model relay against a fake Anthropic (Bun.serve on a random port). The fake checks it got the company key and never
// the device token, records what it was sent, and answers per scenario (the first user message names it).
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { revokeToken, issueToken } from '../../src/auth/tokens'
import { budgetBlock, createBudget } from '../../src/usage/budgets'
import type { Log } from '../../src/log'
import { MSG } from '../../src/relay/proxy'

const COMPANY_KEY = 'sk-ant-api03-company-key-for-tests'
const enc = new TextEncoder()

interface Seen { method: string; path: string; search: string; headers: Record<string, string>; raw: string }
const seen: Seen[] = []
const elsewhere: string[] = []
let hangCancelled = false
let stallAborted = false
let releaseSlow: () => void = () => {}

const event = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
const USAGE_START = {
  input_tokens: 1200, cache_creation_input_tokens: 3000, cache_read_input_tokens: 50_000,
  cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 }, output_tokens: 1,
}
const messageStart = (model: string) => event('message_start', {
  message: { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: USAGE_START },
})
/** a realistic answer: text, then the model invoking the quote-draft skill, then usage */
const happySse = (model: string) => [
  messageStart(model),
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  event('ping', {}),
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '견적서 초안을 만들게요.' } }),
  event('content_block_stop', { index: 0 }),
  event('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Skill', input: {} } }),
  event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '' } }),
  event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"sk' } }),
  event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: 'ill": "quo' } }),
  event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: 'te-draft"}' } }),
  event('content_block_stop', { index: 1 }),
  event('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 350 } }),
  event('message_stop', {}),
].join('')

/** sends `text` in awkward pieces (splitting lines and multi-byte characters) */
function chunked(text: string, size = 37): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text)
  let at = 0
  return new ReadableStream({
    async pull(ctl) {
      if (at >= bytes.length) { ctl.close(); return }
      await Bun.sleep(1)
      ctl.enqueue(bytes.slice(at, at + size))
      at += size
    },
  })
}

const sseHeaders = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'request-id': 'req_fake_1',
  'anthropic-ratelimit-requests-remaining': '99', 'anthropic-organization-id': 'org-secret-id', 'set-cookie': 'cf=1; Path=/' }
const apiErr = (status: number, type: string, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message }, request_id: 'req_err' }), { status, headers: { 'content-type': 'application/json', ...headers } })

function answer(req: Request, url: URL, body: any): Response | Promise<Response> {
  if (url.pathname === '/v1/models') return Response.json({ data: [{ type: 'model', id: 'claude-from-upstream', display_name: 'Upstream', created_at: '2026-10-01T00:00:00Z' }], has_more: false })
  if (url.pathname === '/v1/messages/count_tokens') return Response.json({ input_tokens: 42 })
  if (url.pathname !== '/v1/messages') return apiErr(404, 'not_found_error', 'nope')
  const scenario = String(body?.messages?.[0]?.content ?? '')
  const model = String(body?.model)
  switch (scenario) {
    case 'error-400': return apiErr(400, 'invalid_request_error', 'prompt is too long')
    case 'error-401': return apiErr(401, 'authentication_error', 'invalid x-api-key')
    case 'error-429': return apiErr(429, 'rate_limit_error', 'slow down', { 'retry-after': '7' })
    case 'error-500': return apiErr(500, 'api_error', 'Internal server error')
    case 'redirect': return new Response(null, { status: 307, headers: { location: `http://127.0.0.1:${away.port}/v1/messages` } })
    case 'json': return Response.json({
      id: 'msg_json', type: 'message', role: 'assistant', model, stop_reason: 'tool_use',
      content: [{ type: 'text', text: '네' }, { type: 'tool_use', id: 'toolu_2', name: 'Skill', input: { skill: 'company:meeting-notes' } }, { type: 'tool_use', id: 'toolu_3', name: 'Read', input: { file_path: 'x' } }],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })
    case 'hang': {
      let timer: Timer
      const stream = new ReadableStream<Uint8Array>({
        start(ctl) {
          ctl.enqueue(enc.encode(messageStart(model) + event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })))
          timer = setInterval(() => { try { ctl.enqueue(enc.encode(event('ping', {}))) } catch {} }, 20)
        },
        cancel() { clearInterval(timer); hangCancelled = true },
      })
      req.signal.addEventListener('abort', () => { clearInterval(timer); hangCancelled = true })
      return new Response(stream, { headers: sseHeaders })
    }
    case 'stall': {
      // never answers; notices when the relay gives up on it
      return new Promise<Response>((ok) => {
        req.signal.addEventListener('abort', () => { stallAborted = true; ok(apiErr(500, 'api_error', 'gone')) })
      })
    }
    case 'slow': {
      const gate = new Promise<void>((ok) => { releaseSlow = ok })
      const stream = new ReadableStream<Uint8Array>({
        async start(ctl) {
          ctl.enqueue(enc.encode(messageStart(model)))
          await gate
          ctl.enqueue(enc.encode(event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) + event('message_stop', {})))
          ctl.close()
        },
      })
      return new Response(stream, { headers: sseHeaders })
    }
  }
  if (body?.stream) return new Response(chunked(happySse(model)), { headers: sseHeaders })
  return Response.json({ id: 'msg_plain', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 2 } })
}

const upstream = Bun.serve({
  hostname: '127.0.0.1', port: 0, idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url)
    const raw = req.method === 'POST' ? await req.text() : ''
    seen.push({ method: req.method, path: url.pathname, search: url.search, headers: Object.fromEntries(req.headers), raw })
    // the fake only answers the company key, and never a client credential
    if (req.headers.get('x-api-key') !== COMPANY_KEY || req.headers.has('authorization')) return apiErr(401, 'authentication_error', 'fake: wrong credential')
    let body: unknown = null
    try { body = raw ? JSON.parse(raw) : null } catch {}
    return answer(req, url, body)
  },
})
/** where a redirect points; must never be reached */
const away = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) { elsewhere.push(req.url); return new Response('followed') } })

const logs: { level: string; msg: string; f?: Record<string, unknown> }[] = []
const capture: Log = {
  info: (msg, f) => { logs.push({ level: 'info', msg, f }) },
  warn: (msg, f) => { logs.push({ level: 'warn', msg, f }) },
  error: (msg, f) => { logs.push({ level: 'error', msg, f }) },
}

let hub: TestHub
afterAll(async () => { await hub?.stop(); upstream.stop(true); away.stop(true) })

async function waitFor(fn: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) { if (fn()) return true; await Bun.sleep(10) }
  return fn()
}

describe('model relay', async () => {
  hub = await testHub({ upstream: `http://127.0.0.1:${upstream.port}`, apiKey: COMPANY_KEY })
  hub.ctx.log = capture
  const db = hub.ctx.db
  const upstreamBase = hub.ctx.config.upstreamBaseUrl

  let n = 0
  async function person(o: { kind?: 'device' | 'hub' } = {}) {
    const u = await hub.user(`p${++n}`)
    return { id: u.id, token: hub.token(u.id, o.kind ?? 'device') }
  }
  const ask = (scenario: string, extra: Record<string, unknown> = {}) =>
    ({ model: 'claude-sonnet-5-5', max_tokens: 1024, stream: true, messages: [{ role: 'user', content: scenario }], ...extra })
  const post = (path: string, token: string | null, body: unknown, headers: Record<string, string> = {}, init: RequestInit = {}) =>
    fetch(hub.url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body), ...init,
    })
  const rows = (userId: string) => db.query('SELECT * FROM usage WHERE user_id = ? ORDER BY rowid').all(userId) as any[]
  const skillRows = (userId: string) => db.query('SELECT skill, source FROM skill_events WHERE user_id = ? ORDER BY id').all(userId) as any[]
  const last = () => seen[seen.length - 1]!

  beforeEach(() => {
    hub.ctx.config.upstreamBaseUrl = upstreamBase
    hub.ctx.secrets.setApiKey(COMPANY_KEY)
    logs.length = 0
  })

  test('/api/hello answers GET and HEAD without a token', async () => {
    const g = await fetch(hub.url + '/api/hello')
    expect(g.status).toBe(200)
    const h = await fetch(hub.url + '/api/hello', { method: 'HEAD' })
    expect(h.status).toBe(200)
  })

  test('missing, wrong and revoked tokens get 401 in Anthropic shape; nothing goes upstream', async () => {
    const p = await person()
    const before = seen.length
    for (const token of [null, 'tax_not-a-real-token', 'sk-ant-something-else']) {
      const r = await post('/v1/messages', token, ask('hi'))
      expect(r.status).toBe(401)
      const j = await r.json() as any
      expect(j.type).toBe('error')
      expect(j.error.type).toBe('authentication_error')
    }
    const t = issueToken(db, p.id, 'device', 'old-pc')
    revokeToken(db, t.id)
    expect((await post('/v1/messages', t.token, ask('hi'))).status).toBe(401)
    expect((await fetch(hub.url + '/v1/models')).status).toBe(401)
    expect(seen.length).toBe(before)
  })

  test('streams the answer through byte for byte, with the company key and never the device token', async () => {
    const p = await person()
    const r = await post('/v1/messages', p.token, ask('hi'))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/event-stream')
    expect(await r.text()).toBe(happySse('claude-sonnet-5-5'))
    const h = last().headers
    expect(h['x-api-key']).toBe(COMPANY_KEY)
    expect(h.authorization).toBeUndefined()
    expect(JSON.stringify(last())).not.toContain(p.token)
    expect(JSON.stringify(last())).not.toContain(p.token.slice(4))
  })

  test('records one usage row with tokens, cache split, cost, status and duration', async () => {
    const p = await person()
    await (await post('/v1/messages', p.token, ask('hi'))).text()
    const [u, ...more] = rows(p.id)
    expect(more).toHaveLength(0)
    expect(u).toMatchObject({ source: 'pc', job_id: null, model: 'claude-sonnet-5-5', input_tokens: 1200, output_tokens: 350, cache_read: 50_000, cache_write: 3000, status: 200 })
    // sonnet-5-5: 1200×2 + 350×10 + 1000×2.5 (5m writes) + 2000×4 (1h writes) + 50000×0.10 (reads), per million
    expect(u.cost_usd).toBeCloseTo((1200 * 2 + 350 * 10 + 1000 * 2.5 + 2000 * 4 + 50_000 * 0.1) / 1e6, 10)
    expect(u.duration_ms).toBeGreaterThanOrEqual(0)
    expect(typeof u.token_id).toBe('string')
    expect(Date.parse(u.started_at)).toBeGreaterThan(Date.now() - 60_000)
  })

  test('the model from message_start wins over the one asked for', async () => {
    const p = await person()
    await (await post('/v1/messages', p.token, ask('hi', { model: 'claude-opus-5-5' }))).text()
    expect(rows(p.id)[0].model).toBe('claude-opus-5-5')
    expect(rows(p.id)[0].cost_usd).toBeCloseTo((1200 * 4 + 350 * 20 + 1000 * 5 + 2000 * 8 + 50_000 * 0.2) / 1e6, 10)
  })

  test('a Skill tool_use in the stream becomes a skill_events row', async () => {
    const p = await person()
    await (await post('/v1/messages', p.token, ask('hi'))).text()
    expect(skillRows(p.id)).toEqual([{ skill: 'quote-draft', source: 'relay' }])
  })

  test('non-streaming answers: usage and skills from the body, company: prefix dropped', async () => {
    const p = await person()
    const r = await post('/v1/messages', p.token, ask('json', { stream: false }))
    expect(r.status).toBe(200)
    expect((await r.json() as any).id).toBe('msg_json')
    expect(rows(p.id)[0]).toMatchObject({ input_tokens: 100, output_tokens: 20, status: 200 })
    expect(skillRows(p.id)).toEqual([{ skill: 'meeting-notes', source: 'relay' }])
  })

  test('only the allowed headers reach Anthropic; anthropic-beta and -version unchanged', async () => {
    const p = await person()
    const beta = 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,some-new-thing-2026-10-01'
    await (await post('/v1/messages?beta=true&evil=1', p.token, ask('hi'), {
      'anthropic-beta': beta, 'anthropic-version': '2023-06-01', 'user-agent': 'claude-cli/2.1.309 (external, cli)', 'x-app': 'cli',
      accept: 'application/json', cookie: 'tax_session=abc', 'x-stainless-os': 'MacOS', 'x-claude-code-session-id': 'sess-1',
      'x-forwarded-for': '10.0.0.9', 'x-trina-job': 'job1', 'anthropic-dangerous-direct-browser-access': 'true',
    })).text()
    const s = last()
    expect(s.path).toBe('/v1/messages')
    expect(s.search).toBe('?beta=true')
    expect(s.headers['anthropic-beta']).toBe(beta)
    expect(s.headers['anthropic-version']).toBe('2023-06-01')
    expect(s.headers['user-agent']).toBe('claude-cli/2.1.309 (external, cli)')
    expect(s.headers['x-app']).toBe('cli')
    expect(s.headers.accept).toBe('application/json')
    expect(s.headers['content-type']).toBe('application/json')
    // what fetch itself adds (host, connection, accept-encoding, content-length) aside, nothing else arrives
    const transport = new Set(['host', 'connection', 'accept-encoding', 'content-length'])
    const got = Object.keys(s.headers).filter((k) => !transport.has(k)).sort()
    expect(got).toEqual(['accept', 'anthropic-beta', 'anthropic-version', 'content-type', 'user-agent', 'x-api-key', 'x-app'])
    expect(rows(p.id)[0].job_id).toBeNull() // x-trina-job means nothing on a device token
  })

  test("response headers: Anthropic's ids and rate limits pass, cookies and account ids do not", async () => {
    const p = await person()
    const r = await post('/v1/messages', p.token, ask('hi'))
    await r.text()
    expect(r.headers.get('request-id')).toBe('req_fake_1')
    expect(r.headers.get('anthropic-ratelimit-requests-remaining')).toBe('99')
    expect(r.headers.get('set-cookie')).toBeNull()
    expect(r.headers.get('anthropic-organization-id')).toBeNull()
  })

  test('the body that goes out is the checked one, written again', async () => {
    const p = await person()
    const raw = '{"model":"claude-sonnet-5-5","max_tokens":5,"stream":false,"messages":[{"role":"user","content":"json"}],"max_tokens":7}'
    expect((await post('/v1/messages', p.token, raw)).status).toBe(200)
    expect(last().raw).toBe(JSON.stringify(JSON.parse(raw)))
    expect(JSON.parse(last().raw).max_tokens).toBe(7)
  })

  test('refuses bodies that are not a JSON object, non-Claude models, mcp_servers and container', async () => {
    const p = await person()
    const before = seen.length
    const cases: [unknown, number, string][] = [
      ['not json', 400, 'invalid_request_error'],
      ['[1,2]', 400, 'invalid_request_error'],
      [ask('hi', { model: 'gpt-5' }), 400, 'invalid_request_error'],
      [ask('hi', { model: 'Claude-Opus' }), 400, 'invalid_request_error'],
      [ask('hi', { model: undefined }), 400, 'invalid_request_error'],
      [ask('hi', { mcp_servers: [{ type: 'url', url: 'https://attacker.example/mcp', name: 'x' }] }), 403, 'permission_error'],
      [ask('hi', { container: 'cntr_1' }), 403, 'permission_error'],
    ]
    for (const [body, status, type] of cases) {
      const r = await post('/v1/messages', p.token, body)
      expect(r.status).toBe(status)
      expect((await r.json() as any).error.type).toBe(type)
    }
    const r = await post('/v1/messages/count_tokens', p.token, ask('hi', { mcp_servers: [] }))
    expect(r.status).toBe(403)
    expect((await r.json() as any).error.message).toBe(MSG.refused('mcp_servers'))
    expect(seen.length).toBe(before)
    expect(rows(p.id)).toHaveLength(0)
  })

  test('a used-up budget: 403 permission_error with the Korean message; count_tokens still works', async () => {
    const p = await person()
    createBudget(db, { subjectType: 'user', subjectId: p.id, period: 'day', limitUsd: 0.01, limitTokens: null, action: 'block' })
    db.query("INSERT INTO usage (id, user_id, source, model, cost_usd, status, started_at) VALUES (?, ?, 'pc', 'claude-sonnet-5-5', 0.02, 200, ?)").run('spent-' + p.id, p.id, new Date().toISOString())
    const before = seen.length
    const r = await post('/v1/messages', p.token, ask('hi'))
    expect(r.status).toBe(403)
    const j = await r.json() as any
    expect(j).toEqual({ type: 'error', error: { type: 'permission_error', message: budgetBlock(db, p.id)!.message } })
    expect(j.error.message).toContain('한도')
    expect(seen.length).toBe(before)
    expect(rows(p.id)).toHaveLength(1)
    expect((await post('/v1/messages/count_tokens', p.token, ask('hi'))).status).toBe(200)
  })

  test('no company key: 503 telling the person to ask the admin, not retried; models fall back to the built-in list', async () => {
    const p = await person()
    hub.ctx.secrets.setApiKey(null)
    const before = seen.length
    const r = await post('/v1/messages', p.token, ask('hi'))
    expect(r.status).toBe(503)
    expect(r.headers.get('x-should-retry')).toBe('false')
    const j = await r.json() as any
    expect(j.error.type).toBe('api_error')
    expect(j.error.message).toContain('관리자')
    expect((await post('/v1/messages/count_tokens', p.token, ask('hi'))).status).toBe(503)
    const m = await fetch(hub.url + '/v1/models', { headers: { authorization: 'Bearer ' + p.token } })
    expect(m.status).toBe(200)
    expect((await m.json() as any).data.map((x: any) => x.id)).toContain('claude-opus-5-5')
    expect(seen.length).toBe(before)
  })

  test('upstream errors pass through unmodified and are recorded with their status', async () => {
    const p = await person()
    for (const [scenario, status] of [['error-400', 400], ['error-401', 401], ['error-429', 429], ['error-500', 500]] as const) {
      const r = await post('/v1/messages', p.token, ask(scenario))
      expect(r.status).toBe(status)
      const text = await r.text()
      expect(JSON.parse(text).request_id).toBe('req_err') // the body as Anthropic wrote it
      if (status === 429) expect(r.headers.get('retry-after')).toBe('7')
    }
    expect(rows(p.id).map((u) => [u.status, u.input_tokens, u.cost_usd])).toEqual([[400, 0, 0], [401, 0, 0], [429, 0, 0], [500, 0, 0]])
  })

  test('an upstream 401 (bad company key) is logged as a warning without secrets', async () => {
    const p = await person()
    await (await post('/v1/messages', p.token, ask('error-401'))).text()
    const w = logs.find((l) => l.level === 'warn' && l.msg.includes('401'))
    expect(w).toBeDefined()
    const all = JSON.stringify(logs)
    expect(all).not.toContain(COMPANY_KEY)
    expect(all).not.toContain(p.token)
    expect(all).not.toContain('invalid x-api-key')
  })

  test('a wrong company key reaches the fake as such and its 401 comes back', async () => {
    const p = await person()
    hub.ctx.secrets.setApiKey('sk-ant-wrong')
    const r = await post('/v1/messages', p.token, ask('hi'))
    expect(r.status).toBe(401)
    expect((await r.json() as any).error.message).toBe('fake: wrong credential')
  })

  test('count_tokens is forwarded (with ?beta=true) and adds no usage row', async () => {
    const p = await person()
    const r = await post('/v1/messages/count_tokens?beta=true', p.token, { model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'hi' }] }, { 'anthropic-beta': 'token-counting-2024-11-01' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ input_tokens: 42 })
    expect(last()).toMatchObject({ path: '/v1/messages/count_tokens', search: '?beta=true' })
    expect(last().headers['x-api-key']).toBe(COMPANY_KEY)
    expect(last().headers['anthropic-beta']).toBe('token-counting-2024-11-01')
    expect(rows(p.id)).toHaveLength(0)
  })

  test('models: Anthropic list with the company key, or the built-in list when Anthropic is unreachable', async () => {
    const p = await person()
    const auth = { authorization: 'Bearer ' + p.token }
    let r = await fetch(hub.url + '/v1/models?limit=100&junk=1', { headers: auth })
    expect(r.status).toBe(200)
    expect((await r.json() as any).data[0].id).toBe('claude-from-upstream')
    expect(last()).toMatchObject({ method: 'GET', path: '/v1/models', search: '?limit=100' })
    expect(last().headers['x-api-key']).toBe(COMPANY_KEY)
    expect(last().headers.authorization).toBeUndefined()
    hub.ctx.config.upstreamBaseUrl = 'http://127.0.0.1:9'
    r = await fetch(hub.url + '/v1/models', { headers: auth })
    expect(r.status).toBe(200)
    const j = await r.json() as any
    expect(j.data.map((m: any) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'])
    expect(j.data[0]).toMatchObject({ type: 'model', display_name: 'Claude Opus 5.5' })
  })

  test('everything else under /v1/ is a 404 in Anthropic shape', async () => {
    const p = await person()
    const auth = { authorization: 'Bearer ' + p.token, 'content-type': 'application/json' }
    const before = seen.length
    for (const [method, path] of [['GET', '/v1/files'], ['POST', '/v1/messages/batches'], ['GET', '/v1/messages'], ['POST', '/v1/complete'], ['DELETE', '/v1/models']]) {
      const r = await fetch(hub.url + path, { method: method!, headers: auth, body: method === 'POST' ? '{}' : undefined })
      expect(r.status).toBe(404)
      expect((await r.json() as any).error.type).toBe('not_found_error')
    }
    expect(seen.length).toBe(before)
  })

  test('streams without buffering: the first event arrives while Anthropic is still answering', async () => {
    const p = await person()
    const r = await post('/v1/messages', p.token, ask('slow'))
    const reader = r.body!.getReader()
    const first = await Promise.race([reader.read(), Bun.sleep(2000).then(() => null)])
    expect(first).not.toBeNull()
    expect(new TextDecoder().decode(first!.value)).toContain('message_start')
    releaseSlow()
    let rest = ''
    for (;;) { const { value, done } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value) }
    expect(rest).toContain('message_stop')
    expect(rows(p.id)[0]).toMatchObject({ input_tokens: 1200, output_tokens: 5, status: 200 })
  })

  test('the client hanging up mid-stream cancels the upstream request and records what was seen', async () => {
    const p = await person()
    hangCancelled = false
    const ac = new AbortController()
    const r = await post('/v1/messages', p.token, ask('hang'), {}, { signal: ac.signal })
    const reader = r.body!.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toContain('message_start')
    ac.abort()
    expect(await waitFor(() => hangCancelled)).toBe(true)
    expect(await waitFor(() => rows(p.id).length === 1)).toBe(true)
    expect(rows(p.id)[0]).toMatchObject({ input_tokens: 1200, output_tokens: 1, cache_read: 50_000, cache_write: 3000, status: 200 })
    expect(rows(p.id)[0].cost_usd).toBeGreaterThan(0)
  })

  test('the client hanging up before Anthropic answers cancels the upstream request; the row says status 0', async () => {
    const p = await person()
    stallAborted = false
    const ac = new AbortController()
    const pending = post('/v1/messages', p.token, ask('stall'), {}, { signal: ac.signal }).catch(() => null)
    expect(await waitFor(() => seen.some((s) => s.raw.includes('"stall"') && s.headers['x-api-key'] === COMPANY_KEY))).toBe(true)
    ac.abort()
    await pending
    expect(await waitFor(() => stallAborted)).toBe(true)
    expect(await waitFor(() => rows(p.id).length === 1)).toBe(true)
    expect(rows(p.id)[0]).toMatchObject({ status: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 })
  })

  test('a redirect from upstream is not followed: 502', async () => {
    const p = await person()
    const r = await post('/v1/messages', p.token, ask('redirect'))
    expect(r.status).toBe(502)
    expect((await r.json() as any).error.type).toBe('api_error')
    expect(elsewhere).toHaveLength(0)
    expect(rows(p.id)[0].status).toBe(307)
  })

  test('Anthropic unreachable: 502, and the row says status 0', async () => {
    const p = await person()
    hub.ctx.config.upstreamBaseUrl = 'http://127.0.0.1:9'
    const r = await post('/v1/messages', p.token, ask('hi'))
    expect(r.status).toBe(502)
    expect((await r.json() as any).error.message).toBe(MSG.unreachable)
    expect(rows(p.id)[0]).toMatchObject({ status: 0, input_tokens: 0, cost_usd: 0 })
  })

  test('hub tokens: source hub and the job id from x-trina-job', async () => {
    const p = await person({ kind: 'hub' })
    await (await post('/v1/messages', p.token, ask('hi'), { 'x-trina-job': 'job_abc123' })).text()
    await (await post('/v1/messages', p.token, ask('hi'))).text()
    await (await post('/v1/messages', p.token, ask('hi'), { 'x-trina-job': 'not a job id; drop table' })).text()
    expect(rows(p.id).map((u) => [u.source, u.job_id])).toEqual([['hub', 'job_abc123'], ['hub', null], ['hub', null]])
    expect(seen.slice(-3).every((s) => s.headers['x-trina-job'] === undefined)).toBe(true)
  })
})
