// The Claude app connector login, step by step as claude.ai does it (claude.com/docs/connectors/building/authentication).
import { afterAll, describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import { testHub } from '../lib/hub'
import { pkceChallenge, redirectAllowed, redirectMatches, canonicalResource, listConnectors, revokeConnectors } from '../../src/oauth/routes'

const hub = await testHub({ access: 'subscription' })
afterAll(async () => { await hub.stop() })
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
// requests as they arrive through the Cloudflare tunnel
const PUBLIC = { host: 'acme.trina.app', 'x-forwarded-proto': 'https', 'cf-ray': 'test', 'cf-connecting-ip': '160.79.104.10' }
const ORIGIN = 'https://acme.trina.app'

const mcp = (token: string | null, body: unknown) => fetch(hub.url + '/mcp', {
  method: 'POST', headers: { ...PUBLIC, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body),
})

async function register(uris = [CALLBACK]) {
  const r = await fetch(hub.url + '/oauth/register', { method: 'POST', headers: { ...PUBLIC, 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: uris }) })
  return { status: r.status, body: await r.json() as any }
}

async function authorize(clientId: string, userId: string, o: { verifier?: string; resource?: string; decision?: 'allow' | 'deny' } = {}) {
  const verifier = o.verifier ?? crypto.randomBytes(40).toString('base64url')
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', state: 'st-1', scope: 'mcp offline_access', resource: o.resource ?? `${ORIGIN}/mcp` })
  const a = await fetch(hub.url + '/oauth/authorize?' + q, { headers: PUBLIC, redirect: 'manual' })
  const loc = a.headers.get('location')!
  const s = hub.session(userId)
  if (!loc.startsWith('/oauth/continue/')) return { location: loc, verifier }
  const page = await fetch(hub.url + loc, { headers: { ...PUBLIC, cookie: s.cookie, accept: 'text/html' } })
  expect(page.status).toBe(200)
  expect(await page.text()).toContain('허용')
  const p = await fetch(hub.url + loc, { method: 'POST', redirect: 'manual', headers: { ...PUBLIC, cookie: s.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: s.csrf, decision: o.decision ?? 'allow' }) })
  return { location: p.headers.get('location')!, verifier }
}

const token = (f: Record<string, string>) => fetch(hub.url + '/oauth/token', { method: 'POST', headers: { ...PUBLIC, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f) })

