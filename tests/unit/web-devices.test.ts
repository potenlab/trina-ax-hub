// Web pages: who set up each PC, approving a PC someone else connected, PCs left on an old hub address, the
// dashboard's health cards, and the audit page's names and labels.
import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { issueToken, listTokens, verifyToken } from '../../src/auth/tokens'
import { makeEnrollCode, redeemEnrollCode } from '../../src/auth/enroll'
import { listAudit, audit } from '../../src/audit'
import { noteUpstreamError, noteUpstreamOk } from '../../src/relay/health'
import { saveSetting } from '../../src/web/settings'
import { ACTION_LABEL, pathLabel } from '../../src/web/admin/audit'
import { upstreamAdvice } from '../../src/web/admin/dashboard'
import { get, post, follow } from './web-lib'

const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const hubs: TestHub[] = []
afterAll(async () => { for (const h of hubs) await h.stop() })

describe('web: devices someone else set up', async () => {
  const hub = await testHub()
  hubs.push(hub)
  const db = hub.ctx.db
  const kim = await hub.user('kim')
  const lee = await hub.user('lee')
  const sess = hub.session(kim.id)
  const owner = hub.session(hub.owner.id)

  // the owner (대표) makes a code for kim and it is redeemed on a PC
  const code = makeEnrollCode(db, kim.id, hub.owner.id).code
  const red = redeemEnrollCode(db, code, 'reception-pc', hub.url)!

  test('my page says who connected it and asks me to approve it', async () => {
    expect(verifyToken(db, red.token)?.restricted).toBe(true)
    const body = unescape(await (await get(hub, '/me', sess)).text())
    expect(body).toContain('관리자 대표님이 연결함')
    expect(body).toContain('본인 승인 전')
    expect(body).toContain("'reception-pc' PC를 승인해 주세요.")
    expect(body).toContain('이 PC를 내 PC로 승인')
    expect(body).toContain('승인하기 전에는 이 PC에서 내 개인 폴더(내 폴더)를 열 수 없어요')
    expect(body).toContain(`action="/me/devices/${red.tokenId}/approve"`)
  })

  test("the admin's view of the person shows the same", async () => {
    const body = unescape(await (await get(hub, `/admin/users/${kim.id}`, owner)).text())
    expect(body).toContain('관리자 대표님이 연결함')
    expect(body).toContain('본인 승인 전')
    expect(body).toContain("'내 PC' 페이지에서 승인해야")
  })

  test('approve: CSRF, my own device only, audited', async () => {
    expect((await post(hub, `/me/devices/${red.tokenId}/approve`, sess, {}, { csrf: false })).status).toBe(403)
    // lee cannot approve kim's device
    const other = hub.session(lee.id)
    const nope = await post(hub, `/me/devices/${red.tokenId}/approve`, other)
    expect((await follow(hub, nope, other)).text).toContain('이미 승인했거나 없는 PC예요')
    expect(verifyToken(db, red.token)?.restricted).toBe(true)

    const r = await post(hub, `/me/devices/${red.tokenId}/approve`, sess)
    expect(r.status).toBe(303)
    const page = unescape((await follow(hub, r, sess)).text)
    expect(page).toContain("'reception-pc'을(를) 내 PC로 승인했어요")
    expect(page).not.toContain('이 PC를 내 PC로 승인')
    expect(page).not.toContain('본인 승인 전')
    expect(page).toContain('관리자 대표님이 연결함') // still says who set it up
    expect(verifyToken(db, red.token)?.restricted).toBe(false)
    const a = listAudit(db).find((x) => x.action === 'device.approve')!
    expect(a).toMatchObject({ actor: kim.id, target: red.tokenId })
    expect(a.detail).toContain('reception-pc')
  })

  test('a PC I connected myself needs no approval and names nobody', async () => {
    const mine = redeemEnrollCode(db, makeEnrollCode(db, kim.id, kim.id).code, 'kim-laptop', hub.url)!
    const body = await (await get(hub, '/me', sess)).text()
    expect(body).toContain('kim-laptop')
    expect(body).not.toContain('이 PC를 내 PC로 승인')
    expect(verifyToken(db, mine.token)?.restricted).toBe(false)
  })

  test('the admin enroll result explains the approval', async () => {
    const r = await post(hub, `/admin/users/${lee.id}/enroll`, owner)
    const page = unescape((await follow(hub, r, owner)).text)
    expect(page).toContain("lee님이 '내 PC' 페이지에서 승인해야 개인 폴더를 열 수 있어요")
    expect(page).toContain("'✓ 연결을 마쳤어요'가 나오면 터미널을 새로 열고 <code>claude</code>를 입력해 보세요")
  })
})

