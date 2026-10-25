// The real Claude Code CLI against this hub's MCP endpoint, with a fake Anthropic upstream (never api.anthropic.com,
// never this Mac's own Claude login: HOME and CLAUDE_CONFIG_DIR are fresh temp folders, the environment is built from
// scratch, and every upstream request must carry the dummy token).
//
// The fake upstream answers the first real request with a tool_use of mcp__trina__read_file for a file in the team
// folder, and the follow-up (which carries the tool_result) with text quoting it. Checks: the tool result holds the
// file text, a tool_events row exists, and the system prompt Claude Code sent contains our MCP `instructions`. A second
// run reads a long Korean file: Claude Code must pass the page inline (above ~50,000 characters it would save the
// result on the PC and show the model a 2 KB preview only).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { updateUser } from '../../src/auth/users'
import { issueToken } from '../../src/auth/tokens'

const CLAUDE = path.join(os.homedir(), '.local/bin/claude')
const HAVE_CLAUDE = fs.existsSync(CLAUDE)
const MARKER = 'E2E-TRINA-PROMPT-7731'
const FILE = 'shared/e2e/note.md'
const FILE_TEXT = 'E2E-FILE-CONTENT 사내 메모: 회의는 목요일 10시'
const TOOL_ID = 'toolu_trina_e2e_01'
const DUMMY = 'dummy'

interface Seen { method: string; path: string; auth: string | null; apiKey: string | null; body: any }

