// Live numbers for the "Claude 조직 설정" page.
import type { Database } from 'bun:sqlite'
import { nowIso } from '../db'

export interface OrgStatus {
  /** active people */
  people: number
  /** active people with a live Claude app connection (an unexpired connector token, or a refresh token still valid) */
  connected: number
  /** active people without an email: the org telemetry cannot name them */
  withoutEmail: number
}

export function orgStatus(db: Database): OrgStatus {
  const now = nowIso()
  const one = (sql: string, ...args: string[]) => (db.query(sql).get(...args) as { n: number }).n
  return {
    people: one("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"),
    connected: one(`SELECT COUNT(*) AS n FROM users u WHERE u.status = 'active' AND (
        EXISTS (SELECT 1 FROM tokens t WHERE t.user_id = u.id AND t.kind = 'connector' AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?))
        OR EXISTS (SELECT 1 FROM oauth_refresh r WHERE r.user_id = u.id AND r.revoked_at IS NULL AND r.expires_at > ?))`, now, now),
    withoutEmail: one("SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND (email IS NULL OR trim(email) = '')"),
  }
}