describe('web: PCs on an old hub address', async () => {
  const hub = await testHub({ config: { lanUrl: 'http://192.168.0.10:47900' } })
  hubs.push(hub)
  const db = hub.ctx.db
  const kim = await hub.user('kim')
  const sess = hub.session(kim.id)
  const owner = hub.session(hub.owner.id)
  const lanPc = issueToken(db, kim.id, 'device', 'office-pc', { createdBy: kim.id, hubUrl: 'http://192.168.0.10:47900' })
  issueToken(db, kim.id, 'device', 'old-pc', { createdBy: kim.id, hubUrl: null }) // set up before addresses were recorded
  hub.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: 견적서 초안\n---\n# 견적')

  test('LAN only: nothing to reconnect; the phone card names the address and says office only', async () => {
    const body = unescape(await (await get(hub, '/me', sess)).text())
    expect(body).not.toContain('다시 연결해야 해요')
    expect(body).toContain('휴대폰에서 <b style="word-break:break-all">http://192.168.0.10:47900/app</b> 을 열고 같은 아이디로 로그인하세요.')
    expect(body).toContain('지금은 사무실 와이파이에서만 열려요.')
    expect(body).toContain('공개 주소가 생기면 PC에 자동으로 설치돼요.') // with a skill present
  })

  test('saving a public address: the settings page counts the PCs to reconnect, my page tells me how', async () => {
    const r = await post(hub, '/admin/settings/urls', owner, { publicUrl: 'https://acme.example.com', lanUrl: 'http://192.168.0.10:47900' })
    const page = (await follow(hub, r, owner)).text
    expect(page).toContain('예전 주소로 연결된 PC 1대는 다시 연결해야 해요')
    expect(page).toContain('예전 주소로 연결된 PC가 1대 있어요')

    const me = unescape(await (await get(hub, '/me', sess)).text())
    expect(me).toContain("주소가 바뀌어서 이 PC는 다시 연결해야 해요: 'office-pc'")
    expect(me).toContain('다시 연결 필요')
    expect(me).toContain('다시 연결할 명령 만들기')
    expect(me).not.toContain("'office-pc', 'old-pc'") // unknown address: not flagged
    expect(me).toContain('https://acme.example.com/app')
    expect(me).not.toContain('사무실 와이파이에서만')

    // making a code shows the install command with the new address
    const e = unescape((await follow(hub, await post(hub, '/me/enroll', sess), sess)).text)
    expect(e).toContain('curl -fsSL https://acme.example.com/install.sh | bash -s -- ')
    expect(e).toContain('위에 나온 명령을 그 PC에서 실행해 주세요.')
    expect(listTokens(db, kim.id).find((t) => t.id === lanPc.id)?.revoked_at).toBeNull()
  })
})

