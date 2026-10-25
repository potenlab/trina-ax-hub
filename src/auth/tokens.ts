// Personal access tokens. A device token lives on one PC (in ~/.claude/settings.json); a hub token is made for one
// hub job and expires. Both authenticate the model relay and the MCP endpoint. Only a sha256 of the token is stored.
import type { Database } from 'bun:sqlite'
import { newId, secret, sha256 } from '../ids'
import { nowIso } from '../db'
import { PRODUCT } from '../product'
import { loadPrincipal, type Principal } from '../policy/access'

/** device = a PC (installer), hub = one hub job, connector = a Claude app connector the person approved (OAuth) */
export type TokenKind = 'device' | 'hub' | 'connector'

export interface TokenRow {
  id: string; user_id: string; kind: TokenKind; name: string; prefix: string
  created_at: string; expires_at: string | null; last_used_at: string | null; revoked_at: string | null
  /** who made the enroll code (null = CLI on the hub, or a hub token) */
  created_by: string | null
  /** when the person accepted this device themselves (see `restricted`) */
  approved_at: string | null
  /** hub address this PC was set up with */
  hub_url: string | null
}

const COLS = 'id, user_id, kind, name, prefix, created_at, expires_at, last_used_at, revoked_at, created_by, approved_at, hub_url'

export interface IssueOpts {
  ttlMs?: number
  /** who made the enroll code; a device made by someone else starts unapproved */
  createdBy?: string | null
  hubUrl?: string | null
}

export function issueToken(db: Database, userId: string, kind: TokenKind, name: string, o: IssueOpts | number = {}): { id: string; token: string } {
  const opts: IssueOpts = typeof o === 'number' ? { ttlMs: o } : o
  const token = PRODUCT.tokenPrefix + secret(32)
  const id = newId()
  const now = nowIso()
  // hub tokens are made by the hub for the person's own job; a device is approved when the person made the code
  const approved = kind !== 'device' || opts.createdBy === userId ? now : null
  db.query(`INSERT INTO tokens (id, user_id, kind, name, token_hash, prefix, created_at, expires_at, created_by, approved_at, hub_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, kind, name.slice(0, 80) || kind, sha256(token), token.slice(0, PRODUCT.tokenPrefix.length + 6), now,
      opts.ttlMs ? new Date(Date.now() + opts.ttlMs).toISOString() : null, opts.createdBy ?? null, approved, opts.hubUrl ?? null)
  return { id, token }
}

/** The person accepts a device someone else enrolled for them. */
export function approveToken(db: Database, id: string, userId: string): boolean {
  return db.query("UPDATE tokens SET approved_at = ? WHERE id = ? AND user_id = ? AND kind = 'device' AND revoked_at IS NULL AND approved_at IS NULL").run(nowIso(), id, userId).changes === 1
}

export interface TokenAuth {
  token: TokenRow
  user: Principal
  /** true for a device someone else enrolled that the person has not approved yet: it works for the model and team
   *  folders but never opens the person's own users/<id>/ folder (an admin must not read it through it) */
  restricted: boolean
}

const lastTouch = new Map<string, number>()

/** The person behind a token, or null (unknown, revoked, expired, account disabled). */
export function verifyToken(db: Database, token: string | null | undefined): TokenAuth | null {
  if (!token || !token.startsWith(PRODUCT.tokenPrefix) || token.length > 200) return null
  const row = db.query(`SELECT ${COLS} FROM tokens WHERE token_hash = ?`).get(sha256(token)) as TokenRow | null
  if (!row || row.revoked_at) return null
  if (row.expires_at && row.expires_at < nowIso()) return null
  const user = loadPrincipal(db, row.user_id)
  if (!user) return null
  // last_used_at at most once a minute per token (every relay request would otherwise write)
  const t = Date.now()
  if ((lastTouch.get(row.id) ?? 0) < t - 60_000) {
    lastTouch.set(row.id, t)
    db.query('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id)
  }
  return { token: row, user, restricted: row.kind === 'device' && !row.approved_at }
}

/** Token from `Authorization: Bearer …` or `x-api-key` (Claude Code sends one or the other). */
export function tokenFromHeaders(h: Headers): string | null {
  const auth = h.get('authorization')
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim()
  return h.get('x-api-key')?.trim() || null
}

export function listTokens(db: Database, userId?: string): (TokenRow & { user_name?: string })[] {
  const q = `SELECT t.id, t.user_id, t.kind, t.name, t.prefix, t.created_at, t.expires_at, t.last_used_at, t.revoked_at, t.created_by, t.approved_at, t.hub_url, u.name AS user_name
    FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.kind = 'device' ${userId ? 'AND t.user_id = ?' : ''} ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC`
  return (userId ? db.query(q).all(userId) : db.query(q).all()) as (TokenRow & { user_name?: string })[]
}

export function revokeToken(db: Database, id: string, userId?: string): boolean {
  const r = userId
    ? db.query('UPDATE tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(nowIso(), id, userId)
    : db.query('UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), id)
  return r.changes === 1
}

/** Drop expired hub tokens (they are per job) */
export function sweepTokens(db: Database) {
  db.query("DELETE FROM tokens WHERE kind = 'hub' AND expires_at IS NOT NULL AND expires_at < ?").run(new Date(Date.now() - 86_400_000).toISOString())
}
