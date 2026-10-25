// Invite and password-reset links. An admin adds a person (name + email); the hub makes a single-use link
// /join/<token> and the person chooses their own password there. Only the sha256 of the token is stored.
// Also here: the small helpers that go with "a person known by name + email" (login by email, a hidden username
// derived from the address, address checks).
import type { Database } from 'bun:sqlite'
import { newId, secret, sha256 } from '../ids'
import { nowIso } from '../db'
import { HttpError } from '../http/errors'
import { getUser, getUserByUsername, type Role, type User } from './users'

export const INVITE_TTL_MS = 7 * 86_400_000
export type InviteKind = 'invite' | 'reset'

export interface InviteRow {
  id: string; user_id: string; kind: InviteKind; created_by: string | null
  created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,100}$/

/** A new link for this person. Every earlier open link of theirs stops working (reissue = revoke + create). */
export function createInvite(db: Database, userId: string, kind: InviteKind, createdBy: string | null): { id: string; token: string; expiresAt: string } {
  const token = secret(32) // 32 random bytes → 43 characters
  const id = newId()
  const now = nowIso()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  db.transaction(() => {
    db.query('UPDATE invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL').run(now, userId)
    db.query('INSERT INTO invites (id, user_id, kind, token_hash, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, userId, kind, sha256(token), createdBy, now, expiresAt)
  })()
  return { id, token, expiresAt }
}

/** Why a link does not work (shown to the person in plain Korean by the join page). */
export type InviteProblem = 'unknown' | 'used' | 'revoked' | 'expired' | 'off'
export type InviteLookup = { ok: true; invite: InviteRow; user: User } | { ok: false; why: InviteProblem; user?: User }

export function lookupInvite(db: Database, token: string): InviteLookup {
  if (!TOKEN_SHAPE.test(token)) return { ok: false, why: 'unknown' }
  const row = db.query('SELECT * FROM invites WHERE token_hash = ?').get(sha256(token)) as InviteRow | null
  if (!row) return { ok: false, why: 'unknown' }
  const user = getUser(db, row.user_id)
  if (!user) return { ok: false, why: 'unknown' }
  if (row.used_at) return { ok: false, why: 'used', user }
  if (row.revoked_at) return { ok: false, why: 'revoked', user }
  if (row.expires_at < nowIso()) return { ok: false, why: 'expired', user }
  if (user.status !== 'active') return { ok: false, why: 'off', user }
  return { ok: true, invite: row, user }
}

/**
 * Use the link: the person's password becomes `passwordHash` and the link is spent, in one step. Two people (or two
 * tabs) opening the same link cannot both win. Returns null when the link no longer works.
 */
export function redeemInvite(db: Database, token: string, passwordHash: string): { user: User; kind: InviteKind } | null {
  return db.transaction(() => {
    const l = lookupInvite(db, token)
    if (!l.ok) return null
    const now = nowIso()
    const spent = db.query('UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?').run(now, l.invite.id, now)
    if (spent.changes !== 1) return null
    db.query('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(passwordHash, now, l.user.id)
    return { user: getUser(db, l.user.id)!, kind: l.invite.kind }
  })()
}

/** The link that is still open for this person (newest), or null. */
export function openInvite(db: Database, userId: string): { kind: InviteKind; expiresAt: string; createdAt: string } | null {
  const r = db.query('SELECT kind, expires_at, created_at FROM invites WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
    .get(userId, nowIso()) as { kind: InviteKind; expires_at: string; created_at: string } | null
  return r ? { kind: r.kind, expiresAt: r.expires_at, createdAt: r.created_at } : null
}

/** Open links per person (for the people list). */
export function openInvites(db: Database): Map<string, { kind: InviteKind; expiresAt: string }> {
  const rows = db.query('SELECT user_id, kind, expires_at FROM invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at').all(nowIso()) as { user_id: string; kind: InviteKind; expires_at: string }[]
  return new Map(rows.map((r) => [r.user_id, { kind: r.kind, expiresAt: r.expires_at }]))
}

export function revokeInvites(db: Database, userId: string): number {
  return db.query('UPDATE invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL').run(nowIso(), userId).changes
}

/** Nobody can log in until the person chooses a password on their link: no password at all, and they must set one. */
export function clearPassword(db: Database, userId: string) {
  db.query('UPDATE users SET password_hash = NULL, must_change_password = 1, updated_at = ? WHERE id = ?').run(nowIso(), userId)
}

// people known by name + email ---------------------------------------------------------------------------------------

const EMAIL = /^[^\s@,;<>()"'\\]+@[^\s@,;<>()"'\\]+\.[^\s@,;<>()"'\\]+$/
export const MAX_EMAIL = 120
export const normalizeEmail = (s: string) => s.trim().toLowerCase()
export const validEmail = (s: string) => s.length <= MAX_EMAIL && EMAIL.test(s)

/** Who already uses this address (case-insensitive), apart from `exceptId`. */
export function emailOwner(db: Database, email: string, exceptId?: string): User | null {
  const r = db.query('SELECT id FROM users WHERE lower(email) = ? AND id != ? LIMIT 1').get(normalizeEmail(email), exceptId ?? '') as { id: string } | null
  return r ? getUser(db, r.id) : null
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/i

export function usernameTaken(db: Database, username: string): boolean {
  return !!db.query('SELECT 1 FROM users WHERE username = ?').get(username)
}

/** A hidden login name from an email address: the part before @ (and before any +tag), Latin letters/digits/._- only,
 *  2-32 characters, with a number added until it is free. Addresses with no usable Latin part become user, user2, … */
export function deriveUsername(db: Database, email: string, taken: ReadonlySet<string> = new Set()): string {
  const local = (email.split('@')[0] ?? '').split('+')[0]!
  let base = local.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[^a-z0-9]+/, '')
  if (base.length < 2) base = 'user'
  base = base.slice(0, 28)
  let cand = base
  for (let i = 2; usernameTaken(db, cand) || taken.has(cand.toLowerCase()); i++) cand = `${base}${i}`
  return cand
}

/** Add a person who has no password yet; they get one by using an invite link. */
export function createInvitedUser(db: Database, u: { username: string; name: string; email: string; role: Role }): User {
  const username = u.username.trim()
  if (!USERNAME.test(username)) throw new HttpError(400, 'validation', '아이디는 영문·숫자·._- 2~32자로 정해 주세요.')
  if (!u.name.trim()) throw new HttpError(400, 'validation', '이름을 입력해 주세요.')
  if (u.role === 'owner') throw new HttpError(400, 'validation', '소유자는 한 명만 둘 수 있어요.')
  const email = normalizeEmail(u.email)
  if (!validEmail(email)) throw new HttpError(400, 'validation', '이메일 주소 모양이 이상해요.')
  if (usernameTaken(db, username)) throw new HttpError(409, 'conflict', '이미 있는 아이디예요.')
  if (emailOwner(db, email)) throw new HttpError(409, 'conflict', '이미 같은 이메일을 쓰는 사람이 있어요.')
  const id = newId()
  const now = nowIso()
  db.query('INSERT INTO users (id, username, name, email, role, status, password_hash, must_change_password, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, username, u.name.trim().slice(0, 40), email, u.role, 'active', null, 1, now, now)
  return getUser(db, id)!
}

/** The person a login name belongs to: a username, or an email address (case-insensitive both ways). An address that
 *  more than one person uses (old data) matches nobody; those people log in with their username. */
export function getUserByLogin(db: Database, login: string): (User & { passwordHash: string | null }) | null {
  const v = login.trim()
  if (!v) return null
  if (!v.includes('@')) return getUserByUsername(db, v)
  const rows = db.query('SELECT username FROM users WHERE lower(email) = ? LIMIT 2').all(normalizeEmail(v)) as { username: string }[]
  return rows.length === 1 ? getUserByUsername(db, rows[0]!.username) : null
}
