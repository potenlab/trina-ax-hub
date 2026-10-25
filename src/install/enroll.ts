// Enrollment: the PC installer trades a one-time code for a device token, and gets back everything it writes into
// Claude Code's settings (the `env` for the person's mode, MCP URL, marketplace URL and names).
//
// The hub decides the environment, so the scripts never need to know the modes (see src/auth/access-mode.ts):
//   subscription  the person signs in to Claude Code with their own subscription. No ANTHROPIC_* variables (they would
//                 override that login); Claude Code's OpenTelemetry export points at the hub (`/otel/v1/logs`) so the
//                 hub can show usage per person.
//   company_key   ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN point at the hub's relay (the company API key).
//
//   POST /api/enroll   { code, deviceName?, os? }  →  200 EnrollResponse | 400 invalid_code | 429 rate_limited
//   POST /api/unenroll (Bearer device token)      →  200 { ok: true }   (the uninstaller and re-installs call it)
import { z } from 'zod'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { modelAccessFor, type ModelAccess } from '../auth/access-mode'
import { redeemEnrollCode } from '../auth/enroll'
import { getUser } from '../auth/users'
import { PRODUCT } from '../product'
import { PLUGIN_ID, companyName, marketplaceUrl, skillsUnavailableReason } from '../skills/marketplace'

/** Every `settings.json` env key either mode may set. Switching modes removes the other mode's keys. */
export const ENV_OWNED: readonly string[] = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'OTEL_LOGS_EXPORTER',
  'OTEL_METRICS_EXPORTER',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
]

export const LOGIN_HINT = '터미널에서 claude 를 실행하고 /login 으로 본인 Claude 구독에 로그인해 주세요.'

/** The exact `settings.json` env keys to set for `mode` (a subset of ENV_OWNED). */
export function installEnv(mode: ModelAccess, hub: string, token: string): Record<string, string> {
  if (mode === 'company_key') return { ANTHROPIC_BASE_URL: hub, ANTHROPIC_AUTH_TOKEN: token }
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${hub}/otel/v1/logs`,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
  }
}

export interface EnrollResponse {
  /** device token: goes into the MCP header, the marketplace header and (inside `env`) the relay or OTLP credentials.
   *  Shown nowhere. */
  token: string
  /** the hub's own address (what the installer writes into `env`) */
  hubUrl: string
  mcpUrl: string
  mcpName: string
  marketplaceUrl: string
  marketplaceName: string
  /** for enabledPlugins and `claude plugin install` */
  plugin: string
  user: { name: string }
  companyName: string
  /** false when Claude Code cannot download plugin archives from this hub yet (no https public URL) */
  skillsReady: boolean
  /** short Korean lines the installer prints at the end */
  notices: string[]
  /** how this person reaches Claude (their own setting, else the company default) */
  mode: ModelAccess
  /** exactly the `settings.json` `env` keys the installer sets (it never needs to know the mode) */
  env: Record<string, string>
  /** every key either mode may set: the installer removes (or restores) the ones missing from `env` */
  envOwned: string[]
  /** subscription mode: what the person must still do to sign in; null in company_key mode */
  loginHint: string | null
}

export const EnrollBody = z.object({
  code: z.string().min(1).max(64),
  deviceName: z.string().max(500).optional(), // cut to 80 characters by cleanDeviceName
  os: z.string().max(32).optional(),
})

export type OsName = 'macos' | 'linux' | 'windows' | 'other'

export function osName(v: string | undefined): OsName {
  const s = (v ?? '').toLowerCase()
  if (s === 'macos' || s === 'darwin' || s === 'mac') return 'macos'
  if (s === 'linux') return 'linux'
  if (s === 'windows' || s === 'win32') return 'windows'
  return 'other'
}

const DEFAULT_DEVICE: Record<OsName, string> = { macos: 'Mac', linux: 'Linux PC', windows: 'Windows PC', other: 'PC' }

/** A device name safe to show on the admin pages: no control or invisible characters, one line, at most 80 chars. */
export function cleanDeviceName(v: string | undefined, os: OsName): string {
  const s = (v ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return [...s].slice(0, 80).join('') || DEFAULT_DEVICE[os]
}

/** Codes are XXXX-XXXX-XXXX; people type them with spaces, dashes or lowercase. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Redeem `code` and describe the hub to the installer (`hub` = hubBase()). Null when the code is unknown, used,
 *  expired or the account is off (the caller answers all of these the same way). */
export function enroll(ctx: Ctx, input: { code: string; deviceName?: string; os?: string }, ip: string, hub: string): EnrollResponse | null {
  const os = osName(input.os)
  const deviceName = cleanDeviceName(input.deviceName, os)
  const r = redeemEnrollCode(ctx.db, input.code, deviceName, hub)
  if (!r) return null
  const user = getUser(ctx.db, r.userId)
  const mode = modelAccessFor(ctx.db, r.userId)
  audit(ctx.db, { actor: r.userId, action: 'device.enroll', target: r.tokenId, detail: { device: deviceName, os, ip, mode } })
  ctx.log.info('device enrolled', { user: r.userId, token: r.tokenId, os, mode })
  const skillsProblem = skillsUnavailableReason(ctx.config)
  return {
    token: r.token,
    hubUrl: hub,
    mcpUrl: `${hub}/mcp`,
    mcpName: PRODUCT.mcpName,
    marketplaceUrl: marketplaceUrl(hub),
    marketplaceName: PRODUCT.marketplaceName,
    plugin: PLUGIN_ID,
    user: { name: user?.name ?? '' },
    companyName: companyName(ctx),
    skillsReady: skillsProblem === null,
    notices: skillsProblem ? [skillsProblem] : [],
    mode,
    env: installEnv(mode, hub, r.token),
    envOwned: [...ENV_OWNED],
    loginHint: mode === 'subscription' ? LOGIN_HINT : null,
  }
}
