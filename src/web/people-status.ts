// Where each person is on the way from "invited" to "using it": 초대함 → 가입함 → 연결함 (Claude 앱 또는 PC) → 사용 중.
// "Connected" = a PC token or a live Claude app connection (OAuth refresh row). "Using" = usage or MCP tool calls this
// month, so a person who only works through the Claude app (no usage rows on the hub) still counts.
import type { Database } from 'bun:sqlite'
import { nowIso } from '../db'
import type { User } from '../auth/users'

export type Stage = 'invited' | 'joined' | 'connected' | 'active'
export const STAGE_LABEL: Record<Stage, string> = { invited: '초대함', joined: '가입함', connected: '연결함', active: '사용 중' }

export interface Connections { pcs: number; apps: number }

/** Live PCs (device tokens not revoked) and live Claude app connections per person. */
export function connectionsByUser(db: Database): Map<string, Connections> {
  const out = new Map<string, Connections>()
  const at = (id: string) => { let c = out.get(id); if (!c) { c = { pcs: 0, apps: 0 }; out.set(id, c) } return c }
  for (const r of db.query("SELECT user_id, COUNT(*) AS n FROM tokens WHERE kind = 'device' AND revoked_at IS NULL GROUP BY user_id").all() as { user_id: string; n: number }[]) at(r.user_id).pcs = r.n
  for (const r of db.query('SELECT user_id, COUNT(DISTINCT client_id) AS n FROM oauth_refresh WHERE revoked_at IS NULL AND expires_at > ? GROUP BY user_id').all(nowIso()) as { user_id: string; n: number }[]) at(r.user_id).apps = r.n
  return out
}

/** People with a model request or a tool call in [from, to). */
export function usersWithActivity(db: Database, from: Date, to: Date): Set<string> {
  const a = [from.toISOString(), to.toISOString()]
  const ids = new Set<string>()
  for (const r of db.query('SELECT DISTINCT user_id FROM usage WHERE started_at >= ? AND started_at < ?').all(...a) as { user_id: string }[]) ids.add(r.user_id)
  for (const r of db.query('SELECT DISTINCT user_id FROM tool_events WHERE at >= ? AND at < ?').all(...a) as { user_id: string }[]) ids.add(r.user_id)
  return ids
}

export const isConnected = (c: Connections | undefined) => !!c && (c.pcs > 0 || c.apps > 0)

export function stageOf(u: Pick<User, 'mustChangePassword'>, c: Connections | undefined, active: boolean): Stage {
  // the furthest point reached counts: a PC an admin connected before the person ever logged in is still 연결함
  if (active) return 'active'
  if (isConnected(c)) return 'connected'
  return u.mustChangePassword ? 'invited' : 'joined'
}

/** "앱", "PC 2대", "앱 · PC 1대" */
export function connectionText(c: Connections | undefined): string {
  if (!c) return ''
  const parts: string[] = []
  if (c.apps > 0) parts.push('Claude 앱')
  if (c.pcs > 0) parts.push(`PC ${c.pcs}대`)
  return parts.join(' · ')
}

/** Did this one person use the company AI in [from, to)? Model requests or tool calls. */
export function hasActivity(db: Database, userId: string, from: Date, to: Date): boolean {
  const a = [userId, from.toISOString(), to.toISOString()]
  return !!db.query('SELECT 1 FROM usage WHERE user_id = ? AND started_at >= ? AND started_at < ? LIMIT 1').get(...a)
    || !!db.query('SELECT 1 FROM tool_events WHERE user_id = ? AND at >= ? AND at < ? LIMIT 1').get(...a)
}
