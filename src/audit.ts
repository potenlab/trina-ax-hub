import type { Database } from 'bun:sqlite'
import { nowIso } from './db'

export interface AuditEntry { actor: string | null; action: string; target?: string | null; detail?: Record<string, unknown> }

/** Admin actions and security events. Never put a secret, a password or file contents in `detail`. */
export function audit(db: Database, e: AuditEntry) {
  db.query('INSERT INTO audit (actor, action, target, detail, at) VALUES (?, ?, ?, ?, ?)')
    .run(e.actor, e.action, e.target ?? null, e.detail ? JSON.stringify(e.detail).slice(0, 4000) : null, nowIso())
}

export function listAudit(db: Database, limit = 200, before?: number) {
  const rows = before
    ? db.query('SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, limit)
    : db.query('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit)
  return rows as { id: number; actor: string | null; action: string; target: string | null; detail: string | null; at: string }[]
}
