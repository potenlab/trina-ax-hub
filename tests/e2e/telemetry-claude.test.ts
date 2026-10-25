// A PC on its own Claude subscription: Claude Code talks to "Anthropic" directly (here a local fake standing in for
// it) and only its OpenTelemetry export reaches the hub. Checks the real export format: one usage row per model call,
// source 'sub', for the device's person, counted once.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'

const CLAUDE = path.join(os.homedir(), '.local/bin/claude')

function answer(body: any): Response {
  const model = body?.model ?? 'claude-sonnet-5-5'
  const msg = { id: 'msg_' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 321, output_tokens: 1, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } }
  if (!body?.stream) return Response.json({ ...msg, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { ...msg.usage, output_tokens: 7 } })
  const ev = (t: string, d: object) => `event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`
  return new Response(ev('message_start', { message: msg }) + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'SUB-OK' } }) + ev('content_block_stop', { index: 0 })
    + ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } }) + ev('message_stop', {}),
    { headers: { 'content-type': 'text/event-stream' } })
}

describe.skipIf(!fs.existsSync(CLAUDE))('subscription PC: usage arrives as telemetry', () => {
  let hub: TestHub
  let upstream: ReturnType<typeof Bun.serve>
  let work: string
  beforeAll(async () => {
    upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      const u = new URL(req.url)
      if (u.pathname === '/v1/messages') return answer(await req.json().catch(() => null))
      if (u.pathname === '/v1/messages/count_tokens') return Response.json({ input_tokens: 10 })
      return new Response('', { status: 404 })
    } })
    hub = await testHub({ access: 'subscription' })
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'trina-otel-'))
  })
  afterAll(async () => { await hub?.stop(); upstream?.stop(true); fs.rmSync(work, { recursive: true, force: true }) })

  test('real Claude Code export → usage rows for the person, counted once', async () => {
    const u = await hub.user('subuser')
    const token = hub.token(u.id)
    const home = path.join(work, 'home')
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    const env: Record<string, string> = {
      HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'en_US.UTF-8',
      // stands in for the person's own subscription login talking to Anthropic
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.port}`, ANTHROPIC_AUTH_TOKEN: 'dummy-subscription',
      HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost',
      DISABLE_AUTOUPDATER: '1', DISABLE_ERROR_REPORTING: '1',
      // what the installer writes in subscription mode
      CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${hub.url}/otel/v1/logs`,
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`, OTEL_LOGS_EXPORT_INTERVAL: '1000',
    }
    const p = Bun.spawn([CLAUDE, '-p', 'hello', '--output-format', 'json'], { env, cwd: work, stdout: 'pipe', stderr: 'pipe' })
    const out = await new Response(p.stdout).text()
    const code = await p.exited
    if (code !== 0) console.error(out.slice(0, 1000), (await new Response(p.stderr).text()).slice(0, 1000))
    expect(code).toBe(0)
    expect(JSON.parse(out).result).toContain('SUB-OK')
    const db = hub.ctx.db
    let rows: any[] = []
    for (let i = 0; i < 40 && !rows.length; i++) { rows = db.query("SELECT * FROM usage WHERE user_id = ? AND source = 'sub'").all(u.id); if (!rows.length) await Bun.sleep(250) }
    expect(rows.length).toBeGreaterThan(0)
    const main = rows.find((r) => r.input_tokens === 321)
    expect(main).toBeTruthy()
    expect(main.cache_read).toBe(1000)
    expect(main.cache_write).toBe(50)
    expect(main.output_tokens).toBe(7)
    expect(main.ext_id).toMatch(/^otel:/)
    // the daily rollup sees it too
    const day = db.query("SELECT SUM(requests) AS n FROM usage_daily WHERE user_id = ? AND source = 'sub'").get(u.id) as { n: number }
    expect(day.n).toBe(rows.length)
  }, 120_000)
})
