// Invite links: a person is added by name + email and joins on a single-use link; reissue and reset links; login by
// email or username; the hidden username; bulk invite (paste "이름, 이메일").
import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { getUser, getUserByUsername } from '../../src/auth/users'
import {
  INVITE_TTL_MS, createInvitedUser, deriveUsername, getUserByLogin, lookupInvite, openInvite, normalizeEmail, validEmail,
} from '../../src/auth/invites'
import { listAudit } from '../../src/audit'
import { setInviteMailer } from '../../src/web/invite-mail'
import { PRODUCT } from '../../src/product'
import { BULK_MAX, parseBulk, planBulk, splitCells, inviteMessage } from '../../src/web/invite-ui'
import { get, post, follow, login, preSession, setCookies, hubCookie, inviteOn, pageText } from './web-lib'

const hubs: TestHub[] = []
afterAll(async () => { for (const h of hubs) await h.stop() })
const newHub = async (o: Parameters<typeof testHub>[0] = {}) => { const h = await testHub(o); hubs.push(h); return h }

/** Add a person through the admin form and read the one-time link off the page. */
async function invite(hub: TestHub, fields: Record<string, string | string[]>) {
  const owner = hub.session(hub.owner.id)
  const r = await post(hub, '/admin/users', owner, { role: 'member', ...fields })
  expect(r.status).toBe(303)
  const page = await follow(hub, r, owner)
  const inv = inviteOn(page.text)
  return { inv, page: page.text, location: r.headers.get('location')! }
}

async function join(hub: TestHub, path: string, password = 'brand-new-pass', extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const pre = await preSession(hub, path, headers)
  return post(hub, path, pre, { password, password2: password, ...extra }, { headers })
}

/** Post to a link that may be dead (no form to read a token from), with a form token from the login page. */
async function joinAnyway(hub: TestHub, path: string, password = 'brand-new-pass') {
  const pre = await preSession(hub, '/login')
  return post(hub, path, pre, { password, password2: password })
}

