// SQLite (bun:sqlite) with numbered SQL migrations from ../migrations.
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const MIGRATIONS = path.join(import.meta.dir, '..', 'migrations')

export function openDb(file: string): Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const db = new Database(file, { create: true, strict: false })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  if (file !== ':memory:') try { fs.chmodSync(file, 0o600) } catch {}
  return db
}

export function migrate(db: Database) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const done = new Set((db.query('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name))
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
  for (const f of files) {
    if (done.has(f)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString())
    })()
  }
}

export const nowIso = (d = new Date()) => d.toISOString()

export function getSetting<T>(db: Database, key: string, fallback: T): T {
  const r = db.query('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | null
  if (!r) return fallback
  try { return JSON.parse(r.value) as T } catch { return fallback }
}

export function setSetting(db: Database, key: string, value: unknown) {
  db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}
