// Web pages: folder rules, budgets, usage + CSV, skills, settings (API key write-only, connection check).
import { describe, expect, test, afterAll } from 'bun:test'
import { testHub, type TestHub } from '../lib/hub'
import { loadPrincipal } from '../../src/policy/access'
import { listRules } from '../../src/policy/rules-admin'
import { getUserByUsername, listGroups } from '../../src/auth/users'
import { listBudgets } from '../../src/usage/budgets'
import { getSetting } from '../../src/db'
import { listAudit } from '../../src/audit'
import { effectiveUrls } from '../../src/web/settings'
import { parseRange } from '../../src/web/admin/usage'
import { get, post, follow } from './web-lib'

const GOOD_KEY = 'sk-ant-api03-good-key-for-tests-0000-WXYZ'
let seenKeys: string[] = []
const upstream = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  fetch(req) {
    const key = req.headers.get('x-api-key') ?? ''
    seenKeys.push(key)
    if (new URL(req.url).pathname !== '/v1/models') return new Response('no', { status: 404 })
    if (key === GOOD_KEY) return Response.json({ data: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }], has_more: false })
    return Response.json({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key: ${key}` } }, { status: 401 })
  },
})

let hub: TestHub
afterAll(async () => { await hub?.stop(); upstream.stop(true) })

describe('web: folder permissions', async () => {
  hub = await testHub({ upstream: `http://127.0.0.1:${upstream.port}`, apiKey: null })
  const db = hub.ctx.db
  const hr = hub.group('인사팀')
  const kim = await hub.user('kim')
  const lee = await hub.user('lee', { groups: [hr.id] })
  const owner = hub.session(hub.owner.id)
  hub.write('shared/인사/급여.xlsx', 'x')
  hub.write('shared/영업/a.txt', 'x')
  hub.write('.hidden/secret.txt', 'x')
  const access = (userId: string, p: string) => hub.ctx.rules().access(loadPrincipal(db, userId)!, p.split('/'))

  test('the page shows the top two levels from disk, without hidden folders', async () => {
    const body = await (await get(hub, '/admin/folders', owner)).text()
    expect(body).toContain('📁 shared')
    expect(body).toContain('인사')
    expect(body).toContain('영업')
    expect(body).toContain('개인 폴더')
    expect(body).not.toContain('.hidden')
    expect(body).not.toContain('.trina')
    expect(body).toContain('모두 · 읽기·쓰기') // initTeamFolder's shared rule
  })

  test('adding and removing rules changes what people can do', async () => {
    expect(access(kim.id, 'shared/인사')).toBe('write')
    let r = await post(hub, '/admin/folders/rules', owner, { path: 'shared/인사', subject: 'everyone', access: 'none' })
    expect((await follow(hub, r, owner)).text).toContain('볼 수 없음')
    r = await post(hub, '/admin/folders/rules', owner, { path: '/shared/인사/', subject: `group:${hr.id}`, access: 'read' })
    expect(r.status).toBe(303)
    expect(access(kim.id, 'shared/인사')).toBe('none')
    expect(access(lee.id, 'shared/인사')).toBe('read')
    expect(access(lee.id, 'shared/영업')).toBe('write')
    const page = await (await get(hub, '/admin/folders', owner)).text()
    expect(page).toContain('그룹 · 인사팀')
    // the access check form
    const check = await (await get(hub, `/admin/folders?who=${lee.id}&path=${encodeURIComponent('shared/인사/2026')}`, owner)).text()
    expect(check).toContain('lee</b>님은')
    expect(check).toContain('>읽기</span> 권한이에요')

    r = await post(hub, '/admin/folders/rules/delete', owner, { path: 'shared/인사', subjectType: 'everyone', subjectId: '' })
    expect((await follow(hub, r, owner)).text).toContain('규칙을 지웠어요')
    expect(access(kim.id, 'shared/인사')).toBe('write')
    await post(hub, '/admin/folders/rules/delete', owner, { path: 'shared/인사', subjectType: 'group', subjectId: hr.id })
    expect(listRules(db).filter((x) => x.path === 'shared/인사')).toEqual([])
    const acts = listAudit(db).map((a) => a.action)
    expect(acts).toContain('rule.set')
    expect(acts).toContain('rule.remove')
  })

  test('folder names typed with another case or a missing folder', async () => {
    if (hub.ctx.fx.caseInsensitive) {
      hub.write('Projects/x.txt', 'x')
      await post(hub, '/admin/folders/rules', owner, { path: 'projects', subject: 'everyone', access: 'read' })
      expect(listRules(db).some((x) => x.path === 'Projects')).toBe(true)
    }
    const r = await post(hub, '/admin/folders/rules', owner, { path: 'shared/새폴더', subject: 'everyone', access: 'read' })
    expect((await follow(hub, r, owner)).text).toContain('아직 없어요')
    expect(listRules(db).some((x) => x.path === 'shared/새폴더')).toBe(true)
  })

  test('bad paths and personal folders are refused with a message', async () => {
    for (const [p, msg] of [['../etc', '경로가 올바르지 않아요'], ['users/abc', '개인 폴더'], ['.trina', '경로가 올바르지 않아요']] as const) {
      const r = await post(hub, '/admin/folders/rules', owner, { path: p, subject: 'everyone', access: 'write' })
      expect(r.status).toBe(303)
      expect((await follow(hub, r, owner)).text).toContain(msg)
    }
    expect(listRules(db).some((x) => x.path.startsWith('users') || x.path.includes('..') || x.path.startsWith('.trina'))).toBe(false)
  })
})