describe('discovery', () => {
  test('MCP without a token: 401 pointing at the protected-resource metadata', async () => {
    const r = await mcp(null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(r.status).toBe(401)
    expect(r.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`)
  })
  test('metadata names the address the person typed', async () => {
    const pr = await (await fetch(hub.url + '/.well-known/oauth-protected-resource', { headers: PUBLIC })).json() as any
    expect(pr.resource).toBe(`${ORIGIN}/mcp`)
    expect(pr.authorization_servers).toEqual([ORIGIN])
    const as = await (await fetch(hub.url + '/.well-known/oauth-authorization-server', { headers: PUBLIC })).json() as any
    expect(as.issuer).toBe(ORIGIN)
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.registration_endpoint).toBe(`${ORIGIN}/oauth/register`)
  })
})

describe('registration', () => {
  test('only Claude callbacks', async () => {
    expect((await register()).status).toBe(201)
    expect((await register(['https://evil.example/cb'])).status).toBe(400)
    expect((await register(['http://localhost:51234/callback'])).status).toBe(201)
    expect(redirectAllowed('http://localhost:1/callback?x=1')).toBe(true)
    expect(redirectAllowed('http://evil.com/callback')).toBe(false)
    expect(redirectMatches(['http://localhost:1111/callback'], 'http://localhost:2222/callback')).toBe(true)
    expect(redirectMatches([CALLBACK], 'https://claude.ai/api/mcp/auth_callback?x')).toBe(false)
    expect(canonicalResource('HTTPS://Acme.Trina.app:443/mcp/')).toBe('https://acme.trina.app/mcp')
  })
})

describe('authorize → token → MCP', async () => {
  const park = await hub.user('park')
  hub.write(`users/${park.id}/memo.md`, 'PARK-MEMO')

  test('the whole flow, with the person\'s own folder', async () => {
    const { body: cl } = await register()
    const { location, verifier } = await authorize(cl.client_id, park.id)
    const back = new URL(location)
    expect(back.origin + back.pathname).toBe(CALLBACK)
    expect(back.searchParams.get('state')).toBe('st-1')
    expect(back.searchParams.get('iss')).toBe(ORIGIN)
    const code = back.searchParams.get('code')!
    const t = await token({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: cl.client_id, code_verifier: verifier, resource: `${ORIGIN}/mcp` })
    expect(t.status).toBe(200)
    const tok = await t.json() as any
    expect(tok.token_type).toBe('Bearer')
    expect(tok.expires_in).toBe(3600)
    const init = await mcp(tok.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    expect(init.status).toBe(200)
    const read = await (await mcp(tok.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_file', arguments: { path: `users/${park.id}/memo.md` } } })).json() as any
    expect(JSON.stringify(read)).toContain('PARK-MEMO')
    // never the company key
    const relay = await fetch(hub.url + '/v1/messages', { method: 'POST', headers: { authorization: 'Bearer ' + tok.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 5, messages: [] }) })
    expect(relay.status).toBe(403)
    // refresh rotates: the old pair stops working
    const r2 = await token({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: cl.client_id })
    expect(r2.status).toBe(200)
    const tok2 = await r2.json() as any
    expect((await mcp(tok.access_token, { jsonrpc: '2.0', id: 3, method: 'ping' })).status).toBe(401)
    expect((await mcp(tok2.access_token, { jsonrpc: '2.0', id: 3, method: 'ping' })).status).toBe(200)
    const again = await token({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: cl.client_id })
    expect(again.status).toBe(400)
    expect((await again.json() as any).error).toBe('invalid_grant')
    // the person sees it and can end it
    expect(listConnectors(hub.ctx, park.id).length).toBe(1)
    expect(revokeConnectors(hub.ctx, park.id)).toBeGreaterThan(0)
    expect((await mcp(tok2.access_token, { jsonrpc: '2.0', id: 4, method: 'ping' })).status).toBe(401)
    expect((await token({ grant_type: 'refresh_token', refresh_token: tok2.refresh_token, client_id: cl.client_id })).status).toBe(400)
  })

  test('a code works once; replaying it also ends what it issued', async () => {
    const { body: cl } = await register()
    const { location, verifier } = await authorize(cl.client_id, park.id)
    const code = new URL(location).searchParams.get('code')!
    const first = await (await token({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: cl.client_id, code_verifier: verifier })).json() as any
    expect((await token({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: cl.client_id, code_verifier: verifier })).status).toBe(400)
    expect((await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: cl.client_id })).status).toBe(400)
    expect((await mcp(first.access_token, { jsonrpc: '2.0', id: 9, method: 'ping' })).status).toBe(401)
  })

  test('wrong PKCE verifier, wrong redirect, other client: refused', async () => {
    const { body: cl } = await register()
    const { body: other } = await register()
    const { location, verifier } = await authorize(cl.client_id, park.id)
    const code = new URL(location).searchParams.get('code')!
    expect((await token({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: cl.client_id, code_verifier: verifier.slice(0, -2) + 'xx' })).status).toBe(400)
    const { location: l2, verifier: v2 } = await authorize(cl.client_id, park.id)
    const code2 = new URL(l2).searchParams.get('code')!
    expect((await token({ grant_type: 'authorization_code', code: code2, redirect_uri: CALLBACK, client_id: other.client_id, code_verifier: v2 })).status).toBe(400)
    expect((await token({ grant_type: 'authorization_code', code: code2, redirect_uri: 'http://localhost:1/callback', client_id: cl.client_id, code_verifier: v2 })).status).toBe(400)
  })

  test('declining, a foreign resource, and a missing login', async () => {
    const { body: cl } = await register()
    const deny = await authorize(cl.client_id, park.id, { decision: 'deny' })
    expect(new URL(deny.location).searchParams.get('error')).toBe('access_denied')
    const foreign = await authorize(cl.client_id, park.id, { resource: 'https://other.example/mcp' })
    expect(new URL(foreign.location).searchParams.get('error')).toBe('invalid_target')
    // not logged in: the consent page sends people to the login first
    const q = new URLSearchParams({ response_type: 'code', client_id: cl.client_id, redirect_uri: CALLBACK, code_challenge: pkceChallenge('a'.repeat(43)), code_challenge_method: 'S256' })
    const loc = (await fetch(hub.url + '/oauth/authorize?' + q, { headers: PUBLIC, redirect: 'manual' })).headers.get('location')!
    const r = await fetch(hub.url + loc, { headers: { ...PUBLIC, accept: 'text/html' }, redirect: 'manual' })
    expect(r.headers.get('location')).toStartWith('/login?next=%2Foauth%2Fcontinue%2F')
    // no PKCE: refused back at the client
    const noPkce = await fetch(hub.url + '/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: cl.client_id, redirect_uri: CALLBACK }), { headers: PUBLIC, redirect: 'manual' })
    expect(new URL(noPkce.headers.get('location')!).searchParams.get('error')).toBe('invalid_request')
    // unknown client or redirect: an error page here, never a redirect
    expect((await fetch(hub.url + '/oauth/authorize?client_id=nope&redirect_uri=' + encodeURIComponent(CALLBACK), { headers: PUBLIC, redirect: 'manual' })).status).toBe(400)
  })

  test('a disabled account cannot trade its code', async () => {
    const kim = await hub.user('kimoff')
    const { body: cl } = await register()
    const { location, verifier } = await authorize(cl.client_id, kim.id)
    hub.ctx.db.query("UPDATE users SET status = 'disabled' WHERE id = ?").run(kim.id)
    const code = new URL(location).searchParams.get('code')!
    expect((await token({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: cl.client_id, code_verifier: verifier })).status).toBe(400)
  })
})
