// Web sessions for the admin pages, personal pages and phone chat. Cookie holds a random id; the database keeps
// its sha256 and a CSRF secret that every form post must echo.
import type { Database } from 'bun:sqlite'
import { secret, sha256, safeEqual } from '../ids'
import { nowIso } from '../db'
import { loadPrincipal, type Principal } from '../policy/access'

export const SESSION_TTL_MS = 30 * 86_400_000

export function createSession(db: Database, userId: string): { id: string; csrf: string } {
  const id = secret(32)
  const csrf = secret(18)
  const now = nowIso()
  db.query('INSERT INTO sessions (id_hash, user_id, csrf, created_at, expires_at, last_seen) VALUES (?,?,?,?,?,?)')
    .run(sha256(id), userId, csrf, now, new Date(Date.now() + SESSION_TTL_MS).toISOString(), now)
  return { id, csrf }
}

export interface SessionAuth { user: Principal; csrf: string; idHash: string }

export function verifySession(db: Database, id: string | undefined | null): SessionAuth | null {
  if (!id || id.length > 100) return null
  const h = sha256(id)
  const row = db.query('SELECT user_id, csrf, expires_at, last_seen FROM sessions WHERE id_hash = ?').get(h) as { user_id: string; csrf: string; expires_at: string; last_seen: string } | null
  if (!row || row.expires_at < nowIso()) return null
  const user = loadPrincipal(db, row.user_id)
  if (!user) return null
  // sliding expiry, written at most every 10 minutes
  if (Date.parse(row.last_seen) < Date.now() - 600_000) {
    db.query('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id_hash = ?').run(nowIso(), new Date(Date.now() + SESSION_TTL_MS).toISOString(), h)
  }
  return { user, csrf: row.csrf, idHash: h }
}

export function destroySession(db: Database, id: string | undefined | null) {
  if (id) db.query('DELETE FROM sessions WHERE id_hash = ?').run(sha256(id))
}

export const csrfOk = (s: SessionAuth, given: unknown) => typeof given === 'string' && safeEqual(given, s.csrf)

export function sweepSessions(db: Database) {
  db.query('DELETE FROM sessions WHERE expires_at < ?').run(nowIso())
}
