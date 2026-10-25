// Registering Claude as an app: the per-address limit that fits one company behind Anthropic's shared address, a cap on
// stored apps, and forgetting apps nobody used for 30 days. Redirect rules stay as strict as before.
import { afterAll, describe, expect, test } from 'bun:test'
import { testHub } from '../lib/hub'
import { CLIENT_IDLE_MS, MAX_CLIENTS, REGISTER_PER_IP_PER_HOUR, pruneClients } from '../../src/oauth/routes'

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const hub = await testHub({ access: 'subscription' })
afterAll(async () => { await hub.stop() })
const db = hub.ctx.db
const reg = (ip: string, uris: string[] = [CALLBACK], extra: Record<string, unknown> = {}) =>
  fetch(hub.url + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json', host: 'acme.trina.app', 'x-forwarded-proto': 'https', 'cf-ray': 't', 'cf-connecting-ip': ip }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: uris, ...extra }) })
const count = () => (db.query('SELECT COUNT(*) AS n FROM oauth_clients').get() as { n: number }).n
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const addClient = (id: string, created: string, used: string | null) =>
  db.query('INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at, last_used_at) VALUES (?,?,?,?,?)').run(id, 'Claude', JSON.stringify([CALLBACK]), created, used)

describe('per-address limit', () => {
  test('300 an hour per address, so one company behind the shared address gets through; then 429', async () => {
    expect(REGISTER_PER_IP_PER_HOUR).toBe(300)
    const ip = '160.79.104.77'
    for (let i = 0; i < REGISTER_PER_IP_PER_HOUR; i++) {
      const r = await reg(ip)
      if (r.status !== 201) throw new Error(`registration ${i + 1} got ${r.status}`)
    }
    const over = await reg(ip)
    expect(over.status).toBe(429)
    expect((await over.json() as any).error).toBe('slow_down')
    // another address is not affected
    expect((await reg('203.0.113.9')).status).toBe(201)
  })
})

describe('redirect rules did not loosen', () => {
  test('only Claude callbacks and loopback /callback', async () => {
    const ip = '198.51.100.1'
    expect((await reg(ip, ['https://evil.example/cb'])).status).toBe(400)
    expect((await reg(ip, [CALLBACK, 'https://evil.example/cb'])).status).toBe(400)
    expect((await reg(ip, ['http://evil.example/callback'])).status).toBe(400)
    expect((await reg(ip, ['http://localhost:5000/other'])).status).toBe(400)
    expect((await reg(ip, ['https://user:pw@claude.ai/api/mcp/auth_callback'])).status).toBe(400)
    expect((await reg(ip, [CALLBACK], { token_endpoint_auth_method: 'client_secret_basic' })).status).toBe(400)
    expect((await reg(ip, ['http://127.0.0.1:53280/callback'])).status).toBe(201)
    expect((await reg(ip, ['https://claude.ai/api/mcp/auth_callback'])).status).toBe(201)
  })
})

describe('stored apps', () => {
  test('pruneClients forgets apps unused for 30 days, keeps recent ones and ones with a live connection', () => {
    db.query('DELETE FROM oauth_clients').run()
    addClient('old-never', daysAgo(40), null)
    addClient('old-used', daysAgo(90), daysAgo(35))
    addClient('new-never', daysAgo(2), null)
    addClient('used-lately', daysAgo(90), daysAgo(3))
    addClient('old-but-connected', daysAgo(90), daysAgo(40))
    const u = db.query('SELECT id FROM users LIMIT 1').get() as { id: string }
    db.query('INSERT INTO oauth_refresh (token_hash, client_id, user_id, created_at, expires_at) VALUES (?,?,?,?,?)')
      .run('h1', 'old-but-connected', u.id, daysAgo(40), new Date(Date.now() + 20 * 86_400_000).toISOString())
    expect(pruneClients(db)).toBe(2)
    const left = (db.query('SELECT client_id FROM oauth_clients ORDER BY client_id').all() as { client_id: string }[]).map((r) => r.client_id)
    expect(left).toEqual(['new-never', 'old-but-connected', 'used-lately'])
    // once its connection is gone too, it follows
    db.query('UPDATE oauth_refresh SET revoked_at = ?').run(new Date().toISOString())
    expect(pruneClients(db)).toBe(1)
    expect(CLIENT_IDLE_MS).toBe(30 * 86_400_000)
  })

  test('a registration prunes idle apps on the way (checked at most every 10 minutes, at once when full)', async () => {
    db.query('DELETE FROM oauth_clients').run()
    addClient('stale-1', daysAgo(31), null)
    addClient('stale-2', daysAgo(50), daysAgo(45))
    // the earlier tests already registered from this process: force a check by filling the table
    const fill = db.prepare('INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?,?,?,?)')
    db.transaction(() => { for (let i = 0; i < MAX_CLIENTS - 2; i++) fill.run(`fill-${i}`, 'Claude', `["${CALLBACK}"]`, daysAgo(1)) })()
    expect(count()).toBe(MAX_CLIENTS)
    expect((await reg('192.0.2.50')).status).toBe(201)
    expect(db.query("SELECT COUNT(*) AS n FROM oauth_clients WHERE client_id LIKE 'stale-%'").get()).toEqual({ n: 0 })
    expect(count()).toBe(MAX_CLIENTS - 2 + 1)
  })

  test('full of recent apps: room is made from the oldest ones that never finished connecting, never from apps in use', async () => {
    db.query('DELETE FROM oauth_clients').run()
    const fill = db.prepare('INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at, last_used_at) VALUES (?,?,?,?,?)')
    db.transaction(() => {
      for (let i = 0; i < MAX_CLIENTS; i++) fill.run(`c-${i}`, 'Claude', `["${CALLBACK}"]`, new Date(Date.now() - (MAX_CLIENTS - i) * 1000).toISOString(), i % 2 ? new Date().toISOString() : null)
    })()
    expect(count()).toBe(MAX_CLIENTS)
    const r = await reg('192.0.2.51')
    expect(r.status).toBe(201)
    expect(count()).toBeLessThanOrEqual(MAX_CLIENTS)
    expect(db.query("SELECT COUNT(*) AS n FROM oauth_clients WHERE last_used_at IS NOT NULL").get()).toEqual({ n: MAX_CLIENTS / 2 }) // none in use was removed
    expect(db.query("SELECT COUNT(*) AS n FROM oauth_clients WHERE client_id = 'c-0'").get()).toEqual({ n: 0 }) // the oldest never-used one went
  })

  test('full of apps that are all in use: a clear 429, nothing removed', async () => {
    db.query('DELETE FROM oauth_clients').run()
    const fill = db.prepare('INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at, last_used_at) VALUES (?,?,?,?,?)')
    db.transaction(() => { for (let i = 0; i < MAX_CLIENTS; i++) fill.run(`u-${i}`, 'Claude', `["${CALLBACK}"]`, daysAgo(1), new Date().toISOString()) })()
    const r = await reg('192.0.2.52')
    expect(r.status).toBe(429)
    expect(count()).toBe(MAX_CLIENTS)
  })
})
