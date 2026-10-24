// The PC installer scripts, rendered with this hub's URL and the product names baked in. No secrets ever go in:
// the script trades the enrollment code (typed by the person) for a token at run time.
//
//   macOS / Linux:  curl -fsSL <hub>/install.sh | bash -s -- <CODE>
//   Windows:        & ([scriptblock]::Create((irm <hub>/install.ps1))) <CODE>
import fs from 'node:fs'
import path from 'node:path'
import { PRODUCT } from '../product'
import { PLUGIN_ID } from '../skills/marketplace'

export type ScriptKind = 'sh' | 'ps1'

const TEMPLATE_DIR = path.join(import.meta.dir, '..', '..', 'installer')
const FILES: Record<ScriptKind, string> = { sh: 'install.sh.tmpl', ps1: 'install.ps1.tmpl' }
const templates = new Map<ScriptKind, string>()

function template(kind: ScriptKind): string {
  let t = templates.get(kind)
  if (t === undefined) {
    t = fs.readFileSync(path.join(TEMPLATE_DIR, FILES[kind]), 'utf8')
    templates.set(kind, t)
  }
  return t
}

/** A hub URL that is safe to paste between single quotes in bash and PowerShell (and that Claude Code accepts). */
export function bakeableUrl(url: string): boolean {
  if (!/^[A-Za-z0-9:/.\-_~[\]%]+$/.test(url)) return false
  try {
    const u = new URL(url)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && !u.search && !u.hash
  } catch { return false }
}

/** The script text. Throws when the hub URL cannot be baked in safely (an admin setting gone wrong). */
export function renderScript(kind: ScriptKind, hub: string): string {
  if (!bakeableUrl(hub)) throw new Error('hub URL cannot be used in an install script')
  const values: Record<string, string> = {
    HUB_URL: hub,
    MARKETPLACE: PRODUCT.marketplaceName,
    PLUGIN: PLUGIN_ID,
    MCP_NAME: PRODUCT.mcpName,
    TOKEN_PREFIX: PRODUCT.tokenPrefix,
    VERSION: PRODUCT.version,
  }
  const out = template(kind).replace(/@@([A-Z_]+)@@/g, (m, k: string) => values[k] ?? m)
  const left = /@@[A-Z_]+@@/.exec(out)
  if (left) throw new Error(`unknown placeholder ${left[0]} in ${FILES[kind]}`)
  return out
}

/** The one-line commands the personal page shows (the web module renders them). */
export function installCommands(hub: string, code: string): { mac: string; windows: string; uninstallMac: string; uninstallWindows: string } {
  return {
    mac: `curl -fsSL ${hub}/install.sh | bash -s -- ${code}`,
    windows: `& ([scriptblock]::Create((irm ${hub}/install.ps1))) ${code}`,
    uninstallMac: `curl -fsSL ${hub}/install.sh | bash -s -- --uninstall`,
    uninstallWindows: `& ([scriptblock]::Create((irm ${hub}/install.ps1))) -Uninstall`,
  }
}
