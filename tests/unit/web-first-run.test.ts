// The personal page as a first-run page: which card a person gets in each situation, the Claude app steps (Team,
// Pro/Max or both), the live status endpoint, and what is hidden until it matters.
import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { setSetting } from '../../src/db'
import { setUserModelAccess } from '../../src/auth/access-mode'
import { issueToken } from '../../src/auth/tokens'
import { saveSetting } from '../../src/web/settings'
import { readClaudeOrg } from '../../src/web/claude-org'
import { detectOs, pickNextStep, type Situation } from '../../src/web/first-run'
import { get, post, pageText, connectApp, toolCall, UA } from './web-lib'

const hubs: TestHub[] = []
afterAll(async () => { for (const h of hubs) await h.stop() })
const newHub = async (o: Parameters<typeof testHub>[0] = {}) => { const h = await testHub(o); hubs.push(h); return h }
const PUBLIC = 'https://acme.trina.app'
const page = async (hub: TestHub, userId: string, ua = UA.mac, path = '/me') => {
  const r = await get(hub, path, hub.session(userId), { 'user-agent': ua })
  expect(r.status).toBe(200)
  const html = await r.text()
  return { html, text: pageText(html) }
}

describe('which computer', () => {
  test('from the User-Agent; ?os= can ask for another', () => {
    expect(detectOs(UA.mac)).toBe('mac')
    expect(detectOs(UA.windows)).toBe('windows')
    expect(detectOs(UA.iphone)).toBe('mobile') // an iPhone says "like Mac OS X" too
    expect(detectOs(UA.android)).toBe('mobile')
    expect(detectOs(UA.linux)).toBe('other')
    expect(detectOs('')).toBe('other')
    expect(detectOs(undefined)).toBe('other')
    expect(detectOs(UA.mac, 'windows')).toBe('windows')
    expect(detectOs(UA.windows, 'mac')).toBe('mac')
    expect(detectOs(UA.mac, 'mobile')).toBe('mac') // not a choice
  })
})

describe('which card', () => {
  const sit = (o: Partial<Situation>): Situation => ({ access: 'subscription', publicUrl: true, connector: false, pc: false, used: false, ...o })

  test('Claude subscription: the Claude app first', () => {
    expect(pickNextStep(sit({}))).toBe('app-connect')
    expect(pickNextStep(sit({ publicUrl: false }))).toBe('app-need-url')
    expect(pickNextStep(sit({ connector: true }))).toBe('app-ready')
    expect(pickNextStep(sit({ connector: true, used: true }))).toBe('all-set')
    expect(pickNextStep(sit({ publicUrl: false, pc: true }))).toBe('pc-ready')
    expect(pickNextStep(sit({ pc: true }))).toBe('app-connect') // a PC alone does not finish the Claude app
    expect(pickNextStep(sit({ pc: true, used: true }))).toBe('all-set') // someone already working from a PC is not nagged
  })

  test('company key: the PC first', () => {
    expect(pickNextStep(sit({ access: 'company_key' }))).toBe('pc-connect')
    expect(pickNextStep(sit({ access: 'company_key', publicUrl: false }))).toBe('pc-connect')
    expect(pickNextStep(sit({ access: 'company_key', pc: true }))).toBe('pc-ready')
    expect(pickNextStep(sit({ access: 'company_key', pc: true, used: true }))).toBe('all-set')
    expect(pickNextStep(sit({ access: 'company_key', connector: true }))).toBe('pc-connect')
  })
})

