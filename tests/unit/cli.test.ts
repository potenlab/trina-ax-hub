// src/cli.ts against a real test hub (same folder layout as TRINA_AX_HOME), a fake Anthropic upstream and a fake
// `claude`: URL rules and storage shared with the settings page, readable temporary passwords, one-line errors,
// users/doctor/backup/logs/ping/status, and that no key ever reaches the output.
import { afterAll, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { getSetting } from '../../src/db'
import { getUserByUsername, verifyPassword } from '../../src/auth/users'
import { createSession } from '../../src/auth/sessions'
import { checkUrls, parseArgs } from '../../src/cli'

const CLI = path.resolve(import.meta.dir, '../../src/cli.ts')
const KEY = 'sk-ant-api03-test-KEY-abcdefghijklmnop-9876'
const TEMP_PW = /^[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trina-cli-')))
const fakeHome = path.join(tmp, 'home')
fs.mkdirSync(fakeHome)
const fakeClaude = path.join(tmp, 'claude')
fs.writeFileSync(fakeClaude, '#!/bin/bash\necho "2.1.309 (Claude Code)"\n', { mode: 0o755 })

let upstreamCalls = 0
const upstream = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  fetch(req) {
    upstreamCalls++
    if (new URL(req.url).pathname !== '/v1/models') return new Response('nope', { status: 404 })
    if (req.headers.get('x-api-key') !== KEY) return Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 })
    return Response.json({ data: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-5-5' }] })
  },
})

let hub: TestHub
afterAll(async () => { upstream.stop(true); await hub?.stop(); fs.rmSync(tmp, { recursive: true, force: true }) })

async function cli(args: string[], o: { stdin?: string; env?: Record<string, string>; home?: string } = {}) {
  // async: the test hub and the fake upstream live in this process and must keep answering while the CLI runs
  const p = Bun.spawn(['bun', CLI, ...args], {
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: fakeHome, LANG: 'en_US.UTF-8',
      TRINA_AX_HOME: o.home ?? hub.dir, TRINA_AX_HOST: '127.0.0.1', TRINA_AX_PORT: String(hub.ctx.config.port),
      TRINA_AX_UPSTREAM: `http://127.0.0.1:${upstream.port}`, TRINA_AX_CLAUDE_BIN: fakeClaude,
      ...o.env,
    },
    stdin: o.stdin !== undefined ? new Blob([o.stdin]) : 'ignore', stdout: 'pipe', stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, out, err, all: out + err }
}
const noStack = (s: string) => { expect(s).not.toMatch(/^\s+at /m); expect(s).not.toContain('HttpError') }

