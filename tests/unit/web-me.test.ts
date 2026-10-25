// Web pages: the personal page (/me) — enroll code with install commands, devices, usage, budgets, skills — and the
// effectiveUrls helper.
import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { redeemEnrollCode } from '../../src/auth/enroll'
import { verifyToken, issueToken, listTokens } from '../../src/auth/tokens'
import { createBudget } from '../../src/usage/budgets'
import { setSetting } from '../../src/db'
import { hubUrl } from '../../src/config'
import { listAudit } from '../../src/audit'
import { effectiveUrls, installCommands, saveSetting, hubConcurrency, companyName } from '../../src/web/settings'
import { get, post, follow, secretOn } from './web-lib'

const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

let hub: TestHub
afterAll(async () => { await hub?.stop() })

describe('web: personal page', async () => {
  hub = await testHub()
  const db = hub.ctx.db
  const kim = await hub.user('kim')
  const lee = await hub.user('lee')
  const sess = hub.session(kim.id)

  test('renders for a member with helpful empty states', async () => {
    const r = await get(hub, '/me', sess)
    expect(r.status).toBe(200)
    const body = await r.text()
    for (const t of ['PC 연결하기', '아직 연결된 PC가 없어요', '이번 달 내 사용량', '내 스킬', '휴대폰']) expect(body).toContain(t)
    expect(body).toContain('href="/app"')
    expect(body).not.toContain('href="/admin/users"') // members get the short navigation
  })

  test('PC 연결하기: code shown once with both install commands; it redeems', async () => {
    expect((await post(hub, '/me/enroll', sess, {}, { csrf: false })).status).toBe(403)
    const r = await post(hub, '/me/enroll', sess)
    expect(r.status).toBe(303)
    const page = await follow(hub, r, sess)
    expect(page.status).toBe(200)
    const code = secretOn(page.text)!
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    const text = unescape(page.text)
    expect(text).toContain(`curl -fsSL ${hub.url}/install.sh | bash -s -- ${code}`)
    expect(text).toContain(`& ([scriptblock]::Create((irm ${hub.url}/install.ps1))) ${code}`)
    expect(text).toContain('공개 주소(https)가 아직 없어서')
    expect(text).toContain('터미널')
    // shown once
    expect(secretOn(await (await get(hub, '/me', sess)).text())).toBeNull()
    expect(listAudit(db).some((a) => a.action === 'enroll.create' && a.target === kim.id && !String(a.detail).includes(code))).toBe(true)

    const red = redeemEnrollCode(db, code, 'kim-macbook')!
    expect(red.userId).toBe(kim.id)
    expect(verifyToken(db, red.token)?.user.id).toBe(kim.id)
    const after = await (await get(hub, '/me', sess)).text()
    expect(after).toContain('kim-macbook')
    expect(after).not.toContain('아직 연결된 PC가 없어요')
    expect(after).not.toContain(red.token)
  })

  test('the install command uses the public address once it is set', async () => {
    saveSetting(hub.ctx, 'publicUrl', 'https://acme.example.com')
    try {
      const page = await follow(hub, await post(hub, '/me/enroll', sess), sess)
      const code = secretOn(page.text)!
      const text = unescape(page.text)
      expect(text).toContain(`curl -fsSL https://acme.example.com/install.sh | bash -s -- ${code}`)
      expect(text).toContain(`& ([scriptblock]::Create((irm https://acme.example.com/install.ps1))) ${code}`)
      expect(text).not.toContain('공개 주소(https)가 아직 없어서')
    } finally { saveSetting(hub.ctx, 'publicUrl', null) }
  })

  test('revoke my PC; someone else\'s PC is untouched', async () => {
    const mine = listTokens(db, kim.id).find((t) => t.name === 'kim-macbook')!
    const leeToken = issueToken(db, lee.id, 'device', 'lee-pc')
    expect((await post(hub, `/me/devices/${mine.id}/revoke`, sess, {}, { csrf: false })).status).toBe(403)
    const r = await post(hub, `/me/devices/${mine.id}/revoke`, sess)
    expect(r.status).toBe(303)
    expect((await follow(hub, r, sess)).text).toContain('연결을 끊었어요')
    expect(listTokens(db, kim.id).find((t) => t.id === mine.id)?.revoked_at).toBeTruthy()
    await post(hub, `/me/devices/${leeToken.id}/revoke`, sess)
    expect(verifyToken(db, leeToken.token)?.user.id).toBe(lee.id)
    expect(listAudit(db).some((a) => a.action === 'device.revoke' && a.target === kim.id)).toBe(true)
  })

  test('my usage this month, budgets that apply to me, my skills', async () => {
    const now = new Date().toISOString()
    db.query("INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cost_usd, status, started_at) VALUES ('m1', ?, 'pc', 'claude-sonnet-5-5', 1000, 500, 1.25, 200, ?)").run(kim.id, now)
    db.query("INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cost_usd, status, started_at) VALUES ('m2', ?, 'pc', 'claude-sonnet-5-5', 1000, 500, 0.25, 200, ?)").run(kim.id, now)
    db.query("INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cost_usd, status, started_at) VALUES ('m3', ?, 'pc', 'claude-sonnet-5-5', 1, 1, 99, 200, ?)").run(lee.id, now)
    createBudget(db, { subjectType: 'user', subjectId: kim.id, period: 'month', limitUsd: 10, limitTokens: null, action: 'block' })
    hub.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: 견적서 초안을 만들어요\n---\n# 견적')
    const body = await (await get(hub, '/me', sess)).text()
    expect(body).toContain('$1.50') // only my own rows
    expect(body).not.toContain('$99')
    expect(body).toContain('내게 적용되는 예산')
    expect(body).toContain('$1.50 / $10.00')
    expect(body).toContain('약 2,100원') // 1.50 × 1,400
    expect(body).toContain('견적서 초안을 만들어요')
  })
})

