// Web pages: admin console — page access per role, CSRF on every POST, people, groups, audit.
import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { getUser, getUserByUsername, listGroups } from '../../src/auth/users'
import { issueToken, listTokens, verifyToken } from '../../src/auth/tokens'
import { redeemEnrollCode } from '../../src/auth/enroll'
import { createBudget, listBudgets } from '../../src/usage/budgets'
import { listRules } from '../../src/policy/rules-admin'
import { audit, listAudit } from '../../src/audit'
import { get, post, follow, login, secretOn, type Sess } from './web-lib'

let hub: TestHub
afterAll(async () => { await hub?.stop() })

const PAGES: [string, string[]][] = [
  ['/admin', ['대시보드', '시작하기', '이번 달 쓴 사람']],
  ['/admin/users', ['사람 추가', '소유자']],
  ['/admin/groups', ['그룹 만들기']],
  ['/admin/folders', ['규칙 추가', '팀 폴더', 'shared', '권한 확인']],
  ['/admin/budgets', ['예산 추가', '아직 예산이 없어요']],
  ['/admin/usage', ['사용량', 'CSV 내려받기', '이번 달', '지난달', '최근 7일']],
  ['/admin/skills', ['스킬 넣는 법', '회사 규칙']],
  ['/admin/settings', ['Anthropic API 키', '접속 주소', '회사 이름']],
  ['/admin/audit', ['기록']],
]

describe('web: admin pages by role', async () => {
  hub = await testHub()
  const admin = await hub.user('admin1', { role: 'admin' })
  const member = await hub.user('member1')
  const g = hub.group('영업팀')
  const owner = hub.session(hub.owner.id), adm = hub.session(admin.id), mem = hub.session(member.id)
  const detail: [string, string[]][] = [[`/admin/users/${member.id}`, ['정보', 'PC 연결 코드 만들기', '비밀번호 초기화']], [`/admin/groups/${g.id}`, ['구성원', '그룹 지우기']]]

  test('owner and admin see every page (200 + key text); the admin nav is there', async () => {
    for (const s of [owner, adm]) {
      for (const [path, texts] of [...PAGES, ...detail]) {
        const r = await get(hub, path, s)
        expect(`${path} ${r.status}`).toBe(`${path} 200`)
        const body = await r.text()
        for (const t of texts) expect(`${path}: ${body.includes(t) ? t : 'missing ' + t}`).toBe(`${path}: ${t}`)
        for (const n of ['대시보드', '폴더 권한', '되살리기', '예산', '기록', '내 PC', '채팅']) expect(body).toContain(`>${n}</a>`)
        expect(body).not.toMatch(/\$argon2/)
      }
    }
  })

  test('members get 403 on every admin page; logged out goes to login', async () => {
    for (const [path] of [...PAGES, ...detail, ['/admin/usage.csv', []] as [string, string[]]]) {
      const r = await get(hub, path, mem)
      expect(`${path} ${r.status}`).toBe(`${path} 403`)
      expect(await r.text()).toContain('관리자만')
      const out = await get(hub, path)
      expect(out.status).toBe(302)
      expect(out.headers.get('location')).toStartWith('/login?next=')
    }
    // and cannot post either
    const r = await post(hub, '/admin/groups', mem, { name: '몰래' })
    expect(r.status).toBe(403)
    expect(listGroups(hub.ctx.db).some((x) => x.name === '몰래')).toBe(false)
  })

  test('every POST route refuses a missing or wrong _csrf and changes nothing', async () => {
    const db = hub.ctx.db
    const t = issueToken(db, member.id, 'device', 'm-pc')
    const b = createBudget(db, { subjectType: 'team', subjectId: null, period: 'month', limitUsd: 5, limitTokens: null, action: 'block' })
    const routes: [string, Record<string, string>][] = [
      ['/admin/users', { name: '새사람', username: 'newbie', role: 'member' }],
      [`/admin/users/${member.id}`, { name: '바뀐이름', role: 'admin', status: 'active' }],
      [`/admin/users/${member.id}/password`, {}],
      [`/admin/users/${member.id}/enroll`, {}],
      [`/admin/users/${member.id}/devices/${t.id}/revoke`, {}],
      ['/admin/groups', { name: '새그룹' }],
      [`/admin/groups/${g.id}/rename`, { name: '바뀐그룹' }],
      [`/admin/groups/${g.id}/members`, { userId: member.id }],
      [`/admin/groups/${g.id}/members/${member.id}/remove`, {}],
      [`/admin/groups/${g.id}/delete`, {}],
      ['/admin/folders/rules', { path: 'shared', subject: 'everyone', access: 'none' }],
      ['/admin/folders/rules/delete', { path: 'shared', subjectType: 'everyone', subjectId: '' }],
      ['/admin/budgets', { subject: 'team', period: 'day', usd: '1', action: 'block' }],
      [`/admin/budgets/${b.id}/delete`, {}],
      ['/admin/settings/general', { companyName: '바뀐회사', hubConcurrency: '3' }],
      ['/admin/settings/urls', { publicUrl: 'https://x.example.com', lanUrl: '' }],
      ['/admin/settings/key', { apiKey: 'sk-ant-api03-should-not-be-saved' }],
      ['/admin/settings/key/remove', {}],
      ['/admin/settings/key/check', {}],
      ['/me/enroll', {}],
      [`/me/devices/${t.id}/revoke`, {}],
      ['/me/password', { current: 'password123', password: 'changed-pass-1', password2: 'changed-pass-1' }],
    ]
    const auditBefore = listAudit(db).length
    const snapshot = () => JSON.stringify([getUser(db, member.id), listGroups(db), listRules(db), listBudgets(db).map((x) => x.id), hub.ctx.secrets.getApiKey(), listTokens(db).map((x) => [x.id, x.revoked_at])])
    const before = snapshot()
    for (const [path, fields] of routes) {
      for (const csrf of [false, 'wrong-token'] as const) {
        const r = await post(hub, path, owner, fields, { csrf })
        expect(`${path} ${r.status}`).toBe(`${path} 403`)
      }
    }
    expect(snapshot()).toBe(before)
    expect(listAudit(db).length).toBe(auditBefore)
    expect(verifyToken(db, t.token)?.user.id).toBe(member.id)
    expect((await login(hub, 'owner', 'password123')).sess).not.toBeNull()
  })
})

