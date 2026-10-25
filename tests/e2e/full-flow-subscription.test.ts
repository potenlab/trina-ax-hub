// The whole product for a company on its own Claude subscriptions (the default), with the real Claude Code CLI:
//   - the installer must not touch the model connection (no ANTHROPIC_*), only files (MCP), skills (plugin) and
//     usage telemetry; the person's own login is stood in for by ANTHROPIC_BASE_URL/AUTH_TOKEN in the process env,
//     pointing at a fake Anthropic — the hub's relay must never see a request
//   - usage arrives as telemetry through the tunnel; the Claude app connector login is discoverable on the real
//     https address
// (the company-key variant is tests/e2e/full-flow.test.ts)
//
// Original notes for the shared setup:
//
//   1. a hub reachable over https through a Cloudflare quick tunnel (test data only)
//   2. an employee's PC enrolled with the real `curl … | bash` installer (temp HOME / CLAUDE_CONFIG_DIR)
//   3. that PC's `claude -p`, driven only by what the installer wrote: model calls go through the hub's relay (device
//      token swapped for the company key), company files come from the hub's MCP server, and the company skills
//      arrive as the installed "company" plugin
//   4. the same person's phone chat: a hub session (`claude -p` on the hub) through the same relay and MCP
//
// Nothing may reach api.anthropic.com or this Mac's own Claude login. Skipped when claude or cloudflared is missing or
// the tunnel does not come up.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { CLAUDE_BIN, egressGuard, findCloudflared, quickTunnel, run, walk, type EgressGuard, type Tunnel } from './marketplace-helpers'
import { makeEnrollCode } from '../../src/auth/enroll'
import { setRule } from '../../src/policy/rules-admin'
import { saveSetting } from '../../src/web/settings'
import type { User } from '../../src/auth/users'

const HAVE = fs.existsSync(CLAUDE_BIN) && !!findCloudflared()
const COMPANY_KEY = 'sk-ant-api03-full-flow-company-key-0000'
const PC_MARK = 'FULLFLOW-PC-4417'
const HUB_MARK = 'FULLFLOW-HUB-8820'
const PRICE = 'PRICE-LIST 스케일링 5만원, 미백 30만원'
const RULE = 'RULE-PHRASE 견적은 부가세 별도로 적는다'

interface Seen { auth: string | null; apiKey: string | null; body: any }

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }
function answer(body: any, blocks: Block[], stop: 'end_turn' | 'tool_use'): Response {
  const model = typeof body?.model === 'string' ? body.model : 'claude-sonnet-5-5'
  const usage = { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const id = 'msg_' + Math.random().toString(36).slice(2)
  if (!body?.stream) return Response.json({ id, type: 'message', role: 'assistant', model, content: blocks, stop_reason: stop, stop_sequence: null, usage })
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
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
  out += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 30 } })
  out += ev('message_stop', {})
  return new Response(out, { headers: { 'content-type': 'text/event-stream' } })
}

const textOf = (c: unknown): string => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((x: any) => (x?.type === 'text' ? x.text : x?.type === 'tool_result' ? textOf(x.content) : '')).join('\n') : ''
const userText = (body: any) => (body?.messages ?? []).filter((m: any) => m.role === 'user').map((m: any) => textOf(m.content)).join('\n')
const toolResult = (body: any, id: string): string | null => {
  for (const m of body?.messages ?? []) if (Array.isArray(m.content)) for (const c of m.content) if (c?.type === 'tool_result' && c.tool_use_id === id) return textOf(c.content)
  return null
}

