import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { makeEnrollCode } from '../../src/auth/enroll'
import { verifyToken } from '../../src/auth/tokens'
import { updateUser } from '../../src/auth/users'
import { setDefaultModelAccess, setUserModelAccess } from '../../src/auth/access-mode'
import { listAudit } from '../../src/audit'
import { setSetting } from '../../src/db'
import { bakeableUrl, installCommands, renderScript } from '../../src/install/scripts'
import { redeemEnrollCode } from '../../src/auth/enroll'
import { ENV_OWNED, LOGIN_HINT, NO_API_KEY_NOTICE, checkEnrollCode, cleanDeviceName, installEnv, normalizeCode } from '../../src/install/enroll'
import { FailureLimiter } from '../../src/install/limits'
import { findPwsh } from './install-lib'

let hub: TestHub
afterAll(async () => { await hub?.stop() })

describe('enrollment API', async () => {
  hub = await testHub()
  const db = hub.ctx.db
  const kim = await hub.user('kim')

  const enroll = (body: unknown, ip = '203.0.113.1') =>
    fetch(hub.url + '/api/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const code = (userId = kim.id) => makeEnrollCode(db, userId, hub.owner.id).code

  test('a code becomes a device token and the URLs the installer writes', async () => {
    setSetting(db, 'companyName', '에이크미')
    const r = await enroll({ code: code(), deviceName: '김철수의 MacBook‮ Pro\n', os: 'macos' })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(r.headers.get('cache-control')).toBe('no-store')
    const j = await r.json() as any
    expect(j).toEqual({
      token: expect.stringMatching(/^tax_/),
      hubUrl: hub.url,
      mcpUrl: `${hub.url}/mcp`,
      mcpName: 'trina',
      marketplaceUrl: `${hub.url}/plugins/marketplace.json`,
      marketplaceName: 'trina-ax',
      plugin: 'company@trina-ax',
      user: { name: 'kim' },
      companyName: '에이크미',
      skillsReady: false,
      notices: [expect.stringContaining('공개 주소')],
      mode: 'company_key',
      env: { ANTHROPIC_BASE_URL: hub.url, ANTHROPIC_AUTH_TOKEN: j.token },
      envOwned: [
        'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_ENABLE_TELEMETRY', 'OTEL_LOGS_EXPORTER',
        'OTEL_METRICS_EXPORTER', 'OTEL_EXPORTER_OTLP_PROTOCOL', 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS',
      ],
      loginHint: null,
      modelNotice: null, // the test hub has a company API key
    })
    const auth = verifyToken(db, j.token)!
    expect(auth.user.id).toBe(kim.id)
    expect(auth.token.kind).toBe('device')
    expect(auth.token.name).toBe('김철수의 MacBook Pro')
    const a = listAudit(db).find((e) => e.action === 'device.enroll')!
    expect(a.actor).toBe(kim.id)
    expect(a.detail).toContain('203.0.113.1')
    expect(JSON.parse(a.detail as string).mode).toBe('company_key')
    expect(a.detail).not.toContain(j.token)
  })

  test('a person on their own subscription gets telemetry to the hub and no ANTHROPIC_* variables', async () => {
    const lee = await hub.user('lee-sub')
    setUserModelAccess(db, lee.id, 'subscription')
    const r = await enroll({ code: code(lee.id), os: 'macos' }, '203.0.113.20')
    expect(r.status).toBe(200)
    const j = await r.json() as any
    expect(j.mode).toBe('subscription')
    expect(j.env).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${hub.url}/otel/v1/logs`,
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${j.token}`,
    })
    expect(j.loginHint).toBe('터미널에서 claude 를 실행하면 브라우저에서 Claude 로그인이 열려요. 회사 Claude 계정으로 로그인해 주세요.')
    expect(j.loginHint).toBe(LOGIN_HINT)
    expect(j.modelNotice).toBeNull() // a subscription person needs no company key
    expect(verifyToken(db, j.token)?.user.id).toBe(lee.id)
    const a = listAudit(db).filter((e) => e.action === 'device.enroll').find((e) => e.actor === lee.id)!
    expect(JSON.parse(a.detail as string).mode).toBe('subscription')
    expect(a.detail).not.toContain(j.token)
  })

  test('the company default decides when the person has no setting of their own', async () => {
    const own = await hub.user('own-key')
    const follow = await hub.user('follow-default')
    setUserModelAccess(db, own.id, 'company_key')
    setDefaultModelAccess(db, 'subscription')
    try {
      const a = await (await enroll({ code: code(follow.id) }, '203.0.113.21')).json() as any
      const b = await (await enroll({ code: code(own.id) }, '203.0.113.21')).json() as any
      expect([a.mode, b.mode]).toEqual(['subscription', 'company_key'])
      expect(Object.keys(a.env)).not.toContain('ANTHROPIC_BASE_URL')
      expect(Object.keys(b.env)).toEqual(['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'])
      expect(a.loginHint).toBeString()
      expect(b.loginHint).toBeNull()
    } finally { setDefaultModelAccess(db, 'company_key') }
    // and back: the same person now follows the company_key default
    const c = await (await enroll({ code: code(follow.id) }, '203.0.113.21')).json() as any
    expect(c.mode).toBe('company_key')
  })

  test('envOwned is every key either mode sets, so switching modes can clean up', async () => {
    const lee = await hub.user('owned')
    const modes = ['subscription', 'company_key'] as const
    const union = new Set<string>()
    for (const m of modes) {
      setUserModelAccess(db, lee.id, m)
      const j = await (await enroll({ code: code(lee.id) }, '203.0.113.22')).json() as any
      expect(j.mode).toBe(m)
      for (const k of Object.keys(j.env)) { expect(j.envOwned).toContain(k); union.add(k) }
      expect(Object.keys(j.env)).toEqual(Object.keys(installEnv(m, j.hubUrl, j.token)))
    }
    expect([...union].sort()).toEqual([...ENV_OWNED].sort())
    expect(new Set(ENV_OWNED).size).toBe(ENV_OWNED.length)
  })

  test('codes are forgiving about case, spaces and dashes', async () => {
    const c = code().toLowerCase().replace(/-/g, ' ')
    expect((await enroll({ code: c, os: 'windows' })).status).toBe(200)
  })

  test('a code works once', async () => {
    const c = code()
    expect((await enroll({ code: c })).status).toBe(200)
    const again = await enroll({ code: c })
    expect(again.status).toBe(400)
    const j = await again.json() as any
    expect(j.error.code).toBe('invalid_code')
    expect(j.error.message).toContain('새 코드')
  })

  test('unknown codes, disabled accounts and bad bodies are refused', async () => {
    expect((await enroll({ code: 'AAAA-BBBB-CCCC' }, '203.0.113.2')).status).toBe(400)
    expect((await enroll({ code: 'short' }, '203.0.113.2')).status).toBe(400)
    const off = await hub.user('off')
    const c = code(off.id)
    updateUser(db, off.id, { status: 'disabled' })
    expect((await enroll({ code: c }, '203.0.113.2')).status).toBe(400)
    const bad = await enroll('{not json', '203.0.113.2')
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as any).error.code).toBe('validation')
    expect((await enroll({ code: 'x'.repeat(5000) }, '203.0.113.2')).status).toBe(400)
  })

  test('10 failed attempts per address per hour, then even a good code waits', async () => {
    const ip = '198.51.100.7'
    for (let i = 0; i < 10; i++) expect((await enroll({ code: `ZZ${i}Z-ZZZZ-ZZZZ` }, ip)).status).toBe(400)
    const r = await enroll({ code: code() }, ip)
    expect(r.status).toBe(429)
    expect(((await r.json()) as any).error.message).toContain('한 시간')
    // another address is not affected
    expect((await enroll({ code: code() }, '198.51.100.8')).status).toBe(200)
  })

  test('5 failed attempts per code prefix, from any address', async () => {
    for (let i = 0; i < 5; i++) expect((await enroll({ code: `QQQQ-ZZZZ-ZZZ${i}` }, `192.0.2.${i + 1}`)).status).toBe(400)
    const r = await enroll({ code: 'QQQQ-ZZZZ-ZZZ9' }, '192.0.2.99')
    expect(r.status).toBe(429)
    expect(((await r.json()) as any).error.code).toBe('rate_limited')
  })

  test('successful enrollments do not count (a whole office shares one address)', async () => {
    for (let i = 0; i < 12; i++) expect((await enroll({ code: code() }, '100.64.0.1')).status).toBe(200)
  })

  test('/api/unenroll revokes the calling device token only', async () => {
    const j = await (await enroll({ code: code() }, '100.64.0.2')).json() as any
    const other = await (await enroll({ code: code() }, '100.64.0.2')).json() as any
    const r = await fetch(hub.url + '/api/unenroll', { method: 'POST', headers: { authorization: `Bearer ${j.token}` } })
    expect(r.status).toBe(200)
    expect(verifyToken(db, j.token)).toBeNull()
    expect(verifyToken(db, other.token)).not.toBeNull()
    expect((await fetch(hub.url + '/api/unenroll', { method: 'POST', headers: { authorization: `Bearer ${j.token}` } })).status).toBe(401)
    const hubToken = hub.token(kim.id, 'hub')
    expect((await fetch(hub.url + '/api/unenroll', { method: 'POST', headers: { authorization: `Bearer ${hubToken}` } })).status).toBe(400)
  })

  test('skillsReady follows the public URL', async () => {
    hub.ctx.config.publicUrl = 'https://acme.trina.app'
    try {
      const j = await (await enroll({ code: code() }, '100.64.0.3')).json() as any
      expect(j.skillsReady).toBe(true)
      expect(j.notices).toEqual([])
      expect(j.hubUrl).toBe('https://acme.trina.app')
      expect(j.env.ANTHROPIC_BASE_URL).toBe('https://acme.trina.app')
      expect(j.marketplaceUrl).toBe('https://acme.trina.app/plugins/marketplace.json')
      expect(j.mcpUrl).toBe('https://acme.trina.app/mcp')
    } finally { hub.ctx.config.publicUrl = null }
  })

  test('a company-key person is told when the hub has no company API key (the PC is connected, Claude cannot answer yet)', async () => {
    const lee = await hub.user('no-key')
    setUserModelAccess(db, lee.id, 'company_key')
    hub.ctx.secrets.setApiKey(null)
    try {
      const j = await (await enroll({ code: code(lee.id) }, '203.0.113.30')).json() as any
      expect(j.mode).toBe('company_key')
      expect(j.modelNotice).toBe(NO_API_KEY_NOTICE)
      expect(j.modelNotice).toBe('연결은 됐지만 회사 API 키가 아직 없어서 Claude가 답하지 못해요. 관리자에게 알려 주세요.')
      expect(verifyToken(db, j.token)?.user.id).toBe(lee.id) // the connection itself is valid
      expect(Object.keys(j.env)).toEqual(['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'])
      // a subscription person needs no key: nothing to warn about
      setUserModelAccess(db, lee.id, 'subscription')
      expect(((await (await enroll({ code: code(lee.id) }, '203.0.113.30')).json()) as any).modelNotice).toBeNull()
      // and once the admin has put the key in, the next person hears nothing
      setUserModelAccess(db, lee.id, 'company_key')
      hub.ctx.secrets.setApiKey('sk-ant-test-key')
      expect(((await (await enroll({ code: code(lee.id) }, '203.0.113.30')).json()) as any).modelNotice).toBeNull()
    } finally { hub.ctx.secrets.setApiKey('sk-ant-test-key') }
  })
})

