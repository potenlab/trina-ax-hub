// Web pages: setup (once, race-safe), login (cookie flags, generic errors, rate limits), forced password change, logout.
import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { countUsers, createUser, getUserByUsername, updateUser } from '../../src/auth/users'
import { getSetting } from '../../src/db'
import { listAudit } from '../../src/audit'
import { PRODUCT } from '../../src/product'
import { LOGIN_IP_MAX_FAILURES } from '../../src/web/kit'
import { get, post, follow, login, preSession, setCookies, cookieValue, type Sess } from './web-lib'

const hubs: TestHub[] = []
afterAll(async () => { for (const h of hubs) await h.stop() })
const newHub = async (o: Parameters<typeof testHub>[0] = {}) => { const h = await testHub(o); hubs.push(h); return h }

describe('web: setup', async () => {
  const hub = await newHub({ apiKey: null })
  const db = hub.ctx.db
  db.query('DELETE FROM users').run()
  const form = { companyName: '트리나치과', username: 'boss', name: '김원장', password: 'secret-pass-1', password2: 'secret-pass-1', apiKey: 'sk-ant-api03-setup-test-key-0001' }

  test('a hub without people sends everyone to /setup', async () => {
    expect((await get(hub, '/')).headers.get('location')).toBe('/setup')
    expect((await get(hub, '/login')).headers.get('location')).toBe('/setup')
    const r = await get(hub, '/setup')
    expect(r.status).toBe(200)
    const body = await r.text()
    expect(body.startsWith('<!doctype html>')).toBe(true)
    expect(body).toContain('처음 설정')
    expect(body).toContain('소유자 계정')
  })

  test('refuses a post without the form token, and mismatched passwords', async () => {
    const r = await post(hub, '/setup', null, form)
    expect(r.status).toBe(403)
    const pre = await preSession(hub, '/setup')
    const bad = await post(hub, '/setup', pre, { ...form, password2: 'different-pass' })
    expect(bad.status).toBe(400)
    expect(await bad.text()).toContain('두 비밀번호가 서로 달라요')
    expect(countUsers(db)).toBe(0)
  })

  test('two posts at once make exactly one owner; the winner is logged in', async () => {
    const pre = await preSession(hub, '/setup')
    const [a, b] = await Promise.all([
      post(hub, '/setup', pre, form),
      post(hub, '/setup', pre, { ...form, username: 'intruder', name: '침입자' }),
    ])
    expect(countUsers(db)).toBe(1)
    const owner = getUserByUsername(db, 'boss') ?? getUserByUsername(db, 'intruder')!
    expect(owner.role).toBe('owner')
    const won = cookieValue(a, PRODUCT.sessionCookie) ? a : b
    expect(won.status).toBe(303)
    expect(won.headers.get('location')).toBe('/admin')
    expect(getSetting(db, 'companyName', '')).toBe('트리나치과')
    expect(hub.ctx.secrets.getApiKey()).toBe(form.apiKey)
    expect(listAudit(db).some((x) => x.action === 'setup' && !String(x.detail).includes(form.apiKey))).toBe(true)
    const sess: Sess = { cookie: `${PRODUCT.sessionCookie}=${cookieValue(won, PRODUCT.sessionCookie)}`, csrf: '' }
    const page = await get(hub, '/admin', sess)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('대시보드')
  })

  test('setup is closed after the first person', async () => {
    const g = await get(hub, '/setup')
    expect(g.status).toBe(302)
    expect(g.headers.get('location')).toBe('/login')
    const pre = await preSession(hub, '/login')
    const p = await post(hub, '/setup', pre, { ...form, username: 'second' })
    expect(p.status).toBe(303)
    expect(p.headers.get('location')).toBe('/login')
    expect(countUsers(db)).toBe(1)
  })
})

