import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { verifyToken, revokeToken, issueToken } from '../../src/auth/tokens'
import { makeEnrollCode, redeemEnrollCode } from '../../src/auth/enroll'
import { setRule } from '../../src/policy/rules-admin'
import { loadPrincipal } from '../../src/policy/access'
import { skillsFor, rulesFor, readFrontMatter } from '../../src/skills/catalog'
import { createBudget, budgetBlock } from '../../src/usage/budgets'
import { updateUser } from '../../src/auth/users'

let hub: TestHub
afterAll(async () => { await hub?.stop() })

describe('foundation', async () => {
  hub = await testHub()
  const db = hub.ctx.db

  test('health', async () => {
    const r = await fetch(hub.url + '/healthz')
    expect(r.status).toBe(200)
    expect((await r.json() as any).ok).toBe(true)
  })

  test('tokens: issue, verify, revoke, disabled account', async () => {
    const u = await hub.user('kim')
    const t = issueToken(db, u.id, 'device', 'kim-pc')
    expect(verifyToken(db, t.token)?.user.id).toBe(u.id)
    expect(verifyToken(db, t.token + 'x')).toBeNull()
    expect(verifyToken(db, 'sk-ant-whatever')).toBeNull()
    expect(revokeToken(db, t.id)).toBe(true)
    expect(verifyToken(db, t.token)).toBeNull()
    const t2 = issueToken(db, u.id, 'device', 'kim-pc2')
    updateUser(db, u.id, { status: 'disabled' })
    expect(verifyToken(db, t2.token)).toBeNull()
  })

  test('hub tokens expire', () => {
    const t = issueToken(db, hub.owner.id, 'hub', 'job', -1000)
    expect(verifyToken(db, t.token)).toBeNull()
  })

  test('enroll code works once', async () => {
    const u = await hub.user('lee')
    const { code } = makeEnrollCode(db, u.id, hub.owner.id)
    const r = redeemEnrollCode(db, code.toLowerCase(), 'lee-mac')
    expect(r?.userId).toBe(u.id)
    expect(verifyToken(db, r!.token)?.user.id).toBe(u.id)
    expect(redeemEnrollCode(db, code, 'again')).toBeNull()
    expect(redeemEnrollCode(db, 'AAAA-BBBB-CCCC', 'x')).toBeNull()
  })

  test('skills catalog follows folder permissions', async () => {
    const sales = hub.group('영업')
    const park = await hub.user('park', { groups: [sales.id] })
    const choi = await hub.user('choi')
    hub.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: "견적서 초안을 만든다"\n---\n# 견적')
    hub.write('skills/sales/pitch/SKILL.md', '---\nname: pitch\ndescription: 영업 제안서\n---\n')
    hub.write('skills/RULES.md', '항상 존댓말로 답한다.')
    setRule(db, 'skills/sales', 'everyone', null, 'none')
    setRule(db, 'skills/sales', 'group', sales.id, 'read')
    hub.ctx.rulesChanged()
    const pp = loadPrincipal(db, park.id)!, cp = loadPrincipal(db, choi.id)!
    expect(skillsFor(hub.ctx.fx.root, hub.ctx.rules(), pp).map((s) => s.name).sort()).toEqual(['pitch', 'quote'])
    expect(skillsFor(hub.ctx.fx.root, hub.ctx.rules(), cp).map((s) => s.name)).toEqual(['quote'])
    expect(rulesFor(hub.ctx.fx.root, hub.ctx.rules(), cp)).toContain('존댓말')
    expect(readFrontMatter('---\ndescription: "a: b"\n---').description).toBe('a: b')
  })

  test('budget blocks after the limit', async () => {
    const u = await hub.user('jung')
    createBudget(db, { subjectType: 'user', subjectId: u.id, period: 'day', limitUsd: 1, limitTokens: null, action: 'block' })
    expect(budgetBlock(db, u.id)).toBeNull()
    db.query("INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cost_usd, status, started_at) VALUES ('u1', ?, 'pc', 'claude-sonnet-5-5', 10, 10, 1.5, 200, ?)").run(u.id, new Date().toISOString())
    expect(budgetBlock(db, u.id)?.message).toContain('한도')
  })
})
