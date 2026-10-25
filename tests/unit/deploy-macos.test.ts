// deploy/macos/install-hub.sh end to end on a fake macOS (deploy-lib.ts): LaunchDaemon install with sudo explained,
// power and log rotation settings, kept config, LAN address detection, trina-ax start/stop/restart/status, the
// --agent fallback without sudo, and --uninstall keeping data/ and team/. The hub really starts and answers.
import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { freePort, healthy, macBox, type MacBox } from './deploy-lib'

const REPO = path.resolve(import.meta.dir, '../..')
const SCRIPT = path.join(REPO, 'deploy/macos/install-hub.sh')
const mac = process.platform === 'darwin' && fs.existsSync('/usr/bin/plutil')
const boxes: MacBox[] = []
afterAll(() => { for (const b of boxes) b.cleanup() })

const mode = (p: string) => (fs.statSync(p).mode & 0o777).toString(8)
const plistJson = (file: string) => JSON.parse(Bun.spawnSync(['plutil', '-convert', 'json', '-o', '-', file]).stdout.toString())

describe('scripts parse', () => {
  for (const f of ['deploy/macos/install-hub.sh', 'deploy/macos/trina-ax.sh', 'deploy/linux/trina-ax']) {
    test(`bash -n ${f}`, () => {
      const r = Bun.spawnSync(['bash', '-n', path.join(REPO, f)], { stderr: 'pipe' })
      expect(r.stderr.toString()).toBe('')
      expect(r.exitCode).toBe(0)
    })
  }
  test('--help prints the Korean usage from the header', () => {
    const r = Bun.spawnSync(['bash', SCRIPT, '--help'], { stdout: 'pipe' })
    const out = r.stdout.toString()
    expect(out).toContain('--tunnel-token-file')
    expect(out).toContain('--uninstall')
    expect(out).not.toContain('set -euo')
  })
})

