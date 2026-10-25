// Runs the real install.sh / install.ps1 against a test hub in a temp HOME with a fake `claude` on PATH:
// the settings.json merge (macOS JXA, python3 and node helpers), backups, MCP registration, plugin steps,
// re-install token rotation and --uninstall, in both ways a person can use Claude:
//   subscription  the hub's env is Claude Code's OpenTelemetry export (no ANTHROPIC_* keys)
//   company_key   ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN through the hub's relay
// The scripts never know the mode: they write the `env` the hub sends and manage the keys in `envOwned`.
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { makeEnrollCode } from '../../src/auth/enroll'
import { setUserModelAccess, type ModelAccess } from '../../src/auth/access-mode'
import { verifyToken } from '../../src/auth/tokens'
import { renderScript } from '../../src/install/scripts'
import { findPwsh, jsonEngines, run, sandbox, type RunResult, type Sandbox } from './install-lib'

// each case runs the real scripts a few times (osascript and pwsh take a moment to start)
setDefaultTimeout(60_000)

const GATEWAY = { ANTHROPIC_BASE_URL: 'https://gateway.example.com', ANTHROPIC_AUTH_TOKEN: 'gw-secret' }
const ORIGINAL = {
  theme: 'dark',
  model: 'opus',
  permissions: { allow: ['Bash(git status)', 'Read(~/Documents/**)'], deny: [] as string[] },
  // a corporate proxy, a gateway of their own, and an OTLP exporter value of their own (all must survive)
  env: { HTTPS_PROXY: 'http://proxy.local:3128', ...GATEWAY, OTEL_METRICS_EXPORTER: 'prometheus' } as Record<string, string>,
  enabledPlugins: { 'other@somewhere': true },
  hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo "한글 \\ 따옴표"' }] }] },
  statusLine: { type: 'command', command: '~/.claude/statusline.sh', padding: 0 },
  cleanupPeriodDays: 30,
  includeCoAuthoredBy: false,
  nested: { deep: { deeper: { deepest: [1, 2.5, null, true, 'x', { k: [] }] } } },
}
/** The file the way the helpers write it, so that "restored" can be compared byte for byte. */
const canonical = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

