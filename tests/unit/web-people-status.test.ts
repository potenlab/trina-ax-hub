// The admin's view of onboarding: the dashboard's to-do list and counts (a Claude app connection counts as connected,
// tool calls count as using it) and the per-person status on the people page.
import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { setSetting } from '../../src/db'
import { setUserModelAccess } from '../../src/auth/access-mode'
import { issueToken } from '../../src/auth/tokens'
import { createInvite, createInvitedUser } from '../../src/auth/invites'
import { saveSetting } from '../../src/web/settings'
import { connectionsByUser, isConnected, stageOf, usersWithActivity } from '../../src/web/people-status'
import { get, pageText, connectApp, toolCall } from './web-lib'

const hubs: TestHub[] = []
afterAll(async () => { for (const h of hubs) await h.stop() })
const newHub = async (o: Parameters<typeof testHub>[0] = {}) => { const h = await testHub(o); hubs.push(h); return h }
const dash = async (hub: TestHub) => pageText(await (await get(hub, '/admin', hub.session(hub.owner.id))).text())

describe('dashboard to-do list', async () => {
  test('subscription only: no company API key to-do, and the key box says it is not needed', async () => {
    const hub = await newHub({ access: 'subscription', apiKey: null })
    await hub.user('kim')
    const t = await dash(hub)
    expect(t).not.toContain('회사 API 키 넣기')
    expect(t).toContain('API 키 필요 없음')
    expect(t).not.toContain('키 넣으러 가기')
    expect(t).toContain('공개 주소 정하기')
  })

  test('the key to-do appears when the default is the company key, or when anybody chose it', async () => {
    const hub = await newHub({ access: 'subscription', apiKey: null })
    const kim = await hub.user('kim')
    expect(await dash(hub)).not.toContain('회사 API 키 넣기')
    setUserModelAccess(hub.ctx.db, kim.id, 'company_key')
    let t = await dash(hub)
    expect(t).toContain('회사 API 키 넣기')
    expect(t).toContain('API 키 없음')
    hub.ctx.secrets.setApiKey('sk-ant-test-key')
    t = await dash(hub)
    expect(t).toContain('API 키 있음')

    const key = await newHub({ access: 'company_key', apiKey: null })
    expect(await dash(key)).toContain('회사 API 키 넣기')
  })

  test('"Claude 조직 설정" links to /admin/claude until the company settings are in place', async () => {
    const hub = await newHub({ access: 'subscription' })
    const html = await (await get(hub, '/admin', hub.session(hub.owner.id))).text()
    expect(pageText(html)).toContain('Claude 조직 설정')
    // the to-do button (the nav also links to /admin/claude, so look for the button itself)
    const todo = 'class="btn small" href="/admin/claude"'
    expect(html).toContain(todo)
    setSetting(hub.ctx.db, 'claude_org', { plan: 'team', connectorName: '회사 AI', managedSettingsAt: null })
    expect(await (await get(hub, '/admin', hub.session(hub.owner.id))).text()).toContain(todo)
    setSetting(hub.ctx.db, 'claude_org', { plan: 'team', connectorName: '회사 AI', managedSettingsAt: '2026-10-25T01:00:00Z' })
    const done = await (await get(hub, '/admin', hub.session(hub.owner.id))).text()
    expect(done).not.toContain(todo)
    expect(pageText(done)).toContain('Claude 조직 설정') // listed as done
    expect(done).toMatch(/Claude 조직 설정/)
  })
})

