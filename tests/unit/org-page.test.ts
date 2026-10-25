// /admin/claude (Claude 조직 설정): access, the guide for each plan, the generated JSON, live status.
import { afterAll, describe, expect, test } from 'bun:test'
import { testHub } from '../lib/hub'
import { getSetting } from '../../src/db'
import { issueToken } from '../../src/auth/tokens'
import { updateUser } from '../../src/auth/users'
import { listAudit } from '../../src/audit'
import { ENV_OWNED, installEnv } from '../../src/install/enroll'
import { setRule } from '../../src/policy/rules-admin'
import { activeOrgToken, verifyOrgToken } from '../../src/org/token'
import { CLAUDE_ORG_KEY, defaultConnectorName, getClaudeOrg, setClaudeOrg } from '../../src/org/claude-org'
import { coworkOtlp, managedSettings, managedSettingsJson, TOKEN_PLACEHOLDER } from '../../src/org/managed'
import { ingestOrgLogs } from '../../src/telemetry/routes'
import { setSetting } from '../../src/db'
import { get, post, follow } from './web-lib'

const hub = await testHub({ access: 'subscription', config: { publicUrl: 'https://acme.example' } })
afterAll(async () => { await hub.stop() })
const db = hub.ctx.db

const owner = hub.session(hub.owner.id)
const adminUser = await hub.user('boss', { role: 'admin' })
const adm = hub.session(adminUser.id)
const member = await hub.user('member1')
const mem = hub.session(member.id)

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const pre = (html: string, id: string) => {
  const m = new RegExp(`<pre class="cmd" id="${id}">([\\s\\S]*?)</pre>`).exec(html)
  return m ? unescape(m[1]!) : null
}
const page = async (s = owner) => { const r = await get(hub, '/admin/claude', s); return { status: r.status, text: await r.text() } }

describe('page without a public https address', () => {
  test('asks for one first and shows nothing else', async () => {
    const before = hub.ctx.config.publicUrl
    for (const bad of [null, 'http://acme.example', 'https://127.0.0.1:8443', 'https://localhost']) {
      hub.ctx.config.publicUrl = bad
      const { status, text } = await page()
      expect(status).toBe(200)
      expect(text).toContain('먼저 공개 주소(https)를 정해 주세요')
      expect(text).toContain('href="/admin/settings#urls"')
      for (const absent of ['Claude Team·Enterprise', '/mcp', 'Managed settings', 'OTLP', '조직 토큰', 'Upload a skill', '지금 상태']) expect(text).not.toContain(absent)
    }
    hub.ctx.config.publicUrl = before
  })

  test('actions that need the address are refused without it', async () => {
    const before = hub.ctx.config.publicUrl
    hub.ctx.config.publicUrl = null
    const r = await post(hub, '/admin/claude/token', owner)
    expect(r.status).toBe(303)
    expect(activeOrgToken(db)).toBeNull()
    expect((await follow(hub, r, owner)).text).toContain('공개 주소')
    hub.ctx.config.publicUrl = before
  })
})

describe('who may open it', () => {
  test('owner and admin yes; member 403 (page and every action); logged out goes to login', async () => {
    for (const s of [owner, adm]) {
      const { status, text } = await page(s)
      expect(status).toBe(200)
      expect(text).toContain('Claude 조직 설정')
      expect(text).toContain('어떤 Claude를 쓰나요?')
      // the nav carries it, next to 설정
      expect(text).toMatch(/>설정<\/a><a href="\/admin\/claude" class="[^"]*">Claude 조직 설정<\/a>/)
    }
    expect((await get(hub, '/admin/claude', mem)).status).toBe(403)
    for (const p of ['plan', 'name', 'token', 'token/revoke', 'pasted', 'unknown/clear']) {
      const r = await post(hub, `/admin/claude/${p}`, mem, { plan: 'team' })
      expect(`${p} ${r.status}`).toBe(`${p} 403`)
    }
    expect(activeOrgToken(db)).toBeNull()
    expect(getSetting<unknown>(db, CLAUDE_ORG_KEY, null)).toBeNull()
    const out = await get(hub, '/admin/claude')
    expect(out.status).toBe(302)
    expect(out.headers.get('location')).toStartWith('/login?next=')
  })

  test('actions need the CSRF token', async () => {
    const r = await post(hub, '/admin/claude/token', owner, {}, { csrf: 'wrong' })
    expect(r.status).toBe(403)
    expect(activeOrgToken(db)).toBeNull()
  })
})