const OTEL_KEYS = [
  'CLAUDE_CODE_ENABLE_TELEMETRY', 'OTEL_LOGS_EXPORTER', 'OTEL_METRICS_EXPORTER', 'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS',
]
/** The env keys the hub sends for `mode`, as the installer must leave them in settings.json. */
const modeEnv = (mode: ModelAccess, hubUrl: string, token: string): Record<string, string> => mode === 'subscription'
  ? {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${hubUrl}/otel/v1/logs`,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
  }
  : { ANTHROPIC_BASE_URL: hubUrl, ANTHROPIC_AUTH_TOKEN: token }
const marketplaceEntry = (hubUrl: string, token: string) => ({
  source: { source: 'url', url: `${hubUrl}/plugins/marketplace.json`, headers: { Authorization: `Bearer ${token}` } }, autoUpdate: true,
})
/** What settings.json holds after an install on top of `base` (default ORIGINAL), whatever else is in it. */
const expectedSettings = (mode: ModelAccess, hubUrl: string, token: string, base: any = ORIGINAL) => ({
  ...base,
  env: { ...(base.env ?? {}), ...modeEnv(mode, hubUrl, token) },
  enabledPlugins: { ...(base.enabledPlugins ?? {}), 'company@trina-ax': true },
  extraKnownMarketplaces: { ...(base.extraKnownMarketplaces ?? {}), 'trina-ax': marketplaceEntry(hubUrl, token) },
})
const MODES: ModelAccess[] = ['subscription', 'company_key']
const LOGIN_HINT = '터미널에서 claude 를 실행하고 /login 으로 본인 Claude 구독에 로그인해 주세요.'
const LATER = '회사 스킬은 로그인한 뒤 Claude Code를 처음 열 때 자동으로 설치돼요.'

let hub: TestHub
const boxes: Sandbox[] = []
afterAll(async () => { for (const b of boxes) b.cleanup(); await hub?.stop() })

const box = (o?: { configDir?: string }) => { const b = sandbox(o); boxes.push(b); return b }
/** The device token, from the marketplace header (it is there in both modes; ANTHROPIC_AUTH_TOKEN only in one). */
const tokenOf = (b: Sandbox) => (b.readSettings().extraKnownMarketplaces['trina-ax'].source.headers.Authorization as string).replace(/^Bearer /, '')
const backups = (b: Sandbox) => fs.readdirSync(b.configDir).filter((f) => f.startsWith('settings.json.trina-backup-'))
const noToken = (r: RunResult) => expect(r.out).not.toMatch(/tax_[A-Za-z0-9_-]{10,}/)
const readState = (b: Sandbox) => JSON.parse(fs.readFileSync(b.state, 'utf8'))
const text = (b: Sandbox) => fs.readFileSync(b.settings, 'utf8')
const lastLines = (r: RunResult, n: number) => r.stdout.trimEnd().split('\n').slice(-n).join('\n')

describe('install.sh', async () => {
  hub = await testHub()
  const db = hub.ctx.db
  const kim = await hub.user('kim')
  const scriptFile = path.join(hub.dir, 'install.sh')
  fs.writeFileSync(scriptFile, await (await fetch(hub.url + '/install.sh')).text())
  const code = () => makeEnrollCode(db, kim.id, hub.owner.id).code
  const sh = (b: Sandbox, args: string[], extra: Record<string, string> = {}, file = scriptFile) =>
    run(['bash', file, ...args], b.env(extra), b.home)
  const as = (mode: ModelAccess) => setUserModelAccess(db, kim.id, mode)
  const engines = jsonEngines()

  for (const engine of engines) {
    for (const mode of MODES) {
      test(`${mode}: install, re-install and uninstall keep every existing setting (${engine})`, async () => {
        as(mode)
        const b = box()
        b.writeSettings(canonical(ORIGINAL))
        const E = { TRINA_JSON_ENGINE: engine }

        const r1 = await sh(b, [code(), '--name', '김철수 맥북'], E)
        expect(r1.code).toBe(0)
        noToken(r1)
        expect(r1.stdout).toContain('연결을 마쳤어요')
        const t1 = tokenOf(b)
        expect(verifyToken(db, t1)?.user.id).toBe(kim.id)
        expect(verifyToken(db, t1)?.token.name).toBe('김철수 맥북')
        // exactly the hub's env, nothing else added or taken away
        expect(b.readSettings()).toEqual(expectedSettings(mode, hub.url, t1))
        expect(fs.statSync(b.settings).mode & 0o777).toBe(0o600)
        expect(backups(b)).toHaveLength(1)
        expect(fs.readFileSync(path.join(b.configDir, backups(b)[0]!), 'utf8')).toBe(canonical(ORIGINAL))
        const state = readState(b)
        // before the first install: the gateway pair and the exporter value they had (every managed key that was there)
        expect(state.previous).toEqual({ env: { ...GATEWAY, OTEL_METRICS_EXPORTER: 'prometheus' } })
        expect(state.created).toEqual(['extraKnownMarketplaces'])
        expect(state.setKeys).toEqual(Object.keys(modeEnv(mode, hub.url, t1)))
        expect(JSON.stringify(state)).not.toContain(t1)
        const mcp = [
          ['mcp', 'remove', 'trina', '--scope', 'user'],
          ['mcp', 'add', '--transport', 'http', 'trina', '--scope', 'user', `${hub.url}/mcp`, '--header', `Authorization: Bearer ${t1}`],
        ]
        // only a subscription person's login is looked at
        expect(b.calls().map((c) => c.args)).toEqual(mode === 'subscription' ? [...mcp, ['auth', 'status', '--json']] : mcp)
        expect(r1.stdout).toContain(mode === 'subscription'
          ? 'AI 사용은 본인 Claude 구독으로 해요. 사용량만 회사 허브에 기록돼요.'
          : 'AI 사용료는 회사 계정으로 나가요.')
        expect(r1.stdout).not.toContain(mode === 'subscription' ? 'AI 사용료는 회사 계정으로' : '본인 Claude 구독')

        // running it again with a new code switches to a new token and revokes the old one
        // (the old token is found in the marketplace header: in subscription mode there is no ANTHROPIC_AUTH_TOKEN of ours)
        const r2 = await sh(b, [code()], E)
        expect(r2.code).toBe(0)
        noToken(r2)
        const t2 = tokenOf(b)
        expect(t2).not.toBe(t1)
        expect(verifyToken(db, t1)).toBeNull()
        expect(verifyToken(db, t2)).not.toBeNull()
        expect(b.readSettings()).toEqual(expectedSettings(mode, hub.url, t2))
        expect(readState(b).previous).toEqual(state.previous)

        const r3 = await sh(b, ['--uninstall'], E)
        expect(r3.code).toBe(0)
        noToken(r3)
        expect(r3.stdout).toContain('연결을 해제했어요')
        expect(text(b)).toBe(canonical(ORIGINAL)) // byte for byte
        expect(fs.existsSync(b.state)).toBe(false)
        expect(verifyToken(db, t2)).toBeNull()
        expect(b.calls().slice(-3).map((c) => c.args)).toEqual([
          ['plugin', 'uninstall', 'company@trina-ax', '--scope', 'user'],
          ['plugin', 'marketplace', 'remove', 'trina-ax', '--scope', 'user'],
          ['mcp', 'remove', 'trina', '--scope', 'user'],
        ])
      })

      test(`${mode}: on a PC without other settings the env holds exactly the hub's keys (${engine})`, async () => {
        as(mode)
        const b = box()
        b.writeSettings(canonical({ theme: 'light', env: { HTTPS_PROXY: 'http://proxy.local:3128' } }))
        const r = await sh(b, [code()], { TRINA_JSON_ENGINE: engine })
        expect(r.code).toBe(0)
        const env = b.readSettings().env
        expect(Object.keys(env).sort()).toEqual(['HTTPS_PROXY', ...Object.keys(modeEnv(mode, hub.url, 'x'))].sort())
        if (mode === 'subscription') {
          // nothing that would override the person's own login
          expect(Object.keys(env).some((k) => k.startsWith('ANTHROPIC_'))).toBe(false)
          expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe(`Authorization=Bearer ${tokenOf(b)}`)
        }
        expect((await sh(b, ['--uninstall'], { TRINA_JSON_ENGINE: engine })).code).toBe(0)
        expect(text(b)).toBe(canonical({ theme: 'light', env: { HTTPS_PROXY: 'http://proxy.local:3128' } }))
      })
    }

    test(`switching mode by re-installing removes the other mode's keys and restores what the person had (${engine})`, async () => {
      const b = box()
      b.writeSettings(canonical(ORIGINAL))
      const E = { TRINA_JSON_ENGINE: engine }
      const tokens: string[] = []
      const step = async (mode: ModelAccess) => {
        as(mode)
        const r = await sh(b, [code()], E)
        expect(r.code, r.out).toBe(0)
        noToken(r)
        const t = tokenOf(b)
        tokens.push(t)
        expect(b.readSettings()).toEqual(expectedSettings(mode, hub.url, t))
        // the first install's memory is kept as it was
        expect(readState(b).previous).toEqual({ env: { ...GATEWAY, OTEL_METRICS_EXPORTER: 'prometheus' } })
        expect(readState(b).setKeys).toEqual(Object.keys(modeEnv(mode, hub.url, t)))
        return b.readSettings().env as Record<string, string>
      }

      const sub = await step('subscription')
      expect(sub.ANTHROPIC_BASE_URL).toBe(GATEWAY.ANTHROPIC_BASE_URL) // theirs, untouched
      expect(sub.OTEL_METRICS_EXPORTER).toBe('none')

      const key = await step('company_key')
      expect(Object.keys(key).filter((k) => OTEL_KEYS.includes(k))).toEqual(['OTEL_METRICS_EXPORTER'])
      expect(key.OTEL_METRICS_EXPORTER).toBe('prometheus') // what they had before the first install
      expect(key.ANTHROPIC_BASE_URL).toBe(hub.url)

      const sub2 = await step('subscription')
      expect(sub2.ANTHROPIC_BASE_URL).toBe(GATEWAY.ANTHROPIC_BASE_URL) // back to theirs
      expect(sub2.ANTHROPIC_AUTH_TOKEN).toBe(GATEWAY.ANTHROPIC_AUTH_TOKEN)

      await step('company_key')

      // every earlier token was revoked by the next install, in either mode; only the last one lives
      for (const t of tokens.slice(0, -1)) expect(verifyToken(db, t)).toBeNull()
      expect(verifyToken(db, tokens.at(-1)!)).not.toBeNull()

      const u = await sh(b, ['--uninstall'], E)
      expect(u.code).toBe(0)
      expect(text(b)).toBe(canonical(ORIGINAL))
      expect(verifyToken(db, tokens.at(-1)!)).toBeNull()
    })

    test(`a token of another hub in the marketplace entry is never revoked (${engine})`, async () => {
      as('subscription')
      const other = hub.token(kim.id) // pretend it belongs to somewhere else: the entry points at another address
      const b = box()
      b.writeSettings(canonical({
        extraKnownMarketplaces: { 'trina-ax': { source: { source: 'url', url: 'https://other-hub.example.com/plugins/marketplace.json', headers: { Authorization: `Bearer ${other}` } }, autoUpdate: true } },
      }))
      expect((await sh(b, [code()], { TRINA_JSON_ENGINE: engine })).code).toBe(0)
      expect(verifyToken(db, other)).not.toBeNull()
      expect(b.readSettings().extraKnownMarketplaces['trina-ax'].source.url).toBe(`${hub.url}/plugins/marketplace.json`)
    })

    test(`settings and state from before the modes are understood: uninstall and a switch to subscription (${engine})`, async () => {
      const E = { TRINA_JSON_ENGINE: engine }
      // what an older install.sh left: ANTHROPIC_* of ours, the marketplace entry, and a state file without setKeys
      const legacy = (b: Sandbox, old: string, withState = true) => {
        b.writeSettings(canonical({
          theme: 'dark',
          env: { ANTHROPIC_BASE_URL: hub.url, ANTHROPIC_AUTH_TOKEN: old },
          enabledPlugins: { 'company@trina-ax': true },
          extraKnownMarketplaces: { 'trina-ax': marketplaceEntry(hub.url, old) },
        }))
        if (withState) {
          fs.writeFileSync(b.state, canonical({
            product: 'trina-ax', hubUrl: hub.url, marketplace: 'trina-ax', plugin: 'company@trina-ax',
            installedAt: '2026-10-01T00:00:00Z', created: ['enabledPlugins', 'extraKnownMarketplaces'],
            previous: { env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com' } },
          }))
        }
      }

      // uninstall: the old base URL comes back, the token goes, the old token is revoked
      const a = box()
      const oldA = hub.token(kim.id)
      legacy(a, oldA)
      expect((await sh(a, ['--uninstall'], E)).code).toBe(0)
      expect(a.readSettings()).toEqual({ theme: 'dark', env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com' } })
      expect(verifyToken(db, oldA)).toBeNull()

      // a person who is now on a subscription: ANTHROPIC_* go (or return to theirs), telemetry comes in
      as('subscription')
      const b = box()
      const oldB = hub.token(kim.id)
      legacy(b, oldB)
      expect((await sh(b, [code()], E)).code).toBe(0)
      const tB = tokenOf(b)
      expect(b.readSettings()).toEqual({
        theme: 'dark',
        env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com', ...modeEnv('subscription', hub.url, tB) },
        enabledPlugins: { 'company@trina-ax': true },
        extraKnownMarketplaces: { 'trina-ax': marketplaceEntry(hub.url, tB) },
      })
      expect(verifyToken(db, oldB)).toBeNull()
      expect(readState(b).setKeys).toEqual(Object.keys(modeEnv('subscription', hub.url, tB)))

      // the state file is gone but the settings are ours: still no ANTHROPIC_* left over to override the login
      const c = box()
      const oldC = hub.token(kim.id)
      legacy(c, oldC, false)
      expect((await sh(c, [code()], E)).code).toBe(0)
      const tC = tokenOf(c)
      expect(c.readSettings().env).toEqual(modeEnv('subscription', hub.url, tC))
      expect(verifyToken(db, oldC)).toBeNull()
    })
  }

  test('the JSON helpers write the same settings and state, in both modes', async () => {
    for (const mode of MODES) {
      as(mode)
      const results: { settings: string; state: string }[] = []
      for (const engine of engines) {
        const b = box()
        b.writeSettings(canonical(ORIGINAL))
        const E = { TRINA_JSON_ENGINE: engine }
        expect((await sh(b, [code()], E)).code).toBe(0)
        expect((await sh(b, [code()], E)).code).toBe(0) // the second run goes through the "state exists" path
        const t = tokenOf(b)
        const state = readState(b)
        state.installedAt = 'T'
        results.push({ settings: text(b).replaceAll(t, 'X'), state: canonical(state) })
        expect(JSON.stringify(state)).not.toContain(t)
      }
      for (const r of results) expect(r).toEqual(results[0]!)
    }
  })

  test('a long Korean device name is cut by characters, not bytes', async () => {
    for (const engine of engines) {
      const b = box()
      const r = await sh(b, [code(), '--name', '가'.repeat(100)], { TRINA_JSON_ENGINE: engine })
      expect(r.code, `${engine}: ${r.stderr}`).toBe(0)
      expect(verifyToken(db, tokenOf(b))?.token.name).toBe('가'.repeat(80))
    }
  })

  test('a PC without settings.json gets one, and uninstall leaves an empty object', async () => {
    for (const mode of MODES) {
      as(mode)
      const b = box()
      const r = await sh(b, [code()])
      expect(r.code).toBe(0)
      expect(r.stdout).not.toContain('원래 설정 파일')
      expect(Object.keys(b.readSettings()).sort()).toEqual(['enabledPlugins', 'env', 'extraKnownMarketplaces'])
      expect(backups(b)).toHaveLength(0)
      expect((await sh(b, ['--uninstall'])).code).toBe(0)
      expect(b.readSettings()).toEqual({})
    }
  })

  test('CLAUDE_CONFIG_DIR is honoured', async () => {
    as('company_key')
    const b = box({ configDir: 'custom-claude' })
    expect((await sh(b, [code()])).code).toBe(0)
    expect(b.readSettings().env.ANTHROPIC_BASE_URL).toBe(hub.url)
    expect(fs.existsSync(path.join(b.home, '.claude'))).toBe(false)
  })

  test('a broken settings.json is left alone, and the new token is given back', async () => {
    for (const mode of MODES) {
      as(mode)
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
    }
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
    as('subscription')
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
      for (const mode of MODES) {
        as(mode)
        const b = box()
        const r = await sh(b, [code()], {}, file)
        expect(r.code).toBe(0)
        noToken(r)
        expect(r.stdout).toContain('회사 스킬')
        const s = b.readSettings()
        expect(s.env).toEqual(modeEnv(mode, 'https://acme.ax.trina.app', tokenOf(b)))
        expect(s.extraKnownMarketplaces['trina-ax'].source.url).toBe('https://acme.ax.trina.app/plugins/marketplace.json')
        const calls = b.calls()
        // [mcp remove, mcp add, (auth status,) -p /cost, plugin install, plugin list]
        expect(calls.slice(mode === 'subscription' ? 3 : 2)).toEqual([
          { args: ['-p', '/cost', '--no-session-persistence', '--setting-sources', 'user'], sync: '1' },
          { args: ['plugin', 'install', 'company@trina-ax', '--scope', 'user'], sync: '' },
          { args: ['plugin', 'list', '--json'], sync: '' },
        ])
      }
    } finally { hub.ctx.config.publicUrl = null }
  })

  test('subscription: someone who is not signed in is told to, at the very end', async () => {
    as('subscription')
    for (const auth of ['out', 'out0', 'broken']) {
      const b = box()
      const r = await sh(b, [code()], { FAKE_CLAUDE_AUTH: auth })
      expect(r.code, auth).toBe(0)
      noToken(r)
      expect(r.stdout, auth).toContain(LOGIN_HINT)
      expect(lastLines(r, 4), auth).toContain(LOGIN_HINT)
      expect(r.stdout, auth).not.toContain('이제 터미널에서 claude 를 실행해 보세요')
      expect(b.calls().some((c) => c.args[0] === 'auth' && c.args[1] === 'status' && c.args[2] === '--json'), auth).toBe(true)
      // the connection itself is done
      expect(b.readSettings().env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1')
    }
  })

  test('subscription: someone who is signed in just starts', async () => {
    as('subscription')
    const b = box()
    const r = await sh(b, [code()], { FAKE_CLAUDE_AUTH: 'in' })
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain(LOGIN_HINT)
    expect(r.stdout).toContain('이제 터미널에서 claude 를 실행해 보세요')
  })

  test('company key: a PC is never asked about a login', async () => {
    as('company_key')
    const b = box()
    const r = await sh(b, [code()], { FAKE_CLAUDE_AUTH: 'out' })
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain(LOGIN_HINT)
    expect(b.calls().some((c) => c.args[0] === 'auth')).toBe(false)
  })

  test('subscription: company skills that cannot be installed before the first login do not fail the installer', async () => {
    hub.ctx.config.publicUrl = 'https://acme.ax.trina.app'
    const file = path.join(hub.dir, 'install-public-login.sh')
    fs.writeFileSync(file, renderScript('sh', hub.url))
    try {
      as('subscription')
      const b = box()
      const r = await sh(b, [code()], { FAKE_CLAUDE_AUTH: 'out', FAKE_CLAUDE_PLUGIN_FAIL: '1' }, file)
      expect(r.code).toBe(0)
      expect(r.stdout).toContain(LATER)
      expect(r.stderr).not.toContain('아직 설치하지 못했어요')
      expect(r.stdout).toContain(LOGIN_HINT)
      noToken(r)
      expect(b.readSettings().enabledPlugins['company@trina-ax']).toBe(true) // Claude Code installs it at session start

      // signed in but the install still fails: that is a real warning
      const c = box()
      const r2 = await sh(c, [code()], { FAKE_CLAUDE_AUTH: 'in', FAKE_CLAUDE_PLUGIN_FAIL: '1' }, file)
      expect(r2.code).toBe(0)
      expect(r2.stderr).toContain('아직 설치하지 못했어요')
      expect(r2.stdout).not.toContain(LATER)
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
  const ps = async (b: Sandbox, file: string, args: string[], extra: Record<string, string> = {}) =>
    run([pwsh!, '-NoProfile', '-NonInteractive', '-File', file, ...args], b.env(extra), b.home)
  const setup = async (name: string) => {
    const db = hub.ctx.db
    const u = await hub.user(name)
    const file = path.join(hub.dir, `install-${name}.ps1`)
    fs.writeFileSync(file, await (await fetch(hub.url + '/install.ps1')).text())
    return { db, u, file, code: () => makeEnrollCode(db, u.id, null).code, as: (m: ModelAccess) => setUserModelAccess(db, u.id, m) }
  }

  for (const mode of MODES) {
    test(`${mode}: install, re-install and uninstall keep every existing setting`, async () => {
      const { db, u, file, code, as } = await setup(`lee-ps-${mode}`)
      as(mode)
      const b = box()
      b.writeSettings(ORIGINAL)

      const r1 = await ps(b, file, [code()])
      expect(r1.out).toContain('연결을 마쳤어요')
      noToken(r1)
      const t1 = tokenOf(b)
      expect(verifyToken(db, t1)?.user.id).toBe(u.id)
      expect(b.readSettings()).toEqual(expectedSettings(mode, hub.url, t1))
      expect(readState(b).previous).toEqual({ env: { ...GATEWAY, OTEL_METRICS_EXPORTER: 'prometheus' } })
      expect(readState(b).setKeys).toEqual(Object.keys(modeEnv(mode, hub.url, t1)))
      expect(r1.out).toContain(mode === 'subscription' ? '본인 Claude 구독으로 해요' : 'AI 사용료는 회사 계정으로 나가요')
      const mcp = ['remove', 'add']
      expect(b.calls().map((c) => c.args[1])).toEqual(mode === 'subscription' ? [...mcp, 'status'] : mcp)

      const r2 = await ps(b, file, [code()])
      noToken(r2)
      expect(verifyToken(db, t1)).toBeNull() // found in the marketplace header
      const t2 = tokenOf(b)
      expect(b.readSettings()).toEqual(expectedSettings(mode, hub.url, t2))

      const r3 = await ps(b, file, ['-Uninstall'])
      expect(r3.out).toContain('연결을 해제했어요')
      noToken(r3)
      expect(b.readSettings()).toEqual(ORIGINAL)
      expect(fs.existsSync(b.state)).toBe(false)
      expect(verifyToken(db, t2)).toBeNull()
    }, 120_000)
  }

  test('switching mode by re-installing removes the other mode\'s keys and restores what the person had', async () => {
    const { db, file, code, as } = await setup('lee-ps-switch')
    const b = box()
    b.writeSettings(ORIGINAL)
    const tokens: string[] = []
    for (const mode of ['subscription', 'company_key', 'subscription', 'company_key'] as ModelAccess[]) {
      as(mode)
      noToken(await ps(b, file, [code()]))
      tokens.push(tokenOf(b))
      expect(b.readSettings()).toEqual(expectedSettings(mode, hub.url, tokens.at(-1)!))
    }
    for (const t of tokens.slice(0, -1)) expect(verifyToken(db, t)).toBeNull()
    await ps(b, file, ['-Uninstall'])
    expect(b.readSettings()).toEqual(ORIGINAL)
    expect(verifyToken(db, tokens.at(-1)!)).toBeNull()
  }, 180_000)

  test('a PC without other settings gets exactly the hub\'s keys, and a login hint at the end when nobody is signed in', async () => {
    const { file, code, as } = await setup('lee-ps-login')
    as('subscription')
    const b = box()
    const r = await ps(b, file, [code()], { FAKE_CLAUDE_AUTH: 'out' })
    expect(r.out).toContain(LOGIN_HINT)
    expect(lastLines({ ...r, stdout: r.out }, 4)).toContain(LOGIN_HINT)
    noToken(r)
    expect(Object.keys(b.readSettings().env).sort()).toEqual([...OTEL_KEYS].sort())
    const c = box()
    const r2 = await ps(c, file, [code()], { FAKE_CLAUDE_AUTH: 'in' })
    expect(r2.out).not.toContain(LOGIN_HINT)
    expect(r2.out).toContain('이제 새 터미널에서 claude 를 실행해 보세요')
  }, 120_000)

  test('settings and state from before the modes are understood', async () => {
    const { db, file, code, as } = await setup('lee-ps-legacy')
    const old = hub.token((await hub.user('lee-ps-legacy-owner')).id)
    const b = box()
    b.writeSettings({
      theme: 'dark',
      env: { ANTHROPIC_BASE_URL: hub.url, ANTHROPIC_AUTH_TOKEN: old },
      enabledPlugins: { 'company@trina-ax': true },
      extraKnownMarketplaces: { 'trina-ax': marketplaceEntry(hub.url, old) },
    })
    fs.writeFileSync(b.state, JSON.stringify({
      product: 'trina-ax', hubUrl: hub.url, marketplace: 'trina-ax', plugin: 'company@trina-ax',
      installedAt: '2026-10-01T00:00:00Z', created: ['enabledPlugins', 'extraKnownMarketplaces'],
      previous: { env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com' } },
    }))
    as('subscription')
    expect((await ps(b, file, [code()])).out).toContain('연결을 마쳤어요')
    const t = tokenOf(b)
    expect(b.readSettings()).toEqual({
      theme: 'dark',
      env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com', ...modeEnv('subscription', hub.url, t) },
      enabledPlugins: { 'company@trina-ax': true },
      extraKnownMarketplaces: { 'trina-ax': marketplaceEntry(hub.url, t) },
    })
    expect(verifyToken(db, old)).toBeNull() // revoked: it was only recognisable by the marketplace header's hub
    await ps(b, file, ['-Uninstall'])
    expect(b.readSettings()).toEqual({ theme: 'dark', env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com' } })
  }, 120_000)
})
if (!pwsh) console.warn('[install] pwsh not found (set TRINA_PWSH or put pwsh on PATH): skipping install.ps1 runs')

// Regression: the uninstaller runs `claude plugin marketplace remove` first, which drops the marketplace entry the
// token used to be read from; the token must still be found (relay token or telemetry header) and revoked.
describe('uninstall still revokes after the marketplace entry is gone', () => {
  for (const mode of ['company_key', 'subscription'] as const) {
    test(mode, async () => {
      const { testHub } = await import('../lib/hub')
      const { verifyToken } = await import('../../src/auth/tokens')
      const { makeEnrollCode } = await import('../../src/auth/enroll')
      const { renderScript } = await import('../../src/install/scripts')
      const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
      const h = await testHub({ access: mode })
      try {
        const u = await h.user('rev-' + mode)
        const code = makeEnrollCode(h.ctx.db, u.id, u.id).code
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trina-rev-'))
        const script = path.join(home, 'install.sh')
        fs.writeFileSync(script, renderScript('sh', h.url))
        // a fake claude that, like the real one, removes the marketplace entry from settings on `marketplace remove`
        const bin = path.join(home, 'bin'); fs.mkdirSync(bin)
        fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/bash
if [ "$1 $2 $3" = "plugin marketplace remove" ]; then
  /usr/bin/python3 - "$CLAUDE_CONFIG_DIR/settings.json" <<'PYX'
import json,sys
p=sys.argv[1]; s=json.load(open(p)); s.get('extraKnownMarketplaces',{}).pop('trina-ax',None); json.dump(s,open(p,'w'),indent=2)
PYX
fi
if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; fi
exit 0
`, { mode: 0o755 })
        const env = { HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: `${bin}:/usr/bin:/bin`, TMPDIR: os.tmpdir(), TRINA_SKIP_CLAUDE_INSTALL: '1' }
        const run = async (args: string[]) => { const p = Bun.spawn(['/bin/bash', script, ...args], { env, stdout: 'pipe', stderr: 'pipe' }); await p.exited; return p.exitCode }
        expect(await run([code])).toBe(0)
        const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
        const token = (s.extraKnownMarketplaces['trina-ax'].source.headers.Authorization as string).slice(7)
        expect(verifyToken(h.ctx.db, token)).not.toBeNull()
        expect(await run(['--uninstall'])).toBe(0)
        expect(verifyToken(h.ctx.db, token)).toBeNull()
        fs.rmSync(home, { recursive: true, force: true })
      } finally { await h.stop() }
    })
  }
})
