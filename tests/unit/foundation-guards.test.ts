import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { clientAddress } from '../../src/http/app'
import { FailureLimiter } from '../../src/auth/rate-limit'
import { authorize } from '../../src/policy/authorize'
import { loadPrincipal } from '../../src/policy/access'
import { setRule } from '../../src/policy/rules-admin'
import { Denied } from '../../src/policy/errors'

describe('client address', () => {
  const h = (o: Record<string, string>) => new Headers(o)
  test('tunnelled requests use cf-connecting-ip, never x-forwarded-for', () => {
    expect(clientAddress('127.0.0.1', h({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.9')
    expect(clientAddress('127.0.0.1', h({ 'x-forwarded-for': '1.2.3.4' }))).toBe('127.0.0.1')
  })
  test('a remote peer cannot claim another address', () => {
    expect(clientAddress('198.51.100.7', h({ 'cf-connecting-ip': '203.0.113.9' }))).toBe('198.51.100.7')
    expect(clientAddress('127.0.0.1', h({ 'cf-connecting-ip': 'not an ip; drop table' }))).toBe('127.0.0.1')
  })
})

describe('failure limiter', () => {
  test('counts failures only, clears', () => {
    const l = new FailureLimiter(2, 60_000)
    expect(l.blocked('a')).toBe(false)
    l.fail('a'); l.fail('a')
    expect(l.blocked('a')).toBe(true)
    l.clear('a')
    expect(l.blocked('a')).toBe(false)
  })
})

describe('setup lock and owner', async () => {
  let hub: TestHub
  afterAll(async () => { await hub?.stop() })
  hub = await testHub()

  test('only one owner (database index)', () => {
    expect(() => hub.ctx.db.query("UPDATE users SET role = 'owner' WHERE id != ?").run(hub.owner.id)).not.toThrow() // no other users yet
    hub.ctx.db.query("INSERT INTO users (id, username, name, role, status, created_at, updated_at) VALUES ('x2', 'other', 'other', 'member', 'active', 'now', 'now')").run()
    expect(() => hub.ctx.db.query("UPDATE users SET role = 'owner' WHERE id = 'x2'").run()).toThrow()
  })

  test('missing and hidden paths answer the same for writes', async () => {
    const u = await hub.user('mover')
    hub.write('secret/plan.md', 'x')
    setRule(hub.ctx.db, 'secret', 'everyone', null, 'none')
    hub.ctx.rulesChanged()
    const p = loadPrincipal(hub.ctx.db, u.id)!
    const msg = (input: string) => { try { authorize(hub.ctx.fx, hub.ctx.rules(), p, input, 'write', { mustExist: true }); return 'ok' } catch (e) { return (e as Error).constructor.name + ':' + (e as Error).message.replace(input, '<p>') } }
    expect(msg('shared/nothing.md')).toBe(msg('secret/plan.md'))
    expect(msg('shared/nothing.md').startsWith(Denied.name)).toBe(true)
  })
})

describe('setup page lock', async () => {
  let hub: TestHub
  afterAll(async () => { await hub?.stop() })
  hub = await testHub()
  // a fresh hub: remove the owner the harness made
  hub.ctx.db.query('DELETE FROM users').run()
  const token = hub.ctx.secrets.ensureSetupToken()
  const tunnelled = { accept: 'text/html', 'cf-connecting-ip': '203.0.113.9', 'cf-ray': 'x' }

  test('open on the hub computer itself', async () => {
    const r = await fetch(hub.url + '/setup', { headers: { accept: 'text/html' } })
    expect(r.status).toBe(200)
  })
  test('locked through the tunnel without the token', async () => {
    const r = await fetch(hub.url + '/setup', { headers: tunnelled })
    expect(r.status).toBe(403)
    const p = await fetch(hub.url + '/setup', { method: 'POST', headers: { ...tunnelled, 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=evil&name=evil&password=password123&password2=password123&companyName=x' })
    expect(p.status).toBe(403)
    expect((hub.ctx.db.query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(0)
  })
  test('open through the tunnel with the token', async () => {
    const r = await fetch(hub.url + '/setup?t=' + token, { headers: tunnelled })
    expect(r.status).toBe(200)
    expect(await r.text()).toContain(token)
    const bad = await fetch(hub.url + '/setup?t=' + token.slice(0, -1) + 'x', { headers: tunnelled })
    expect(bad.status).toBe(403)
  })
})

describe('devices enrolled by someone else', async () => {
  let hub: TestHub
  afterAll(async () => { await hub?.stop() })
  hub = await testHub()
  const { makeEnrollCode, redeemEnrollCode } = await import('../../src/auth/enroll')
  const { approveToken } = await import('../../src/auth/tokens')

  const read = async (token: string, p: string) => {
    const r = await fetch(hub.url + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: { path: p } } }) })
    const j = await r.json() as any
    return { isError: !!j.result?.isError, text: (j.result?.content ?? []).map((c: any) => c.text).join('') }
  }

  test("an admin's code cannot open the person's personal folder until they approve the device", async () => {
    const admin = await hub.user('adm', { role: 'admin' })
    const park = await hub.user('park2')
    hub.write(`users/${park.id}/diary.md`, 'PRIVATE-PARK')
    hub.write('shared/team.md', 'TEAM-OK')
    const byAdmin = redeemEnrollCode(hub.ctx.db, makeEnrollCode(hub.ctx.db, park.id, admin.id).code, 'pc', 'https://hub.example')!
    expect(byAdmin.approved).toBe(false)
    expect((await read(byAdmin.token, 'shared/team.md')).text).toContain('TEAM-OK')
    const before = await read(byAdmin.token, `users/${park.id}/diary.md`)
    expect(before.isError).toBe(true)
    expect(before.text).not.toContain('PRIVATE-PARK')
    expect(approveToken(hub.ctx.db, byAdmin.tokenId, park.id)).toBe(true)
    expect((await read(byAdmin.token, `users/${park.id}/diary.md`)).text).toContain('PRIVATE-PARK')
    // a code the person made is approved from the start
    const own = redeemEnrollCode(hub.ctx.db, makeEnrollCode(hub.ctx.db, park.id, park.id).code, 'pc2')!
    expect(own.approved).toBe(true)
    expect((await read(own.token, `users/${park.id}/diary.md`)).text).toContain('PRIVATE-PARK')
  })
})
