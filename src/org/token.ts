// The org token: one credential for the whole company, pasted into the Claude admin console (Claude Code managed
// settings and the Cowork OTLP form). Every member's Claude then sends it, so every member can read it. That is why
// it can do exactly two things:
//
//   (a) POST /otel/v1/logs (and /otel/v1/metrics, which is ignored)      → usage by the email the event names
//   (b) GET  /plugins/marketplace.json and the org plugin zip            → skills every member may use
//
// It is a `tokens` row of kind 'org' with no user (migrations/160_org.sql). `verifyToken` (src/auth/tokens.ts) never
// returns it, so the relay, MCP, the installer API and every other token route answer 401 for it; the two routes above
// accept it through `requireTokenOrOrg` (src/org/auth.ts). At most one is active. Making a new one revokes the old.
import type { Database } from 'bun:sqlite'
import { newId, secret, sha256 } from '../ids'
import { nowIso } from '../db'
import { PRODUCT } from '../product'

export const ORG_TOKEN_PREFIX = PRODUCT.tokenPrefix + 'org_'

export interface OrgTokenInfo {
  id: string
  /** first characters, safe to show */
  prefix: string
  createdAt: string
  /** the admin who made it */
  createdBy: string | null
  lastUsedAt: string | null
}

/** What a request with a valid org token carries (no person). */
export interface OrgAuth { token: OrgTokenInfo }

const ROW = 'id, prefix, created_at AS createdAt, created_by AS createdBy, last_used_at AS lastUsedAt'

/** The active org token (never the secret), or null. */
export function activeOrgToken(db: Database): OrgTokenInfo | null {
  return (db.query(`SELECT ${ROW} FROM tokens WHERE kind = 'org' AND revoked_at IS NULL`).get() as OrgTokenInfo | null) ?? null
}

/** Make a new org token and revoke the old one in the same step. The secret is returned once and stored as a hash. */
export function rotateOrgToken(db: Database, actor: string | null): { id: string; token: string; replaced: boolean } {
  return db.transaction(() => {
    const now = nowIso()
    const replaced = db.query("UPDATE tokens SET revoked_at = ? WHERE kind = 'org' AND revoked_at IS NULL").run(now).changes > 0
    const token = ORG_TOKEN_PREFIX + secret(32)
    const id = newId()
    db.query(`INSERT INTO tokens (id, user_id, kind, name, token_hash, prefix, created_at, created_by) VALUES (?, NULL, 'org', ?, ?, ?, ?, ?)`)
      .run(id, 'Claude 조직 설정', sha256(token), token.slice(0, ORG_TOKEN_PREFIX.length + 4), now, actor)
    return { id, token, replaced }
  })()
}

/** Stop the org token without making a new one. */
export function revokeOrgToken(db: Database): boolean {
  return db.query("UPDATE tokens SET revoked_at = ? WHERE kind = 'org' AND revoked_at IS NULL").run(nowIso()).changes > 0
}

const lastTouch = new Map<string, number>()

/** The org token behind a bearer string, or null (unknown, revoked, or not an org token at all). */
export function verifyOrgToken(db: Database, token: string | null | undefined): OrgAuth | null {
  if (!token || !token.startsWith(ORG_TOKEN_PREFIX) || token.length > 200) return null
  const row = db.query(`SELECT ${ROW} FROM tokens WHERE token_hash = ? AND kind = 'org' AND revoked_at IS NULL`).get(sha256(token)) as OrgTokenInfo | null
  if (!row) return null
  const t = Date.now()
  if ((lastTouch.get(row.id) ?? 0) < t - 60_000) {
    lastTouch.set(row.id, t)
    db.query('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id)
  }
  return { token: row }
}