describe('step 0: the plan', () => {
  test('nothing picked: only the picker', async () => {
    const { text } = await page()
    expect(text).toContain('Claude Team·Enterprise')
    expect(text).toContain('Pro·Max 개인 구독')
    expect(text).toContain('회사 API 키')
    expect(text).not.toContain('Sign in now')
    expect(text).not.toContain('지금 상태')
  })

  test('picking is saved in the setting the employee page reads: { plan, connectorName, managedSettingsAt }', async () => {
    setSetting(db, 'companyName', '에이크미')
    const r = await post(hub, '/admin/claude/plan', owner, { plan: 'team' })
    expect(r.status).toBe(303)
    expect(getSetting<unknown>(db, CLAUDE_ORG_KEY, null)).toEqual({ plan: 'team', connectorName: '에이크미 AI', managedSettingsAt: null })
    expect(getClaudeOrg(db)).toEqual({ plan: 'team', connectorName: '에이크미 AI', managedSettingsAt: null })
    await post(hub, '/admin/claude/plan', owner, { plan: 'individual' })
    expect(getClaudeOrg(db).plan).toBe('individual')
    await post(hub, '/admin/claude/plan', owner, { plan: 'company_key' })
    expect(getClaudeOrg(db)).toEqual({ plan: null, connectorName: '에이크미 AI', managedSettingsAt: null, companyKeyChosen: true })
    expect(getSetting<any>(db, CLAUDE_ORG_KEY, null).plan).toBeNull()
    await post(hub, '/admin/claude/plan', owner, { plan: 'bogus' })
    expect(getClaudeOrg(db).plan).toBeNull()
    expect(listAudit(db, 50).some((a) => a.action === 'claude_org.plan')).toBe(true)
  })

  test('Pro·Max: each employee adds the connector', async () => {
    await post(hub, '/admin/claude/plan', owner, { plan: 'individual' })
    const { text } = await page()
    expect(text).toContain('Customize › Connectors')
    expect(text).toContain('Add custom connector')
    expect(text).toContain('https://acme.example/mcp')
    expect(text).toContain('에이크미 AI')
    // no admin-console steps for this plan
    for (const absent of ['Managed settings', 'Upload a skill', 'OTLP endpoint', 'Organization settings › Connectors']) expect(text).not.toContain(absent)
    expect(text).toContain('그룹별 스킬은 Claude Code 설치 명령이나 Claude 앱 연결의 스킬 목록으로 나눠져요.')
  })

  test('company API key: the PC installer is the path', async () => {
    await post(hub, '/admin/claude/plan', owner, { plan: 'company_key' })
    const { text } = await page()
    expect(text).toContain('설치 명령')
    expect(text).toContain('href="/me"')
    expect(text).toContain('href="/admin/settings#key"')
    for (const absent of ['Managed settings', 'Sign in now', 'Upload a skill']) expect(text).not.toContain(absent)
    // the page remembers the pick
    expect(text).toMatch(/value="company_key" checked/)
  })
})

