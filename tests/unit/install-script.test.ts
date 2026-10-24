// Runs the real install.sh / install.ps1 against a test hub in a temp HOME with a fake `claude` on PATH:
// the settings.json merge (macOS JXA, python3 and node helpers), backups, MCP registration, plugin steps,
// re-install token rotation and --uninstall.
import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { makeEnrollCode } from '../../src/auth/enroll'
import { verifyToken } from '../../src/auth/tokens'
import { renderScript } from '../../src/install/scripts'
import { findPwsh, jsonEngines, run, sandbox, type RunResult, type Sandbox } from './install-lib'

const ORIGINAL = {
  theme: 'dark',
  model: 'opus',
  permissions: { allow: ['Bash(git status)', 'Read(~/Documents/**)'], deny: [] as string[] },
  env: { HTTPS_PROXY: 'http://proxy.local:3128', ANTHROPIC_BASE_URL: 'https://gateway.example.com', ANTHROPIC_AUTH_TOKEN: 'gw-secret' },
  enabledPlugins: { 'other@somewhere': true },
  hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo "한글 \\ 따옴표"' }] }] },
  statusLine: { type: 'command', command: '~/.claude/statusline.sh', padding: 0 },
  cleanupPeriodDays: 30,
  includeCoAuthoredBy: false,
  nested: { deep: { deeper: { deepest: [1, 2.5, null, true, 'x', { k: [] }] } } },
}

let hub: TestHub
const boxes: Sandbox[] = []
afterAll(async () => { for (const b of boxes) b.cleanup(); await hub?.stop() })

const box = (o?: { configDir?: string }) => { const b = sandbox(o); boxes.push(b); return b }
const tokenOf = (b: Sandbox) => b.readSettings().env.ANTHROPIC_AUTH_TOKEN as string
const backups = (b: Sandbox) => fs.readdirSync(b.configDir).filter((f) => f.startsWith('settings.json.trina-backup-'))
const noToken = (r: RunResult) => expect(r.out).not.toMatch(/tax_[A-Za-z0-9_-]{10,}/)