describe('invite link: single use, 7 days, reissue', async () => {
  const hub = await newHub()
  const db = hub.ctx.db
  const owner = hub.session(hub.owner.id)
  const sales = hub.group('영업팀')
  const made = await invite(hub, { name: '김영희', email: 'Younghee.Kim@Company.com', groups: [sales.id] })
  const kim = getUserByUsername(db, 'younghee.kim')!

  test('the admin sees the link once, with a message to paste', () => {
    expect(made.inv).not.toBeNull()
    expect(made.inv!.token).toHaveLength(43) // 32 random bytes
    expect(kim.email).toBe('younghee.kim@company.com')
    expect(kim.mustChangePassword).toBe(true)
    expect(kim.groups.map((g) => g.id)).toEqual([sales.id])
    const text = pageText(made.page)
    expect(text).toContain(`${hub.url}/join/${made.inv!.token}`)
    expect(text).toContain('Claude 앱을 먼저 설치해 두세요')
    expect(text).toContain('김영희님, 회사 AI에 초대했어요')
    expect(text).toContain('Trina AX') // the company name
    expect(text).toContain('복사')
    expect(made.page).toContain('data-copy="invite-link"')
    expect(made.page).toContain('data-copy="invite-message"')
    expect(text).toContain('메일로 바로 보내는 기능은 아직 없어요')
  })

  test('only a hash is stored; the link expires in 7 days', () => {
    const rows = db.query('SELECT * FROM invites WHERE user_id = ?').all(kim.id) as any[]
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain(made.inv!.token)
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
    const span = Date.parse(rows[0].expires_at) - Date.parse(rows[0].created_at)
    expect(Math.abs(span - INVITE_TTL_MS)).toBeLessThan(5000)
    expect(INVITE_TTL_MS).toBe(7 * 86_400_000)
  })

  test('the join page names the company and the person, asks for the password twice, and is not cached', async () => {
    const r = await get(hub, made.inv!.path)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toContain('no-store')
    const html = await r.text()
    const text = pageText(html)
    expect(text).toContain('Trina AX')
    expect(text).toContain('김영희님')
    expect(text).toContain('younghee.kim@company.com') // what they log in with next time
    expect(html).toContain('name="password"')
    expect(html).toContain('name="password2"')
    expect(html).toContain('autocomplete="new-password"')
    expect(html).toContain('name="robots"')
    expect(setCookies(r).some((c) => c.startsWith(PRODUCT.sessionCookie + '='))).toBe(false) // opening the link logs nobody in
  })

  test('same rules as before: 8 characters, both the same, a form token; a failed try keeps the link alive', async () => {
    expect((await post(hub, made.inv!.path, null, { password: 'longenough1', password2: 'longenough1' }, { csrf: false })).status).toBe(403)
    const pre = await preSession(hub, made.inv!.path)
    const short = await post(hub, made.inv!.path, pre, { password: 'short', password2: 'short' })
    expect(short.status).toBe(400)
    expect(await short.text()).toContain('8자 이상')
    const diff = await post(hub, made.inv!.path, pre, { password: 'longenough1', password2: 'longenough2' })
    expect(diff.status).toBe(400)
    expect(await diff.text()).toContain('서로 달라요')
    expect(getUser(db, kim.id)!.mustChangePassword).toBe(true)
    expect(lookupInvite(db, made.inv!.token).ok).toBe(true)
  })

  test('joining logs them in, spends the link and is written to the audit log', async () => {
    const r = await join(hub, made.inv!.path, 'younghee-pass-1')
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/me')
    const cookie = hubCookie(r, PRODUCT.sessionCookie)!
    expect((await get(hub, '/me', { cookie, csrf: '' })).status).toBe(200)
    const u = getUser(db, kim.id)!
    expect(u.mustChangePassword).toBe(false)
    expect((await login(hub, 'younghee.kim@company.com', 'younghee-pass-1')).sess).not.toBeNull()
    const a = listAudit(db).find((x) => x.action === 'invite.join' && x.target === kim.id)!
    expect(a.actor).toBe(kim.id)
    expect(a.detail).not.toContain('younghee-pass-1')
    expect(JSON.stringify(listAudit(db))).not.toContain(made.inv!.token)
  })

  test('a used link says so and points at the login; a second post changes nothing', async () => {
    const g = await get(hub, made.inv!.path)
    expect(g.status).toBe(410)
    const text = pageText(await g.text())
    expect(text).toContain('이미 쓴 링크예요')
    expect(text).toContain('관리자에게 새 링크를 부탁해')
    const again = await joinAnyway(hub, made.inv!.path, 'someone-elses-pass')
    expect(again.status).toBe(410)
    expect((await login(hub, 'younghee.kim', 'someone-elses-pass')).sess).toBeNull()
    expect((await login(hub, 'younghee.kim', 'younghee-pass-1')).sess).not.toBeNull()
  })

  test('two people opening the same link at once: exactly one wins', async () => {
    const { inv } = await invite(hub, { name: '동시', email: 'race@company.com' })
    const [a, b] = await Promise.all([join(hub, inv!.path, 'first-pass-123'), join(hub, inv!.path, 'second-pass-123')])
    expect([a.status, b.status].sort()).toEqual([303, 410])
    const winner = a.status === 303 ? 'first-pass-123' : 'second-pass-123'
    expect((await login(hub, 'race', winner)).sess).not.toBeNull()
  })

  test('an expired link, an unknown link, a bad shape, a switched-off account: each a plain Korean page', async () => {
    const { inv } = await invite(hub, { name: '늦은', email: 'late@company.com' })
    const late = getUserByUsername(db, 'late')!
    db.query('UPDATE invites SET expires_at = ? WHERE user_id = ?').run(new Date(Date.now() - 1000).toISOString(), late.id)
    const e = await get(hub, inv!.path)
    expect(e.status).toBe(410)
    expect(pageText(await e.text())).toContain('링크 기간이 지났어요')
    expect((await joinAnyway(hub, inv!.path)).status).toBe(410)
    expect(getUser(db, late.id)!.mustChangePassword).toBe(true)
    expect(lookupInvite(db, inv!.token)).toMatchObject({ ok: false, why: 'expired' })

    const unknown = await get(hub, '/join/' + 'a'.repeat(43))
    expect(unknown.status).toBe(404)
    expect(pageText(await unknown.text())).toContain('열 수 없는 링크예요')
    expect((await get(hub, '/join/short')).status).toBe(404)

    const off = await invite(hub, { name: '꺼진', email: 'off@company.com' })
    const offUser = getUserByUsername(db, 'off')!
    db.query("UPDATE users SET status = 'disabled' WHERE id = ?").run(offUser.id)
    const g = await get(hub, off.inv!.path)
    expect(g.status).toBe(410)
    expect(pageText(await g.text())).toContain('지금은 쓸 수 없는 계정이에요')
    expect((await joinAnyway(hub, off.inv!.path)).status).toBe(410)
  })

  test('reissue: the new link works, the old one is dead; a person who joined gets a message instead', async () => {
    const first = await invite(hub, { name: '재발급', email: 'again@company.com' })
    const u = getUserByUsername(db, 'again')!
    const r = await post(hub, `/admin/users/${u.id}/invite`, owner)
    expect(r.status).toBe(303)
    const second = inviteOn((await follow(hub, r, owner)).text)!
    expect(second.token).not.toBe(first.inv!.token)
    expect(openInvite(db, u.id)).toMatchObject({ kind: 'invite' })
    const old = await get(hub, first.inv!.path)
    expect(old.status).toBe(410)
    expect(pageText(await old.text())).toContain('새 링크가 만들어져서')
    expect((await joinAnyway(hub, first.inv!.path)).status).toBe(410)
    expect((await join(hub, second.path, 'again-pass-123')).status).toBe(303)
    // already joined: no more invite links for them
    const late = await post(hub, `/admin/users/${u.id}/invite`, owner)
    expect((await follow(hub, late, owner)).text).toContain('이미 가입한 사람이에요')
    expect(listAudit(db).filter((a) => a.action === 'invite.create' && a.target === u.id)).toHaveLength(2)
  })

  test('the user page offers the right button for where the person is', async () => {
    const { inv } = await invite(hub, { name: '버튼', email: 'button@company.com' })
    const u = getUserByUsername(db, 'button')!
    const before = pageText(await (await get(hub, `/admin/users/${u.id}`, owner)).text())
    expect(before).toContain('초대 링크 다시 만들기')
    expect(before).toContain('초대함')
    expect(before).not.toContain('초기화 링크 만들기')
    await join(hub, inv!.path, 'button-pass-123')
    const after = pageText(await (await get(hub, `/admin/users/${u.id}`, owner)).text())
    expect(after).toContain('초기화 링크 만들기')
    expect(after).toContain('임시 비밀번호로 만들기')
    expect(after).toContain('가입함')
    expect(after).not.toContain('초대 링크 다시 만들기')
  })

  test('over https the session cookie is the __Host- one', async () => {
    const { inv } = await invite(hub, { name: '보안', email: 'secure@company.com' })
    const https = { 'x-forwarded-proto': 'https' }
    const r = await join(hub, inv!.path, 'secure-pass-123', {}, https)
    expect(r.status).toBe(303)
    const c = setCookies(r).find((x) => x.startsWith(`__Host-${PRODUCT.sessionCookie}=`))!
    expect(c).toContain('Secure')
    expect(c).toContain('HttpOnly')
    expect(c).toContain('Path=/')
    expect(c).not.toMatch(/Domain=/i)
    expect(setCookies(r).some((x) => x.startsWith(`${PRODUCT.sessionCookie}=`))).toBe(false)
  })

  test('the join link keeps `next` (query or the cookie the login page left) and ignores addresses outside the hub', async () => {
    const a = await invite(hub, { name: '다음', email: 'next@company.com' })
    const page = await (await get(hub, a.inv!.path + '?next=' + encodeURIComponent('/oauth/continue/abc123'))).text()
    expect(page).toContain('name="next" value="/oauth/continue/abc123"')
    const bad = await (await get(hub, a.inv!.path + '?next=' + encodeURIComponent('https://evil.example/'))).text()
    expect(bad).not.toContain('name="next"')
    const r = await join(hub, a.inv!.path, 'next-pass-1234', { next: '//evil.example/x' })
    expect(r.headers.get('location')).toBe('/me')
  })
})

