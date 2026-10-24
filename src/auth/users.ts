// People and groups. Roles: owner (one, can do everything), admin (manages people, folders, budgets), member.
import type { Database } from 'bun:sqlite'
import { newId } from '../ids'
import { nowIso } from '../db'
import { HttpError } from '../http/errors'

export type Role = 'owner' | 'admin' | 'member'
export interface User {
  id: string; username: string; name: string; email: string | null; role: Role; status: 'active' | 'disabled'
  mustChangePassword: boolean; createdAt: string; groups: { id: string; name: string }[]
}
interface Row { id: string; username: string; name: string; email: string | null; role: Role; status: 'active' | 'disabled'; must_change_password: number; created_at: string }

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/i

function toUser(db: Database, r: Row): User {
  const groups = db.query('SELECT g.id, g.name FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.name').all(r.id) as { id: string; name: string }[]
  return { id: r.id, username: r.username, name: r.name, email: r.email, role: r.role, status: r.status, mustChangePassword: !!r.must_change_password, createdAt: r.created_at, groups }
}

export function getUser(db: Database, id: string): User | null {
  const r = db.query('SELECT * FROM users WHERE id = ?').get(id) as Row | null
  return r ? toUser(db, r) : null
}

export function getUserByUsername(db: Database, username: string): (User & { passwordHash: string | null }) | null {
  const r = db.query('SELECT * FROM users WHERE username = ?').get(username) as (Row & { password_hash: string | null }) | null
  return r ? { ...toUser(db, r), passwordHash: r.password_hash } : null
}

export function listUsers(db: Database): User[] {
  return (db.query("SELECT * FROM users ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name").all() as Row[]).map((r) => toUser(db, r))
}

export function countUsers(db: Database): number {
  return (db.query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
}

export async function createUser(db: Database, u: { username: string; name: string; email?: string | null; role: Role; password: string; mustChangePassword?: boolean }): Promise<User> {
  const username = u.username.trim()
  if (!USERNAME.test(username)) throw new HttpError(400, 'validation', '아이디는 영문·숫자·._- 2~32자로 정해 주세요.')
  if (!u.name.trim()) throw new HttpError(400, 'validation', '이름을 입력해 주세요.')
  if (u.password.length < 8) throw new HttpError(400, 'validation', '비밀번호는 8자 이상이어야 해요.')
  if (u.role === 'owner' && db.query("SELECT 1 FROM users WHERE role = 'owner'").get()) throw new HttpError(400, 'validation', '소유자는 한 명만 둘 수 있어요.')
  if (db.query('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'conflict', '이미 있는 아이디예요.')
  const id = newId()
  const now = nowIso()
  const hash = await Bun.password.hash(u.password)
  db.query('INSERT INTO users (id, username, name, email, role, status, password_hash, must_change_password, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, username, u.name.trim(), u.email?.trim() || null, u.role, 'active', hash, u.mustChangePassword ? 1 : 0, now, now)
  return getUser(db, id)!
}

export function updateUser(db: Database, id: string, p: { name?: string; email?: string | null; role?: Role; status?: 'active' | 'disabled' }): User {
  const cur = getUser(db, id)
  if (!cur) throw new HttpError(404, 'not_found', '없는 사람이에요.')
  if (cur.role === 'owner' && ((p.role && p.role !== 'owner') || p.status === 'disabled')) throw new HttpError(400, 'validation', '소유자의 역할은 바꾸거나 끌 수 없어요.')
  if (p.role === 'owner' && cur.role !== 'owner') throw new HttpError(400, 'validation', '소유자는 한 명만 둘 수 있어요.')
  db.query('UPDATE users SET name = ?, email = ?, role = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(p.name?.trim() || cur.name, p.email !== undefined ? (p.email?.trim() || null) : cur.email, p.role ?? cur.role, p.status ?? cur.status, nowIso(), id)
  if (p.status === 'disabled') {
    db.query('DELETE FROM sessions WHERE user_id = ?').run(id)
    db.query('UPDATE tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), id)
  }
  return getUser(db, id)!
}

export async function setPassword(db: Database, id: string, password: string, mustChange = false) {
  if (password.length < 8) throw new HttpError(400, 'validation', '비밀번호는 8자 이상이어야 해요.')
  const hash = await Bun.password.hash(password)
  db.query('UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?').run(hash, mustChange ? 1 : 0, nowIso(), id)
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (!hash) return false
  try { return await Bun.password.verify(password, hash) } catch { return false }
}

// groups ---------------------------------------------------------------------------------------------------------------
export function listGroups(db: Database) {
  return db.query('SELECT g.id, g.name, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members FROM groups g ORDER BY g.name').all() as { id: string; name: string; members: number }[]
}

export function createGroup(db: Database, name: string) {
  const n = name.trim()
  if (!n || n.length > 40) throw new HttpError(400, 'validation', '그룹 이름은 1~40자로 정해 주세요.')
  if (db.query('SELECT 1 FROM groups WHERE name = ?').get(n)) throw new HttpError(409, 'conflict', '이미 있는 그룹이에요.')
  const id = newId()
  db.query('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(id, n, nowIso())
  return { id, name: n }
}

export function deleteGroup(db: Database, id: string) {
  db.query("DELETE FROM folder_rules WHERE subject_type = 'group' AND subject_id = ?").run(id)
  db.query("DELETE FROM budgets WHERE subject_type = 'group' AND subject_id = ?").run(id)
  db.query('DELETE FROM groups WHERE id = ?').run(id)
}

export function setUserGroups(db: Database, userId: string, groupIds: string[]) {
  db.transaction(() => {
    db.query('DELETE FROM group_members WHERE user_id = ?').run(userId)
    for (const g of new Set(groupIds)) {
      if (db.query('SELECT 1 FROM groups WHERE id = ?').get(g)) db.query('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(g, userId)
    }
  })()
}