describe('web: budgets', () => {
  test('add (team / group / person, day / month, USD and tokens), validate, delete', async () => {
    const db = hub.ctx.db
    const owner = hub.session(hub.owner.id)
    const kim = getUserByUsername(db, 'kim')!
    let r = await post(hub, '/admin/budgets', owner, { subject: 'team', period: 'month', usd: '50', tokens: '', action: 'block' })
    expect((await follow(hub, r, owner)).text).toContain('예산을 만들었어요')
    await post(hub, '/admin/budgets', owner, { subject: `user:${kim.id}`, period: 'day', usd: '', tokens: '1,000,000', action: 'warn' })
    const bs = listBudgets(db)
    expect(bs.map((b) => [b.subjectType, b.period, b.limitUsd, b.limitTokens, b.action])).toEqual(expect.arrayContaining([
      ['team', 'month', 50, null, 'block'], ['user', 'day', 0, 1_000_000, 'warn'],
    ]))
    db.query("INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cost_usd, status, started_at) VALUES ('b1', ?, 'pc', 'claude-sonnet-5-5', 900000, 0, 45, 200, ?)").run(kim.id, new Date().toISOString())
    const page = await (await get(hub, '/admin/budgets', owner)).text()
    expect(page).toContain('$45.0 / $50.0')
    expect(page).toContain('80% 넘음')
    expect(page).toContain('알림만')

    r = await post(hub, '/admin/budgets', owner, { subject: 'team', period: 'month', usd: '', tokens: '', action: 'block' })
    expect((await follow(hub, r, owner)).text).toContain('하나는 정해 주세요')
    r = await post(hub, '/admin/budgets', owner, { subject: 'team', period: 'month', usd: '-3', action: 'block' })
    expect((await follow(hub, r, owner)).text).toContain('0 이상의 숫자')
    expect(listBudgets(db).length).toBe(2)

    const dash = await (await get(hub, '/admin', owner)).text()
    expect(dash).toContain('한도에 가까운 예산')

    const team = listBudgets(db).find((b) => b.subjectType === 'team')!
    await post(hub, `/admin/budgets/${team.id}/delete`, owner)
    expect(listBudgets(db).some((b) => b.id === team.id)).toBe(false)
    expect(listAudit(db).map((a) => a.action)).toEqual(expect.arrayContaining(['budget.create', 'budget.delete']))
  })
})

