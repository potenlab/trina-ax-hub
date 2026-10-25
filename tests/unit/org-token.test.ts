// The org token: a hub-wide credential with no person. It may send telemetry and read the org marketplace, nothing
// else. Every refusal below is a real request against a running hub.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { testHub } from '../lib/hub'
import { migrate } from '../../src/db'
import { sha256 } from '../../src/ids'
import { issueToken, verifyToken } from '../../src/auth/tokens'
import { ORG_TOKEN_PREFIX, activeOrgToken, revokeOrgToken, rotateOrgToken, verifyOrgToken } from '../../src/org/token'
import { get } from './web-lib'

const hub = await testHub({ access: 'subscription', config: { publicUrl: 'https://acme.example' } })
afterAll(async () => { await hub.stop() })

const db = hub.ctx.db
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const post = (p: string, t: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(hub.url + p, { method: 'POST', headers: { 'content-type': 'application/json', ...auth(t), ...headers }, body: JSON.stringify(body) })

describe('org token: storage and rotation', () => {
  test('made once, stored only as a hash, with no person', () => {
    const r = rotateOrgToken(db, hub.owner.id)
    expect(r.token.startsWith(ORG_TOKEN_PREFIX)).toBe(true)
    expect(r.replaced).toBe(false)
    const row = db.query('SELECT * FROM tokens WHERE id = ?').get(r.id) as any
    expect(row.kind).toBe('org')
    expect(row.user_id).toBeNull()
    expect(row.token_hash).toBe(sha256(r.token))
    expect(JSON.stringify(row)).not.toContain(r.token)
    expect(row.created_by).toBe(hub.owner.id)
    // what the page may show: a prefix, never the secret
    const info = activeOrgToken(db)!
    expect(info.id).toBe(r.id)
    expect(r.token.startsWith(info.prefix)).toBe(true)
    expect(info.prefix.length).toBeLessThan(r.token.length / 2)
  })

  test('a new one replaces the old at once; there is never more than one active', () => {
    const a = rotateOrgToken(db, hub.owner.id)
    expect(verifyOrgToken(db, a.token)).not.toBeNull()
    const b = rotateOrgToken(db, hub.owner.id)
    expect(b.replaced).toBe(true)
    expect(verifyOrgToken(db, a.token)).toBeNull()
    expect(verifyOrgToken(db, b.token)).not.toBeNull()
    expect((db.query("SELECT COUNT(*) AS n FROM tokens WHERE kind = 'org' AND revoked_at IS NULL").get() as any).n).toBe(1)
    expect(activeOrgToken(db)!.id).toBe(b.id)
    // the database itself refuses a second active org token
    expect(() => db.query("INSERT INTO tokens (id, user_id, kind, name, token_hash, prefix, created_at) VALUES ('x', NULL, 'org', 'x', 'h', 'p', 'now')").run()).toThrow()
  })

  test('the old token is refused by the endpoints it used to work on', async () => {
    const a = rotateOrgToken(db, hub.owner.id)
    expect((await post('/otel/v1/logs', a.token)).status).toBe(200)
    expect((await fetch(hub.url + '/plugins/marketplace.json', { headers: auth(a.token) })).status).toBe(200)
    const b = rotateOrgToken(db, hub.owner.id)
    expect((await post('/otel/v1/logs', a.token)).status).toBe(401)
    expect((await fetch(hub.url + '/plugins/marketplace.json', { headers: auth(a.token) })).status).toBe(401)
    expect((await post('/otel/v1/logs', b.token)).status).toBe(200)
  })

  test('stopping it leaves none active', async () => {
    const a = rotateOrgToken(db, hub.owner.id)
    expect(revokeOrgToken(db)).toBe(true)
    expect(activeOrgToken(db)).toBeNull()
    expect(revokeOrgToken(db)).toBe(false)
    expect((await post('/otel/v1/logs', a.token)).status).toBe(401)
  })

  test('the table check: org rows have no person, every other kind has one', () => {
    const u = hub.owner.id
    const ins = (kind: string, user: string | null) => () => db.query('INSERT INTO tokens (id, user_id, kind, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(Math.random().toString(36).slice(2), user, kind, 'x', Math.random().toString(36), 'p', 'now')
    expect(ins('org', u)).toThrow()
    expect(ins('device', null)).toThrow()
    expect(ins('connector', null)).toThrow()
    expect(ins('hub', null)).toThrow()
    expect(ins('bogus', u)).toThrow()
    expect(ins('device', u)).not.toThrow()
  })
})

describe('org token: what it can never do', () => {
  let t = ''
  beforeAll(() => { t = rotateOrgToken(db, hub.owner.id).token })

  test('verifyToken (relay, MCP, installer API, everything person-shaped) never returns it', () => {
    expect(verifyToken(db, t)).toBeNull()
    expect(verifyOrgToken(db, t)).not.toBeNull()
  })

  test('the model relay refuses it, in every header form', async () => {
    const body = JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })
    for (const h of [{ authorization: `Bearer ${t}` }, { 'x-api-key': t }] as Record<string, string>[]) {
      for (const p of ['/v1/messages', '/v1/messages/count_tokens']) {
        const r = await fetch(hub.url + p, { method: 'POST', body, headers: { 'content-type': 'application/json', ...h } })
        expect(`${p} ${r.status}`).toBe(`${p} 401`)
      }
      expect((await fetch(hub.url + '/v1/models', { headers: h })).status).toBe(401)
    }
  })

  test('MCP refuses it: no tools, no initialize', async () => {
    for (const method of ['initialize', 'tools/list', 'tools/call']) {
      const r = await fetch(hub.url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...auth(t) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { name: 'list_files', arguments: {} } }) })
      expect(`${method} ${r.status}`).toBe(`${method} 401`)
      expect(r.headers.get('www-authenticate')).toContain('resource_metadata')
    }
  })

  test('the installer API refuses it (it must not be able to revoke a device)', async () => {
    const u = await hub.user('victim')
    const dev = hub.token(u.id)
    expect((await post('/api/unenroll', t)).status).toBe(401)
    expect(verifyToken(db, dev)).not.toBeNull()
  })

  test('web pages refuse it: not as a bearer, not as a cookie', async () => {
    for (const p of ['/me', '/admin', '/admin/claude', '/admin/users', '/app']) {
      const r = await fetch(hub.url + p, { headers: { ...auth(t), accept: 'text/html', cookie: `tax_session=${t}; __Host-tax_session=${t}` }, redirect: 'manual' })
      expect(`${p} ${r.status}`).toBe(`${p} 302`)
      expect(r.headers.get('location')).toStartWith('/login')
    }
    // and a POST to an admin action does nothing
    const r = await fetch(hub.url + '/admin/claude/token', { method: 'POST', headers: { ...auth(t), 'content-type': 'application/x-www-form-urlencoded' }, body: '_csrf=x', redirect: 'manual' })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/login')
  })

  test('the hub job and file routes have nothing for it either', async () => {
    for (const p of ['/app/chats', '/app/schedules']) expect((await fetch(hub.url + p, { headers: auth(t), redirect: 'manual' })).status).toBe(302)
    // other paths under the two areas it may use
    expect((await post('/otel/v1/traces', t)).status).toBe(404)
    expect((await fetch(hub.url + '/plugins/other.json', { headers: auth(t) })).status).toBe(404)
  })

  test('and a person token cannot be mistaken for an org token', async () => {
    const u = await hub.user('plain')
    const dev = hub.token(u.id)
    expect(verifyOrgToken(db, dev)).toBeNull()
    expect(issueToken(db, u.id, 'hub', 'job', 60_000).token.startsWith(ORG_TOKEN_PREFIX)).toBe(false)
  })
})

