// The real thing: Claude Code (~/.local/bin/claude) installs and updates the "company" plugin from a test hub that is
// reachable over https through a Cloudflare quick tunnel, and the real install.sh connects a fresh HOME.
//
// Safety: every `claude` run gets a temp HOME and CLAUDE_CONFIG_DIR (never this Mac's own login or settings), its
// model base URL points at the test hub, and all its outside traffic goes through an egress guard that only lets the
// tunnel host through, so nothing can reach api.anthropic.com. The hub holds test data only.
//
// Skips (with the reason printed) when claude or cloudflared is missing or the tunnel does not come up in 60 s.
import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { setRule } from '../../src/policy/rules-admin'
import { makeEnrollCode } from '../../src/auth/enroll'
import { verifyToken } from '../../src/auth/tokens'
import { loadPrincipal, type Principal } from '../../src/policy/access'
import { pluginFor } from '../../src/skills/marketplace'
import {
  CLAUDE_BIN, egressGuard, findCloudflared, quickTunnel, run, sandboxEnv, walk, type EgressGuard, type Tunnel,
} from './marketplace-helpers'

const why: string[] = []
if (!fs.existsSync(CLAUDE_BIN)) why.push(`${CLAUDE_BIN} not found`)
const cloudflared = findCloudflared()
if (!cloudflared) why.push('cloudflared not found')

let hub: TestHub | null = null
let tunnel: Tunnel | null = null
let guard: EgressGuard | null = null
if (!why.length) {
  hub = await testHub()
  tunnel = await quickTunnel(cloudflared!, Number(new URL(hub.url).port), 60_000, why)
  if (tunnel) {
    hub.ctx.config.publicUrl = tunnel.url
    const host = new URL(tunnel.url).hostname
    guard = await egressGuard((h) => h === host)
  }
}
const ready = !!(hub && tunnel && guard)
if (!ready) console.warn(`[e2e marketplace-claude] skipped: ${why.join('; ')}`)

const homes: string[] = []
afterAll(async () => {
  if (guard?.blocked.length) console.warn('[e2e marketplace-claude] egress guard blocked:', [...new Set(guard.blocked)].join(', '))
  guard?.stop()
  tunnel?.stop()
  await hub?.stop()
  for (const h of homes) fs.rmSync(h, { recursive: true, force: true })
})

/** A fresh HOME whose PATH has only `claude` (a link to the real binary) and the system tools. */
function freshHome() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trina-e2e-home-')))
  homes.push(home)
  const configDir = path.join(home, '.claude')
  fs.mkdirSync(configDir)
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin)
  fs.symlinkSync(fs.realpathSync(CLAUDE_BIN), path.join(bin, 'claude'))
  const env = sandboxEnv({ home, configDir, baseUrl: hub!.url, proxy: guard!.url, extraPath: [bin] })
  const claude = (args: string[], extra: Record<string, string> = {}) => run([path.join(bin, 'claude'), ...args], { ...env, ...extra }, home, 180_000)
  const plugins = async () => {
    const r = await claude(['plugin', 'list', '--json'])
    expect(r.code).toBe(0)
    return JSON.parse(r.stdout) as { id: string; version: string; installPath: string }[]
  }
  return { home, configDir, env, claude, plugins }
}

const show = (r: { code: number; stdout: string; stderr: string }) =>
  `exit ${r.code}\n${r.stdout.slice(-1500)}\n${r.stderr.slice(-1500)}`.replace(/tax_[A-Za-z0-9_-]+/g, 'tax_***')