describe('login by email or username', async () => {
  const hub = await newHub()
  const db = hub.ctx.db
  const { inv } = await invite(hub, { name: '이메일', email: 'Lee.Mail@Company.com' })
  await join(hub, inv!.path, 'mail-login-pass')

  test('either works, upper or lower case', async () => {
    for (const id of ['lee.mail@company.com', 'LEE.MAIL@COMPANY.COM', 'Lee.Mail', 'lee.mail', '  lee.mail@company.com  ']) {
      const { r, sess } = await login(hub, id, 'mail-login-pass')
      expect(`${id}: ${r.status}`).toBe(`${id}: 303`)
      expect(sess).not.toBeNull()
    }
    expect((await login(hub, 'lee.mail@company.com', 'wrong-pass-1')).sess).toBeNull()
    expect((await login(hub, 'nobody@company.com', 'mail-login-pass')).sess).toBeNull()
    expect((await login(hub, 'owner', 'password123')).sess).not.toBeNull()
    const page = pageText(await (await get(hub, '/login')).text())
    expect(page).toContain('이메일 또는 아이디')
  })

  test('an address two old accounts share matches nobody (they use their usernames)', async () => {
    const a = await hub.user('dupe-a'), b = await hub.user('dupe-b')
    db.query('UPDATE users SET email = ? WHERE id IN (?, ?)').run('shared@company.com', a.id, b.id)
    expect(getUserByLogin(db, 'shared@company.com')).toBeNull()
    expect(getUserByLogin(db, 'dupe-a')?.id).toBe(a.id)
    expect((await login(hub, 'shared@company.com', 'password123')).sess).toBeNull()
    expect((await login(hub, 'dupe-b', 'password123')).sess).not.toBeNull()
  })

  test('a person who was invited but never joined cannot log in with anything', async () => {
    await invite(hub, { name: '아직', email: 'not.yet@company.com' })
    for (const pw of ['', 'password123', 'x'.repeat(12)]) expect((await login(hub, 'not.yet@company.com', pw)).sess).toBeNull()
    expect((await login(hub, 'not.yet', 'password123')).sess).toBeNull()
  })
})

