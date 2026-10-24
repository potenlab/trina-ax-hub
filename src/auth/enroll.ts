// One-time enrollment codes. An admin (or the person themselves) makes a code; the PC installer trades it for a
// device token exactly once. Codes are short enough to type, expire after 24 hours and are stored hashed.
import type { Database } from 'bun:sqlite'
import crypto from 'node:crypto'
import { sha256 } from '../ids'
import { nowIso } from '../db'
import { issueToken } from './tokens'
import { loadPrincipal } from '../policy/access'

const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ENROLL_TTL_MS = 24 * 3600_000

/** XXXX-XXXX-XXXX (≈60 bits) */
export function makeEnrollCode(db: Database, userId: string, createdBy: string | null): { code: string; expiresAt: string } {
  const b = crypto.randomBytes(12)
  let raw = ''
  for (let i = 0; i < 12; i++) raw += CODE_ALPHA[b[i]! % CODE_ALPHA.length]
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
  const expiresAt = new Date(Date.now() + ENROLL_TTL_MS).toISOString()
  db.query('INSERT INTO enroll_codes (code_hash, user_id, created_by, created_at, expires_at) VALUES (?,?,?,?,?)').run(sha256(normalize(code)), userId, createdBy, nowIso(), expiresAt)
  return { code, expiresAt }
}

const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Trade a code for a device token. Null when the code is unknown, used, expired or the account is off. */
export function redeemEnrollCode(db: Database, code: string, deviceName: string, hubUrl?: string | null): { userId: string; tokenId: string; token: string; approved: boolean } | null {
  const h = sha256(normalize(code))
  return db.transaction(() => {
    const row = db.query('SELECT user_id, created_by, expires_at, used_at FROM enroll_codes WHERE code_hash = ?').get(h) as { user_id: string; created_by: string | null; expires_at: string; used_at: string | null } | null
    if (!row || row.used_at || row.expires_at < nowIso()) return null
    if (!loadPrincipal(db, row.user_id)) return null
    const t = issueToken(db, row.user_id, 'device', deviceName || 'PC', { createdBy: row.created_by, hubUrl: hubUrl ?? null })
    db.query('UPDATE enroll_codes SET used_at = ?, token_id = ? WHERE code_hash = ?').run(nowIso(), t.id, h)
    return { userId: row.user_id, tokenId: t.id, token: t.token, approved: row.created_by === row.user_id }
  })()
}

export function sweepEnrollCodes(db: Database) {
  db.query('DELETE FROM enroll_codes WHERE expires_at < ?').run(new Date(Date.now() - 7 * 86_400_000).toISOString())
}