describe('/me by situation: Claude subscription', async () => {
  const hub = await newHub({ access: 'subscription' })
  const db = hub.ctx.db
  const kim = await hub.user('kim')

  test('no public address yet: the Claude app waits for the admin, Claude Code is open below', async () => {
    const { html, text } = await page(hub, kim.id)
    expect(text).toContain('Claude 앱 연결은 관리자가 먼저 준비해야 해요')
    expect(text).toContain('Claude Code도 쓰나요?')
    expect(html).toMatch(/<details open[^>]*>/) // opened, it is the only way in for now
    expect(text).toContain('연결 명령 만들기')
    expect(text).not.toContain('Claude 앱에서 회사 AI 연결하기')
  })

  test('with a public address and nothing known about the Claude account: both sets of steps, the address, a live status line', async () => {
    saveSetting(hub.ctx, 'publicUrl', PUBLIC)
    const { html, text } = await page(hub, kim.id)
    expect(text).toContain('다음에 할 일')
    expect(text).toContain('Claude 앱에서 회사 AI 연결하기')
    expect(text).toContain('회사가 Claude Team을 쓰는 경우')
    expect(text).toContain('개인 Claude(Pro·Max)를 쓰는 경우')
    expect(text).toContain('사용자 지정(Customize) › 커넥터')
    expect(text).toContain('옆의 연결을 눌러요')
    expect(text).toContain('커넥터 추가 › 커스텀 커넥터')
    expect(text).toContain(`${PUBLIC}/mcp`)
    expect(html).toContain('data-copy="me-connector-address"')
    expect(html).toContain('data-live="connector-wait"')
    expect(html).toContain('data-live="connector-done" hidden')
    expect(html).toContain('/me/status.json')
    expect(text).toContain("✓ Claude 앱이 연결됐어요. Claude에게 '회사 폴더에 뭐가 있어?'라고 물어보세요.")
    // the Claude Code installer is folded away
    expect(html).not.toMatch(/<details open[^>]*>/)
    // plain words for office workers
    for (const w of ['MCP', 'OAuth', '토큰']) expect(text).not.toContain(w)
  })

  test('the Claude owner said Team: the steps use the connector name and nothing about adding one', async () => {
    setSetting(db, 'claude_org', { plan: 'team', connectorName: '데모 AI', managedSettingsAt: null })
    const { html, text } = await page(hub, kim.id)
    expect(text).toContain("'데모 AI' 옆의 연결을 눌러요")
    expect(text).not.toContain('개인 Claude(Pro·Max)')
    expect(text).not.toContain('커스텀 커넥터')
    expect(html).not.toContain('me-connector-address')
    expect(text).toContain('Claude 앱(데스크톱·휴대폰·claude.ai)')
    // Claude Code: no managed settings yet, so the installer
    expect(text).toContain('터미널의 Claude Code에서도')
  })

  test('Pro/Max only: add it yourself with the name and the address', async () => {
    setSetting(db, 'claude_org', { plan: 'individual', connectorName: '우리 회사 AI', managedSettingsAt: null })
    const { html, text } = await page(hub, kim.id)
    expect(text).toContain('커넥터 추가 › 커스텀 커넥터')
    expect(text).toContain("이름에는 '우리 회사 AI'")
    expect(html).toContain('data-copy="me-connector-address"')
    expect(text).not.toContain('회사가 Claude Team을 쓰는 경우')
    expect(text).not.toContain('옆의 연결을 눌러요')
  })

  test('Team with the company Claude Code settings in place: no installer, one sentence', async () => {
    setSetting(db, 'claude_org', { plan: 'team', connectorName: '회사 AI', managedSettingsAt: '2026-10-25T01:00:00Z' })
    const { html, text } = await page(hub, kim.id)
    expect(text).toContain("회사 Claude 계정으로 로그인하면 회사 스킬과 연결이 자동으로 들어가요. 처음 한 번 뜨는 '조직 설정 적용' 창에서 승인을 눌러 주세요.")
    expect(text).not.toContain('터미널의 Claude Code에서도')
    expect(html).not.toContain('action="/me/enroll"')
    // the same setting without managed settings, or for individuals, shows the installer
    setSetting(db, 'claude_org', { plan: 'individual', connectorName: '회사 AI', managedSettingsAt: '2026-10-25T01:00:00Z' })
    expect((await page(hub, kim.id)).html).toContain('action="/me/enroll"')
    setSetting(db, 'claude_org', null)
  })

  test('the Claude app connects: status.json flips, the page says so, the apps are listed and can be disconnected', async () => {
    const s = hub.session(kim.id)
    const st = async () => (await (await get(hub, '/me/status.json', s)).json()) as any
    expect(await st()).toMatchObject({ connector: false, pc: false })
    const cid = connectApp(hub, kim.id, 'Claude')
    expect(await st()).toMatchObject({ connector: true, apps: ['Claude'], pc: false })
    const { html, text } = await page(hub, kim.id)
    expect(text).toContain("✓ Claude 앱이 연결됐어요. Claude에게 '회사 폴더에 뭐가 있어?'라고 물어보세요.")
    expect(text).toContain('Claude 앱이 연결돼 있어요')
    expect(html).not.toContain('data-live="connector-wait"')
    expect(text).toContain('연결된 Claude 앱')
    expect(html).toContain(`/me/connectors/${cid}/revoke`)
    // used it: all set
    toolCall(hub, kim.id)
    expect((await page(hub, kim.id)).text).toContain('모두 준비됐어요')
    // disconnected again
    expect((await post(hub, `/me/connectors/${cid}/revoke`, s)).status).toBe(303)
    expect(await st()).toMatchObject({ connector: false })
  })

  test('a connected PC flips the PC flag', async () => {
    const lee = await hub.user('lee')
    issueToken(hub.ctx.db, lee.id, 'device', 'lee-pc', { createdBy: lee.id })
    const st = (await (await get(hub, '/me/status.json', hub.session(lee.id))).json()) as any
    expect(st).toMatchObject({ pc: true, pcs: 1, connector: false })
  })
})