describe('web: usage', () => {
  test('range presets, group by, skills/tools tables, CSV export', async () => {
    const db = hub.ctx.db
    const owner = hub.session(hub.owner.id)
    const lee = getUserByUsername(db, 'lee')!
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12).toISOString()
    const ins = db.query('INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, status, started_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    ins.run('u1', lee.id, 'pc', 'claude-opus-5-5', 1200, 300, 5000, 0, 2.5, 200, now.toISOString())
    ins.run('u2', lee.id, 'hub', 'claude-haiku-5-5', 100, 50, 0, 0, 0.01, 200, now.toISOString())
    ins.run('u3', lee.id, 'pc', 'claude-sonnet-5-5', 10, 10, 0, 0, 7.75, 200, lastMonth)
    db.query("INSERT INTO skill_events (user_id, skill, source, at) VALUES (?, 'company:quote', 'relay', ?)").run(lee.id, now.toISOString())
    db.query("INSERT INTO tool_events (user_id, tool, summary, ok, at) VALUES (?, 'read_file', 'shared/a.txt', 1, ?)").run(lee.id, now.toISOString())

    let body = await (await get(hub, '/admin/usage', owner)).text()
    expect(body).toContain('lee')
    expect(body).toContain('company:quote')
    expect(body).toContain('read_file')
    expect(body).toContain('$47.5') // 45 (budgets test) + 2.5 + 0.01, this month
    body = await (await get(hub, '/admin/usage?range=month&by=model', owner)).text()
    expect(body).toContain('claude-opus-5-5')
    expect(body).toContain('claude-haiku-5-5')
    body = await (await get(hub, '/admin/usage?range=last&by=source', owner)).text()
    expect(body).toContain('$7.75')
    expect(body).not.toContain('claude-opus-5-5')
    body = await (await get(hub, '/admin/usage?range=month&by=day', owner)).text()
    expect(body).toMatch(/\d+월 \d+일 \(.\)/)
    for (const by of ['user', 'day', 'model', 'group', 'source']) for (const range of ['month', 'last', '7d', 'custom&from=2026-01-01&to=2026-12-31', 'custom&from=bad']) {
      expect((await get(hub, `/admin/usage?range=${range}&by=${by}`, owner)).status).toBe(200)
    }

    const csv = await get(hub, '/admin/usage.csv?range=month', owner)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(csv.headers.get('content-disposition')).toMatch(/attachment; filename="trina-usage-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/)
    const lines = (await csv.text()).trim().split('\n')
    expect(lines[0]).toBe('started_at,username,source,model,input_tokens,output_tokens,cache_read,cache_write,cost_usd,status')
    expect(lines.length).toBe(1 + 3) // b1 (budgets test), u1, u2
    expect(lines.some((l) => l.includes('claude-opus-5-5') && l.includes(',lee,'))).toBe(true)
    const last = (await (await get(hub, '/admin/usage.csv?range=last', owner)).text()).trim().split('\n')
    expect(last.length).toBe(2)
    expect(listAudit(db).some((a) => a.action === 'usage.export')).toBe(true)
  })

  test('parseRange presets', () => {
    const now = new Date(2026, 9, 25, 14, 0)
    const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const show = (q: Record<string, string>) => { const r = parseRange(q, now); return [r.key, ymd(r.from), ymd(r.to)] }
    expect(show({})).toEqual(['month', '2026-10-1', '2026-11-1'])
    expect(show({ range: 'last' })).toEqual(['last', '2026-9-1', '2026-10-1'])
    expect(show({ range: '7d' })).toEqual(['7d', '2026-10-19', '2026-10-26'])
    expect(show({ range: 'custom', from: '2026-10-03', to: '2026-10-05' })).toEqual(['custom', '2026-10-3', '2026-10-6'])
    expect(show({ range: 'custom', from: '2026-10-05', to: '2026-10-03' })[0]).toBe('month')
    expect(show({ range: 'custom', from: '2026-02-30', to: '2026-03-01' })[0]).toBe('month')
  })
})

describe('web: skills', () => {
  test('packs, who can use them, RULES.md preview', async () => {
    const db = hub.ctx.db
    const owner = hub.session(hub.owner.id)
    hub.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: 견적서 초안을 만든다\n---\n')
    hub.write('skills/인사/payroll/SKILL.md', '---\nname: payroll\ndescription: 급여 명세 정리\n---\n')
    hub.write('skills/RULES.md', '항상 존댓말로 답한다.\n<script>alert(1)</script>')
    const hr = listGroups(db).find((g) => g.name === '인사팀')!
    await post(hub, '/admin/folders/rules', owner, { path: 'skills/인사', subject: 'everyone', access: 'none' })
    await post(hub, '/admin/folders/rules', owner, { path: 'skills/인사', subject: `group:${hr.id}`, access: 'read' })
    const body = await (await get(hub, '/admin/skills', owner)).text()
    expect(body).toContain('견적서 초안을 만든다')
    expect(body).toContain('급여 명세 정리')
    expect(body).toContain('모든 사람')
    expect(body).toMatch(/쓸 수 있는 사람: [^<]*lee/)
    expect(body).not.toMatch(/쓸 수 있는 사람: [^<]*kim/)
    expect(body).toContain('항상 존댓말로 답한다.')
    expect(body).not.toContain('<script>alert(1)</script>')
    expect(body).toContain('1회') // company:quote from the usage test
  })
})

describe('web: settings', () => {
  test('company name and concurrency (admins too)', async () => {
    const adm = hub.session((await hub.user('admin1', { role: 'admin' })).id)
    const r = await post(hub, '/admin/settings/general', adm, { companyName: '트리나여행사', hubConcurrency: '3' })
    expect((await follow(hub, r, adm)).text).toContain('저장했어요')
    expect(getSetting(hub.ctx.db, 'companyName', '')).toBe('트리나여행사')
    expect(hub.ctx.config.hubConcurrency).toBe(3)
    expect(await (await get(hub, '/login')).text()).toContain('트리나여행사')
    const bad = await post(hub, '/admin/settings/general', adm, { companyName: '', hubConcurrency: '99' })
    expect((await follow(hub, bad, adm)).text).toContain('회사 이름')
  })

  test('addresses: owner only, https for the public one', async () => {
    const owner = hub.session(hub.owner.id)
    const adm = hub.session(getUserByUsername(hub.ctx.db, 'admin1')!.id)
    expect((await post(hub, '/admin/settings/urls', adm, { publicUrl: 'https://evil.example.com', lanUrl: '' })).status).toBe(403)
    let r = await post(hub, '/admin/settings/urls', owner, { publicUrl: 'http://acme.example.com', lanUrl: '' })
    expect((await follow(hub, r, owner)).text).toContain('https://')
    r = await post(hub, '/admin/settings/urls', owner, { publicUrl: 'https://acme.example.com/path', lanUrl: '' })
    expect((await follow(hub, r, owner)).text).toContain('경로 없이')
    expect(effectiveUrls(hub.ctx).publicUrl).toBeNull()
    r = await post(hub, '/admin/settings/urls', owner, { publicUrl: 'https://Acme.Example.com/', lanUrl: 'http://192.168.0.10:47900' })
    expect((await follow(hub, r, owner)).text).toContain('https://acme.example.com')
    expect(effectiveUrls(hub.ctx)).toMatchObject({ publicUrl: 'https://acme.example.com', lanUrl: 'http://192.168.0.10:47900', kind: 'public' })
    expect(hub.ctx.config.publicUrl).toBe('https://acme.example.com')
    await post(hub, '/admin/settings/urls', owner, { publicUrl: '', lanUrl: '' })
    expect(effectiveUrls(hub.ctx).kind).toBe('local')
  })

  test('API key: owner only, write-only (hint, never the key), connection check, remove', async () => {
    const owner = hub.session(hub.owner.id)
    const adm = hub.session(getUserByUsername(hub.ctx.db, 'admin1')!.id)
    let body = await (await get(hub, '/admin/settings', owner)).text()
    expect(body).toContain('없음')
    expect(body).not.toContain('연결 확인')

    expect((await post(hub, '/admin/settings/key', adm, { apiKey: GOOD_KEY })).status).toBe(403)
    expect(hub.ctx.secrets.getApiKey()).toBeNull()
    let r = await post(hub, '/admin/settings/key', owner, { apiKey: 'has spaces in it' })
    expect((await follow(hub, r, owner)).text).toContain('키 모양이 이상해요')

    r = await post(hub, '/admin/settings/key', owner, { apiKey: GOOD_KEY })
    body = (await follow(hub, r, owner)).text
    expect(body).toContain('저장했어요')
    expect(hub.ctx.secrets.getApiKey()).toBe(GOOD_KEY)
    body = await (await get(hub, '/admin/settings', owner)).text()
    expect(body).toContain('…WXYZ')
    expect(body).toContain('설정됨')
    expect(body).not.toContain(GOOD_KEY)
    expect(body).not.toContain(GOOD_KEY.slice(0, 20))

    seenKeys = []
    r = await post(hub, '/admin/settings/key/check', adm) // admins may check
    body = (await follow(hub, r, adm)).text
    expect(body).toContain('연결됐어요')
    expect(body).toContain('모델 2개')
    expect(seenKeys).toEqual([GOOD_KEY])

    const wrong = 'sk-ant-api03-wrong-key-should-not-show-ABCD'
    hub.ctx.secrets.setApiKey(wrong)
    r = await post(hub, '/admin/settings/key/check', owner)
    body = (await follow(hub, r, owner)).text
    expect(body).toContain('키가 맞지 않아요')
    expect(body).toContain('401')
    expect(body).not.toContain(wrong)
    expect(JSON.stringify(listAudit(hub.ctx.db))).not.toContain('sk-ant-')

    expect((await post(hub, '/admin/settings/key/remove', adm)).status).toBe(403)
    r = await post(hub, '/admin/settings/key/remove', owner)
    expect((await follow(hub, r, owner)).text).toContain('API 키를 지웠어요')
    expect(hub.ctx.secrets.getApiKey()).toBeNull()
    expect(listAudit(hub.ctx.db).map((a) => a.action)).toEqual(expect.arrayContaining(['apikey.set', 'apikey.check', 'apikey.remove', 'settings.urls', 'settings.update']))
  })

  test('connection check when the upstream cannot be reached', async () => {
    const h = await testHub({ upstream: 'http://127.0.0.1:9' })
    try {
      const s = h.session(h.owner.id)
      const r = await post(h, '/admin/settings/key/check', s)
      expect((await follow(h, r, s)).text).toContain('연결하지 못했어요')
    } finally { await h.stop() }
  })
})