describe('cli', async () => {
  hub = await testHub()
  const db = hub.ctx.db

  test('help: every command, in Korean, also as <cmd> --help', async () => {
    const r = await cli(['help'])
    expect(r.code).toBe(0)
    for (const c of ['start', 'stop', 'restart', 'status', 'logs', 'users', 'doctor', 'backup', 'set-url', 'user-add', 'reset-password', 'enroll', 'set-key', 'remove-key', 'init']) expect(r.out).toContain(c)
    const d = await cli(['doctor', '--help'])
    expect(d.code).toBe(0)
    expect(d.out).toContain('점검')
    expect((await cli(['help', 'backup'])).out).toContain('VACUUM INTO')
    expect((await cli([])).out).toContain('사용법')
  })

  test('unknown command or option: one line, exit 1', async () => {
    const r = await cli(['frobnicate'])
    expect(r.code).toBe(1)
    expect(r.err.trim().split('\n')).toHaveLength(1)
    const o = await cli(['users', '--nope'])
    expect(o.code).toBe(1)
    expect(o.err).toContain('모르는 옵션')
    expect((await cli(['start'])).err).toContain('설치된 trina-ax')
  })

  test('set-url: https and not loopback for the public address, same storage as the settings page', async () => {
    const bad = await cli(['set-url', '--public', 'http://acme.example.com'])
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('https://')
    noStack(bad.all)
    const loop = await cli(['set-url', '--public', 'https://127.0.0.1:8443'])
    expect(loop.code).toBe(1)
    expect(loop.err).toContain('localhost')
    const path_ = await cli(['set-url', '--public', 'https://acme.example.com/hub'])
    expect(path_.code).toBe(1)
    const lanLoop = await cli(['set-url', '--lan', 'http://localhost:47900'])
    expect(lanLoop.code).toBe(1)

    const dry = await cli(['set-url', '--dry-run', '--public', 'https://acme.example.com/'])
    expect(dry.code).toBe(0)
    expect(getSetting<string | null>(db, 'publicUrl', null)).toBeNull()

    const ok = await cli(['set-url', '--public', 'https://acme.example.com/', '--lan', 'http://192.168.0.10:47900'])
    expect(ok.code).toBe(0)
    expect(ok.out).toContain('trina-ax restart')
    expect(getSetting<string | null>(db, 'publicUrl', null)).toBe('https://acme.example.com')
    expect(getSetting<string | null>(db, 'lanUrl', null)).toBe('http://192.168.0.10:47900')
    expect((await cli(['set-url'])).out).toContain('https://acme.example.com')

    const clear = await cli(['set-url', '--public', ''])
    expect(clear.code).toBe(0)
    expect(getSetting<string | null>(db, 'publicUrl', 'x')).toBeNull()
    expect(clear.out).toContain('http://192.168.0.10:47900')
    await cli(['set-url', '--lan', ''])
  })

  test('checkUrls / parseArgs', async () => {
    expect(checkUrls({ public: 'https://a.example.com/' })).toEqual({ publicUrl: 'https://a.example.com' })
    expect(checkUrls({ lan: 'http://10.0.0.5:47900' })).toEqual({ lanUrl: 'http://10.0.0.5:47900' })
    expect(checkUrls({ public: '' })).toEqual({ publicUrl: null })
    expect(() => checkUrls({ public: 'https://localhost' })).toThrow('localhost')
    expect(() => checkUrls({ public: 'https://[::1]:443' })).toThrow()
    expect(parseArgs(['--public=https://x.example.com', 'a'], { values: ['--public'] }).opts.get('--public')).toBe('https://x.example.com')
    expect(() => parseArgs(['--public'], { values: ['--public'] })).toThrow()
  })

  test('user-add: readable temporary password once, must change; duplicate is a one-line error', async () => {
    const r = await cli(['user-add', 'gildong', '홍길동'])
    expect(r.code).toBe(0)
    const pw = /임시 비밀번호\s+(\S+)/.exec(r.out)?.[1] ?? ''
    expect(pw).toMatch(TEMP_PW)
    const u = getUserByUsername(db, 'gildong')!
    expect(u.name).toBe('홍길동')
    expect(u.role).toBe('member')
    expect(u.mustChangePassword).toBe(true)
    expect(await verifyPassword(u.passwordHash, pw)).toBe(true)
    expect(r.out).toContain('/login')

    const dup = await cli(['user-add', 'gildong'])
    expect(dup.code).toBe(1)
    expect(dup.err.trim()).toBe('이미 있는 아이디예요.')
    noStack(dup.all)

    const admin = await cli(['user-add', 'boss2', '관리자님', '--admin'])
    expect(admin.code).toBe(0)
    expect(getUserByUsername(db, 'boss2')!.role).toBe('admin')
    expect((await cli(['user-add', '!bad'])).err).toContain('아이디는')
  })

  test('users lists people with role and state', async () => {
    const r = await cli(['users'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('gildong')
    expect(r.out).toContain('홍길동')
    expect(r.out).toContain('첫 로그인 전')
    expect(r.out).toContain('소유자')
  })

  test('reset-password: new readable password, web sessions end', async () => {
    const u = getUserByUsername(db, 'gildong')!
    createSession(db, u.id)
    const r = await cli(['reset-password', 'gildong'])
    expect(r.code).toBe(0)
    const pw = /임시 비밀번호: (\S+)/.exec(r.out)?.[1] ?? ''
    expect(pw).toMatch(TEMP_PW)
    expect(await verifyPassword(getUserByUsername(db, 'gildong')!.passwordHash, pw)).toBe(true)
    expect((db.query('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(u.id) as { n: number }).n).toBe(0)
    expect((await cli(['reset-password', 'nobody'])).err).toContain('없는 아이디')
  })

  test('enroll: one-time code and both install commands', async () => {
    const r = await cli(['enroll', 'gildong'])
    expect(r.code).toBe(0)
    const code = /([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(r.out)?.[1]
    expect(code).toBeDefined()
    expect(r.out).toContain(`/install.sh | bash -s -- ${code}`)
    expect(r.out).toContain(`/install.ps1))) ${code}`)
  })

  test('set-key from stdin: stored 0600, never printed; remove-key', async () => {
    const r = await cli(['set-key'], { stdin: KEY + '\n' })
    expect(r.code).toBe(0)
    expect(r.all).not.toContain(KEY)
    expect(r.out).toContain('…9876')
    const f = path.join(hub.dir, 'data/secrets/anthropic-api-key')
    expect(fs.readFileSync(f, 'utf8').trim()).toBe(KEY)
    expect((fs.statSync(f).mode & 0o777).toString(8)).toBe('600')
    expect((await cli(['set-key'], { stdin: 'has space\n' })).code).toBe(1)
  })

  test('status and status --json (no key, no token)', async () => {
    const r = await cli(['status'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('응답해요')
    expect(r.out).toContain('…9876')
    const j = JSON.parse((await cli(['status', '--json'])).out)
    expect(j.server.running).toBe(true)
    expect(j.apiKey).toBe(true)
    expect(j.port).toBe(hub.ctx.config.port)
    expect(JSON.stringify(j)).not.toContain(KEY)
  })

  test('ping: answers now, fails fast on a dead port', async () => {
    expect((await cli(['ping'])).code).toBe(0)
    const dead = await cli(['ping', '--wait', '0'], { env: { TRINA_AX_PORT: '9' } })
    expect(dead.code).toBe(1)
    expect(dead.err).toContain('응답하지 않아요')
  })

  test('doctor --live: every check, the key checked upstream, never printed', async () => {
    const before = upstreamCalls
    const r = await cli(['doctor', '--live'], { env: { TRINA_AX_PUBLIC_URL: hub.url } })
    expect(upstreamCalls).toBe(before + 1)
    expect(r.all).not.toContain(KEY)
    for (const what of ['서버', 'API 키', '공개 주소', '공개 경로', 'claude', '디스크', 'DB', '팀 폴더']) expect(r.out).toContain(what)
    expect(r.out).toContain('모델 2개')
    expect(r.out).toContain('2.1.309')
    expect(r.out).toContain('이상 없어요')
    expect(r.out).toMatch(/✓ 공개 경로/)
    expect(r.out).toMatch(/! 공개 주소\s+\S+ 가 https가 아니에요/)
    expect(r.code).toBe(0)
  }, 30_000)

  test('doctor: a wrong key and a dead server are problems (exit 1)', async () => {
    fs.writeFileSync(path.join(hub.dir, 'data/secrets/anthropic-api-key'), 'sk-ant-wrong-key-0000000000000000\n', { mode: 0o600 })
    const r = await cli(['doctor', '--live'], { env: { TRINA_AX_PORT: '9' } })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/✗ 서버/)
    expect(r.out).toContain('키가 맞지 않아요')
    expect(r.all).not.toContain('sk-ant-wrong')
    await cli(['set-key'], { stdin: KEY })
  }, 30_000)

  test('backup: consistent DB copy, secrets 0600, team with --with-team, restore steps', async () => {
    hub.write('공유/보고서.md', '# 회사 문서')
    const out = path.join(tmp, 'backups')
    const r = await cli(['backup', out, '--with-team'])
    expect(r.code).toBe(0)
    const dest = fs.readdirSync(out).map((d) => path.join(out, d))[0]!
    expect((fs.statSync(dest).mode & 0o777).toString(8)).toBe('700')
    const copy = new Database(path.join(dest, 'data/hub.db'), { readonly: true })
    expect((copy.query('PRAGMA quick_check').get() as any).quick_check).toBe('ok')
    expect((copy.query("SELECT COUNT(*) AS n FROM users WHERE username = 'gildong'").get() as any).n).toBe(1)
    copy.close()
    expect((fs.statSync(path.join(dest, 'data/hub.db')).mode & 0o777).toString(8)).toBe('600')
    expect((fs.statSync(path.join(dest, 'data/secrets')).mode & 0o777).toString(8)).toBe('700')
    const key = path.join(dest, 'data/secrets/anthropic-api-key')
    expect((fs.statSync(key).mode & 0o777).toString(8)).toBe('600')
    expect(fs.readFileSync(path.join(dest, 'team/공유/보고서.md'), 'utf8')).toBe('# 회사 문서')
    const restore = fs.readFileSync(path.join(dest, 'RESTORE.txt'), 'utf8')
    expect(restore).toContain('trina-ax stop')
    expect(restore).toContain('trina-ax doctor')
    expect(r.out).toContain('되살리기')
    expect(r.all).not.toContain(KEY)
    // never inside the hub's own folders
    expect((await cli(['backup', path.join(hub.dir, 'team', 'x')])).code).toBe(1)
  })

  test('pricing: check, set with the relay\'s rules, reset', async () => {
    const unknown = await cli(['pricing', 'check', 'claude-sonnet-6'])
    expect(unknown.out).toContain('가장 비싼 가격')
    const file = path.join(tmp, 'prices.json')
    fs.writeFileSync(file, JSON.stringify([{ match: '^claude-sonnet-6(-\\d{8})?$', input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 }]))
    expect((await cli(['pricing', 'set', file])).code).toBe(0)
    expect(getSetting<unknown[]>(db, 'pricing', []).length).toBe(1)
    const known = await cli(['pricing', 'check', 'claude-sonnet-6-20270101'])
    expect(known.out).toContain('입력 3 · 출력 15')
    expect(known.out).not.toContain('가장 비싼')
    fs.writeFileSync(file, JSON.stringify([{ match: '([', input: 1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 }]))
    const bad = await cli(['pricing', 'set', file])
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('정규식')
    fs.writeFileSync(file, JSON.stringify([{ match: 'x', input: -1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 }]))
    expect((await cli(['pricing', 'set', file])).err).toContain('input')
    expect(getSetting<unknown[]>(db, 'pricing', []).length).toBe(1)
    expect((await cli(['pricing', 'reset'])).code).toBe(0)
    expect(getSetting<unknown[]>(db, 'pricing', ['x']).length).toBe(0)
  })

  test('logs: the last lines of logs/hub.log', async () => {
    fs.mkdirSync(path.join(hub.dir, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(hub.dir, 'logs/hub.log'), ['one', 'two', 'three'].join('\n') + '\n')
    const r = await cli(['logs', '-n', '2'])
    expect(r.code).toBe(0)
    expect(r.out).toBe('two\nthree\n')
    // no tunnel.log: macOS has nothing else to show (1); Linux with systemd shows the journal instead (journalctl, 0)
    const journal = process.platform === 'linux' && !!Bun.which('journalctl')
    expect((await cli(['logs', '--tunnel'])).code).toBe(journal ? 0 : 1)
  })

  test('init on a fresh home: owner from stdin; refuses a second owner', async () => {
    const home = path.join(tmp, 'fresh')
    const env = { TRINA_AX_PORT: '9' }
    const st = await cli(['status'], { home, env })
    expect(st.out).toContain('/setup?t=')
    const r = await cli(['init', '--username', 'boss', '--name', '대표', '--company', '에이크미'], { home, env, stdin: 'owner-password-1\n' })
    expect(r.code).toBe(0)
    const fresh = new Database(path.join(home, 'data/hub.db'), { readonly: true })
    expect((fresh.query("SELECT role FROM users WHERE username = 'boss'").get() as any).role).toBe('owner')
    fresh.close()
    expect(fs.existsSync(path.join(home, 'data/secrets/setup-token'))).toBe(false)
    const again = await cli(['init', '--username', 'x'], { home, env, stdin: 'owner-password-1\n' })
    expect(again.code).toBe(1)
    expect(again.err).toContain('이미 소유자')
    const short = await cli(['init', '--username', 'yy'], { home: path.join(tmp, 'fresh2'), env, stdin: 'short\n' })
    expect(short.code).toBe(1)
    expect(short.err).toContain('8자')
    noStack(short.all)
  })
})
