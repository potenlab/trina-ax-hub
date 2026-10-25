// The connector address is easy to get wrong: /mcp/ works like /mcp, a browser gets a short page instead of a blank 405,
// and the 401 text fits Claude app users as well as PCs.
import { afterAll, describe, expect, test } from 'bun:test'
import { testHub } from '../lib/hub'
import { setSetting } from '../../src/db'
import { MCP_UNAUTHORIZED } from '../../src/mcp/routes'
import { pageText } from './web-lib'

const hub = await testHub({ access: 'subscription' })
afterAll(async () => { await hub.stop() })
const owner = hub.owner
const token = hub.token(owner.id)
const TUNNEL = { host: 'acme.trina.app', 'x-forwarded-proto': 'https', 'cf-ray': 'test', 'cf-connecting-ip': '160.79.104.10' }
const rpc = (path: string, t: string | null, body: unknown = { jsonrpc: '2.0', id: 1, method: 'ping' }) =>
  fetch(hub.url + path, { method: 'POST', headers: { ...TUNNEL, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(body) })

describe('/mcp/ is /mcp', () => {
  test('POST works on both, with and without the slash', async () => {
    for (const p of ['/mcp', '/mcp/']) {
      const r = await rpc(p, token)
      expect(`${p} ${r.status}`).toBe(`${p} 200`)
      expect(await r.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
      const init = await (await rpc(p, token, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json() as any
      expect(init.result.serverInfo.name).toBe('trina-ax')
    }
  })

  test('401 on both, with the same WWW-Authenticate header Claude needs', async () => {
    const want = 'Bearer resource_metadata="https://acme.trina.app/.well-known/oauth-protected-resource"'
    for (const p of ['/mcp', '/mcp/']) {
      const r = await rpc(p, null)
      expect(r.status).toBe(401)
      expect(r.headers.get('www-authenticate')).toBe(want)
    }
  })

  test('DELETE and the non-browser GET answer the same on both', async () => {
    for (const p of ['/mcp', '/mcp/']) {
      expect((await fetch(hub.url + p, { method: 'DELETE', headers: { authorization: 'Bearer ' + token } })).status).toBe(200)
      const g = await fetch(hub.url + p, { headers: { accept: 'text/event-stream', authorization: 'Bearer ' + token } })
      expect(g.status).toBe(405)
      expect(g.headers.get('allow')).toBe('POST, DELETE')
      expect((await fetch(hub.url + p)).status).toBe(405) // no Accept header at all
    }
  })
})

describe('a browser opening the address', () => {
  const browser = { ...TUNNEL, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }

  test('gets a short Korean page that says what the address is for, with the steps and the address to paste', async () => {
    for (const p of ['/mcp', '/mcp/']) {
      const r = await fetch(hub.url + p, { headers: browser })
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toContain('text/html')
      expect(r.headers.get('cache-control')).toContain('no-store')
      const html = await r.text()
      const t = pageText(html)
      expect(html.startsWith('<!doctype html>')).toBe(true)
      expect(t).toContain('브라우저에서 여는 곳이 아니에요')
      expect(t).toContain('Claude 앱의 커넥터 설정')
      expect(t).toContain('사용자 지정(Customize) › 커넥터')
      expect(t).toContain('https://acme.trina.app/mcp')
      expect(html).toContain('data-copy="mcp-help-address"')
      for (const w of ['MCP', 'OAuth', '토큰']) expect(t).not.toContain(w)
    }
  })

  test('uses what the Claude owner saved about their account', async () => {
    setSetting(hub.ctx.db, 'claude_org', { plan: 'team', connectorName: '데모 AI', managedSettingsAt: null })
    const t = pageText(await (await fetch(hub.url + '/mcp', { headers: browser })).text())
    expect(t).toContain("'데모 AI' 옆의 연결을 눌러요")
    expect(t).not.toContain('커스텀 커넥터')
    setSetting(hub.ctx.db, 'claude_org', null)
  })

  test('Claude itself (no text/html in Accept) still gets the plain 405', async () => {
    const r = await fetch(hub.url + '/mcp', { headers: { ...TUNNEL, accept: 'text/event-stream' } })
    expect(r.status).toBe(405)
    expect(await r.text()).toBe('')
  })
})

describe('the 401 text', () => {
  test('names no PC and no app; keeps the machine-readable parts', async () => {
    const r = await rpc('/mcp', null)
    const j = await r.json() as any
    expect(j.error.code).toBe('unauthorized')
    expect(j.error.message).toBe(MCP_UNAUTHORIZED)
    expect(j.error.message).toContain('커넥터')
    expect(j.error.message).toContain('PC 연결하기')
    expect(j.error.message).not.toContain('이 PC의')
    expect(r.headers.get('content-type')).toBe('application/json')
  })
})