describe('enrollment check (does the code still work?)', async () => {
  const db = hub.ctx.db
  const kim = await hub.user('kim-check')
  const post = (path: string, body: unknown, ip = '203.0.113.50') =>
    fetch(hub.url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const check = (body: unknown, ip?: string) => post('/api/enroll/check', body, ip)
  const exchange = (body: unknown, ip?: string) => post('/api/enroll', body, ip)
  const code = (userId = kim.id) => makeEnrollCode(db, userId, hub.owner.id).code
  const tokenCount = () => (db.query('SELECT COUNT(*) AS n FROM tokens').get() as { n: number }).n
  const expire = (userId: string) => db.query("UPDATE enroll_codes SET expires_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ? AND used_at IS NULL").run(userId)

  test('a good code is answered ok and is not used up', async () => {
    const c = code()
    const tokens = tokenCount()
    const audits = listAudit(db).filter((e) => e.action === 'device.enroll').length
    for (let i = 0; i < 3; i++) {
      const r = await check({ code: c })
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8')
      expect(r.headers.get('cache-control')).toBe('no-store')
      // nothing but "ok": no name, mode, expiry or address
      expect(await r.json()).toEqual({ ok: true })
    }
    expect(tokenCount()).toBe(tokens) // no device token was made
    expect(listAudit(db).filter((e) => e.action === 'device.enroll')).toHaveLength(audits)
    expect((await exchange({ code: c })).status).toBe(200) // and the code still works once
    expect((await check({ code: c })).status).toBe(400) // now it is used
  })

  test('the check is as forgiving about case, spaces and dashes as the exchange', async () => {
    const c = code()
    expect((await check({ code: c.toLowerCase().replace(/-/g, ' ') })).status).toBe(200)
  })

  test('unknown, used, expired and disabled codes, and bad bodies, are refused exactly as the exchange refuses them', async () => {
    const used = code()
    expect((await exchange({ code: used })).status).toBe(200)
    const late = await hub.user('late')
    const lateCode = code(late.id)
    expire(late.id)
    const off = await hub.user('off-check')
    const offCode = code(off.id)
    updateUser(db, off.id, { status: 'disabled' })
    const cases: unknown[] = [{ code: 'GGGG-HHHH-JJJJ' }, { code: used }, { code: lateCode }, { code: offCode }, { code: 'short' }, { code: 'x'.repeat(5000) }, {}, '{not json', '']
    for (const body of cases) {
      const a = await check(body, '203.0.113.51')
      const b = await exchange(body, '203.0.113.52') // a different address: each has its own budget
      expect(a.status, JSON.stringify(body).slice(0, 40)).toBe(400)
      expect(a.status).toBe(b.status)
      expect(await a.json()).toEqual(await b.json()) // same words as the exchange: nothing more than redeeming would say
    }
    const generic = await (await check({ code: 'GGGG-HHHH-JJJJ' }, '203.0.113.53')).json() as any
    expect(generic.error).toEqual({ code: 'invalid_code', message: '연결 코드가 맞지 않거나, 이미 썼거나, 만료됐어요. 새 코드를 받아 주세요.' })
  })

  test('it says ok exactly when the exchange would work (same rules, kept in step)', async () => {
    const late = await hub.user('parity-late')
    const off = await hub.user('parity-off')
    const make: Record<string, () => string> = {
      ok: () => code(),
      used: () => { const c = code(); expect(redeemEnrollCode(db, c, 'x')).not.toBeNull(); return c },
      expired: () => { const c = code(late.id); expire(late.id); return c },
      unknown: () => 'ABCD-EFGH-JKLM',
      disabled: () => { const c = code(off.id); updateUser(db, off.id, { status: 'disabled' }); return c },
    }
    const verdicts: Record<string, string> = {}
    for (const [name, mk] of Object.entries(make)) {
      const c = mk()
      const verdict = checkEnrollCode(db, c)
      verdicts[name] = verdict
      expect(checkEnrollCode(db, c), name).toBe(verdict) // asking again does not change anything
      expect(verdict === 'ok', name).toBe(redeemEnrollCode(db, c, 'x') !== null) // and the exchange agrees
    }
    // the reason is for the hub's log; the API answers every refusal alike
    expect(verdicts).toEqual({ ok: 'ok', used: 'used', expired: 'expired', unknown: 'unknown', disabled: 'unknown' })
  })

  test('failures share one budget with the exchange: 10 per address, then even a good code waits', async () => {
    const ip = '198.51.100.70'
    for (let i = 0; i < 5; i++) expect((await check({ code: `ZY${i}Z-ZZZZ-ZZZZ` }, ip)).status).toBe(400)
    for (let i = 5; i < 10; i++) expect((await exchange({ code: `ZY${i}Z-ZZZZ-ZZZZ` }, ip)).status).toBe(400)
    const r = await check({ code: code() }, ip)
    expect(r.status).toBe(429)
    const j = await r.json() as any
    expect(j.error.code).toBe('rate_limited')
    expect(j.error.message).toContain('한 시간')
    expect((await exchange({ code: code() }, ip)).status).toBe(429)
    // another address is not affected
    expect((await check({ code: code() }, '198.51.100.71')).status).toBe(200)
  })

  test('5 failed attempts per code prefix, from any address', async () => {
    for (let i = 0; i < 5; i++) expect((await check({ code: `PPPP-ZZZZ-ZZZ${i}` }, `192.0.2.${100 + i}`)).status).toBe(400)
    const r = await check({ code: 'PPPP-ZZZZ-ZZZ9' }, '192.0.2.199')
    expect(r.status).toBe(429)
    expect(((await r.json()) as any).error.message).toContain('새 코드')
    expect((await exchange({ code: 'PPPP-ZZZZ-ZZZ8' }, '192.0.2.198')).status).toBe(429)
  })

  test('good checks do not count against anyone (a whole office shares one address)', async () => {
    for (let i = 0; i < 15; i++) expect((await check({ code: code() }, '100.64.0.50')).status).toBe(200)
    expect((await check({ code: 'GGGG-HHHH-JJJJ' }, '100.64.0.50')).status).toBe(400)
  })
})

describe('helpers', () => {
  test('device names and codes', () => {
    expect(cleanDeviceName('  a\u0000b​ c  ', 'macos')).toBe('ab c')
    expect(cleanDeviceName('', 'windows')).toBe('Windows PC')
    expect(cleanDeviceName(undefined, 'other')).toBe('PC')
    expect([...cleanDeviceName('가'.repeat(200), 'linux')]).toHaveLength(80)
    expect(normalizeCode(' abcd-efgh jklm ')).toBe('ABCDEFGHJKLM')
  })
  test('failure limiter window', () => {
    const l = new FailureLimiter(2, 1000)
    l.fail('a', 0); l.fail('a', 10)
    expect(l.blocked('a', 20)).toBe(true)
    expect(l.blocked('a', 1011)).toBe(false)
    expect(l.blocked('b', 20)).toBe(false)
  })
  test('only plain URLs are baked into scripts', () => {
    expect(bakeableUrl('https://acme.trina.app')).toBe(true)
    expect(bakeableUrl('http://192.168.1.17:47900')).toBe(true)
    expect(bakeableUrl('http://[::1]:47900')).toBe(true)
    for (const u of ["https://x.com/'; rm -rf ~", 'https://x.com/$(id)', 'https://x.com/`id`', 'https://u:p@x.com', 'https://x.com/?a=1', 'ftp://x.com', 'https://x.com/"', 'javascript:alert(1)']) {
      expect(bakeableUrl(u)).toBe(false)
    }
    expect(() => renderScript('sh', "https://x.com/'")).toThrow()
  })
  test('the commands the personal page shows', () => {
    const c = installCommands('https://acme.trina.app', 'ABCD-EFGH-JKLM')
    expect(c.mac).toBe('curl -fsSL https://acme.trina.app/install.sh | bash -s -- ABCD-EFGH-JKLM')
    expect(c.windows).toBe('& ([scriptblock]::Create((irm https://acme.trina.app/install.ps1))) ABCD-EFGH-JKLM')
  })
})

describe('installer scripts', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trina-install-scripts-'))
  afterAll(() => fs.rmSync(work, { recursive: true, force: true }))

  for (const [route, kind] of [['/install.sh', 'sh'], ['/install.ps1', 'ps1']] as const) {
    test(`${route} is served with the hub URL baked in and nothing secret`, async () => {
      const r = await fetch(hub.url + route)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(r.headers.get('cache-control')).toBe('no-store')
      const text = await r.text()
      expect(text).toContain(`'${hub.url}'`)
      expect(text).not.toMatch(/@@[A-Z_]+@@/)
      expect(text).not.toMatch(/tax_[A-Za-z0-9_-]{20,}/)
      expect(text).not.toContain('sk-ant-')
      expect(text).toContain(kind === 'sh' ? 'set -euo pipefail' : "$ErrorActionPreference = 'Stop'")
      expect(text).not.toContain('\r')
    })
  }

  // The PowerShell script is not run on every machine (no pwsh here), so what both installers must do is also pinned by
  // reading the rendered text: the same steps, in the same order, with the same words.
  const rendered = { sh: renderScript('sh', 'https://acme.trina.app'), ps1: renderScript('ps1', 'https://acme.trina.app') }
  /** the body of the install function (bash `do_install`, PowerShell `Install-TrinaAX`) */
  const installBody = (kind: 'sh' | 'ps1') => {
    const t = rendered[kind]
    return kind === 'sh' ? t.slice(t.indexOf('do_install() {'), t.indexOf('# uninstall')) : t.slice(t.indexOf('function Install-TrinaAX'), t.indexOf('# uninstall'))
  }

  test('both installers check the code with the hub before they install Claude Code, then exchange it', () => {
    for (const kind of ['sh', 'ps1'] as const) {
      const t = rendered[kind], body = installBody(kind)
      expect(t, kind).toContain('/api/enroll/check')
      const at = (needle: string) => { const i = body.indexOf(needle); expect(i, `${kind}: ${needle}`).toBeGreaterThan(-1); return i }
      const check = at(kind === 'sh' ? 'check_code\n' : 'Test-EnrollCode $Code')
      const install = at(kind === 'sh' ? 'install_claude\n' : "'Claude Code를 설치해요")
      const exchange = at(kind === 'sh' ? '  enroll\n' : '/api/enroll"')
      expect(check, kind).toBeLessThan(install)
      expect(install, kind).toBeLessThan(exchange)
      // the code is read and shaped before the check (nothing is typed after a download)
      expect(at(kind === 'sh' ? 'read -r CODE' : 'Read-Host'), kind).toBeLessThan(check)
      // a refusal says nothing was changed
      expect(t, kind).toContain('아무것도 바꾸지 않았어요')
      // the Claude Code step says how long it may take
      expect(t, kind).toContain('Claude Code를 설치해요 (공식 설치 스크립트). 보통 1~2분, 느린 인터넷이면 더 걸려요')
    }
  })

  test('both installers say the same things about the plugin sync, the missing company key and the login', () => {
    const both = [
      '회사 스킬을 받는 중이에요. 최대 3분 걸려요.',
      '지났어요',
      '회사 스킬 받기가 끝났어요',
      '3분 안에 끝나지 않아서 멈췄어요. 연결은 이미 끝났어요. 회사 스킬은 다음에 Claude Code를 켤 때 받아요.',
      'CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS',
      'TRINA_SYNC_TIMEOUT_SECONDS', 'TRINA_SYNC_GRACE_SECONDS', 'TRINA_PROGRESS_SECONDS',
      'modelNotice',
      '관리자가 키를 넣으면 이 PC에서 바로 쓸 수 있어요. 다시 설치하지 않아도 돼요.',
      '✓ 연결을 마쳤어요.',
      '마지막으로 한 가지만 남았어요',
      LOGIN_HINT, // the fallback when the hub sends none
    ]
    for (const kind of ['sh', 'ps1'] as const) for (const needle of both) expect(rendered[kind], `${kind}: ${needle}`).toContain(needle)
    // the old instruction (type /login yourself) is gone from both
    for (const kind of ['sh', 'ps1'] as const) expect(rendered[kind], kind).not.toContain('/login 으로')
    // the plugin sync still runs the same local-only session with the same flags
    for (const kind of ['sh', 'ps1'] as const) for (const needle of ['/cost', '--no-session-persistence', '--setting-sources']) expect(rendered[kind], `${kind}: ${needle}`).toContain(needle)
  })

  test('the missing-key warning replaces the success line and is yellow; the login box is for subscription mode only', () => {
    const sh = installBody('sh'), ps = installBody('ps1')
    // bash: the warning comes from the hub's modelNotice, in yellow on a terminal; "✓ 연결을 마쳤어요." only without it
    expect(sh).toContain('if [ -n "$MODEL_NOTICE" ]; then')
    expect(sh).toMatch(/printf '%s! %s%s\\n' "\$YELLOW" "\$MODEL_NOTICE" "\$RESET"/)
    expect(sh.indexOf('"$YELLOW" "$MODEL_NOTICE"')).toBeLessThan(sh.indexOf('say "✓ 연결을 마쳤어요."'))
    expect(rendered.sh).toContain("YELLOW=$'\\033[33m'")
    expect(rendered.sh).toContain('NO_COLOR')
    // PowerShell: the same, with Write-Host -ForegroundColor Yellow
    expect(ps).toContain('if ($modelNotice) {')
    expect(ps).toContain('Write-Host "! $modelNotice" -ForegroundColor Yellow')
    expect(ps.indexOf('Write-Host "! $modelNotice"')).toBeLessThan(ps.indexOf("Say '✓ 연결을 마쳤어요.'"))
    // the login box is only reached when there is no notice and nobody is signed in (a company-key PC never is "logged out")
    expect(sh).toMatch(/elif \[ "\$logged_in" = 0 \]; then[\s\S]*마지막으로 한 가지만 남았어요/)
    expect(ps).toMatch(/elseif \(-not \$loggedIn\) \{[\s\S]*마지막으로 한 가지만 남았어요/)
    expect(sh).toContain('if [ "$ACCESS_MODE" = subscription ] && ! claude_logged_in; then logged_in=0; fi')
    expect(ps).toContain("if ($mode -eq 'subscription') { $loggedIn = Test-LoggedIn $claude }")
  })

  test('a public URL is baked in when set', async () => {
    hub.ctx.config.publicUrl = 'https://acme.trina.app'
    try {
      const text = await (await fetch(hub.url + '/install.sh')).text()
      expect(text).toContain("HUB_URL='https://acme.trina.app'")
    } finally { hub.ctx.config.publicUrl = null }
  })

  test('a broken public URL setting gives a 500 that fails safely in bash', async () => {
    hub.ctx.config.publicUrl = "https://x.com/'; touch /tmp/pwned"
    try {
      const r = await fetch(hub.url + '/install.sh')
      expect(r.status).toBe(500)
      const text = await r.text()
      expect(text).toContain('exit 1')
      expect(text).not.toContain('pwned')
    } finally { hub.ctx.config.publicUrl = null }
  })

  test('install.sh passes bash -n', async () => {
    const f = path.join(work, 'install.sh')
    fs.writeFileSync(f, renderScript('sh', 'https://acme.trina.app'))
    const p = Bun.spawn(['bash', '-n', f], { stderr: 'pipe' })
    const err = await new Response(p.stderr).text()
    expect(await p.exited).toBe(0)
    expect(err).toBe('')
  })

  const pwsh = findPwsh()
  test.skipIf(!pwsh)('install.ps1 parses in PowerShell', async () => {
    const f = path.join(work, 'install.ps1')
    fs.writeFileSync(f, renderScript('ps1', 'https://acme.trina.app'))
    const cmd = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${f}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.ToString() }; exit 1 }`
    const p = Bun.spawn([pwsh!, '-NoProfile', '-NonInteractive', '-Command', cmd], { stdout: 'pipe', stderr: 'pipe' })
    const out = await new Response(p.stdout).text()
    expect({ code: await p.exited, out }).toEqual({ code: 0, out: '' })
  })
  if (!pwsh) console.warn('[install] pwsh not found (set TRINA_PWSH or put pwsh on PATH): skipping the PowerShell parse check')
})
