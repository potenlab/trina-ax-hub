// Enrollment: the PC installer trades a one-time code for a device token, and gets back everything it writes into
// Claude Code's settings (relay URL, MCP URL, marketplace URL and names).
//
//   POST /api/enroll   { code, deviceName?, os? }  →  200 EnrollResponse | 400 invalid_code | 429 rate_limited
//   POST /api/unenroll (Bearer device token)      →  200 { ok: true }   (the uninstaller and re-installs call it)
import { z } from 'zod'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { redeemEnrollCode } from '../auth/enroll'
import { getUser } from '../auth/users'
import { PRODUCT } from '../product'
import { PLUGIN_ID, companyName, marketplaceUrl, skillsUnavailableReason } from '../skills/marketplace'

export interface EnrollResponse {
  /** device token: goes into ANTHROPIC_AUTH_TOKEN, the MCP header and the marketplace header. Shown nowhere. */
  token: string
  /** ANTHROPIC_BASE_URL */
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
  audit(ctx.db, { actor: r.userId, action: 'device.enroll', target: r.tokenId, detail: { device: deviceName, os, ip } })
  ctx.log.info('device enrolled', { user: r.userId, token: r.tokenId, os })
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
  }
}
