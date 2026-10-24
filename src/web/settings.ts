// Settings the admin pages save (table `settings`) layered over the config file / environment.
//
//   companyName     string        shown on pages and as the marketplace owner
//   publicUrl       string|null   https address that works from anywhere (Cloudflare tunnel); null = use config
//   lanUrl          string|null   office address (http://192.168.x.y:47900); null = use config
//   hubConcurrency  number|null   hub sessions at once; null = use config
//
// Other modules: call `effectiveUrls(ctx)` / `companyName(ctx)` / `hubConcurrency(ctx)` instead of reading
// ctx.config directly. `applySavedSettings(ctx)` also copies the saved values onto ctx.config (at startup and after
// every save), so code that reads `ctx.config.publicUrl` or `hubUrl(ctx.config)` sees them too.
import type { Ctx } from '../context'
import { getSetting, setSetting } from '../db'
import { PRODUCT } from '../product'

export interface HubUrls {
  /** https address that works from anywhere (needed for skills), or null */
  publicUrl: string | null
  /** office network address, or null */
  lanUrl: string | null
  /** the address this server answers on locally (or the address the browser used) */
  localUrl: string
  /** what PCs should use: public, else LAN, else local */
  hubUrl: string
  kind: 'public' | 'lan' | 'local'
}

/** Configured values before the admin's saved settings (config file / environment), for the settings page. */
const base = new WeakMap<Ctx, { publicUrl: string | null; lanUrl: string | null; hubConcurrency: number }>()

const baseOf = (ctx: Ctx) => {
  let b = base.get(ctx)
  if (!b) { b = { publicUrl: ctx.config.publicUrl, lanUrl: ctx.config.lanUrl, hubConcurrency: ctx.config.hubConcurrency }; base.set(ctx, b) }
  return b
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : null)

/** The config-file/environment values (what applies when nothing is saved on the settings page). */
export function configuredDefaults(ctx: Ctx) { return { ...baseOf(ctx) } }

export function localUrl(ctx: Ctx): string {
  const host = ctx.config.host === '0.0.0.0' || ctx.config.host === '::' ? '127.0.0.1' : ctx.config.host
  return `http://${host.includes(':') ? `[${host}]` : host}:${ctx.config.port}`
}

/**
 * Hub addresses with saved settings applied. `requestOrigin` (the address the browser used, e.g.
 * http://192.168.1.17:47900) is a better local fallback than the bind address when neither a public nor a LAN
 * address is set.
 */
export function effectiveUrls(ctx: Ctx, requestOrigin?: string): HubUrls {
  const b = baseOf(ctx)
  const publicUrl = str(getSetting<string | null>(ctx.db, 'publicUrl', null)) ?? b.publicUrl
  const lanUrl = str(getSetting<string | null>(ctx.db, 'lanUrl', null)) ?? b.lanUrl
  const local = requestOrigin ? requestOrigin.replace(/\/+$/, '') : localUrl(ctx)
  const kind = publicUrl ? 'public' : lanUrl ? 'lan' : 'local'
  return { publicUrl, lanUrl, localUrl: local, hubUrl: publicUrl ?? lanUrl ?? local, kind }
}

export function companyName(ctx: Ctx): string {
  return str(getSetting<string | null>(ctx.db, 'companyName', null)) ?? PRODUCT.displayName
}

export function hubConcurrency(ctx: Ctx): number {
  const v = getSetting<number | null>(ctx.db, 'hubConcurrency', null)
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : baseOf(ctx).hubConcurrency
}

/** Copy saved settings onto ctx.config so modules reading the config see them. Safe to call any time. */
export function applySavedSettings(ctx: Ctx) {
  const u = effectiveUrls(ctx)
  ctx.config.publicUrl = u.publicUrl
  ctx.config.lanUrl = u.lanUrl
  ctx.config.hubConcurrency = hubConcurrency(ctx)
}

/** Save one setting (null = back to the config value) and re-apply. */
export function saveSetting(ctx: Ctx, key: 'companyName' | 'publicUrl' | 'lanUrl' | 'hubConcurrency', value: string | number | null) {
  baseOf(ctx) // remember the configured values before the first override
  setSetting(ctx.db, key, value)
  applySavedSettings(ctx)
}

/** The one-line install commands for a PC (contract with the install module). */
export function installCommands(hub: string, code: string) {
  return {
    mac: `curl -fsSL ${hub}/install.sh | bash -s -- ${code}`,
    windows: `& ([scriptblock]::Create((irm ${hub}/install.ps1))) ${code}`,
  }
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1|0\.0\.0\.0)$/i

/** Warnings to show next to install commands (Korean, for people). */
export function urlWarnings(u: HubUrls): string[] {
  const out: string[] = []
  if (!u.publicUrl) {
    out.push('공개 주소(https)가 아직 없어서 회사 스킬은 PC에 설치되지 않아요. 파일과 AI 사용은 바로 돼요. 관리자에게 설정 > 주소를 부탁해 주세요.')
  }
  if (u.kind === 'local') {
    let host = ''
    try { host = new URL(u.hubUrl).hostname } catch {}
    out.push(LOOPBACK.test(host)
      ? `이 주소(${u.hubUrl})는 허브 컴퓨터 안에서만 열려요. 다른 PC를 연결하려면 설정에서 사내 주소나 공개 주소를 넣어 주세요.`
      : `연결할 PC에서 ${u.hubUrl} 이 열리는지 먼저 확인해 주세요. 같은 사무실 네트워크에 있어야 해요.`)
  } else if (u.kind === 'lan') {
    out.push('사내 주소라서 사무실 네트워크에 있는 PC만 연결돼요.')
  }
  return out
}