describe('the hidden username', async () => {
  const hub = await newHub()
  const db = hub.ctx.db

  test('derived from the email, Latin only, de-duplicated', () => {
    expect(deriveUsername(db, 'Gildong.Hong@Company.com')).toBe('gildong.hong')
    expect(deriveUsername(db, 'kim+work@company.com')).toBe('kim')
    expect(deriveUsername(db, '홍길동@회사.kr')).toBe('user')
    expect(deriveUsername(db, 'a@x.com')).toBe('user')
    expect(deriveUsername(db, '_-x_y@x.com')).toBe('x_y')
    expect(deriveUsername(db, 'owner@x.com')).toBe('owner2') // taken by the owner
    expect(deriveUsername(db, 'a'.repeat(60) + '@x.com')).toHaveLength(28)
    expect(deriveUsername(db, 'bob@x.com', new Set(['bob', 'bob2']))).toBe('bob3')
  })

  test('the same name part from two addresses gets a number; an explicit one under 고급 wins', async () => {
    const one = await invite(hub, { name: '김하나', email: 'kim@one.com' })
    const two = await invite(hub, { name: '김둘', email: 'kim@two.com' })
    const three = await invite(hub, { name: '김셋', email: 'kim3@three.com', username: 'my-own' })
    expect(one.inv && two.inv && three.inv).toBeTruthy()
    expect(getUserByUsername(db, 'kim')!.name).toBe('김하나')
    expect(getUserByUsername(db, 'kim2')!.name).toBe('김둘')
    expect(getUserByUsername(db, 'my-own')!.name).toBe('김셋')
    // an address with no Latin letters at all still gets a login name
    const ko = await invite(hub, { name: '한글', email: '한글@회사.kr' })
    expect(ko.inv).not.toBeNull()
    expect(getUserByUsername(db, 'user')!.name).toBe('한글')
  })

  test('createInvitedUser checks the same things as the form', () => {
    expect(() => createInvitedUser(db, { username: 'x', name: 'A', email: 'a@b.com', role: 'member' })).toThrow('아이디')
    expect(() => createInvitedUser(db, { username: 'okname', name: ' ', email: 'a@b.com', role: 'member' })).toThrow('이름')
    expect(() => createInvitedUser(db, { username: 'okname', name: 'A', email: 'bad', role: 'member' })).toThrow('이메일')
    expect(() => createInvitedUser(db, { username: 'okname', name: 'A', email: 'a@b.com', role: 'owner' })).toThrow('소유자')
    expect(normalizeEmail('  A@B.Com ')).toBe('a@b.com')
    expect(validEmail('a@b.co')).toBe(true)
    expect(validEmail('a b@c.com')).toBe(false)
    expect(validEmail('a@b')).toBe(false)
  })
})