describe('web: dashboard health', async () => {
  const hub = await testHub()
  hubs.push(hub)
  const db = hub.ctx.db
  const owner = hub.session(hub.owner.id)
  const kim = await hub.user('kim')
  const lee = await hub.user('lee')
  issueToken(db, lee.id, 'device', 'lee-pc', { createdBy: lee.id })

  test('no problems yet: phone chat off without Claude Code, people not set up, public address first', async () => {
    const body = await (await get(hub, '/admin', owner)).text()
    expect(body).not.toContain('class="card alert')
    expect(body).toContain('직원 PC를 연결하기 전에 공개 주소부터 넣어 주세요')
    expect(body).toContain('아직 아무도 쓰지 않았어요')
    expect(body).toContain('꺼져 있어요')
    expect(body).toContain('PC를 연결하지 않았어요 (2명)') // owner and kim
    expect(body).toContain(`href="/admin/users/${kim.id}"`)
    expect(body).toContain('PC는 있지만 이번 달에 안 썼어요 (1명)') // lee
  })

  test('last use and a refusal from Anthropic', async () => {
    db.query("INSERT INTO usage (id, user_id, source, model, cost_usd, status, started_at) VALUES ('u1', ?, 'pc', 'claude-sonnet-5-5', 0.5, 200, ?)")
      .run(lee.id, new Date(Date.now() - 3 * 60_000).toISOString())
    noteUpstreamOk(db, Date.now() - 120_000)
    noteUpstreamError(db, { status: 400, type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' })
    const body = unescape(await (await get(hub, '/admin', owner)).text())
    expect(body).toContain('마지막 사용 <b>3분 전</b>')
    expect(body).toContain('class="card alert"')
    expect(body).toContain('Anthropic이 회사 키를 거절했어요 (잔액 부족 등).')
    expect(body).toContain('Anthropic 콘솔(console.anthropic.com)에서 결제·키를 확인해 주세요.')
    expect(body).toContain('Your credit balance is too low')
    expect(body).toContain('400 · invalid_request_error')
    expect(body).not.toContain('PC는 있지만 이번 달에 안 썼어요') // lee used it now
    // a later success clears it
    noteUpstreamOk(db, Date.now() + 120_000)
    expect(await (await get(hub, '/admin', owner)).text()).not.toContain('class="card alert')
  })

  test('advice by kind of refusal', () => {
    const e = (status: number, message = '', type = '') => upstreamAdvice({ status, message, type, at: new Date().toISOString() })
    expect(e(401).title).toContain('키를 받지 않아요')
    expect(e(401).severe).toBe(true)
    expect(e(403).title).toContain('거절했어요')
    expect(e(429).severe).toBe(false)
    expect(e(529).title).toContain('Anthropic 쪽에')
    expect(e(0).title).toContain('연결하지 못했어요')
    expect(e(400, 'prompt is too long').severe).toBe(false)
    expect(e(400, 'credit balance too low').severe).toBe(true)
  })
})

describe('web: audit page', async () => {
  const hub = await testHub()
  hubs.push(hub)
  const db = hub.ctx.db
  const owner = hub.session(hub.owner.id)
  const kim = await hub.user('kim')

  test('every action the hub writes has a Korean label', async () => {
    const src = await Array.fromAsync(new Bun.Glob('src/**/*.{ts,tsx}').scan('.'))
    const actions = new Set<string>()
    for (const f of src) {
      if (f.endsWith('admin/audit.tsx')) continue
      for (const m of (await Bun.file(f).text()).matchAll(/audit\([^)]*?action: '([a-z_.]+)'/g)) actions.add(m[1]!)
    }
    expect(actions.size).toBeGreaterThan(20)
    for (const a of actions) expect(`${a}: ${ACTION_LABEL[a] ? 'ok' : 'missing'}`).toBe(`${a}: ok`)
  })

  test('names instead of ids: people, PCs, personal folders', async () => {
    const pc = issueToken(db, kim.id, 'device', 'kim-mac', { createdBy: kim.id })
    audit(db, { actor: kim.id, action: 'device.enroll', target: pc.id, detail: { device: 'kim-mac', os: 'macos', ip: '10.0.0.1' } })
    audit(db, { actor: kim.id, action: 'device.approve', target: pc.id, detail: { device: 'kim-mac' } })
    audit(db, { actor: kim.id, action: 'hub.schedule.save', target: `users/${kim.id}/예약 작업/2026-10-25 0900 보고.md` })
    const body = unescape(await (await get(hub, '/admin/audit', owner)).text())
    expect(body).toContain('PC 연결됨')
    expect(body).toContain('PC 승인')
    expect(body).toContain("PC 'kim-mac' (kim)")
    expect(body).toContain('예약 작업 결과 저장')
    expect(body).toContain('kim님 폴더/예약 작업/2026-10-25 0900 보고.md')
    expect(body).toContain('OS: 맥')
    expect(body).not.toContain(`>${pc.id}<`)
    expect(body).toContain('<td class="nowrap">kim</td>')
    expect(pathLabel('/', new Map())).toBe('팀 폴더 맨 위')
    expect(pathLabel('users/nobody/x', new Map())).toBe('users/nobody/x')
  })
})
