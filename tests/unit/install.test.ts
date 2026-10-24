import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { makeEnrollCode } from '../../src/auth/enroll'
import { verifyToken } from '../../src/auth/tokens'
import { updateUser } from '../../src/auth/users'
import { listAudit } from '../../src/audit'
import { setSetting } from '../../src/db'
import { bakeableUrl, installCommands, renderScript } from '../../src/install/scripts'
import { cleanDeviceName, normalizeCode } from '../../src/install/enroll'
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
    })
    const auth = verifyToken(db, j.token)!
    expect(auth.user.id).toBe(kim.id)
    expect(auth.token.kind).toBe('device')
    expect(auth.token.name).toBe('김철수의 MacBook Pro')
    const a = listAudit(db).find((e) => e.action === 'device.enroll')!
    expect(a.actor).toBe(kim.id)
    expect(a.detail).toContain('203.0.113.1')
    expect(a.detail).not.toContain(j.token)
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
    hub.ctx.config.publicUrl = 'https://acme.ax.trina.app'
    try {
      const j = await (await enroll({ code: code() }, '100.64.0.3')).json() as any
      expect(j.skillsReady).toBe(true)
      expect(j.notices).toEqual([])
      expect(j.hubUrl).toBe('https://acme.ax.trina.app')
      expect(j.marketplaceUrl).toBe('https://acme.ax.trina.app/plugins/marketplace.json')
      expect(j.mcpUrl).toBe('https://acme.ax.trina.app/mcp')
    } finally { hub.ctx.config.publicUrl = null }
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
    expect(bakeableUrl('https://acme.ax.trina.app')).toBe(true)
    expect(bakeableUrl('http://192.168.1.17:47900')).toBe(true)
    expect(bakeableUrl('http://[::1]:47900')).toBe(true)
    for (const u of ["https://x.com/'; rm -rf ~", 'https://x.com/$(id)', 'https://x.com/`id`', 'https://u:p@x.com', 'https://x.com/?a=1', 'ftp://x.com', 'https://x.com/"', 'javascript:alert(1)']) {
      expect(bakeableUrl(u)).toBe(false)
    }
    expect(() => renderScript('sh', "https://x.com/'")).toThrow()
  })
  test('the commands the personal page shows', () => {
    const c = installCommands('https://acme.ax.trina.app', 'ABCD-EFGH-JKLM')
    expect(c.mac).toBe('curl -fsSL https://acme.ax.trina.app/install.sh | bash -s -- ABCD-EFGH-JKLM')
    expect(c.windows).toBe('& ([scriptblock]::Create((irm https://acme.ax.trina.app/install.ps1))) ABCD-EFGH-JKLM')
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

  test('a public URL is baked in when set', async () => {
    hub.ctx.config.publicUrl = 'https://acme.ax.trina.app'
    try {
      const text = await (await fetch(hub.url + '/install.sh')).text()
      expect(text).toContain("HUB_URL='https://acme.ax.trina.app'")
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
    fs.writeFileSync(f, renderScript('sh', 'https://acme.ax.trina.app'))
    const p = Bun.spawn(['bash', '-n', f], { stderr: 'pipe' })
    const err = await new Response(p.stderr).text()
    expect(await p.exited).toBe(0)
    expect(err).toBe('')
  })

  const pwsh = findPwsh()
  test.skipIf(!pwsh)('install.ps1 parses in PowerShell', async () => {
    const f = path.join(work, 'install.ps1')
    fs.writeFileSync(f, renderScript('ps1', 'https://acme.ax.trina.app'))
    const cmd = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${f}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.ToString() }; exit 1 }`
    const p = Bun.spawn([pwsh!, '-NoProfile', '-NonInteractive', '-Command', cmd], { stdout: 'pipe', stderr: 'pipe' })
    const out = await new Response(p.stdout).text()
    expect({ code: await p.exited, out }).toEqual({ code: 0, out: '' })
  })
  if (!pwsh) console.warn('[install] pwsh not found (set TRINA_PWSH or put pwsh on PATH): skipping the PowerShell parse check')
})
