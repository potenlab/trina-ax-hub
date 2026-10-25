// A fake macOS for deploy/macos/install-hub.sh: fake `sudo`, `launchctl`, `pmset`, `fdesetup`, `ipconfig`, `route`,
// `brew`, `cloudflared` and the firewall tool on PATH, recording every call. The fake launchctl really starts the
// plist's ProgramArguments (with its EnvironmentVariables and WorkingDirectory), so the installed hub answers on its
// port exactly as launchd would start it. Nothing runs as root and nothing outside the sandbox is touched.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FAKE_LAUNCHCTL = fs.readFileSync(path.join(import.meta.dir, 'deploy-fake-launchctl.sh'), 'utf8')

const FAKE_SUDO = `#!/bin/bash
echo "sudo $*" >> "$FAKE_STATE/calls.log"
[ "$1" = -v ] && exit 0
[ "$1" = -n ] && shift
# no root here: ownership changes are recorded, not done
[ "$1" = chown ] && exit 0
exec "$@"
`

const recorder = (name: string, body = '') => `#!/bin/bash
echo "${name} $*" >> "$FAKE_STATE/calls.log"
${body}
exit 0
`

export interface MacBox {
  root: string
  home: string
  state: string
  bin: string
  launchd: string
  newsyslog: string
  link: string
  env(extra?: Record<string, string>): Record<string, string>
  calls(): string[]
  /** run install-hub.sh (or another command) in the sandbox */
  run(cmd: string[], extra?: Record<string, string>): { code: number; out: string }
  cleanup(): void
}

export function macBox(o: { fileVault?: boolean; firewall?: boolean } = {}): MacBox {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trina-deploy-')))
  const dirs = { home: 'home', state: 'state', bin: 'fakebin', launchd: 'LaunchDaemons', newsyslog: 'newsyslog.d', link: 'usr-local-bin' }
  for (const d of Object.values(dirs)) fs.mkdirSync(path.join(root, d))
  const p = (d: string) => path.join(root, d)
  const write = (name: string, text: string) => fs.writeFileSync(path.join(p('fakebin'), name), text, { mode: 0o755 })
  write('launchctl', FAKE_LAUNCHCTL)
  write('sudo', FAKE_SUDO)
  write('pmset', recorder('pmset', '[ "$1" = -g ] && echo " sleep                0"'))
  write('fdesetup', recorder('fdesetup', `echo "FileVault is ${o.fileVault ? 'On' : 'Off'}."`))
  write('ipconfig', recorder('ipconfig', '[ "$2" = en0 ] && echo 192.168.77.10'))
  write('route', recorder('route', 'echo "   route to: default"; echo "interface: en0"'))
  write('brew', recorder('brew'))
  write('cloudflared', recorder('cloudflared', 'exec sleep 600'))
  write('socketfilterfw', recorder('socketfilterfw', `case "$1" in --getglobalstate) echo "Firewall is ${o.firewall === false ? 'disabled. (State = 0)' : 'enabled. (State = 1)'}" ;; --getblockall) echo "Firewall has block all state set to disabled." ;; esac`))
  const env = (extra: Record<string, string> = {}) => ({
    PATH: `${p('fakebin')}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`,
    HOME: p('home'),
    USER: os.userInfo().username,
    LANG: 'en_US.UTF-8',
    TMPDIR: os.tmpdir(),
    FAKE_STATE: p('state'),
    TRINA_AX_LAUNCHD_DIR: p('LaunchDaemons'),
    TRINA_AX_NEWSYSLOG_DIR: p('newsyslog.d'),
    TRINA_AX_LINK_DIR: p('usr-local-bin'),
    TRINA_AX_FIREWALL: path.join(p('fakebin'), 'socketfilterfw'),
    // keep tests off the network and off this machine's Claude login
    TRINA_AX_UPSTREAM: 'http://127.0.0.1:9',
    ...extra,
  })
  const calls = () => { try { return fs.readFileSync(path.join(p('state'), 'calls.log'), 'utf8').trim().split('\n').filter(Boolean) } catch { return [] } }
  return {
    root, home: p('home'), state: p('state'), bin: p('fakebin'), launchd: p('LaunchDaemons'), newsyslog: p('newsyslog.d'), link: p('usr-local-bin'),
    env, calls,
    run(cmd, extra = {}) {
      const r = Bun.spawnSync(cmd, { env: env(extra), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 120_000 })
      return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() }
    },
    cleanup() {
      for (const f of fs.readdirSync(p('state'))) {
        if (!f.endsWith('.pid')) continue
        const pid = Number(fs.readFileSync(path.join(p('state'), f), 'utf8'))
        try { process.kill(pid, 'SIGKILL') } catch {}
      }
      // the hub's own children (run-logged.ts → bun main.ts) are in the same tree; give them a moment
      Bun.spawnSync(['pkill', '-f', root])
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

export async function freePort(): Promise<number> {
  const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
  const port = s.port!
  s.stop(true)
  return port
}

export async function healthy(url: string, ms = 1500): Promise<boolean> {
  try { const r = await fetch(url + '/healthz', { signal: AbortSignal.timeout(ms) }); return r.ok && (await r.json() as any).product === 'trina-ax' } catch { return false }
}
