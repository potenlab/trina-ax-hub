// Who changed a file last (file_changes, migration 170). Bookkeeping only: it never makes a file operation fail.
import type { Database } from 'bun:sqlite'
import { nowIso } from '../db'

export type ChangeSource = 'web' | 'mcp'

const key = (rel: string) => rel.normalize('NFC')
const cpLen = (s: string) => [...s].length // SQLite counts characters, not UTF-16 units

/** `rel` (a file) was created or changed by `userId` just now. */
export function recordChange(db: Database, rel: string, userId: string, source: ChangeSource) {
  try {
    db.query('INSERT INTO file_changes (path, user_id, source, at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET user_id = excluded.user_id, source = excluded.source, at = excluded.at')
      .run(key(rel), userId, source, nowIso())
  } catch { /* bookkeeping only */ }
}

/** A file or folder moved: its rows (and those of everything below a folder) move with it. */
export function moveChange(db: Database, from: string, to: string) {
  try {
    const f = key(from), t = key(to)
    // exact comparisons (LIKE would ignore the case of ASCII letters)
    db.transaction(() => {
      db.query('DELETE FROM file_changes WHERE path = ? OR substr(path, 1, ?) = ?').run(t, cpLen(t) + 1, t + '/')
      db.query('UPDATE file_changes SET path = ? || substr(path, ?) WHERE path = ? OR substr(path, 1, ?) = ?')
        .run(t, cpLen(f) + 1, f, cpLen(f) + 1, f + '/')
    })()
  } catch { /* bookkeeping only */ }
}

/** A file was deleted (trash). */
export function dropChange(db: Database, rel: string) {
  try { db.query('DELETE FROM file_changes WHERE path = ?').run(key(rel)) } catch { /* bookkeeping only */ }
}

export interface LastChange { userId: string | null; userName: string | null; source: ChangeSource; at: string }

/** The last change of file `rel` whose modified time is `mtimeMs`; null when unknown or older than the file itself. */
export function lastChange(db: Database, rel: string, mtimeMs: number): LastChange | null {
  const r = db.query('SELECT c.user_id, c.source, c.at, u.name AS user_name FROM file_changes c LEFT JOIN users u ON u.id = c.user_id WHERE c.path = ?').get(key(rel)) as
    { user_id: string | null; source: ChangeSource; at: string; user_name: string | null } | null
  if (!r || !r.user_name) return null
  // the row is written right after the file is, so it is never older than the file; a file changed behind the hub's
  // back (copied onto the machine) is newer than its row
  if (Date.parse(r.at) < Math.floor(mtimeMs) - 2000) return null
  return { userId: r.user_id, userName: r.user_name, source: r.source, at: r.at }
}