describe('web: people', async () => {
  const db = () => hub.ctx.db
  const sales = hub.group('상담실')
  const owner = hub.session(hub.owner.id)

  test('add a person: temp password shown once, must change it, can log in', async () => {
    const r = await post(hub, '/admin/users', owner, { name: '박상담', username: 'park', role: 'member', groups: [sales.id] })
    expect(r.status).toBe(303)
    const park = getUserByUsername(db(), 'park')!
    expect(r.headers.get('location')).toBe(`/admin/users/${park.id}`)
    expect(park.mustChangePassword).toBe(true)
    expect(park.groups.map((x) => x.id)).toEqual([sales.id])
    const page = await follow(hub, r, owner)
    expect(page.text).toContain('임시 비밀번호')
    const temp = secretOn(page.text)!
    expect(temp).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
    expect(page.text).toContain('/login')
    expect(secretOn(await (await get(hub, `/admin/users/${park.id}`, owner)).text())).toBeNull()
    expect(JSON.stringify(listAudit(db()))).not.toContain(temp)

    const { r: lr, sess } = await login(hub, 'park', temp)
    expect(lr.headers.get('location')).toBe('/me/password')
    expect((await post(hub, '/me/password', sess, { password: 'park-own-pass', password2: 'park-own-pass' })).status).toBe(303)
    expect((await get(hub, '/me', sess)).status).toBe(200)
  })

  test('add refuses a duplicate username with a message', async () => {
    const r = await post(hub, '/admin/users', owner, { name: '또박', username: 'park', role: 'member' })
    expect(r.status).toBe(303)
    expect((await follow(hub, r, owner)).text).toContain('이미 있는 아이디예요')
  })

  test('edit name, role, status and groups; disabling cuts sessions and PCs', async () => {
    const park = getUserByUsername(db(), 'park')!
    const parkSess = hub.session(park.id)
    const tok = issueToken(db(), park.id, 'device', 'park-pc')
    let r = await post(hub, `/admin/users/${park.id}`, owner, { name: '박실장', email: 'park@example.com', role: 'admin', status: 'active' })
    expect((await follow(hub, r, owner)).text).toContain('저장했어요')
    let u = getUser(db(), park.id)!
    expect([u.name, u.role, u.email, u.groups.length]).toEqual(['박실장', 'admin', 'park@example.com', 0])
    expect(listAudit(db()).find((a) => a.action === 'user.update' && a.target === park.id)?.detail).toContain('admin')

    r = await post(hub, `/admin/users/${park.id}`, owner, { name: '박실장', role: 'member', status: 'disabled', groups: [sales.id] })
    expect((await follow(hub, r, owner)).text).toContain('껐어요')
    u = getUser(db(), park.id)!
    expect([u.role, u.status, u.groups.map((x) => x.id)]).toEqual(['member', 'disabled', [sales.id]])
    expect(verifyToken(db(), tok.token)).toBeNull()
    expect((await get(hub, '/me', parkSess)).status).toBe(302)
    // back on
    await post(hub, `/admin/users/${park.id}`, owner, { name: '박실장', role: 'member', status: 'active', groups: [sales.id] })
    expect(getUser(db(), park.id)!.status).toBe('active')
  })

  test('nobody changes their own role; only the owner touches the owner account', async () => {
    const adminU = await hub.user('admin2', { role: 'admin' })
    const adm = hub.session(adminU.id)
    await post(hub, `/admin/users/${adminU.id}`, adm, { name: 'admin2', role: 'member', status: 'disabled' })
    expect(getUser(hub.ctx.db, adminU.id)).toMatchObject({ role: 'admin', status: 'active' })
    for (const path of [`/admin/users/${hub.owner.id}`, `/admin/users/${hub.owner.id}/password`, `/admin/users/${hub.owner.id}/enroll`]) {
      const r = await post(hub, path, adm, { name: '해킹', role: 'member', status: 'disabled' })
      expect(`${path} ${r.status}`).toBe(`${path} 403`)
    }
    expect(getUser(hub.ctx.db, hub.owner.id)!.name).toBe('대표')
    expect((await login(hub, 'owner', 'password123')).sess).not.toBeNull()
    // the owner page tells the admin why there is no form
    expect(await (await get(hub, `/admin/users/${hub.owner.id}`, adm)).text()).toContain('소유자 계정은 소유자만')
    // the owner's own role cannot be changed (foundation rule)
    await post(hub, `/admin/users/${hub.owner.id}`, owner, { name: '대표', role: 'member' })
    expect(getUser(hub.ctx.db, hub.owner.id)!.role).toBe('owner')
  })

  test('reset password: new temp password shown once, old one stops working, sessions end', async () => {
    const park = getUserByUsername(hub.ctx.db, 'park')!
    const parkSess = hub.session(park.id)
    const r = await post(hub, `/admin/users/${park.id}/password`, owner)
    const page = await follow(hub, r, owner)
    const temp = secretOn(page.text)!
    expect(temp).toBeTruthy()
    expect((await get(hub, '/me', parkSess)).status).toBe(302)
    expect((await login(hub, 'park', 'park-own-pass')).sess).toBeNull()
    expect((await login(hub, 'park', temp)).r.headers.get('location')).toBe('/me/password')
    expect(listAudit(hub.ctx.db).some((a) => a.action === 'user.password_reset' && a.target === park.id)).toBe(true)
    // not for yourself
    const self = await post(hub, `/admin/users/${hub.owner.id}/password`, owner)
    expect((await follow(hub, self, owner)).text).toContain('비밀번호 바꾸기')
  })

  test('make an enroll code for someone, it redeems, then revoke their PC', async () => {
    const park = getUserByUsername(hub.ctx.db, 'park')!
    const r = await post(hub, `/admin/users/${park.id}/enroll`, owner)
    const page = await follow(hub, r, owner)
    const code = secretOn(page.text)!
    expect(page.text).toContain(`/install.sh | bash -s -- ${code}`)
    expect(page.text).toContain(`/install.ps1))) ${code}`)
    const red = redeemEnrollCode(hub.ctx.db, code, '상담실 PC')!
    expect(red.userId).toBe(park.id)
    const list = await (await get(hub, `/admin/users/${park.id}`, owner)).text()
    expect(list).toContain('상담실 PC')
    const rv = await post(hub, `/admin/users/${park.id}/devices/${red.tokenId}/revoke`, owner)
    expect((await follow(hub, rv, owner)).text).toContain('연결을 끊었어요')
    expect(verifyToken(hub.ctx.db, red.token)).toBeNull()
    expect(listAudit(hub.ctx.db).filter((a) => a.target === park.id).map((a) => a.action)).toEqual(expect.arrayContaining(['enroll.create', 'device.revoke']))
  })
})