describe('Team: connector, managed settings, Cowork, skills', () => {
  test('step 1: the connector, with the exact menu names and the IP range', async () => {
    await post(hub, '/admin/claude/plan', owner, { plan: 'team' })
    const { text } = await page()
    for (const t of ['Organization settings › Connectors', 'Add', 'Custom', 'Sign in now', 'Register automatically', 'https://acme.example/mcp', '에이크미 AI', '160.79.104.0/21', '/.well-known/*', 'Customize › Connectors', 'Connect']) expect(text).toContain(t)
    expect(pre(text, 'connector-url')).toBe('https://acme.example/mcp')
    expect(pre(text, 'connector-name')).toBe('에이크미 AI')
  })

  test('the connector name can be changed; empty goes back to "<회사 이름> AI"', async () => {
    await post(hub, '/admin/claude/name', owner, { connectorName: '  에이크미 \n 도우미  ' })
    expect(getClaudeOrg(db).connectorName).toBe('에이크미 도우미')
    expect(pre((await page()).text, 'connector-name')).toBe('에이크미 도우미')
    await post(hub, '/admin/claude/name', owner, { connectorName: '' })
    expect(getClaudeOrg(db).connectorName).toBe(defaultConnectorName(db))
    expect(getClaudeOrg(db).plan).toBe('team')
  })

  test('step 2 before a token: the JSON shows a placeholder and cannot be copied', async () => {
    const { text } = await page()
    expect(text).toContain('Organization settings › Claude Code › Managed settings')
    expect(text).toContain('조직 토큰 만들기')
    expect(text).toContain('id="managed-json-preview"')
    expect(text).not.toContain('id="managed-json"')
    expect(pre(text, 'managed-json-preview')).toContain(TOKEN_PLACEHOLDER)
    expect(text).not.toContain('tax_org_')
  })

  let token = ''
  test('making the token shows the finished JSON once', async () => {
    const r = await post(hub, '/admin/claude/token', owner)
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/admin/claude#step2')
    const p = await follow(hub, r, owner)
    expect(p.status).toBe(200)
    const json = pre(p.text, 'managed-json')!
    expect(json).toBeTruthy()
    const cfg = JSON.parse(json)
    const header = cfg.env.OTEL_EXPORTER_OTLP_HEADERS as string
    expect(header).toStartWith('Authorization=Bearer tax_org_')
    token = header.replace('Authorization=Bearer ', '')
    expect(verifyOrgToken(db, token)).not.toBeNull()
    // the same token is in the marketplace header and in the Cowork header, and nowhere else on the page
    expect(cfg.extraKnownMarketplaces['trina-ax-org'].source.headers.Authorization).toBe(`Bearer ${token}`)
    expect(pre(p.text, 'cowork-headers')).toBe(`Authorization=Bearer ${token}`)
    expect(p.text.split(token).length - 1).toBe(3)
    expect(p.text).toContain('지금 한 번만 보여요')
    // the status changes
    expect(p.text).toContain('사용 중')
  })

  test('the JSON: telemetry env like the installer\'s, org marketplace and plugin, never a base URL or auth token', async () => {
    const cfg = managedSettings('https://acme.example', token)
    // matches the hub's real routes
    expect(cfg.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBe('https://acme.example/otel/v1/logs')
    expect(cfg.extraKnownMarketplaces['trina-ax-org']!.source.url).toBe('https://acme.example/plugins/marketplace.json')
    expect(cfg.enabledPlugins).toEqual({ 'company-all@trina-ax-org': true })
    expect(cfg.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1')
    expect(cfg.env.OTEL_LOGS_EXPORTER).toBe('otlp')
    expect(cfg.env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe('http/json')
    expect(cfg.env.OTEL_LOG_USER_PROMPTS).toBe('0')
    // consistent with the installer's env: same keys and values, plus the prompt switch
    const { OTEL_LOG_USER_PROMPTS: _p, ...rest } = cfg.env
    expect(rest).toEqual(installEnv('subscription', 'https://acme.example', token))
    for (const k of Object.keys(rest)) expect(ENV_OWNED).toContain(k)
    // never what would switch managed settings off
    const text = managedSettingsJson('https://acme.example', token)
    for (const bad of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_', 'apiKeyHelper', 'otelHeadersHelper']) expect(text).not.toContain(bad)
    expect(Object.keys(cfg).sort()).toEqual(['enabledPlugins', 'env', 'extraKnownMarketplaces'])
  })

  test('the endpoint and marketplace the JSON names are really served, and the token in it works only there', async () => {
    const u = new URL(managedSettings('https://acme.example', token).env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT!)
    const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    expect((await fetch(hub.url + u.pathname, { method: 'POST', headers: h, body: '{}' })).status).toBe(200)
    const m = await fetch(hub.url + new URL(managedSettings('https://acme.example', token).extraKnownMarketplaces['trina-ax-org']!.source.url).pathname, { headers: h })
    expect(m.status).toBe(200)
    expect(((await m.json()) as any).plugins[0].name).toBe('company-all')
    // and what the employees must not be able to do with it
    expect((await fetch(hub.url + '/v1/messages', { method: 'POST', headers: h, body: '{}' })).status).toBe(401)
    expect((await fetch(hub.url + '/mcp', { method: 'POST', headers: h, body: '{}' })).status).toBe(401)
  })

  test('reloading the page does not show the token again', async () => {
    const { text } = await page()
    expect(text).not.toContain(token)
    expect(text).not.toContain('id="managed-json"')
    expect(pre(text, 'managed-json-preview')).toContain(TOKEN_PLACEHOLDER)
    expect(text).toContain('새로 만들기')
    expect(text).toContain('이전 토큰은 바로 멈춰서')
  })

  test('step 2 explains the approval dialog, the versions and what the JSON does', async () => {
    const { text } = await page()
    for (const t of ['조직 설정 적용', '승인', '거절하면 Claude Code가 종료돼요', 'claude doctor', 'Managed settings (remote)', '프롬프트 내용은 보내지 않아요', 'ANTHROPIC_BASE_URL', '직원이 모두 볼 수 있어요']) expect(text).toContain(t)
    expect(text).toContain('그룹별 스킬은 Claude Code 설치 명령이나 Claude 앱 연결의 스킬 목록으로 나눠져요.')
  })

  test('"붙여 넣었어요" records the time; a new token clears it and stops the old one', async () => {
    expect(getClaudeOrg(db).managedSettingsAt).toBeNull()
    await post(hub, '/admin/claude/pasted', owner)
    const at = getClaudeOrg(db).managedSettingsAt!
    expect(Date.now() - Date.parse(at)).toBeLessThan(10_000)
    expect(getSetting<any>(db, CLAUDE_ORG_KEY, null)).toEqual({ plan: 'team', connectorName: defaultConnectorName(db), managedSettingsAt: at })
    expect((await page()).text).toContain('붙여 넣었다고 표시했어요')

    const r = await post(hub, '/admin/claude/token', adm)
    const fresh = await follow(hub, r, adm)
    const newToken = (JSON.parse(pre(fresh.text, 'managed-json')!).env.OTEL_EXPORTER_OTLP_HEADERS as string).replace('Authorization=Bearer ', '')
    expect(newToken).not.toBe(token)
    expect(fresh.text).toContain('이전 토큰은 바로 멈췄어요')
    expect(getClaudeOrg(db).managedSettingsAt).toBeNull()
    expect(verifyOrgToken(db, token)).toBeNull()
    expect(verifyOrgToken(db, newToken)).not.toBeNull()
    token = newToken
  })

  test('the token reaches no log: audit rows name the token by id only', () => {
    const rows = listAudit(db, 100).filter((a) => a.action.startsWith('org_token.'))
    expect(rows.map((a) => a.action).reverse()).toEqual(['org_token.create', 'org_token.rotate'])
    expect(JSON.stringify(listAudit(db, 200))).not.toContain('tax_org_')
  })

  test('"멈추기" stops it', async () => {
    const r = await post(hub, '/admin/claude/token/revoke', owner)
    expect(r.status).toBe(303)
    expect(activeOrgToken(db)).toBeNull()
    expect(verifyOrgToken(db, token)).toBeNull()
    expect(getClaudeOrg(db).managedSettingsAt).toBeNull()
    // "붙여 넣었어요" without a token does nothing
    await post(hub, '/admin/claude/pasted', owner)
    expect(getClaudeOrg(db).managedSettingsAt).toBeNull()
    expect(listAudit(db, 50).some((a) => a.action === 'org_token.revoke')).toBe(true)
  })

  test('step 3: Cowork fields', async () => {
    const { text } = await page()
    for (const t of ['Admin settings › Cowork', 'OTLP endpoint', 'OTLP protocol', 'OTLP headers', 'http/json', '1.1.4173']) expect(text).toContain(t)
    expect(pre(text, 'cowork-endpoint')).toBe('https://acme.example/otel')
    expect(pre(text, 'cowork-protocol')).toBe('http/json')
    expect(coworkOtlp('https://acme.example', 't').logsUrl).toBe('https://acme.example/otel/v1/logs')
  })
})

describe('step 4: org skills and the live status', () => {
  hub.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: "견적서 초안을 만든다"\n---\n# 견적\n')
  hub.write('skills/hr/review/SKILL.md', '---\nname: review\ndescription: 인사 평가\n---\n# r\n')
  setRule(db, 'skills/hr', 'everyone', null, 'none')
  setRule(db, 'skills/hr', 'role', 'admin', 'read')
  hub.ctx.rulesChanged()

  test('lists the skills every member may use, with a .zip link each; says they do not update by themselves', async () => {
    const { text } = await page()
    for (const t of ['Organization settings › Plugins &amp; skills', 'Upload a skill', 'Cloud code execution and file creation', 'quote', '/admin/claude/skill.zip?path=skills%2Fcompany%2Fquote']) expect(text).toContain(t)
    expect(text).not.toContain('인사 평가')
    expect(text).not.toContain('skills/hr/review')
    expect(text).toContain('저절로 바뀌지 않아요')
    expect(text).toContain('그룹별 스킬은 Claude Code 설치 명령이나 Claude 앱 연결의 스킬 목록으로 나눠져요.')
  })

  test('status: connectors connected N of M people, counting live connections only', async () => {
    const people = (db.query("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").get() as any).n
    expect((await page()).text).toContain(`<b>0</b> / ${people}명이 연결했어요`)
    const a = await hub.user('conn1'), b = await hub.user('conn2'), c = await hub.user('conn3')
    issueToken(db, a.id, 'connector', 'Claude 앱', { ttlMs: 3600_000 })
    // expired access token but a valid refresh token: still connected
    const old = issueToken(db, b.id, 'connector', 'Claude 앱', { ttlMs: 3600_000 })
    db.query("UPDATE tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(old.id)
    db.query("INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES ('cl', 'Claude', '[]', 'now')").run()
    db.query("INSERT INTO oauth_refresh (token_hash, client_id, user_id, created_at, expires_at) VALUES ('rh', 'cl', ?, 'now', ?)").run(b.id, new Date(Date.now() + 86_400_000).toISOString())
    // revoked: not connected; a device token is not a connector
    const gone = issueToken(db, c.id, 'connector', 'Claude 앱', { ttlMs: 3600_000 })
    db.query('UPDATE tokens SET revoked_at = ? WHERE id = ?').run('2026-01-01', gone.id)
    issueToken(db, c.id, 'device', 'PC')
    const now = people + 3
    expect((await page()).text).toContain(`<b>2</b> / ${now}명이 연결했어요`)
  })

  test('status: unknown emails with counts and what to do; people without an email', async () => {
    const t = (await post(hub, '/admin/claude/token', owner).then((r) => follow(hub, r, owner)))
    const tokenId = activeOrgToken(db)!.id
    const s = (key: string, v: string) => ({ key, value: { stringValue: v } })
    const body = { resourceLogs: [{ resource: { attributes: [s('session.id', 'x1')] }, scopeLogs: [{ logRecords: Array.from({ length: 12 }, (_, i) => ({
      timeUnixNano: String(Date.now() * 1e6), attributes: [s('event.name', 'api_request'), s('event.sequence', String(i)), s('model', 'claude-opus-5-5'), s('user.email', 'kim@acme.co')] })) }] }] }
    expect(ingestOrgLogs(hub.ctx, { tokenId }, body).unattributed).toBe(12)
    const { text } = await page()
    expect(text).toContain('허브에 없는 이메일')
    expect(text).toContain('kim@acme.co')
    expect(text).toContain('(12건)')
    expect(text).toContain('사람 목록에 이메일을 넣어 주세요')
    expect(text).toContain('마지막으로 받은 때')
    expect(t.status).toBe(200)
    // giving the person that email empties the list; "비우기" clears the rest
    const kim = await hub.user('kim')
    updateUser(db, kim.id, { email: 'Kim@Acme.co' })
    expect((await page()).text).not.toContain('kim@acme.co (12건)')
    ingestOrgLogs(hub.ctx, { tokenId }, { ...body, resourceLogs: [{ ...body.resourceLogs[0], scopeLogs: [{ logRecords: [{ attributes: [s('event.name', 'api_request'), s('model', 'claude-opus-5-5'), s('user.email', 'who@acme.co')] }] }] }] })
    expect((await page()).text).toContain('who@acme.co')
    await post(hub, '/admin/claude/unknown/clear', owner)
    expect((await page()).text).not.toContain('who@acme.co')
  })

  test('status: tells how many people have no email', async () => {
    const withoutEmail = (db.query("SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND (email IS NULL OR trim(email) = '')").get() as any).n
    expect(withoutEmail).toBeGreaterThan(0)
    expect((await page()).text).toContain(`${withoutEmail}명`)
  })
})

describe('the setting reader and writer', () => {
  test('whatever is stored comes out well-formed', () => {
    for (const [stored, plan] of [[null, null], ['x', null], [[], null], [{ plan: 'enterprise' }, null], [{ plan: 'team' }, 'team'], [{ plan: 'individual', managedSettingsAt: 'not a date' }, 'individual']] as const) {
      setSetting(db, CLAUDE_ORG_KEY, stored)
      const v = getClaudeOrg(db)
      expect(v.plan).toBe(plan)
      expect(typeof v.connectorName).toBe('string')
      expect(v.connectorName.length).toBeGreaterThan(0)
      expect(v.managedSettingsAt).toBeNull()
    }
  })

  test('setClaudeOrg changes some fields and keeps the rest', () => {
    setSetting(db, CLAUDE_ORG_KEY, null)
    setClaudeOrg(db, { plan: 'team' })
    setClaudeOrg(db, { managedSettingsAt: '2026-10-25T01:00:00.000Z' })
    setClaudeOrg(db, { connectorName: 'My AI\n‮' })
    expect(getClaudeOrg(db)).toEqual({ plan: 'team', connectorName: 'My AI', managedSettingsAt: '2026-10-25T01:00:00.000Z' })
  })
})
