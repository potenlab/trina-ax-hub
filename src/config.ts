// Server configuration: defaults, then <dataDir>/config.json, then environment variables (env wins).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Config {
  host: string
  port: number
  /** database, secrets, hub sessions, logs */
  dataDir: string
  /** the company's files; every tool path is relative to this folder */
  teamRoot: string
  /** how PCs reach the hub from anywhere (Cloudflare tunnel), e.g. https://acme.ax.trina.app. Null = local only. */
  publicUrl: string | null
  /** how PCs in the office reach the hub directly, e.g. http://192.168.1.17:47900 */
  lanUrl: string | null
  /** Anthropic API base URL (tests point this at a fake upstream) */
  upstreamBaseUrl: string
  /** claude CLI for hub sessions (phone chat, schedules); null = hub sessions off */
  claudeBin: string | null
  /** hub sessions that may run at once on this machine */
  hubConcurrency: number
  /** ripgrep binary for search; null = filename search only */
  rgBin: string | null
  pandocBin: string | null
  pdftotextBin: string | null
}

export function which(name: string, extra: string[] = []): string | null {
  const dirs = [...extra, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', ...(process.env.PATH ?? '').split(':')]
  for (const d of dirs) {
    if (!d) continue
    const p = path.join(d, name)
    try { fs.accessSync(p, fs.constants.X_OK); return p } catch {}
  }
  return null
}

const num = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d)
const trimUrl = (v: string | null | undefined) => (v ? v.replace(/\/+$/, '') : null)

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const home = os.homedir()
  const base = env.TRINA_AX_HOME ?? path.join(home, 'TrinaAX')
  const dataDir = path.resolve(env.TRINA_AX_DATA_DIR ?? path.join(base, 'data'))
  let file: Partial<Config> = {}
  const cfgPath = env.TRINA_AX_CONFIG ?? path.join(dataDir, 'config.json')
  try { file = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) } catch {}
  const claude = env.TRINA_AX_CLAUDE_BIN ?? file.claudeBin ?? which('claude', [path.join(home, '.local/bin'), path.join(home, '.claude/local')])
  return {
    host: env.TRINA_AX_HOST ?? file.host ?? '127.0.0.1',
    port: num(env.TRINA_AX_PORT, file.port ?? 47900),
    dataDir,
    teamRoot: path.resolve(env.TRINA_AX_TEAM_ROOT ?? file.teamRoot ?? path.join(base, 'team')),
    publicUrl: trimUrl(env.TRINA_AX_PUBLIC_URL ?? file.publicUrl ?? null),
    lanUrl: trimUrl(env.TRINA_AX_LAN_URL ?? file.lanUrl ?? null),
    upstreamBaseUrl: trimUrl(env.TRINA_AX_UPSTREAM ?? file.upstreamBaseUrl ?? 'https://api.anthropic.com')!,
    claudeBin: claude || null,
    hubConcurrency: num(env.TRINA_AX_HUB_CONCURRENCY, file.hubConcurrency ?? 2),
    rgBin: env.TRINA_AX_RG_BIN ?? which('rg'),
    pandocBin: which('pandoc'),
    pdftotextBin: which('pdftotext'),
  }
}

/** The URL PCs should use, best first: public (works everywhere), then LAN, then the local address. */
export function hubUrl(c: Config): string {
  return c.publicUrl ?? c.lanUrl ?? `http://${c.host === '0.0.0.0' ? '127.0.0.1' : c.host}:${c.port}`
}