describe('bulk invite: parsing what people paste', () => {
  test('comma, tab (an Excel paste), quotes, Windows line ends, extra columns, email first', () => {
    const p = parseBulk([
      '홍길동, gildong@company.com',
      '김영희\tyounghee@company.com\t영업팀\t010-1234-5678',
      '"박, 철수","chulsoo@company.com"',
      'minsu@company.com, 이민수',
      '',
      '   ',
      '최지우 ,  JIWOO@Company.com  ',
    ].join('\r\n'))
    expect(p.header).toBe(false)
    expect(p.rows.map((r) => [r.line, r.name, r.email, r.problem])).toEqual([
      [1, '홍길동', 'gildong@company.com', undefined],
      [2, '김영희', 'younghee@company.com', undefined],
      [3, '박, 철수', 'chulsoo@company.com', undefined],
      [4, '이민수', 'minsu@company.com', undefined],
      [7, '최지우', 'jiwoo@company.com', undefined],
    ])
    expect(splitCells('a\t"b\tc"\td')).toEqual(['a', 'b\tc', 'd'])
    expect(splitCells('a,"say ""hi""",c')).toEqual(['a', 'say "hi"', 'c'])
  })

  test('a header line is skipped; a BOM and old Mac line ends are fine', () => {
    for (const head of ['이름, 이메일', '이름\t이메일\t부서', 'Name,E-mail', '﻿이름,이메일']) {
      const p = parseBulk(`${head}\r홍길동, a@b.com`)
      expect(p.header).toBe(true)
      expect(p.rows).toHaveLength(1)
      expect(p.rows[0]!.line).toBe(2)
    }
    expect(parseBulk('홍길동, a@b.com').header).toBe(false)
  })

  test('every problem is named, and nothing is dropped silently', () => {
    const p = parseBulk(['홍길동', '홍길동, not-an-email', ', a@b.com', `${'가'.repeat(41)}, long@b.com`, 'a@b.com'].join('\n'))
    expect(p.rows.map((r) => r.problem)).toEqual(['이메일이 없어요.', '이메일 모양이 이상해요.', '이름이 없어요.', '이름이 너무 길어요 (40자 안으로).', '이름이 없어요.'])
    expect(p.rows[1]).toMatchObject({ name: '홍길동', email: 'not-an-email' })
  })

  test(`at most ${BULK_MAX} people at once, and the page says so`, () => {
    const many = Array.from({ length: BULK_MAX + 5 }, (_, i) => `사람${i}, p${i}@b.com`).join('\n')
    const p = parseBulk(many)
    expect(p.rows).toHaveLength(BULK_MAX)
    expect(p.tooMany).toBe(true)
  })

  test('duplicates and existing people are skipped with a reason', async () => {
    const hub = await newHub()
    const j = await invite(hub, { name: '이미', email: 'joined@b.com' })
    await join(hub, j.inv!.path, 'joined-pass-123')
    await invite(hub, { name: '초대됨', email: 'pending@b.com' })
    const plan = planBulk(hub.ctx.db, parseBulk([
      '새사람, new@b.com', '또새사람, NEW@b.com', '이미, Joined@B.com', '초대됨, pending@b.com', '대표, ', '다른, other@b.com',
    ].join('\n')).rows)
    expect(plan.map((r) => r.status)).toEqual(['new', 'skip', 'skip', 'skip', 'skip', 'new'])
    expect(plan[1]!.reason).toContain('같은 이메일이 앞에도')
    expect(plan[2]!.reason).toContain('이미 가입한')
    expect(plan[3]!.reason).toContain('이미 초대한')
    expect(plan[4]!.reason).toContain('이메일이 없어요')
  })
})