describe('web: effectiveUrls', () => {
  test('config first, saved settings win, empty falls back; ctx.config follows', async () => {
    const h = await testHub({ config: { lanUrl: 'http://192.168.0.10:47900' } })
    try {
      let u = effectiveUrls(h.ctx)
      expect(u.kind).toBe('lan')
      expect(u.hubUrl).toBe('http://192.168.0.10:47900')
      expect(effectiveUrls(h.ctx, 'http://10.0.0.5:47900').hubUrl).toBe('http://192.168.0.10:47900')
      saveSetting(h.ctx, 'publicUrl', 'https://acme.example.com')
      u = effectiveUrls(h.ctx)
      expect(u).toMatchObject({ kind: 'public', hubUrl: 'https://acme.example.com', lanUrl: 'http://192.168.0.10:47900' })
      expect(h.ctx.config.publicUrl).toBe('https://acme.example.com')
      expect(hubUrl(h.ctx.config)).toBe('https://acme.example.com')
      saveSetting(h.ctx, 'publicUrl', null)
      saveSetting(h.ctx, 'lanUrl', null)
      expect(effectiveUrls(h.ctx).hubUrl).toBe('http://192.168.0.10:47900')
      setSetting(h.ctx.db, 'lanUrl', 'http://10.1.1.1:47900')
      expect(effectiveUrls(h.ctx).lanUrl).toBe('http://10.1.1.1:47900')
      saveSetting(h.ctx, 'hubConcurrency', 3)
      expect(hubConcurrency(h.ctx)).toBe(3)
      expect(h.ctx.config.hubConcurrency).toBe(3)
      expect(companyName(h.ctx)).toBe('Trina AX')
      expect(installCommands('https://x.example', 'AAAA-BBBB-CCCC')).toEqual({
        mac: 'curl -fsSL https://x.example/install.sh | bash -s -- AAAA-BBBB-CCCC',
        windows: '& ([scriptblock]::Create((irm https://x.example/install.ps1))) AAAA-BBBB-CCCC',
      })
    } finally { await h.stop() }
  })

  test('with no public or LAN address the local fallback is the address the browser used', async () => {
    const h = await testHub()
    try {
      expect(effectiveUrls(h.ctx, 'http://192.168.5.5:47900')).toMatchObject({ kind: 'local', hubUrl: 'http://192.168.5.5:47900' })
      expect(effectiveUrls(h.ctx).hubUrl).toStartWith('http://127.0.0.1:')
    } finally { await h.stop() }
  })
})
