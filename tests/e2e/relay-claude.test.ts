// The real Claude Code CLI through the relay: `claude -p` with ANTHROPIC_BASE_URL = the hub and ANTHROPIC_AUTH_TOKEN =
// a device token, against a fake Anthropic. Proves Claude Code works through the relay and that its usage is recorded,
// and that the relay's tool rules (no code execution) leave Claude Code's own tools and its web search alone.
//
// Safety: nothing here may reach api.anthropic.com or use this Mac's own Claude login. The CLI gets a fresh HOME and
// CLAUDE_CONFIG_DIR, an environment built from scratch (nothing inherited), the hub as its base URL, and HTTPS_PROXY
// pointing at a local black hole that refuses every tunnel, so any other HTTPS request fails on this machine.
import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'

const CLAUDE = path.join(os.homedir(), '.local/bin/claude')
const COMPANY_KEY = 'sk-ant-api03-e2e-company-key'
const ANSWER = 'TRINA-RELAY-OK 안녕하세요'
const enc = new TextEncoder()

interface Seen { method: string; path: string; model?: string; stream?: boolean; auth: string | null; key: string | null; tools?: string[] }
const seen: Seen[] = []

const event = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
const usage = { input_tokens: 2100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

type Block = { type: 'text'; text: string } | { type: 'tool_use'; name: string; input: Record<string, unknown> }

/** A well-formed streamed answer: text and tool_use blocks, then usage. */
function streamAnswer(model: string, blocks: Block[], extraUsage: Record<string, unknown> = {}): Response {
  const out = [event('message_start', { message: { id: 'msg_e2e', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } })]
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      out.push(event('content_block_start', { index, content_block: { type: 'text', text: '' } }),
        event('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } }))
    } else {
      out.push(event('content_block_start', { index, content_block: { type: 'tool_use', id: `toolu_e2e_${index}`, name: b.name, input: {} } }),
        event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }))
    }
    out.push(event('content_block_stop', { index }))
  })
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  out.push(event('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 12, ...extraUsage } }), event('message_stop', {}))
  return new Response(enc.encode(out.join('')), { headers: { 'content-type': 'text/event-stream', 'request-id': 'req_e2e' } })
}

function jsonAnswer(model: string, text: string): Response {
  return Response.json({ id: 'msg_e2e_json', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { ...usage, output_tokens: 12 } })
}

const hasToolResult = (body: any) => JSON.stringify(body?.messages ?? []).includes('"tool_result"')
const firstUserText = (body: any) => JSON.stringify(body?.messages?.[0]?.content ?? '')

/** The agent's own turn carries its tools and gets ANSWER (or, asked to search, a WebSearch call first); Claude
 * Code's WebSearch tool sends its own request with the web_search server tool and gets a short result; a small side
 * request without tools (a session title or topic check) gets the short JSON such requests expect. */
function answerFor(body: any): Block[] {
  const tools: any[] = Array.isArray(body?.tools) ? body.tools : []
  if (tools.some((t) => String(t?.type ?? '').startsWith('web_search'))) return [{ type: 'text', text: 'trina.example: Trina AX is a hub.' }]
  if (!tools.length && /title|topic/i.test(JSON.stringify(body?.system ?? ''))) return [{ type: 'text', text: '{"title":"Say hi","isNewTopic":true}' }]
  if (/search the web/i.test(firstUserText(body)) && !hasToolResult(body)) return [{ type: 'tool_use', name: 'WebSearch', input: { query: 'trina ax hub' } }]
  return [{ type: 'text', text: ANSWER }]
}

const upstream = Bun.serve({
  hostname: '127.0.0.1', port: 0, idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url)
    let body: any = null
    if (req.method === 'POST') try { body = await req.json() } catch {}
    seen.push({ method: req.method, path: url.pathname, model: body?.model, stream: body?.stream, auth: req.headers.get('authorization'), key: req.headers.get('x-api-key'),
      tools: Array.isArray(body?.tools) ? body.tools.map((t: any) => String(t?.type ?? 'none')) : undefined })
    if (req.headers.get('x-api-key') !== COMPANY_KEY) return Response.json({ type: 'error', error: { type: 'authentication_error', message: 'fake: wrong key' } }, { status: 401 })
    if (url.pathname === '/v1/messages/count_tokens') return Response.json({ input_tokens: 100 })
    if (url.pathname === '/v1/models') return Response.json({ data: [], has_more: false })
    if (url.pathname !== '/v1/messages') return Response.json({ type: 'error', error: { type: 'not_found_error', message: 'nope' } }, { status: 404 })
    const model = String(body?.model ?? 'claude-sonnet-5-5')
    const blocks = answerFor(body)
    const webSearch = (body?.tools ?? []).some((t: any) => String(t?.type ?? '').startsWith('web_search'))
    if (!body?.stream) return jsonAnswer(model, blocks.map((b) => (b.type === 'text' ? b.text : '')).join(''))
    return streamAnswer(model, blocks, webSearch ? { server_tool_use: { web_search_requests: 1 } } : {})
  },
})