describe('what it does: telemetry and the org marketplace only', () => {
  test('telemetry and the marketplace answer 200 (the page tests cover the content)', async () => {
    const t = rotateOrgToken(db, hub.owner.id).token
    expect((await post('/otel/v1/logs', t)).status).toBe(200)
    expect((await post('/otel/v1/metrics', t)).status).toBe(200)
    const m = await fetch(hub.url + '/plugins/marketplace.json', { headers: auth(t) })
    expect(m.status).toBe(200)
    expect((await m.json() as any).name).toBe('trina-ax-org')
  })

  test('the page is not reachable with it, and a member session still gets 403', async () => {
    const member = await hub.user('nobody')
    expect((await get(hub, '/admin/claude', hub.session(member.id))).status).toBe(403)
  })
})

describe('migration 160', () => {
  test('rebuilds tokens and keeps every existing row', () => {
    const dir = path.join(import.meta.dir, '..', '..', 'migrations')
    const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
    const before = files.filter((f) => f < '160')
    const old = new Database(':memory:')
    old.exec('PRAGMA foreign_keys = ON')
    for (const f of before) old.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    old.query("INSERT INTO users (id, username, name, role, status, created_at, updated_at) VALUES ('u1', 'u1', 'U', 'member', 'active', 'now', 'now')").run()
    const rows = [['t1', 'device'], ['t2', 'hub'], ['t3', 'connector']]
    for (const [id, kind] of rows) {
      old.query(`INSERT INTO tokens (id, user_id, kind, name, token_hash, prefix, created_at, expires_at, last_used_at, revoked_at, created_by, approved_at, hub_url)
        VALUES (?, 'u1', ?, ?, ?, 'tax_ab', '2026-01-01', '2027-01-01', '2026-02-02', NULL, 'u1', '2026-01-02', 'https://a.example')`).run(id, kind, `n-${id}`, `h-${id}`)
    }
    const snapshot = old.query('SELECT * FROM tokens ORDER BY id').all()
    // the same code path the hub uses at startup applies what is left (160 only)
    old.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    for (const f of before) old.query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, 'now')
    migrate(old)
    expect(old.query('SELECT * FROM tokens ORDER BY id').all()).toEqual(snapshot)
    expect((old.query("SELECT COUNT(*) AS n FROM schema_migrations WHERE name = '160_org.sql'").get() as any).n).toBe(1)
    // the new kind works, tokens still go away with their person, and the index survived
    old.query("INSERT INTO tokens (id, user_id, kind, name, token_hash, prefix, created_at) VALUES ('o1', NULL, 'org', 'o', 'ho', 'tax_org_', 'now')").run()
    old.query("DELETE FROM users WHERE id = 'u1'").run()
    expect((old.query('SELECT COUNT(*) AS n FROM tokens').get() as any).n).toBe(1)
    expect((old.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tokens' ORDER BY name").all() as any[]).map((r) => r.name)).toContain('tokens_user')
    old.close()
  })
})