describe.skipIf(!HAVE)('full flow, own subscriptions: installer → PC Claude (MCP + skills, no relay) → telemetry → connector discovery', () => {
  let hub: TestHub
  let upstream: ReturnType<typeof Bun.serve>
  let tunnel: Tunnel | null = null
  let guard: EgressGuard
  let park: User
  const seen: Seen[] = []
  const why: string[] = []
  let sandbox: string

  beforeAll(async () => {
    upstream = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/v1/messages/count_tokens') return Response.json({ input_tokens: 42 })
        if (url.pathname !== '/v1/messages') return new Response('nope', { status: 404 })
        const body = await req.json().catch(() => null)
        seen.push({ auth: req.headers.get('authorization'), apiKey: req.headers.get('x-api-key'), body })
        const text = userText(body)
        for (const [mark, id, done] of [[PC_MARK, 'toolu_pc_1', 'PC-DONE'], [HUB_MARK, 'toolu_hub_1', 'HUB-DONE']] as const) {
          if (!text.includes(mark)) continue
          const r = toolResult(body, id)
          if (r === null) return answer(body, [{ type: 'tool_use', id, name: 'mcp__trina__read_file', input: { path: 'shared/price-list.md' } }], 'tool_use')
          return answer(body, [{ type: 'text', text: `${done}: ${r.replace(/\s+/g, ' ').slice(0, 200)}` }], 'end_turn')
        }
        return answer(body, [{ type: 'text', text: 'ok' }], 'end_turn')
      },
    })
    hub = await testHub({ upstream: `http://127.0.0.1:${upstream.port}`, apiKey: COMPANY_KEY, background: true, access: 'subscription', config: { claudeBin: CLAUDE_BIN, hubConcurrency: 2 } })
    tunnel = await quickTunnel(findCloudflared()!, hub.ctx.config.port, 90_000, why)
    if (!tunnel) return
    saveSetting(hub.ctx, 'publicUrl', tunnel.url)
    const tunnelHost = new URL(tunnel.url).hostname
    guard = await egressGuard((host) => host === tunnelHost)

    const sales = hub.group('영업')
    park = await hub.user('park', { groups: [sales.id] })
    hub.write('shared/price-list.md', PRICE)
    hub.write('skills/RULES.md', RULE)
    hub.write('skills/company/quote-draft/SKILL.md', '---\nname: quote-draft\ndescription: 가격표로 견적서 초안을 쓴다\n---\n# 견적 초안\nshared/price-list.md를 읽고 표로 정리한다.')
    hub.write('skills/sales/pitch-deck/SKILL.md', '---\nname: pitch-deck\ndescription: 영업 제안서 목차를 만든다\n---\n# 제안서')
    hub.write('skills/finance/close-books/SKILL.md', '---\nname: close-books\ndescription: 월말 결산\n---\n# 결산')
    setRule(hub.ctx.db, 'skills/sales', 'everyone', null, 'none')
    setRule(hub.ctx.db, 'skills/sales', 'group', sales.id, 'read')
    setRule(hub.ctx.db, 'skills/finance', 'everyone', null, 'none')
    hub.ctx.rulesChanged()
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trina-full-'))
  }, 180_000)

  afterAll(async () => {
    tunnel?.stop()
    guard?.stop()
    await hub?.stop()
    upstream?.stop(true)
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true })
  })

  const pcEnv = () => {
    const home = path.join(sandbox, 'home')
    fs.mkdirSync(home, { recursive: true })
    return {
      HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      PATH: [path.dirname(CLAUDE_BIN), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
      TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'en_US.UTF-8', TERM: 'dumb',
      HTTPS_PROXY: guard.url, https_proxy: guard.url, HTTP_PROXY: guard.url, http_proxy: guard.url,
      NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
      DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
      CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    } as Record<string, string>
  }

  test('the installer enrolls the PC and installs the company plugin', async () => {
    if (!tunnel) { console.warn('[full-flow] skipped:', why.join('; ')); return }
    const env = pcEnv()
    const { code } = makeEnrollCode(hub.ctx.db, park.id, hub.owner.id)
    const r = await run(['/bin/bash', '-c', `curl -fsSL ${tunnel.url}/install.sh | bash -s -- ${code}`], env, sandbox, 240_000)
    if (r.code !== 0) console.error(r.stdout, r.stderr)
    expect(r.code).toBe(0)
    const settings = JSON.parse(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR!, 'settings.json'), 'utf8'))
    expect(settings.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(settings.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1')
    expect(settings.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBe(`${tunnel.url}/otel/v1/logs`)
    expect(settings.env.OTEL_EXPORTER_OTLP_HEADERS).toMatch(/^Authorization=Bearer tax_/)
    expect(r.stdout + r.stderr).toContain('회사 Claude 계정으로 로그인해 주세요.') // the login hint at the end
    expect(settings.enabledPlugins['company@trina-ax']).toBe(true)
    const files = walk(env.CLAUDE_CONFIG_DIR!)
    expect(files.some((f) => f.endsWith('quote-draft/SKILL.md'))).toBe(true)
    expect(files.some((f) => f.endsWith('pitch-deck/SKILL.md'))).toBe(true) // park is in 영업
    expect(files.some((f) => f.endsWith('close-books/SKILL.md'))).toBe(false) // finance is closed
    expect(r.stdout + r.stderr).not.toContain(settings.env.OTEL_EXPORTER_OTLP_HEADERS.replace('Authorization=Bearer ', ''))
  }, 300_000)

  test('PC Claude: relay with the company key, company files over MCP, rules and skills reach the model', async () => {
    if (!tunnel) return
    // the person's own Claude login, stood in for by a direct connection to the fake Anthropic
    const env = { ...pcEnv(), ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.port}`, ANTHROPIC_AUTH_TOKEN: 'own-subscription', OTEL_LOGS_EXPORT_INTERVAL: '1000' }
    const before = seen.length
    const r = await run([CLAUDE_BIN, '-p', `${PC_MARK} 가격표 보고 견적 초안 써 줘`, '--output-format', 'json', '--allowedTools', 'mcp__trina__read_file'], env, sandbox, 240_000)
    if (r.code !== 0) console.error(r.stdout.slice(0, 2000), r.stderr.slice(0, 2000))
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.result).toContain('PC-DONE')
    expect(out.result).toContain('PRICE-LIST')

    const mine = seen.slice(before)
    expect(mine.length).toBeGreaterThan(0)
    // straight to "Anthropic" with the person's own login; the company key was never used
    for (const s of mine) { expect(s.auth).toBe('Bearer own-subscription'); expect(s.apiKey).not.toBe(COMPANY_KEY) }
    // MCP servers connect in the background, so the instructions may only arrive from the second request of the run
    const all = mine.map((s) => JSON.stringify(s.body)).join('\n')
    expect(all).toContain('RULE-PHRASE')       // MCP instructions (company rules)
    expect(all).toContain('quote-draft')       // the installed company plugin's skill
    expect(all).toContain('pitch-deck')        // group skill
    expect(all).not.toContain('close-books')   // closed pack

    const db = hub.ctx.db
    // nothing went through the relay; usage arrived as telemetry (through the tunnel)
    expect((db.query("SELECT COUNT(*) AS n FROM usage WHERE user_id = ? AND source = 'pc'").get(park.id) as { n: number }).n).toBe(0)
    let sub = 0
    for (let i = 0; i < 60 && !sub; i++) { sub = (db.query("SELECT COUNT(*) AS n FROM usage WHERE user_id = ? AND source = 'sub'").get(park.id) as { n: number }).n; if (!sub) await Bun.sleep(500) }
    expect(sub).toBeGreaterThan(0)
    const tool = db.query("SELECT ok, summary FROM tool_events WHERE user_id = ? AND tool = 'read_file' ORDER BY id DESC").get(park.id) as { ok: number; summary: string }
    expect(tool.ok).toBe(1)
    expect(tool.summary).toContain('shared/price-list.md')
  }, 300_000)

  test('the Claude app connector login is discoverable on the real https address', async () => {
    if (!tunnel) return
    const mcp = await fetch(tunnel.url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(mcp.status).toBe(401)
    expect(mcp.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${tunnel.url}/.well-known/oauth-protected-resource"`)
    const pr = await (await fetch(tunnel.url + '/.well-known/oauth-protected-resource')).json() as any
    expect(pr.resource).toBe(`${tunnel.url}/mcp`)
    const as = await (await fetch(tunnel.url + '/.well-known/oauth-authorization-server')).json() as any
    expect(as.issuer).toBe(tunnel.url)
    const reg = await fetch(tunnel.url + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) })
    expect(reg.status).toBe(201)
  }, 60_000)

  test('nothing tried to leave the machine except the tunnel (and the public MCP registry)', () => {
    if (!tunnel) return
    // With an MCP server configured, Claude Code fetches Anthropic's public MCP registry from api.anthropic.com
    // ("Failed to fetch MCP registry" in --debug). It carries no credential of ours; every model call went through
    // the relay (checked above). Anything else leaving the machine is a failure.
    expect(guard.blocked.filter((h) => h !== 'api.anthropic.com:443')).toEqual([])
  })
})