describe.skipIf(!mac)('install-hub.sh as a LaunchDaemon', async () => {
  if (!mac) return // bun still runs a skipped describe's body: don't set up a fake macOS on Linux
  const box = macBox({ fileVault: true })
  boxes.push(box)
  const home = path.join(box.home, 'TrinaAX')
  const port = await freePort()
  const url = `http://[::1]:${port}`
  const token = path.join(box.root, 'tunnel-token.txt')
  fs.writeFileSync(token, 'eyJ-fake-tunnel-token\n')
  const ctl = path.join(home, 'bin', 'trina-ax')
  const first = box.run(['bash', SCRIPT, '--port', String(port), '--host', '::1', '--tunnel-token-file', token])

  test('installs and the hub answers', async () => {
    if (first.code !== 0) console.log(first.out)
    expect(first.code).toBe(0)
    expect(await healthy(url)).toBe(true)
    expect(first.out).toContain('허브가 응답해요')
  })

  test('explains sudo before using it, and only for system files', () => {
    const calls = box.calls()
    const sudo = calls.filter((c) => c.startsWith('sudo '))
    expect(sudo[0]).toBe('sudo -v')
    expect(first.out).toContain('아래 일에만 sudo를 써요')
    expect(first.out).toContain('[sudo]')
    for (const c of sudo.slice(1)) {
      expect(c).toMatch(/^sudo (cp|chown|chmod|launchctl|pmset|mkdir|ln|rm|\S*socketfilterfw) /)
    }
    expect(calls).toContain('sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1')
    expect(calls.some((c) => c.startsWith(`sudo launchctl bootstrap system ${box.launchd}/app.trina-ax.hub.plist`))).toBe(true)
    expect(calls.some((c) => c.startsWith(`sudo launchctl bootstrap system ${box.launchd}/app.trina-ax.tunnel.plist`))).toBe(true)
    expect(calls.some((c) => /^sudo \S*socketfilterfw --add \//.test(c))).toBe(true)
    expect(calls.some((c) => /^sudo \S*socketfilterfw --unblockapp \//.test(c))).toBe(true)
    // never the per-user GUI domain, which fails over SSH
    expect(calls.some((c) => c.includes('bootstrap gui/'))).toBe(false)
  })

  test('the daemon plist runs as this user, through run-logged.ts, unthrottled', () => {
    const file = path.join(box.launchd, 'app.trina-ax.hub.plist')
    expect(Bun.spawnSync(['plutil', '-lint', '-s', file]).exitCode).toBe(0)
    const p = plistJson(file)
    expect(p.Label).toBe('app.trina-ax.hub')
    expect(p.UserName).toBe(os.userInfo().username)
    expect(p.ProgramArguments[1]).toBe(path.join(home, 'app/deploy/macos/run-logged.ts'))
    expect(p.ProgramArguments[2]).toBe(path.join(home, 'logs/hub.log'))
    expect(p.ProgramArguments.slice(-1)[0]).toBe(path.join(home, 'app/src/main.ts'))
    expect(p.ProgramArguments).not.toContain('--max-size') // newsyslog rotates daemon logs
    expect(p.EnvironmentVariables.TRINA_AX_HOME).toBe(home)
    expect(p.EnvironmentVariables.HOME).toBe(box.home)
    expect(p.KeepAlive).toBe(true)
    expect(p.RunAtLoad).toBe(true)
    expect(p.ProcessType).toBe('Interactive')
    expect(p.SoftResourceLimits.NumberOfFiles).toBeGreaterThanOrEqual(4096)
    const t = plistJson(path.join(box.launchd, 'app.trina-ax.tunnel.plist'))
    expect(t.ProgramArguments).toContain('--token-file')
    expect(t.ProgramArguments).toContain(path.join(home, 'data/tunnel-token'))
    expect(t.ProgramArguments[2]).toBe(path.join(home, 'logs/tunnel.log'))
  })

  test('hub output lands in logs/hub.log', () => {
    const log = fs.readFileSync(path.join(home, 'logs/hub.log'), 'utf8')
    expect(log).toContain('listening')
  })

  test('newsyslog rotates hub.log and tunnel.log', () => {
    const conf = fs.readFileSync(path.join(box.newsyslog, 'trina-ax.conf'), 'utf8')
    const me = os.userInfo().username
    for (const f of ['hub.log', 'tunnel.log']) {
      expect(conf).toMatch(new RegExp(`^${path.join(home, 'logs', f).replace(/[.]/g, '\\.')} ${me}:\\S+ 600 \\d+ \\d+ \\* N\\S*$`, 'm'))
    }
  })

  test('folder permissions and secrets', () => {
    expect(mode(home)).toBe('750')
    expect(mode(path.join(home, 'data'))).toBe('700')
    expect(mode(path.join(home, 'logs'))).toBe('700')
    expect(mode(path.join(home, 'team'))).toBe('750')
    expect(mode(path.join(home, 'data/tunnel-token'))).toBe('600')
    expect(mode(path.join(home, 'data/config.json'))).toBe('600')
    expect(fs.readFileSync(path.join(home, 'data/tunnel-token'), 'utf8')).toContain('eyJ-fake-tunnel-token')
    expect(first.out).not.toContain('eyJ-fake-tunnel-token')
  })

  test('detects the LAN address and suggests a DHCP reservation', () => {
    expect(first.out).toContain(`http://192.168.77.10:${port}`)
    expect(first.out).toContain('DHCP')
    const st = JSON.parse(box.run([ctl, 'status', '--json']).out)
    expect(st.lanUrl).toBe(`http://192.168.77.10:${port}`)
  })

  test('FileVault reminder only says what matters for a daemon', () => {
    expect(first.out).toContain('FileVault가 켜져 있어요')
    expect(first.out).toContain('로그인 없이')
    expect(first.out).not.toContain('자동으로 로그인')
  })

  test('the trina-ax command is installed and linked', () => {
    const text = fs.readFileSync(ctl, 'utf8')
    expect(text).not.toContain('@@')
    expect(text).toContain("MODE='daemon'")
    expect(fs.readlinkSync(path.join(box.link, 'trina-ax'))).toBe(ctl)
  })

  test('status shows both services', () => {
    const r = box.run([ctl, 'status'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/서비스 허브: running \(pid \d+\)/)
    expect(r.out).toMatch(/서비스 터널: running/)
    expect(r.out).toContain('응답해요')
  })

  test('stop really stops (bootout, not a kill that KeepAlive undoes); start and restart bring it back', async () => {
    const stop = box.run([ctl, 'stop'])
    expect(stop.code).toBe(0)
    expect(stop.out).toContain('[sudo]')
    expect(box.calls()).toContain('sudo launchctl bootout system/app.trina-ax.hub')
    expect(await healthy(url)).toBe(false)
    expect(box.run([ctl, 'status']).out).toContain('서비스 허브: 꺼짐')

    const start = box.run([ctl, 'start'])
    expect(start.code).toBe(0)
    expect(await healthy(url)).toBe(true)

    const pidBefore = box.run(['launchctl', 'print', 'system/app.trina-ax.hub']).out.match(/pid = (\d+)/)?.[1]
    const restart = box.run([ctl, 'restart', 'hub'])
    expect(restart.code).toBe(0)
    expect(box.calls()).toContain('sudo launchctl kickstart -k system/app.trina-ax.hub')
    const pidAfter = box.run(['launchctl', 'print', 'system/app.trina-ax.hub']).out.match(/pid = (\d+)/)?.[1]
    expect(pidAfter).toBeDefined()
    expect(pidAfter).not.toBe(pidBefore)
    expect(await healthy(url)).toBe(true)
  })

  test('re-running keeps host, port, saved addresses and other config', async () => {
    const cfgFile = path.join(home, 'data/config.json')
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
    fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, hubConcurrency: 3 }))
    expect(box.run([ctl, 'set-url', '--public', 'https://acme.example.com']).code).toBe(0)
    fs.writeFileSync(path.join(home, 'team', 'keep.txt'), 'company file')
    const again = box.run(['bash', SCRIPT])
    if (again.code !== 0) console.log(again.out)
    expect(again.code).toBe(0)
    const after = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
    expect(after.host).toBe('::1')
    expect(after.port).toBe(port)
    expect(after.hubConcurrency).toBe(3)
    const st = JSON.parse(box.run([ctl, 'status', '--json']).out)
    expect(st.publicUrl).toBe('https://acme.example.com')
    expect(st.lanUrl).toBe(`http://192.168.77.10:${port}`)
    expect(fs.readFileSync(path.join(home, 'team', 'keep.txt'), 'utf8')).toBe('company file')
    // the tunnel stays installed from the saved token
    expect(fs.existsSync(path.join(box.launchd, 'app.trina-ax.tunnel.plist'))).toBe(true)
    expect(await healthy(url)).toBe(true)
  })

  test('a bad address stops the update before anything is touched', async () => {
    const r = box.run(['bash', SCRIPT, '--public-url', 'http://insecure.example.com'])
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('https://')
    expect(await healthy(url)).toBe(true)
  })

  test('--uninstall removes services, plists, rotation config and app/, keeps data/ and team/', async () => {
    const r = box.run(['bash', SCRIPT, '--uninstall', '--yes'])
    if (r.code !== 0) console.log(r.out)
    expect(r.code).toBe(0)
    expect(await healthy(url)).toBe(false)
    expect(fs.existsSync(path.join(box.launchd, 'app.trina-ax.hub.plist'))).toBe(false)
    expect(fs.existsSync(path.join(box.launchd, 'app.trina-ax.tunnel.plist'))).toBe(false)
    expect(fs.existsSync(path.join(box.newsyslog, 'trina-ax.conf'))).toBe(false)
    expect(fs.existsSync(path.join(box.link, 'trina-ax'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'app'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'bin'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'data/hub.db'))).toBe(true)
    expect(fs.readFileSync(path.join(home, 'team', 'keep.txt'), 'utf8')).toBe('company file')
    expect(r.out).toContain(path.join(home, 'data'))
    expect(r.out).toContain('--uninstall') // reminds to disconnect every PC first
  })
})

describe.skipIf(!mac)('install-hub.sh --agent (no sudo)', async () => {
  if (!mac) return // bun still runs a skipped describe's body: don't set up a fake macOS on Linux
  const box = macBox({ firewall: false })
  boxes.push(box)
  const home = path.join(box.home, 'TrinaAX')
  const port = await freePort()
  // over SSH: no GUI session, so the gui/<uid> domain refuses bootstrap
  const r = box.run(['bash', SCRIPT, '--agent', '--port', String(port), '--host', '127.0.0.1'], { FAKE_NO_GUI: '1' })

  test('installs a LaunchAgent in the user domain, never calls sudo', async () => {
    if (r.code !== 0) console.log(r.out)
    expect(r.code).toBe(0)
    expect(box.calls().some((c) => c.startsWith('sudo'))).toBe(false)
    expect(box.calls().some((c) => c.startsWith('pmset'))).toBe(false)
    const plist = path.join(box.home, 'Library/LaunchAgents/app.trina-ax.hub.plist')
    const p = plistJson(plist)
    expect(p.UserName).toBeUndefined()
    expect(p.ProgramArguments).toContain('--max-size') // no newsyslog without sudo: rotate in run-logged.ts
    expect(box.calls()).toContain(`launchctl bootstrap user/${process.getuid!()} ${plist}`)
    expect(await healthy(`http://127.0.0.1:${port}`)).toBe(true)
    expect(r.out).toContain('로그인해야 켜져요')
    expect(r.out).toContain('자동으로 로그인')
    // 127.0.0.1 only: no LAN address guessed
    expect(r.out).not.toContain('192.168.77.10')
  })

  test('trina-ax stop/start work in whichever user domain it is in', async () => {
    const ctl = path.join(home, 'bin', 'trina-ax')
    const env = { FAKE_NO_GUI: '1' }
    expect(box.run([ctl, 'stop'], env).code).toBe(0)
    expect(box.calls()).toContain(`launchctl bootout user/${process.getuid!()}/app.trina-ax.hub`)
    expect(await healthy(`http://127.0.0.1:${port}`)).toBe(false)
    expect(box.run([ctl, 'start'], env).code).toBe(0)
    expect(await healthy(`http://127.0.0.1:${port}`)).toBe(true)
    expect(box.calls().some((c) => c.startsWith('sudo'))).toBe(false)
  })

  test('refuses to switch a daemon install to --agent silently', () => {
    fs.writeFileSync(path.join(box.launchd, 'app.trina-ax.hub.plist'), '<plist/>')
    const again = box.run(['bash', SCRIPT, '--agent'], { FAKE_NO_GUI: '1' })
    expect(again.code).not.toBe(0)
    expect(again.out).toContain('--uninstall')
    fs.rmSync(path.join(box.launchd, 'app.trina-ax.hub.plist'))
  })

  test('--uninstall without daemons needs no sudo', async () => {
    const u = box.run(['bash', SCRIPT, '--uninstall', '--yes'], { FAKE_NO_GUI: '1' })
    expect(u.code).toBe(0)
    expect(box.calls().some((c) => c.startsWith('sudo'))).toBe(false)
    expect(fs.existsSync(path.join(box.home, 'Library/LaunchAgents/app.trina-ax.hub.plist'))).toBe(false)
    expect(await healthy(`http://127.0.0.1:${port}`)).toBe(false)
    expect(fs.existsSync(path.join(home, 'data'))).toBe(true)
  })
})

describe.skipIf(!mac)('upgrading an old LaunchAgent install', async () => {
  if (!mac) return // bun still runs a skipped describe's body: don't set up a fake macOS on Linux
  const box = macBox({ firewall: false })
  boxes.push(box)
  const uid = process.getuid!()
  // what the previous install-hub.sh left behind: a per-user agent, running
  const agents = path.join(box.home, 'Library/LaunchAgents')
  fs.mkdirSync(agents, { recursive: true })
  const old = path.join(agents, 'app.trina-ax.hub.plist')
  fs.writeFileSync(old, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>app.trina-ax.hub</string>
<key>ProgramArguments</key><array><string>/bin/sleep</string><string>600</string></array>
<key>WorkingDirectory</key><string>/</string><key>KeepAlive</key><true/></dict></plist>
`)
  box.run(['launchctl', 'bootstrap', `gui/${uid}`, old])
  const oldPid = Number(fs.readFileSync(path.join(box.state, `gui_${uid}_app.trina-ax.hub.pid`), 'utf8'))
  const port = await freePort()
  const r = box.run(['bash', SCRIPT, '--port', String(port), '--host', '127.0.0.1', '--no-power'])

  test('the old agent is stopped and removed, the daemon takes over', async () => {
    if (r.code !== 0) console.log(r.out)
    expect(r.code).toBe(0)
    expect(r.out).toContain('예전 방식(LaunchAgent)')
    expect(box.calls()).toContain(`launchctl bootout gui/${uid}/app.trina-ax.hub`)
    expect(fs.existsSync(old)).toBe(false)
    let alive = true
    try { process.kill(oldPid, 0) } catch { alive = false }
    expect(alive).toBe(false)
    expect(fs.existsSync(path.join(box.launchd, 'app.trina-ax.hub.plist'))).toBe(true)
    expect(box.calls().some((c) => c.startsWith('sudo pmset'))).toBe(false) // --no-power
    expect(await healthy(`http://127.0.0.1:${port}`)).toBe(true)
    expect(box.run(['bash', SCRIPT, '--uninstall', '--yes']).code).toBe(0)
  })
})

describe('refuses unsafe runs', () => {
  test('not as root, not with odd paths', () => {
    const r = Bun.spawnSync(['bash', SCRIPT, '--home', '/tmp/has space/x'], { stdout: 'pipe', stderr: 'pipe' })
    if (process.platform === 'darwin' && process.getuid!() !== 0) {
      expect(r.exitCode).not.toBe(0)
      expect(r.stderr.toString()).toContain('공백')
    }
  })
})

describe('linux unit', () => {
  const unit = fs.readFileSync(path.join(REPO, 'deploy/linux/trina-ax.service'), 'utf8')
  test('restarts forever, logs to journald, writes only data and team', () => {
    expect(unit).toMatch(/^Restart=always$/m)
    expect(unit).toMatch(/^StartLimitIntervalSec=0$/m)
    expect(unit).toMatch(/^StandardOutput=journal$/m)
    expect(unit).toMatch(/^WorkingDirectory=\/srv\/trina-ax\/app$/m)
    expect(unit).toMatch(/^ReadWritePaths=\/srv\/trina-ax\/data \/srv\/trina-ax\/team$/m)
    expect(unit).toMatch(/^ProtectSystem=strict$/m)
    // the listening address comes from config.json, not a hard-coded environment override
    expect(unit).not.toMatch(/^Environment=TRINA_AX_HOST=/m)
  })
})