/** HTTPS_PROXY black hole: records which host a tunnel was asked for, then refuses it. */
const tunnels: string[] = []
const blackHole = net.createServer((sock) => {
  sock.on('error', () => {})
  sock.once('data', (d) => {
    tunnels.push(d.toString('latin1').split('\r\n')[0]!.slice(0, 200))
    sock.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
  })
})
await new Promise<void>((ok) => blackHole.listen(0, '127.0.0.1', ok))
const blackHolePort = (blackHole.address() as net.AddressInfo).port

let hub: TestHub | undefined
const temps: string[] = []
afterAll(async () => {
  await hub?.stop()
  upstream.stop(true)
  blackHole.close()
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true })
})

/** `claude -p <prompt> --output-format json <args>` against the hub with a device token, in a fresh home. */
async function runClaude(token: string, prompt: string, args: string[] = []) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trina-relay-e2e-home-')))
  temps.push(home)
  const configDir = path.join(home, '.claude')
  const work = path.join(home, 'work')
  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(work)
  // built from scratch: nothing of this Mac's (or the parent Claude session's) environment is inherited
  const env: Record<string, string> = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    TMPDIR: os.tmpdir(),
    LANG: 'en_US.UTF-8',
    ANTHROPIC_BASE_URL: hub!.url,
    ANTHROPIC_AUTH_TOKEN: token,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    HTTPS_PROXY: `http://127.0.0.1:${blackHolePort}`,
    https_proxy: `http://127.0.0.1:${blackHolePort}`,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  }
  const proc = Bun.spawn([CLAUDE, '-p', prompt, '--output-format', 'json', ...args], { cwd: work, env, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const timer = setTimeout(() => proc.kill(), 150_000)
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  clearTimeout(timer)
  console.log('requests seen by the fake Anthropic:', JSON.stringify(seen.map(({ auth, key, ...s }) => ({ ...s, key: key === COMPANY_KEY ? 'company' : key, auth: auth ? 'present' : null }))))
  console.log('blocked tunnels:', JSON.stringify(tunnels))
  if (code !== 0) console.log('claude stderr:', err.slice(0, 2000), '\nstdout:', out.slice(0, 2000))
  return { code, result: code === 0 ? JSON.parse(out.trim().split('\n').pop()!) : null }
}

describe.skipIf(!fs.existsSync(CLAUDE))('real Claude Code through the relay', () => {
  test('claude -p "say hi" answers through the hub and its usage is recorded for the device\'s user', async () => {
    hub = await testHub({ upstream: `http://127.0.0.1:${upstream.port}`, apiKey: COMPANY_KEY })
    const user = await hub.user('e2e-kim')
    const token = hub.token(user.id, 'device')
    seen.length = 0

    const { code, result } = await runClaude(token, 'say hi')
    expect(code).toBe(0)
    expect(result.is_error).toBe(false)
    expect(result.result).toContain(ANSWER)

    // every request reached the fake with the company key, none with the device token
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((s) => s.key === COMPANY_KEY && s.auth === null)).toBe(true)
    // the relay was the only way out: nothing tried to reach Anthropic directly
    expect(tunnels.filter((t) => /anthropic\.com|claude\.ai/i.test(t))).toEqual([])
    // Claude Code's own tools carry no server-tool type, so the relay's tool rule never refuses them
    const agent = seen.find((s) => s.tools?.length)
    expect(agent?.tools?.every((t) => t === 'none' || t === 'custom')).toBe(true)

    const rows = hub.ctx.db.query('SELECT * FROM usage WHERE user_id = ?').all(user.id) as any[]
    const messages = seen.filter((s) => s.path === '/v1/messages').length
    expect(rows.length).toBe(messages)
    expect(rows.every((r) => r.source === 'pc' && r.status === 200 && r.input_tokens === 2100 && r.output_tokens === 12 && r.cost_usd > 0)).toBe(true)
    // the rollup (budgets, reports) has every request
    expect((hub.ctx.db.query('SELECT SUM(requests) AS n FROM usage_daily WHERE user_id = ?').get(user.id) as any).n).toBe(messages)
  }, 180_000)

  test('Claude Code\'s WebSearch (the web_search server tool) goes through the relay and is priced', async () => {
    hub ??= await testHub({ upstream: `http://127.0.0.1:${upstream.port}`, apiKey: COMPANY_KEY })
    const user = await hub.user('e2e-lee')
    const token = hub.token(user.id, 'device')
    seen.length = 0

    const { code, result } = await runClaude(token, 'search the web for trina ax, then answer', ['--allowedTools', 'WebSearch'])
    expect(code).toBe(0)
    expect(result.is_error).toBe(false)
    expect(result.result).toContain(ANSWER)

    const search = seen.filter((s) => s.tools?.some((t) => t.startsWith('web_search')))
    expect(search.length).toBeGreaterThan(0)
    const rows = hub.ctx.db.query('SELECT * FROM usage WHERE user_id = ? ORDER BY rowid').all(user.id) as any[]
    expect(rows.length).toBe(seen.filter((s) => s.path === '/v1/messages').length)
    expect(rows.every((r) => r.status === 200)).toBe(true) // nothing refused
    // the search request's row includes $0.01 for the search on top of its tokens
    expect(rows.some((r) => r.cost_usd > 0.01)).toBe(true)
  }, 180_000)
})