describe.skipIf(!ready)('real Claude Code against the hub over a Cloudflare tunnel', () => {
  let parkToken = ''
  let park: Principal
  let shell: ReturnType<typeof freshHome>

  test('settings with the marketplace (url + Bearer header + autoUpdate) install the plugin with the team skills', async () => {
    const h = hub!
    const sales = h.group('영업')
    const u = await h.user('park', { groups: [sales.id] })
    park = loadPrincipal(h.ctx.db, u.id)!
    h.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: "견적서 초안을 만든다"\n---\n# 견적 v1\n')
    h.write('skills/company/quote/templates/견적서.md', '# 견적서 양식\n')
    h.write('skills/sales/pitch/SKILL.md', '---\nname: pitch\ndescription: 영업 제안서\n---\n# pitch\n')
    setRule(h.ctx.db, 'skills/sales', 'everyone', null, 'none')
    setRule(h.ctx.db, 'skills/sales', 'group', sales.id, 'read')
    h.ctx.rulesChanged()
    parkToken = h.token(u.id)

    shell = freshHome()
    fs.writeFileSync(path.join(shell.configDir, 'settings.json'), JSON.stringify({
      env: { ANTHROPIC_BASE_URL: h.url, ANTHROPIC_AUTH_TOKEN: parkToken },
      extraKnownMarketplaces: {
        'trina-ax': {
          source: { source: 'url', url: `${tunnel!.url}/plugins/marketplace.json`, headers: { Authorization: `Bearer ${parkToken}` } },
          autoUpdate: true,
        },
      },
      enabledPlugins: { 'company@trina-ax': true },
    }, null, 2))

    // Claude Code registers settings-declared marketplaces at session start; /cost is answered locally
    const sync = await shell.claude(['-p', '/cost', '--no-session-persistence', '--setting-sources', 'user'], { CLAUDE_CODE_SYNC_PLUGIN_INSTALL: '1' })
    expect(sync.code, show(sync)).toBe(0)
    const install = await shell.claude(['plugin', 'install', 'company@trina-ax', '--scope', 'user'])
    expect(install.code, show(install)).toBe(0)

    const expected = pluginFor(h.ctx, park).sha12
    const p = (await shell.plugins()).find((x) => x.id === 'company@trina-ax')
    expect(p, 'plugin list').toBeDefined()
    expect(p!.version).toBe(expected)
    expect(p!.installPath.startsWith(shell.configDir)).toBe(true)
    expect(fs.readFileSync(path.join(p!.installPath, 'skills/quote/SKILL.md'), 'utf8')).toContain('# 견적 v1')
    expect(fs.readFileSync(path.join(p!.installPath, 'skills/quote/templates/견적서.md'), 'utf8')).toBe('# 견적서 양식\n')
    expect(fs.existsSync(path.join(p!.installPath, 'skills/pitch/SKILL.md'))).toBe(true)
    expect(walk(shell.configDir).some((f) => f.startsWith('plugins/cache/trina-ax/company/'))).toBe(true)
    expect(guard!.seen.some((s) => s.startsWith(new URL(tunnel!.url).hostname))).toBe(true)
  }, 300_000)

  test('a changed skill arrives with `plugin marketplace update` + `plugin update`', async () => {
    const h = hub!
    expect(parkToken).not.toBe('')
    h.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: "견적서 초안을 만든다"\n---\n# 견적 v2\n')
    const expected = pluginFor(h.ctx, park).sha12
    const mu = await shell.claude(['plugin', 'marketplace', 'update', 'trina-ax'])
    expect(mu.code, show(mu)).toBe(0)
    const pu = await shell.claude(['plugin', 'update', 'company@trina-ax'])
    expect(pu.code, show(pu)).toBe(0)
    const p = (await shell.plugins()).find((x) => x.id === 'company@trina-ax')!
    expect(p.version).toBe(expected)
    expect(fs.readFileSync(path.join(p.installPath, 'skills/quote/SKILL.md'), 'utf8')).toContain('# 견적 v2')
  }, 300_000)

  test('install.sh (curl | bash) connects a fresh HOME, and --uninstall undoes it', async () => {
    const h = hub!
    const lee = await h.user('lee')
    const { code } = makeEnrollCode(h.ctx.db, lee.id, h.owner.id)
    const pc = freshHome()
    fs.writeFileSync(path.join(pc.configDir, 'settings.json'), JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls)'] } }, null, 2))
    const curlBash = (args: string) => run(['/bin/bash', '-c', `curl -fsSL "$1/install.sh" | bash -s -- ${args}`, '_', tunnel!.url], pc.env, pc.home, 300_000)

    const r = await curlBash(code)
    expect(r.code, show(r)).toBe(0)
    expect(r.stdout + r.stderr).not.toMatch(/tax_[A-Za-z0-9_-]{10,}/)
    expect(r.stdout).toContain('회사 스킬(플러그인 company@trina-ax)을 설치했어요')

    const s = JSON.parse(fs.readFileSync(path.join(pc.configDir, 'settings.json'), 'utf8'))
    const token = s.env.ANTHROPIC_AUTH_TOKEN as string
    expect(verifyToken(h.ctx.db, token)?.user.id).toBe(lee.id)
    expect(s.theme).toBe('dark')
    expect(s.permissions).toEqual({ allow: ['Bash(ls)'] })
    expect(s.env.ANTHROPIC_BASE_URL).toBe(tunnel!.url)
    expect(s.enabledPlugins).toEqual({ 'company@trina-ax': true })
    expect(s.extraKnownMarketplaces['trina-ax']).toEqual({
      source: { source: 'url', url: `${tunnel!.url}/plugins/marketplace.json`, headers: { Authorization: `Bearer ${token}` } },
      autoUpdate: true,
    })
    const state = JSON.parse(fs.readFileSync(path.join(pc.configDir, '.claude.json'), 'utf8'))
    expect(state.mcpServers?.trina).toEqual({ type: 'http', url: `${tunnel!.url}/mcp`, headers: { Authorization: `Bearer ${token}` } })
    const p = (await pc.plugins()).find((x) => x.id === 'company@trina-ax')
    expect(p?.version).toBe(pluginFor(h.ctx, loadPrincipal(h.ctx.db, lee.id)!).sha12)
    expect(fs.readFileSync(path.join(p!.installPath, 'skills/quote/SKILL.md'), 'utf8')).toContain('# 견적 v2')
    expect(fs.existsSync(path.join(p!.installPath, 'skills/pitch/SKILL.md'))).toBe(false) // lee is not in 영업

    // running it again with a new code rotates the token: the old one is revoked and Claude Code keeps working
    const again = await curlBash(makeEnrollCode(h.ctx.db, lee.id, h.owner.id).code)
    expect(again.code, show(again)).toBe(0)
    const token2 = JSON.parse(fs.readFileSync(path.join(pc.configDir, 'settings.json'), 'utf8')).env.ANTHROPIC_AUTH_TOKEN as string
    expect(token2).not.toBe(token)
    expect(verifyToken(h.ctx.db, token)).toBeNull()
    const mu = await pc.claude(['plugin', 'marketplace', 'update', 'trina-ax'])
    expect(mu.code, show(mu)).toBe(0)
    expect((await pc.plugins()).some((x) => x.id === 'company@trina-ax')).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(pc.configDir, '.claude.json'), 'utf8')).mcpServers.trina.headers).toEqual({ Authorization: `Bearer ${token2}` })

    const u = await curlBash('--uninstall')
    expect(u.code, show(u)).toBe(0)
    expect(verifyToken(h.ctx.db, token2)).toBeNull()
    const after = JSON.parse(fs.readFileSync(path.join(pc.configDir, 'settings.json'), 'utf8'))
    expect(after).toEqual({ theme: 'dark', permissions: { allow: ['Bash(ls)'] } })
    expect(JSON.parse(fs.readFileSync(path.join(pc.configDir, '.claude.json'), 'utf8')).mcpServers?.trina).toBeUndefined()
    // claude needs some login to run; give it a placeholder that only reaches the test hub
    const left = await pc.claude(['plugin', 'list', '--json'], { ANTHROPIC_AUTH_TOKEN: 'tax_placeholder' })
    expect(left.code, show(left)).toBe(0)
    expect(JSON.parse(left.stdout).some((x: { id: string }) => x.id === 'company@trina-ax')).toBe(false)
  }, 600_000)
})