describe('bulk invite: the page', async () => {
  const hub = await newHub()
  const db = hub.ctx.db
  const owner = hub.session(hub.owner.id)
  const sales = hub.group('영업팀')
  await hub.user('kim') // takes the name "kim"
  const text = ['홍길동, gildong@company.com', '김영희\tkim@company.com', '김둘\tkim@other.com', '엉터리, nope', '홍길동2, GILDONG@company.com'].join('\n')

  test('preview first: nothing is created, every line says what will happen', async () => {
    const before = db.query('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    const r = await post(hub, '/admin/users/bulk/preview', owner, { text, group: sales.id })
    expect(r.status).toBe(200)
    const body = await r.text()
    const t = pageText(body)
    expect(t).toContain('3명')
    expect(t).toContain('2명은 건너뛰어요')
    expect(t).toContain('이메일 모양이 이상해요')
    expect(t).toContain('같은 이메일이 앞에도 있어요')
    expect(t).toContain('3명 초대 링크 만들기')
    expect(t).toContain('영업팀')
    expect(body).toContain('action="/admin/users/bulk"')
    expect((db.query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(before.n)
    expect((await post(hub, '/admin/users/bulk/preview', owner, { text }, { csrf: false })).status).toBe(403)
  })

  test('create: a table with each person\'s link, one "모두 복사" with a message per person, skips with reasons', async () => {
    expect((await post(hub, '/admin/users/bulk', owner, { text, group: sales.id }, { csrf: false })).status).toBe(403)
    const r = await post(hub, '/admin/users/bulk', owner, { text, group: sales.id })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/admin/users')
    const page = (await follow(hub, r, owner)).text
    const t = pageText(page)
    expect(t).toContain('3명을 초대했어요 (2명 건너뜀)')
    expect(page).toContain('data-copy="bulk-all"')
    expect(page).toContain('id="bulk-all"')
    for (const n of ['홍길동', '김영희', '김둘']) expect(t).toContain(n)
    expect(t).toContain('이메일 모양이 이상해요')
    expect(t).toContain('같은 이메일이 앞에도 있어요')
    const links = [...page.matchAll(/\/join\/([A-Za-z0-9_-]{43})/g)].map((m) => m[1]!)
    expect(new Set(links).size).toBe(3) // one link per person (the all-copy block repeats them)
    // the "모두 복사" block holds one message per person
    const all = /<pre class="preview" id="bulk-all">([\s\S]*?)<\/pre>/.exec(page)![1]!
    expect(all.split('Claude 앱을 먼저 설치해 두세요')).toHaveLength(4)
    expect(all).toContain('홍길동님, 회사 AI에 초대했어요')
    // people exist, in the group, with hidden usernames from their addresses (kim is taken)
    const gil = getUserByUsername(db, 'gildong')!
    expect([gil.email, gil.mustChangePassword, gil.groups.map((g) => g.name)]).toEqual(['gildong@company.com', true, ['영업팀']])
    expect(getUserByUsername(db, 'kim2')!.name).toBe('김영희')
    expect(getUserByUsername(db, 'kim3')!.name).toBe('김둘')
    // gone after one view; the people list shows them as invited
    const again = await (await get(hub, '/admin/users', owner)).text()
    expect(again).not.toContain('bulk-result')
    expect(pageText(again)).toContain('초대함')
    // every link joins its person
    const j = await join(hub, `/join/${links[0]}`, 'bulk-pass-1234')
    expect(j.status).toBe(303)
    const audits = listAudit(db).filter((a) => a.action === 'invite.create')
    expect(audits.length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(listAudit(db))).not.toContain(links[0]!)
  })

  test('running the same paste again creates nobody twice', async () => {
    const r = await post(hub, '/admin/users/bulk', owner, { text })
    expect((await follow(hub, r, owner)).text).toContain('만들 수 있는 사람이 없어요')
    expect(getUserByUsername(db, 'gildong2')).toBeNull()
    expect(getUserByUsername(db, 'kim4')).toBeNull()
  })

  test('an empty paste', async () => {
    const r = await post(hub, '/admin/users/bulk/preview', owner, { text: '  \n ' })
    expect(r.status).toBe(200)
    expect(pageText(await r.text())).toContain('사람을 찾지 못했어요')
  })

  test('the message', () => {
    const m = inviteMessage({ company: '데모치과', name: '홍길동', link: 'https://demo.trina.app/join/x' })
    expect(m).toContain('[데모치과]')
    expect(m).toContain('Claude 앱을 먼저 설치해 두세요.')
    expect(m).toContain('https://demo.trina.app/join/x')
    expect(inviteMessage({ company: '데모치과', name: '홍길동', link: 'L', reset: true })).toContain('비밀번호를 다시 정하는 링크')
  })
})

describe('the seam for sending by email', async () => {
  const hub = await newHub()
  const owner = hub.session(hub.owner.id)
  const sent: { to: string; name: string; company: string; link: string; message: string; kind: string }[] = []

  test('with no mail service the page says to copy the link, and nothing is sent', async () => {
    const { page } = await invite(hub, { name: '무메일', email: 'nomail@company.com' })
    expect(pageText(page)).toContain('메일로 바로 보내는 기능은 아직 없어요')
    expect(sent).toHaveLength(0)
  })

  test('a registered mailer gets every new link: single, reissue, reset and bulk; a failing one loses nothing', async () => {
    setInviteMailer(hub.ctx, { available: true, send: async (m) => { sent.push(m); return { sent: true } } })
    const one = await invite(hub, { name: '메일맨', email: 'mailman@company.com' })
    expect(sent.at(-1)).toMatchObject({ to: 'mailman@company.com', name: '메일맨', kind: 'invite' })
    expect(sent.at(-1)!.link).toBe(`${hub.url}/join/${one.inv!.token}`)
    expect(sent.at(-1)!.message).toContain('Claude 앱을 먼저 설치해 두세요')
    expect(pageText(one.page)).toContain('메일로도 보냈어요')
    const u = getUserByUsername(hub.ctx.db, 'mailman')!
    await post(hub, `/admin/users/${u.id}/invite`, owner)
    expect(sent.at(-1)!.kind).toBe('invite')
    await join(hub, `/join/${sent.at(-1)!.link.split('/join/')[1]}`, 'mailman-pass-1')
    await post(hub, `/admin/users/${u.id}/password`, owner)
    expect(sent.at(-1)!.kind).toBe('reset')
    const before = sent.length
    const r = await post(hub, '/admin/users/bulk', owner, { text: '가나, ga@company.com\n다라, da@company.com' })
    const page = (await follow(hub, r, owner)).text
    expect(sent.length).toBe(before + 2)
    expect(pageText(page)).toContain('모두 메일로도 보냈어요')

    setInviteMailer(hub.ctx, { available: true, send: async () => { throw new Error('smtp down') } })
    const broken = await invite(hub, { name: '실패', email: 'broken@company.com' })
    expect(broken.inv).not.toBeNull() // the link is still shown
    expect(pageText(broken.page)).toContain('메일로 바로 보내는 기능은 아직 없어요')
    setInviteMailer(hub.ctx, null)
  })
})