describe('connected and active', async () => {
  const hub = await newHub({ access: 'subscription' })
  const db = hub.ctx.db
  const app = await hub.user('app-only')
  const pc = await hub.user('pc-only')
  const talker = await hub.user('tools-only')
  const idle = await hub.user('idle')
  const gone = await hub.user('gone')
  connectApp(hub, app.id)
  issueToken(db, pc.id, 'device', 'pc', { createdBy: pc.id })
  toolCall(hub, talker.id)
  // a revoked PC and a revoked connector do not count
  const dead = issueToken(db, gone.id, 'device', 'old', { createdBy: gone.id })
  db.query('UPDATE tokens SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), dead.id)
  const cid = connectApp(hub, gone.id)
  db.query('UPDATE oauth_refresh SET revoked_at = ? WHERE client_id = ?').run(new Date().toISOString(), cid)
  // and an expired refresh token
  const old = connectApp(hub, idle.id)
  db.query('UPDATE oauth_refresh SET expires_at = ? WHERE client_id = ?').run(new Date(Date.now() - 1000).toISOString(), old)

  test('a PC token or a live Claude app connection means connected', () => {
    const c = connectionsByUser(db)
    expect(isConnected(c.get(app.id))).toBe(true)
    expect(isConnected(c.get(pc.id))).toBe(true)
    expect(isConnected(c.get(talker.id))).toBe(false)
    expect(isConnected(c.get(idle.id))).toBe(false)
    expect(isConnected(c.get(gone.id))).toBe(false)
  })

  test('usage or tool calls this month mean using it', () => {
    db.query("INSERT INTO usage (id, user_id, source, model, cost_usd, status, started_at) VALUES ('u1', ?, 'sub', 'claude-sonnet-5-5', 0.1, 200, ?)").run(pc.id, new Date().toISOString())
    const lastMonth = new Date(Date.now() - 45 * 86_400_000).toISOString()
    toolCall(hub, idle.id, lastMonth)
    const from = new Date(new Date().getFullYear(), new Date().getMonth(), 1), to = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
    const used = usersWithActivity(db, from, to)
    expect([...used].sort()).toEqual([pc.id, talker.id].sort())
  })

  test('the dashboard counts them: the app person and the PC person are connected (2 of 6); two people used it this month', async () => {
    const html = await (await get(hub, '/admin', hub.session(hub.owner.id))).text()
    const t = pageText(html)
    expect(t).toContain('연결된 사람2 / 6명')
    expect(t).toContain('PC 1대 · Claude 앱 1명')
    expect(t).toContain('이번 달 쓴 사람2 / 6명')
    // the person who only uses the Claude app is not listed as unconnected
    const notConnected = /아직 연결하지 않았어요 \((\d+)명\)/.exec(t)
    expect(notConnected?.[1]).toBe('4')
    const block = html.slice(html.indexOf('아직 연결하지 않았어요'), html.indexOf('연결은 했지만'))
    expect(block).toContain('tools-only')
    expect(block).not.toContain('>app-only<')
    expect(block).not.toContain('>pc-only<')
    // connected but not using it this month: the app-only person
    expect(t).toContain('연결은 했지만 이번 달에 안 썼어요 (1명)')
    expect(html.slice(html.indexOf('연결은 했지만'))).toContain('app-only')
  })
})

describe('people page status', async () => {
  const hub = await newHub({ access: 'subscription' })
  const db = hub.ctx.db
  const owner = hub.session(hub.owner.id)
  const invited = createInvitedUser(db, { username: 'inv', name: '초대받음', email: 'inv@b.com', role: 'member' })
  createInvite(db, invited.id, 'invite', hub.owner.id)
  const expired = createInvitedUser(db, { username: 'exp', name: '만료됨', email: 'exp@b.com', role: 'member' })
  createInvite(db, expired.id, 'invite', hub.owner.id)
  db.query('UPDATE invites SET expires_at = ? WHERE user_id = ?').run(new Date(Date.now() - 1000).toISOString(), expired.id)
  const joined = await hub.user('joined')
  const viaApp = await hub.user('via-app')
  const viaPc = await hub.user('via-pc')
  const using = await hub.user('using')
  connectApp(hub, viaApp.id)
  issueToken(db, viaPc.id, 'device', 'pc', { createdBy: viaPc.id })
  issueToken(db, viaPc.id, 'device', 'pc2', { createdBy: viaPc.id })
  connectApp(hub, using.id)
  toolCall(hub, using.id)

  test('초대함 / 가입함 / 연결함 (앱 또는 PC) / 사용 중, one per person', async () => {
    const html = await (await get(hub, '/admin/users', owner)).text()
    const row = (name: string) => pageText(html.slice(html.indexOf(`>${name}<`), html.indexOf('</tr>', html.indexOf(`>${name}<`))))
    expect(row('초대받음')).toContain('초대함')
    expect(row('초대받음')).toMatch(/링크 .*까지/)
    expect(row('만료됨')).toContain('초대함')
    expect(row('만료됨')).toContain('링크 기간이 지났어요')
    expect(row('joined')).toContain('가입함')
    expect(row('via-app')).toContain('연결함')
    expect(row('via-app')).toContain('Claude 앱')
    expect(row('via-pc')).toContain('연결함')
    expect(row('via-pc')).toContain('PC 2대')
    expect(row('using')).toContain('사용 중')
    expect(row('using')).toContain('Claude 앱')
    // the person's address is under the name
    expect(row('초대받음')).toContain('inv@b.com')
  })

  test('the furthest point reached counts', () => {
    const u = { mustChangePassword: true }
    expect(stageOf(u, undefined, false)).toBe('invited')
    expect(stageOf({ mustChangePassword: false }, undefined, false)).toBe('joined')
    expect(stageOf(u, { pcs: 1, apps: 0 }, false)).toBe('connected') // a PC an admin set up before they ever logged in
    expect(stageOf({ mustChangePassword: false }, { pcs: 0, apps: 1 }, true)).toBe('active')
  })

  test('the person page shows the same status and the connected Claude apps', async () => {
    const html = await (await get(hub, `/admin/users/${viaApp.id}`, owner)).text()
    const t = pageText(html)
    expect(t).toContain('연결함')
    expect(t).toContain('연결된 Claude 앱1개')
    const inv = pageText(await (await get(hub, `/admin/users/${invited.id}`, owner)).text())
    expect(inv).toContain('초대함')
    expect(inv).toContain('초대 링크를 아직 열지 않았어요')
    const exp = pageText(await (await get(hub, `/admin/users/${expired.id}`, owner)).text())
    expect(exp).toContain('링크 기간이 지났어요')
  })
})