/** Anthropic Messages API answer: SSE when the request streams, else one JSON message. */
function answer(body: any, blocks: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown })[], stop: 'end_turn' | 'tool_use'): Response {
  const model = typeof body?.model === 'string' ? body.model : 'claude-test'
  const usage = { input_tokens: 12, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const id = 'msg_' + Math.random().toString(36).slice(2)
  if (!body?.stream) {
    return Response.json({ id, type: 'message', role: 'assistant', model, content: blocks, stop_reason: stop, stop_sequence: null, usage })
  }
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`
  let out = ev('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else {
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    out += ev('content_block_stop', { index })
  })
  out += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 7 } })
  out += ev('message_stop', {})
  return new Response(out, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

const textOf = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((c: any) => (c?.type === 'text' ? c.text : c?.type === 'tool_result' ? textOf(c.content) : '')).join('\n') : ''
/**
 * Everything Claude Code sent as system prompt: the top-level `system` blocks plus `role: "system"` entries in
 * `messages`. Claude Code 2.1.x puts the environment block, and with it "# MCP Server Instructions", in the latter.
 */
const systemOf = (body: any) => [textOf(body?.system), ...(body?.messages ?? []).filter((m: any) => m.role === 'system').map((m: any) => textOf(m.content))].join('\n')
const toolResultOf = (body: any): string | null => {
  for (const m of body?.messages ?? []) {
    if (!Array.isArray(m.content)) continue
    for (const c of m.content) if (c?.type === 'tool_result' && c.tool_use_id === TOOL_ID) return textOf(c.content)
  }
  return null
}
const hasMarker = (body: any) => (body?.messages ?? []).some((m: any) => m.role === 'user' && textOf(m.content).includes(MARKER))

describe.skipIf(!HAVE_CLAUDE)('real Claude Code over MCP', () => {
  let hub: TestHub
  let upstream: ReturnType<typeof Bun.serve>
  let seen: Seen[] = []
  let work: string
  /** the team file the fake model asks read_file for */
  let target = FILE

  beforeAll(async () => {
    hub = await testHub()
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'trina-e2e-claude-'))
    upstream = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        let body: any = null
        if (req.method === 'POST') { try { body = await req.json() } catch {} }
        seen.push({ method: req.method, path: url.pathname, auth: req.headers.get('authorization'), apiKey: req.headers.get('x-api-key'), body })
        if (url.pathname === '/v1/messages/count_tokens') return Response.json({ input_tokens: 42 })
        if (url.pathname === '/v1/messages' && req.method === 'POST') {
          const result = toolResultOf(body)
          if (result !== null) return answer(body, [{ type: 'text', text: `The file says: ${result.slice(0, 500)}` }], 'end_turn')
          if (hasMarker(body)) return answer(body, [{ type: 'tool_use', id: TOOL_ID, name: 'mcp__trina__read_file', input: { path: target } }], 'tool_use')
          return answer(body, [{ type: 'text', text: 'ok' }], 'end_turn') // side requests (titles, quota checks, ...)
        }
        return Response.json({})
      },
    })
  })
  afterAll(async () => {
    upstream?.stop(true)
    await hub?.stop()
    if (work) fs.rmSync(work, { recursive: true, force: true })
  })

  /** One `claude -p` run in fresh HOME / CLAUDE_CONFIG_DIR folders; returns what the fake upstream saw. */
  async function runClaude(file: string) {
    target = file
    seen = []
    // a device the owner enrolled themselves (one someone else enrolled keeps users/<id>/ closed until approved)
    const token = issueToken(hub.ctx.db, hub.owner.id, 'device', 'e2e', { createdBy: hub.owner.id }).token
    const run = fs.mkdtempSync(path.join(work, 'run-'))
    const home = path.join(run, 'home'), config = path.join(run, 'config'), cwd = path.join(run, 'cwd')
    for (const d of [home, config, cwd]) fs.mkdirSync(d, { recursive: true })
    const mcpConfig = path.join(run, 'mcp.json')
    fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { trina: { type: 'http', url: `${hub.url}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }))
    const p = Bun.spawn([CLAUDE, '-p', `${MARKER} Read ${file} from the company files and tell me what it says.`,
      '--output-format', 'stream-json', '--verbose', '--mcp-config', mcpConfig, '--strict-mcp-config',
      '--allowedTools', 'mcp__trina__read_file', '--permission-mode', 'dontAsk', '--tools', ''], {
      cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      // built from scratch: nothing of this Mac's own Claude login or API keys can leak in
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, CLAUDE_CONFIG_DIR: config, TMPDIR: cwd,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.port}`, ANTHROPIC_AUTH_TOKEN: DUMMY,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
      },
    })
    const kill = setTimeout(() => p.kill('SIGKILL'), 150_000)
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    clearTimeout(kill)
    const events = stdout.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
    const debug = () => JSON.stringify({ code, stderr: stderr.slice(-2000), events: events.map((e) => e.type + (e.subtype ? ':' + e.subtype : '')), seen: seen.map((s) => `${s.method} ${s.path} ${s.body?.model ?? ''} marker=${hasMarker(s.body)} result=${toolResultOf(s.body) !== null}`) }, null, 1)
    // every upstream request carried the dummy token and nothing else
    expect(seen.length, debug()).toBeGreaterThan(0)
    for (const s of seen) {
      expect(s.auth ?? `Bearer ${s.apiKey}`, debug()).toBe(`Bearer ${DUMMY}`)
      if (s.apiKey) expect(s.apiKey).toBe(DUMMY)
    }
    const first = seen.find((s) => s.path === '/v1/messages' && hasMarker(s.body) && toolResultOf(s.body) === null)
    const second = seen.find((s) => s.path === '/v1/messages' && toolResultOf(s.body) !== null)
    expect(first, debug()).toBeDefined()
    expect(second, debug()).toBeDefined()
    return { first: first!.body, toolResult: toolResultOf(second!.body)!, result: events.find((e) => e.type === 'result'), code, debug }
  }

  test('read_file through Claude Code; instructions reach the system prompt', async () => {
    updateUser(hub.ctx.db, hub.owner.id, { name: 'E2E대표' })
    hub.write(FILE, FILE_TEXT + '\n')
    hub.write('skills/RULES.md', 'E2E-RULE: 고객 이름은 밖에 알리지 않는다.')
    hub.write('skills/company/e2e-quote/SKILL.md', '---\nname: e2e-quote\ndescription: E2E-SKILL 견적서 초안\n---\n# 견적\n')
    const r = await runClaude(FILE)
    // the tool result Claude Code sent back holds the file text, with line numbers from read_file
    expect(r.toolResult).toContain(FILE_TEXT)
    expect(r.toolResult).toContain('     1\t')
    // the MCP instructions are in the system prompt the model got
    const system = systemOf(r.first)
    expect(system, r.debug()).toContain('Trina AX: the shared file hub')
    expect(system).toContain('You are working with E2E대표 (owner)')
    expect(system).toContain(`users/${hub.owner.id}/`)
    expect(system).toContain('E2E-RULE: 고객 이름은 밖에 알리지 않는다.')
    expect(system).toContain('- e2e-quote: E2E-SKILL 견적서 초안')
    // the tool was offered under its MCP name
    expect((r.first.tools ?? []).map((t: any) => t.name)).toContain('mcp__trina__read_file')
    // audited on the hub
    const ev = hub.ctx.db.query("SELECT * FROM tool_events WHERE tool = 'read_file' AND user_id = ?").all(hub.owner.id) as any[]
    expect(ev.length).toBe(1)
    expect(ev[0]).toMatchObject({ ok: 1 })
    expect(ev[0].summary).toContain(FILE)
    // and Claude Code finished with the final answer
    expect(r.result?.result ?? '', r.debug()).toContain('E2E-FILE-CONTENT')
    expect(r.code).toBe(0)
  }, 180_000)

  test('a long Korean file comes back as an inline page, not a saved-to-disk preview', async () => {
    const long = 'shared/e2e/long.md'
    hub.write(long, Array.from({ length: 4000 }, (_, i) => `가나다라마바사아자차카타파하 회의록 ${i + 1}번째 줄입니다`).join('\n'))
    const r = await runClaude(long)
    expect(r.toolResult.startsWith('<persisted-output>'), r.toolResult.slice(0, 300)).toBe(false)
    expect(r.toolResult).toContain('     1\t가나다라마바사아자차카타파하 회의록 1번째 줄입니다')
    expect(r.toolResult).toMatch(/Call read_file with offset=\d+ to continue/)
    expect(r.code).toBe(0)
  }, 180_000)
})