describe('install.sh', async () => {
  hub = await testHub()
  const db = hub.ctx.db
  const kim = await hub.user('kim')
  const scriptFile = path.join(hub.dir, 'install.sh')
  fs.writeFileSync(scriptFile, await (await fetch(hub.url + '/install.sh')).text())
  const code = () => makeEnrollCode(db, kim.id, hub.owner.id).code
  const sh = (b: Sandbox, args: string[], extra: Record<string, string> = {}, file = scriptFile) =>
    run(['bash', file, ...args], b.env(extra), b.home)

  for (const engine of jsonEngines()) {
    test(`install, re-install and uninstall keep every existing setting (${engine})`, async () => {
      const b = box()
      b.writeSettings(ORIGINAL)
      const E = { TRINA_JSON_ENGINE: engine }

      const r1 = await sh(b, [code(), '--name', '김철수 맥북'], E)
      expect(r1.code).toBe(0)
      noToken(r1)
      expect(r1.stdout).toContain('연결을 마쳤어요')
      const t1 = tokenOf(b)
      expect(verifyToken(db, t1)?.user.id).toBe(kim.id)
      expect(verifyToken(db, t1)?.token.name).toBe('김철수 맥북')
      const s1 = b.readSettings()
      expect(s1).toEqual({
        ...ORIGINAL,
        env: { HTTPS_PROXY: 'http://proxy.local:3128', ANTHROPIC_BASE_URL: hub.url, ANTHROPIC_AUTH_TOKEN: t1 },
        enabledPlugins: { 'other@somewhere': true, 'company@trina-ax': true },
        extraKnownMarketplaces: {
          'trina-ax': { source: { source: 'url', url: `${hub.url}/plugins/marketplace.json`, headers: { Authorization: `Bearer ${t1}` } }, autoUpdate: true },
        },
      })
      expect(fs.statSync(b.settings).mode & 0o777).toBe(0o600)
      expect(backups(b)).toHaveLength(1)
      expect(JSON.parse(fs.readFileSync(path.join(b.configDir, backups(b)[0]!), 'utf8'))).toEqual(ORIGINAL)
      const state = JSON.parse(fs.readFileSync(b.state, 'utf8'))
      expect(state.previous).toEqual({ env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com', ANTHROPIC_AUTH_TOKEN: 'gw-secret' } })
      expect(state.created).toEqual(['extraKnownMarketplaces'])
      expect(JSON.stringify(state)).not.toContain(t1)
      expect(b.calls().map((c) => c.args)).toEqual([
        ['mcp', 'remove', 'trina', '--scope', 'user'],
        ['mcp', 'add', '--transport', 'http', 'trina', '--scope', 'user', `${hub.url}/mcp`, '--header', `Authorization: Bearer ${t1}`],
      ])

      // running it again with a new code switches to a new token and revokes the old one
      const r2 = await sh(b, [code()], E)
      expect(r2.code).toBe(0)
      noToken(r2)
      const t2 = tokenOf(b)
      expect(t2).not.toBe(t1)
      expect(verifyToken(db, t1)).toBeNull()
      expect(verifyToken(db, t2)).not.toBeNull()
      expect(JSON.parse(fs.readFileSync(b.state, 'utf8')).previous).toEqual(state.previous)

      const r3 = await sh(b, ['--uninstall'], E)
      expect(r3.code).toBe(0)
      noToken(r3)
      expect(r3.stdout).toContain('연결을 해제했어요')
      expect(b.readSettings()).toEqual(ORIGINAL)
      expect(fs.existsSync(b.state)).toBe(false)
      expect(verifyToken(db, t2)).toBeNull()
      expect(b.calls().slice(-3).map((c) => c.args)).toEqual([
        ['plugin', 'uninstall', 'company@trina-ax', '--scope', 'user'],
        ['plugin', 'marketplace', 'remove', 'trina-ax', '--scope', 'user'],
        ['mcp', 'remove', 'trina', '--scope', 'user'],
      ])
    })
  }

  test('the three JSON helpers write the same settings', async () => {
    const results: unknown[] = []
    for (const engine of jsonEngines()) {
      const b = box()
      b.writeSettings(ORIGINAL)
      expect((await sh(b, [code()], { TRINA_JSON_ENGINE: engine })).code).toBe(0)
      const s = b.readSettings()
      s.env.ANTHROPIC_AUTH_TOKEN = 'X'
      s.extraKnownMarketplaces['trina-ax'].source.headers.Authorization = 'X'
      results.push(s)
    }
    for (const r of results) expect(r).toEqual(results[0])
  })

  test('a long Korean device name is cut by characters, not bytes', async () => {
    for (const engine of jsonEngines()) {
      const b = box()
      const r = await sh(b, [code(), '--name', '가'.repeat(100)], { TRINA_JSON_ENGINE: engine })
      expect(r.code, `${engine}: ${r.stderr}`).toBe(0)
      expect(verifyToken(db, tokenOf(b))?.token.name).toBe('가'.repeat(80))
    }
  })

  test('a PC without settings.json gets one, and uninstall leaves an empty object', async () => {
    const b = box()
    const r = await sh(b, [code()])
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain('원래 설정 파일')
    expect(Object.keys(b.readSettings()).sort()).toEqual(['enabledPlugins', 'env', 'extraKnownMarketplaces'])
    expect(backups(b)).toHaveLength(0)
    expect((await sh(b, ['--uninstall'])).code).toBe(0)
    expect(b.readSettings()).toEqual({})
  })

  test('CLAUDE_CONFIG_DIR is honoured', async () => {
    const b = box({ configDir: 'custom-claude' })
    expect((await sh(b, [code()])).code).toBe(0)
    expect(b.readSettings().env.ANTHROPIC_BASE_URL).toBe(hub.url)
    expect(fs.existsSync(path.join(b.home, '.claude'))).toBe(false)
  })

  test('a broken settings.json is left alone, and the new token is given back', async () => {
    const b = box()
    const broken = '{ "theme": "dark", // comments are not JSON\n}'
    b.writeSettings(broken)
    const before = db.query("SELECT COUNT(*) AS n FROM tokens WHERE user_id = ? AND revoked_at IS NULL").get(kim.id) as { n: number }
    const r = await sh(b, [code()])
    expect(r.code).not.toBe(0)
    noToken(r)
    expect(r.stderr).toContain('올바른 JSON이 아니에요')
    expect(fs.readFileSync(b.settings, 'utf8')).toBe(broken)
    const after = db.query("SELECT COUNT(*) AS n FROM tokens WHERE user_id = ? AND revoked_at IS NULL").get(kim.id) as { n: number }
    expect(after.n).toBe(before.n)
    expect(b.calls()).toEqual([])
  })

  test('a wrong code stops before anything changes, with the hub’s message', async () => {
    const b = box()
    b.writeSettings(ORIGINAL)
    const r = await sh(b, ['AAAA-BBBB-CCCC'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('연결 코드가 맞지 않거나')
    expect(b.readSettings()).toEqual(ORIGINAL)
    expect(backups(b)).toHaveLength(0)
  })

  test('a symlinked settings.json (dotfiles) stays a symlink', async () => {
    const b = box()
    const target = path.join(b.home, 'dotfiles-settings.json')
    fs.writeFileSync(target, JSON.stringify({ theme: 'light' }))
    fs.mkdirSync(b.configDir, { recursive: true })
    fs.symlinkSync(target, b.settings)
    expect((await sh(b, [code()])).code).toBe(0)
    expect(fs.lstatSync(b.settings).isSymbolicLink()).toBe(true)
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).theme).toBe('light')
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).enabledPlugins['company@trina-ax']).toBe(true)
  })

  test('with an https public URL the plugin is installed through a local-only session', async () => {
    hub.ctx.config.publicUrl = 'https://acme.ax.trina.app'
    const file = path.join(hub.dir, 'install-public.sh')
    fs.writeFileSync(file, renderScript('sh', hub.url)) // enroll against this test hub; URLs in settings are public
    try {
      const b = box()
      const r = await sh(b, [code()], {}, file)
      expect(r.code).toBe(0)
      noToken(r)
      expect(r.stdout).toContain('회사 스킬')
      const s = b.readSettings()
      expect(s.env.ANTHROPIC_BASE_URL).toBe('https://acme.ax.trina.app')
      expect(s.extraKnownMarketplaces['trina-ax'].source.url).toBe('https://acme.ax.trina.app/plugins/marketplace.json')
      const calls = b.calls()
      expect(calls.slice(2)).toEqual([
        { args: ['-p', '/cost', '--no-session-persistence', '--setting-sources', 'user'], sync: '1' },
        { args: ['plugin', 'install', 'company@trina-ax', '--scope', 'user'], sync: '' },
        { args: ['plugin', 'list', '--json'], sync: '' },
      ])
    } finally { hub.ctx.config.publicUrl = null }
  })

  test('--help works without a hub', async () => {
    const b = box()
    const r = await sh(b, ['--help'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('--uninstall')
  })
})

const pwsh = findPwsh()
describe.skipIf(!pwsh)('install.ps1 (PowerShell)', () => {
  test('install and uninstall keep every existing setting', async () => {
    const db = hub.ctx.db
    const lee = await hub.user('lee-ps')
    const file = path.join(hub.dir, 'install.ps1')
    fs.writeFileSync(file, await (await fetch(hub.url + '/install.ps1')).text())
    const b = box()
    b.writeSettings(ORIGINAL)
    const ps = (args: string[]) => run([pwsh!, '-NoProfile', '-NonInteractive', '-File', file, ...args], b.env(), b.home)

    const r1 = await ps([makeEnrollCode(db, lee.id, null).code])
    expect(r1.out).toContain('연결을 마쳤어요')
    noToken(r1)
    const t1 = tokenOf(b)
    expect(verifyToken(db, t1)?.user.id).toBe(lee.id)
    expect(b.readSettings()).toEqual({
      ...ORIGINAL,
      env: { HTTPS_PROXY: 'http://proxy.local:3128', ANTHROPIC_BASE_URL: hub.url, ANTHROPIC_AUTH_TOKEN: t1 },
      enabledPlugins: { 'other@somewhere': true, 'company@trina-ax': true },
      extraKnownMarketplaces: {
        'trina-ax': { source: { source: 'url', url: `${hub.url}/plugins/marketplace.json`, headers: { Authorization: `Bearer ${t1}` } }, autoUpdate: true },
      },
    })
    expect(b.calls().map((c) => c.args[1])).toEqual(['remove', 'add'])

    const r2 = await ps([makeEnrollCode(db, lee.id, null).code])
    noToken(r2)
    expect(verifyToken(db, t1)).toBeNull()

    const r3 = await ps(['-Uninstall'])
    expect(r3.out).toContain('연결을 해제했어요')
    noToken(r3)
    expect(b.readSettings()).toEqual(ORIGINAL)
    expect(fs.existsSync(b.state)).toBe(false)
  }, 60_000)
})
if (!pwsh) console.warn('[install] pwsh not found (set TRINA_PWSH or put pwsh on PATH): skipping install.ps1 runs')