describe('web: login', async () => {
  const hub = await newHub()
  const db = hub.ctx.db
  await createUser(db, { username: 'kim', name: '김직원', role: 'member', password: 'kim-password' })
  await createUser(db, { username: 'off', name: '퇴사자', role: 'member', password: 'off-password' })
  updateUser(db, getUserByUsername(db, 'off')!.id, { status: 'disabled' })

  test('login page renders with the company name', async () => {
    const r = await get(hub, '/login')
    expect(r.status).toBe(200)
    const body = await r.text()
    expect(body).toContain('로그인')
    expect(body).toContain('name="_csrf"')
  })

  test('success sets an HttpOnly, SameSite=Lax session cookie and goes home', async () => {
    const { r, sess } = await login(hub, 'owner', 'password123')
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/admin')
    const c = setCookies(r).find((x) => x.startsWith(PRODUCT.sessionCookie + '='))!
    expect(c).toContain('HttpOnly')
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Path=/')
    expect(c).not.toContain('Secure')
    expect((await get(hub, '/', sess)).headers.get('location')).toBe('/admin')
    const m = await login(hub, 'kim', 'kim-password')
    expect(m.r.headers.get('location')).toBe('/me')
    expect((await get(hub, '/', m.sess)).headers.get('location')).toBe('/me')
    expect((await get(hub, '/')).headers.get('location')).toBe('/login')
  })

  test('cookie is Secure behind https (x-forwarded-proto)', async () => {
    const { r } = await login(hub, 'owner', 'password123', { 'x-forwarded-proto': 'https' })
    expect(setCookies(r).find((x) => x.startsWith(PRODUCT.sessionCookie + '='))).toContain('Secure')
  })

  test('next= goes back to a local page only', async () => {
    const pre = await preSession(hub, '/login')
    const r = await post(hub, '/login', pre, { username: 'owner', password: 'password123', next: '/admin/users' })
    expect(r.headers.get('location')).toBe('/admin/users')
    const r2 = await post(hub, '/login', pre, { username: 'owner', password: 'password123', next: '//evil.example/x' })
    expect(r2.headers.get('location')).toBe('/admin')
  })

  test('wrong password, unknown user and a disabled account get the same message', async () => {
    for (const [u, p] of [['owner', 'nope-nope'], ['ghost', 'whatever1'], ['off', 'off-password']] as const) {
      const { r, sess } = await login(hub, u, p, { 'cf-connecting-ip': '10.9.9.9' })
      expect(sess).toBeNull()
      expect(r.status).toBe(400)
      expect(await r.text()).toContain('아이디 또는 비밀번호가 맞지 않아요')
    }
    // a known account's failure is recorded, the typed text of an unknown one is not
    const fails = listAudit(db).filter((x) => x.action === 'login.fail')
    expect(fails.length).toBe(2)
    expect(fails.some((x) => String(x.target).includes('ghost') || String(x.detail).includes('ghost'))).toBe(false)
  })

  test('refuses a login post without the form token', async () => {
    const r = await post(hub, '/login', null, { username: 'owner', password: 'password123' })
    expect(r.status).toBe(403)
    expect(cookieValue(r, PRODUCT.sessionCookie)).toBeNull()
  })

  test('10 failures for one username from one address block that pair for 15 minutes (even the right password)', async () => {
    const ip = { 'cf-connecting-ip': '10.0.0.1' }
    for (let i = 0; i < 10; i++) expect((await login(hub, 'kim', 'bad-password', ip)).r.status).toBe(400)
    const blocked = await login(hub, 'KIM', 'kim-password', ip)
    expect(blocked.r.status).toBe(429)
    expect(await blocked.r.text()).toContain('너무 많아요')
    expect(blocked.sess).toBeNull()
    // the same person from another address, and someone else from this address, still get in
    expect((await login(hub, 'kim', 'kim-password', { 'cf-connecting-ip': '10.0.0.2' })).r.status).toBe(303)
    expect((await login(hub, 'owner', 'password123', ip)).r.status).toBe(303)
  })

  test('nobody can lock a username out for everyone (the office shares one address through the tunnel)', async () => {
    // someone guessing the owner's password from many addresses
    for (let i = 0; i < 30; i++) expect((await login(hub, 'owner', 'bad-password', { 'cf-connecting-ip': `10.1.0.${i}` })).r.status).toBe(400)
    expect((await login(hub, 'owner', 'password123', { 'cf-connecting-ip': '10.2.0.1' })).r.status).toBe(303)
  }, 30_000)

  test('one address gets a higher cap across usernames', async () => {
    const ip = { 'cf-connecting-ip': '10.3.0.1' }
    for (let i = 0; i < LOGIN_IP_MAX_FAILURES; i++) expect((await login(hub, `nobody${i % 7}`, 'bad-password', ip)).r.status).toBe(400)
    expect((await login(hub, 'owner', 'password123', ip)).r.status).toBe(429)
    expect((await login(hub, 'owner', 'password123', { 'cf-connecting-ip': '10.3.0.2' })).r.status).toBe(303)
  }, 30_000)
})