describe('/me/status.json', async () => {
  const hub = await newHub()
  const kim = await hub.user('kim')

  test('only for a logged-in person: a plain 401, never the login page; never cached', async () => {
    const out = await get(hub, '/me/status.json')
    expect(out.status).toBe(401)
    expect(out.headers.get('content-type')).toContain('application/json')
    expect(out.headers.get('location')).toBeNull()
    expect(await out.json()).toEqual({ error: 'unauthorized' })
    const r = await get(hub, '/me/status.json', hub.session(kim.id))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect(r.headers.get('content-type')).toContain('application/json')
    expect(await r.json()).toEqual({ connector: false, apps: [], pc: false, pcs: 0 })
  })

  test('shows only my own connections', async () => {
    const lee = await hub.user('lee')
    connectApp(hub, lee.id)
    expect(await (await get(hub, '/me/status.json', hub.session(kim.id))).json()).toMatchObject({ connector: false })
    expect(await (await get(hub, '/me/status.json', hub.session(lee.id))).json()).toMatchObject({ connector: true })
  })

  test('a person who must still choose a password cannot read it', async () => {
    const t = await hub.user('temp')
    hub.ctx.db.query('UPDATE users SET must_change_password = 1 WHERE id = ?').run(t.id)
    expect((await get(hub, '/me/status.json', hub.session(t.id))).status).toBe(302)
  })
})

describe('/me by situation: company key', async () => {
  const hub = await newHub({ access: 'company_key' })
  const kim = await hub.user('kim')

  test('the PC command is the main card; the Claude app card is not shown', async () => {
    const { html, text } = await page(hub, kim.id)
    expect(text).toContain('내 PC에 회사 AI 연결하기')
    expect(text).toContain('연결 명령 만들기')
    expect(text).not.toContain('Claude 앱에서 회사 AI 연결하기')
    expect(text).not.toContain('Claude Code도 쓰나요?')
    expect(html).toContain('data-live="pc-wait"')
    expect(html).toContain('data-live="pc-done" hidden')
    expect(text).toContain('AI 사용료는 회사 계정으로 나가요')
  })

  test('a connected PC: ready; a person who used it too: all set', async () => {
    issueToken(hub.ctx.db, kim.id, 'device', 'kim-pc', { createdBy: kim.id })
    expect((await page(hub, kim.id)).text).toContain('PC가 연결돼 있어요')
    toolCall(hub, kim.id)
    expect((await page(hub, kim.id)).text).toContain('모두 준비됐어요')
  })

  test('one person can differ from the company default', async () => {
    const lee = await hub.user('lee')
    setUserModelAccess(hub.ctx.db, lee.id, 'subscription')
    saveSetting(hub.ctx, 'publicUrl', PUBLIC)
    expect((await page(hub, lee.id)).text).toContain('Claude 앱에서 회사 AI 연결하기')
    expect((await page(hub, kim.id)).text).not.toContain('Claude 앱에서 회사 AI 연결하기')
  })
})

describe('what is hidden until it matters', async () => {
  test('chat: the 채팅 entry and the phone card only where the hub can run chats', async () => {
    const off = await newHub({ access: 'subscription' })
    const kim = await off.user('kim')
    const a = await page(off, kim.id)
    expect(a.html).not.toContain('>채팅</a>')
    expect(a.html).not.toContain('href="/app"')
    expect(a.text).not.toContain('휴대폰에서도 써요')

    const noKey = await newHub({ config: { claudeBin: '/usr/bin/true' }, apiKey: null })
    const lee = await noKey.user('lee')
    expect((await page(noKey, lee.id)).html).not.toContain('>채팅</a>')

    const on = await newHub({ config: { claudeBin: '/usr/bin/true' } })
    const park = await on.user('park')
    const b = await page(on, park.id)
    expect(b.html).toContain('>채팅</a>')
    expect(b.html).toContain('href="/app"')
    expect(b.text).toContain('휴대폰에서도 써요')
    // the owner sees it in the admin navigation too
    expect(await (await get(on, '/admin', on.session(on.owner.id))).text()).toContain('>채팅</a>')
    expect(await (await get(off, '/admin', off.session(off.owner.id))).text()).not.toContain('>채팅</a>')
  })

  test('usage charts, budgets and skills: only when there is something', async () => {
    const hub = await newHub({ access: 'subscription' })
    const kim = await hub.user('kim')
    const t0 = (await page(hub, kim.id)).text
    for (const w of ['이번 달 내 사용량', '환산 비용', '내게 적용되는 예산', '내 스킬']) expect(t0).not.toContain(w)
    hub.ctx.db.query("INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cost_usd, status, started_at) VALUES ('u1', ?, 'sub', 'claude-sonnet-5-5', 10, 5, 0.5, 200, ?)").run(kim.id, new Date().toISOString())
    expect((await page(hub, kim.id)).text).toContain('이번 달 내 사용량')
  })
})