describe('web: groups', () => {
  test('create, add and remove a member, rename, delete', async () => {
    const owner = hub.session(hub.owner.id)
    const db = hub.ctx.db
    const choi = await hub.user('choi')
    let r = await post(hub, '/admin/groups', owner, { name: '진료팀' })
    const g = listGroups(db).find((x) => x.name === '진료팀')!
    expect(r.headers.get('location')).toBe(`/admin/groups/${g.id}`)
    expect((await follow(hub, r, owner)).text).toContain('만들었어요')
    r = await post(hub, '/admin/groups', owner, { name: '진료팀' })
    expect((await follow(hub, r, owner)).text).toContain('이미 있는 그룹이에요')

    await post(hub, `/admin/groups/${g.id}/members`, owner, { userId: choi.id })
    expect(getUser(db, choi.id)!.groups.map((x) => x.name)).toEqual(['진료팀'])
    expect(await (await get(hub, `/admin/groups/${g.id}`, owner)).text()).toContain('choi')
    await post(hub, `/admin/groups/${g.id}/members/${choi.id}/remove`, owner)
    expect(getUser(db, choi.id)!.groups).toEqual([])

    await post(hub, `/admin/groups/${g.id}/rename`, owner, { name: '진료1팀' })
    expect(listGroups(db).find((x) => x.id === g.id)!.name).toBe('진료1팀')
    await post(hub, `/admin/groups/${g.id}/delete`, owner)
    expect(listGroups(db).some((x) => x.id === g.id)).toBe(false)
    const actions = listAudit(db).map((a) => a.action)
    for (const a of ['group.create', 'group.member_add', 'group.member_remove', 'group.rename', 'group.delete']) expect(actions).toContain(a)
  })
})

describe('web: audit page', () => {
  test('shows readable rows and pages by 200', async () => {
    const owner = hub.session(hub.owner.id)
    const db = hub.ctx.db
    let body = await (await get(hub, '/admin/audit', owner)).text()
    expect(body).toContain('사람 추가')
    expect(body).toContain('그룹 만듦')
    for (let i = 0; i < 230; i++) audit(db, { actor: hub.owner.id, action: 'test.filler', target: `t${i}` })
    body = await (await get(hub, '/admin/audit', owner)).text()
    const more = /href="\/admin\/audit\?before=(\d+)"/.exec(body)
    expect(more).not.toBeNull()
    expect((body.match(/<tr>/g) ?? []).length).toBe(201) // header + 200
    const older = await (await get(hub, `/admin/audit?before=${more![1]}`, owner)).text()
    expect(older).toContain('최근 기록으로')
    expect(older).toContain('사람 추가')
  })
})