describe('web: forced password change and logout', async () => {
  const hub = await newHub()
  const db = hub.ctx.db
  await createUser(db, { username: 'new', name: '신입', role: 'member', password: 'temp-pass-1', mustChangePassword: true })

  test('a temp password leads to /me/password and every page waits for it', async () => {
    const { r, sess } = await login(hub, 'new', 'temp-pass-1')
    expect(r.headers.get('location')).toBe('/me/password')
    expect((await get(hub, '/me', sess)).headers.get('location')).toBe('/me/password')
    expect((await get(hub, '/admin', sess)).headers.get('location')).toBe('/me/password')
    const page = await get(hub, '/me/password', sess)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('새로 정해 주세요')

    expect((await post(hub, '/me/password', sess, { password: 'short', password2: 'short' })).status).toBe(400)
    expect(await (await post(hub, '/me/password', sess, { password: 'brand-new-1', password2: 'brand-new-2' })).text()).toContain('서로 달라요')
    expect(await (await post(hub, '/me/password', sess, { password: 'temp-pass-1', password2: 'temp-pass-1' })).text()).toContain('다른 비밀번호')
    expect((await post(hub, '/me/password', sess, { password: 'brand-new-1', password2: 'brand-new-1' }, { csrf: false })).status).toBe(403)

    const ok = await post(hub, '/me/password', sess, { password: 'brand-new-1', password2: 'brand-new-1' })
    expect(ok.status).toBe(303)
    const me = await follow(hub, ok, sess)
    expect(me.status).toBe(200)
    expect(me.text).toContain('비밀번호를 바꿨어요')
    expect(getUserByUsername(db, 'new')!.mustChangePassword).toBe(false)
    expect((await login(hub, 'new', 'temp-pass-1')).sess).toBeNull()
    expect((await login(hub, 'new', 'brand-new-1')).r.headers.get('location')).toBe('/me')
    expect(listAudit(db).some((x) => x.action === 'password.change')).toBe(true)
  })

  test('a voluntary change asks for the current password', async () => {
    const sess = hub.session(hub.owner.id)
    expect(await (await post(hub, '/me/password', sess, { current: 'wrong-one', password: 'owner-new-1', password2: 'owner-new-1' })).text()).toContain('지금 비밀번호가 맞지 않아요')
    expect((await post(hub, '/me/password', sess, { current: 'password123', password: 'owner-new-1', password2: 'owner-new-1' })).status).toBe(303)
  })

  test('logout: needs the form token or a same-origin browser post', async () => {
    const sess = hub.session(hub.owner.id)
    expect((await post(hub, '/logout', sess, {}, { csrf: 'wrong' })).status).toBe(403)
    expect((await post(hub, '/logout', sess, {}, { csrf: false, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await post(hub, '/logout', sess, {}, { csrf: false })).status).toBe(403)
    expect((await get(hub, '/admin', sess)).status).toBe(200)

    const r = await post(hub, '/logout', sess)
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/login?bye')
    expect((await get(hub, '/admin', sess)).headers.get('location')).toStartWith('/login')

    const sess2 = hub.session(hub.owner.id)
    const host = new URL(hub.url).host
    expect((await post(hub, '/logout', sess2, {}, { csrf: false, headers: { origin: `http://${host}` } })).status).toBe(303)
    expect((await get(hub, '/admin', sess2)).status).toBe(302)
  })

  test('logged-out page requests go to the login page with next=', async () => {
    const r = await get(hub, '/admin/users?x=1')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/login?next=' + encodeURIComponent('/admin/users?x=1'))
  })
})
