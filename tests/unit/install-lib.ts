// Helpers for running the real installer scripts against a test hub, with a fake `claude` on PATH.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function which(name: string, extra: string[] = []): string | null {
  for (const d of [...extra, ...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']) {
    if (!d) continue
    const p = path.join(d, name)
    try { fs.accessSync(p, fs.constants.X_OK); return p } catch {}
  }
  return null
}

/** PowerShell for the .ps1 checks: $TRINA_PWSH, else pwsh on PATH. */
export function findPwsh(): string | null {
  const env = process.env.TRINA_PWSH
  if (env) { try { fs.accessSync(env, fs.constants.X_OK); return env } catch {} }
  return which('pwsh')
}

// The fake records every call (args separated by \x1f, plus the sync env var) and imitates the few answers the
// installer reads. `mcp add` echoes its arguments, token included, the way a careless tool might: the installer
// must never let that reach the terminal.
// FAKE_CLAUDE_AUTH decides what `auth status --json` says: in (default), out (loggedIn false, exit 1), out0 (loggedIn
// false, exit 0), broken (no such command, exit 2). FAKE_CLAUDE_PLUGIN_FAIL=1 makes `plugin install` fail.
const FAKE_CLAUDE = `#!/bin/bash
{ printf '%s\\x1f' "$@"; printf 'SYNC=%s\\n' "\${CLAUDE_CODE_SYNC_PLUGIN_INSTALL:-}"; } >> "$FAKE_CLAUDE_LOG"
case "$1 \${2:-}" in
  "mcp add") echo "Added HTTP MCP server: $*" ;;
  "plugin install")
    if [ -n "\${FAKE_CLAUDE_PLUGIN_FAIL:-}" ]; then echo "Not logged in" >&2; exit 1; fi
    : > "$FAKE_CLAUDE_STATE/plugin-installed"; echo "installed" ;;
  "plugin uninstall") rm -f "$FAKE_CLAUDE_STATE/plugin-installed" ;;
  "plugin list") if [ -f "$FAKE_CLAUDE_STATE/plugin-installed" ]; then echo '[{"id":"company@trina-ax","scope":"user"}]'; else echo '[]'; fi ;;
  "auth status")
    case "\${FAKE_CLAUDE_AUTH:-in}" in
      in) echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}' ;;
      out) echo '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'; exit 1 ;;
      out0) echo '{ "loggedIn": false, "authMethod": "none" }' ;;
      *) echo "error: unknown command 'auth'" >&2; exit 2 ;;
    esac ;;
esac
exit 0
`

export interface Sandbox {
  home: string
  bin: string
  configDir: string
  settings: string
  state: string
  /** calls made to the fake claude: args + the CLAUDE_CODE_SYNC_PLUGIN_INSTALL value */
  calls(): { args: string[]; sync: string }[]
  readSettings(): any
  writeSettings(v: unknown): void
  env(extra?: Record<string, string>): Record<string, string>
  cleanup(): void
}

export function sandbox(o: { configDir?: string } = {}): Sandbox {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trina-install-home-')))
  const bin = path.join(home, 'fakebin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 })
  const configDir = o.configDir ? path.join(home, o.configDir) : path.join(home, '.claude')
  const log = path.join(home, 'claude-calls.log')
  const nodeDir = which('node') ? path.dirname(which('node')!) : null
  return {
    home, bin, configDir,
    settings: path.join(configDir, 'settings.json'),
    state: path.join(configDir, 'trina-ax.json'),
    calls() {
      if (!fs.existsSync(log)) return []
      return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => {
        const parts = l.split('\x1f')
        return { args: parts.slice(0, -1), sync: parts.at(-1)!.replace(/^SYNC=/, '') }
      })
    },
    readSettings() { return JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')) },
    writeSettings(v) {
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(path.join(configDir, 'settings.json'), typeof v === 'string' ? v : JSON.stringify(v, null, 2))
    },
    env(extra = {}) {
      return {
        HOME: home,
        PATH: [bin, ...(nodeDir ? [nodeDir] : []), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
        TMPDIR: os.tmpdir(),
        LANG: 'en_US.UTF-8',
        FAKE_CLAUDE_LOG: log,
        FAKE_CLAUDE_STATE: home,
        ...(o.configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
        ...extra,
      }
    },
    cleanup() { fs.rmSync(home, { recursive: true, force: true }) },
  }
}

export interface RunResult { code: number; stdout: string; stderr: string; out: string }

/** Runs a command without blocking the event loop (the test hub answers in this same process). */
export async function run(cmd: string[], env: Record<string, string>, cwd?: string): Promise<RunResult> {
  const p = Bun.spawn(cmd, { env, cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  return { code, stdout, stderr, out: stdout + stderr }
}

/** JSON engines install.sh can use on this machine */
export function jsonEngines(): string[] {
  const out: string[] = []
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/osascript')) out.push('osascript')
  if (which('python3', ['/usr/bin'])) out.push('python3')
  if (which('node')) out.push('node')
  return out
}
