// Daily usage rollup (`usage_daily`, migrations/110_usage_daily.sql): usage summed per local day, person, source and
// model. Budget checks run on every model request and must not scan a month of raw rows, so budgets and reports read
// whole days from here and only the partial days at the ends of a range from `usage`.
//
// How it stays right: `usage_rollup_state.last_rowid` is the last `usage` rowid summed in. The relay writes a usage
// row and calls syncUsageRollup in one transaction; every reader calls syncUsageRollup first, which costs two
// point lookups when nothing is new and otherwise sums the rows above the mark (rows written some other way, e.g. an
// import or a test, and the backfill of rows from before this table existed). `usage` rows are only ever added; code
// that deletes or rewrites them must call rebuildUsageRollup afterwards.
import type { Database } from 'bun:sqlite'

/** The server's local calendar day of an instant, YYYY-MM-DD (the same calendar periodStart uses). */
export function localDay(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dayOf = (startedAt: string): string => {
  const d = new Date(startedAt)
  return Number.isNaN(d.getTime()) ? startedAt.slice(0, 10) : localDay(d)
}

/** The time zone days are computed in (a change at startup rebuilds the rollup). */
export const timeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''

/** the most raw rows read into memory at once while catching up */
const BATCH = 20_000

interface State { last_rowid: number; time_zone: string | null }
interface RawRow { rid: number; user_id: string; source: string; model: string; input_tokens: number; output_tokens: number; cache_read: number; cache_write: number; cost_usd: number; started_at: string }
interface Sum { day: string; user_id: string; source: string; model: string; requests: number; input: number; output: number; cache_read: number; cache_write: number; cost_usd: number; last_at: string }

const state = (db: Database) => db.query('SELECT last_rowid, time_zone FROM usage_rollup_state WHERE id = 1').get() as State
const maxRowid = (db: Database) => (db.query('SELECT MAX(rowid) AS m FROM usage').get() as { m: number | null }).m ?? 0

/** Sums the usage rows the rollup has not seen yet into it. Returns how many rows were added. */
export function syncUsageRollup(db: Database): number {
  const s = state(db)
  const max = maxRowid(db)
  if (max === s.last_rowid) return 0
  if (max < s.last_rowid) return rebuildUsageRollup(db) // rows were removed: start over
  let added = 0
  db.transaction(() => {
    const from = state(db).last_rowid // again, inside the write transaction
    const top = maxRowid(db)
    if (top <= from) return
    added = sumRows(db, from, top)
    db.query('UPDATE usage_rollup_state SET last_rowid = ?, time_zone = COALESCE(time_zone, ?) WHERE id = 1').run(top, timeZone())
  }).immediate()
  return added
}

function sumRows(db: Database, from: number, to: number): number {
  const sel = db.query(`SELECT rowid AS rid, user_id, source, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, started_at
    FROM usage WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ${BATCH}`)
  const sums = new Map<string, Sum>()
  let n = 0
  for (let at = from; ;) {
    const rows = sel.all(at, to) as RawRow[]
    if (!rows.length) break
    for (const r of rows) {
      const day = dayOf(r.started_at)
      const key = `${day}\u0000${r.user_id}\u0000${r.source}\u0000${r.model}`
      let s = sums.get(key)
      if (!s) sums.set(key, s = { day, user_id: r.user_id, source: r.source, model: r.model, requests: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, last_at: r.started_at })
      s.requests++
      s.input += r.input_tokens; s.output += r.output_tokens; s.cache_read += r.cache_read; s.cache_write += r.cache_write; s.cost_usd += r.cost_usd
      if (r.started_at > s.last_at) s.last_at = r.started_at
    }
    n += rows.length
    at = rows[rows.length - 1]!.rid
  }
  const up = db.query(`INSERT INTO usage_daily (day, user_id, source, model, requests, input, output, cache_read, cache_write, cost_usd, last_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (day, user_id, source, model) DO UPDATE SET requests = requests + excluded.requests, input = input + excluded.input,
      output = output + excluded.output, cache_read = cache_read + excluded.cache_read, cache_write = cache_write + excluded.cache_write,
      cost_usd = cost_usd + excluded.cost_usd, last_at = MAX(COALESCE(last_at, ''), excluded.last_at)`)
  for (const s of sums.values()) up.run(s.day, s.user_id, s.source, s.model, s.requests, s.input, s.output, s.cache_read, s.cache_write, s.cost_usd, s.last_at)
  return n
}

/** Drops the rollup and sums every usage row again (in the current time zone). Returns how many rows were summed. */
export function rebuildUsageRollup(db: Database): number {
  let n = 0
  db.transaction(() => {
    db.exec('DELETE FROM usage_daily')
    const top = maxRowid(db)
    n = sumRows(db, 0, top)
    db.query('UPDATE usage_rollup_state SET last_rowid = ?, time_zone = ? WHERE id = 1').run(top, timeZone())
  }).immediate()
  return n
}

/** Startup: backfill rows from before the rollup existed (or written while the hub was off) and rebuild when the
 * server's time zone changed. Idempotent; cheap when there is nothing to do. */
export function ensureUsageRollup(db: Database): { added: number; rebuilt: boolean } {
  const s = state(db)
  if (s.time_zone && s.time_zone !== timeZone()) return { added: rebuildUsageRollup(db), rebuilt: true }
  return { added: syncUsageRollup(db), rebuilt: false }
}

/** One usage row as the relay records it. */
export interface UsageInsert {
  id: string; userId: string; tokenId: string | null; source: 'pc' | 'hub'; jobId: string | null; model: string
  input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; status: number; startedAt: string; durationMs: number
}

/** Writes a usage row and adds it to the rollup, in one transaction. */
export function insertUsage(db: Database, u: UsageInsert) {
  db.transaction(() => {
    db.query(`INSERT INTO usage (id, user_id, token_id, source, job_id, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, status, started_at, duration_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(u.id, u.userId, u.tokenId, u.source, u.jobId, u.model, u.input, u.output, u.cacheRead, u.cacheWrite, u.costUsd, u.status, u.startedAt, u.durationMs)
    syncUsageRollup(db)
  }).immediate()
}

// ---- reading ---------------------------------------------------------------------------------------------------

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const nextMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)

export interface RangeSplit {
  /** whole local days [from, to) read from usage_daily, or null */
  days: [string, string] | null
  /** at most two pieces of a single day each (the ends of the range), read from raw usage rows */
  partial: { day: string; from: Date; to: Date }[]
}

/** [from, to) as whole local days plus the partial days at either end. Period starts (local midnight, the 1st of a
 * month) have no partial part. */
export function splitRange(from: Date, to: Date): RangeSplit {
  const out: RangeSplit = { days: null, partial: [] }
  if (!(from.getTime() < to.getTime())) return out
  let a = midnight(from)
  if (a.getTime() < from.getTime()) {
    const next = nextMidnight(from)
    out.partial.push({ day: localDay(from), from, to: next < to ? next : to })
    a = next
  }
  if (a.getTime() >= to.getTime()) return out
  const b = midnight(to)
  if (b.getTime() > a.getTime()) out.days = [localDay(a), localDay(b)]
  if (b.getTime() < to.getTime()) out.partial.push({ day: localDay(b), from: b, to }) // b >= a: a is a midnight before to
  return out
}

/** Columns of a usage slice (rollup granularity). */
export const SLICE_COLS = 'day, user_id, source, model, requests, input, output, cache_read, cache_write, cost_usd, last_at'

/**
 * A SQL subquery giving the usage in [from, to) at rollup granularity (columns SLICE_COLS): whole days from the
 * rollup, partial days from raw rows. `who` filters on `user_id` (e.g. `user_id = ?`). Call syncUsageRollup first.
 */
export function usageSlice(from: Date, to: Date, who?: { sql: string; args: (string | number)[] }): { sql: string; args: (string | number)[] } {
  const split = splitRange(from, to)
  const w = who ? ` AND (${who.sql})` : ''
  const wa = who ? who.args : []
  const parts: string[] = []
  const args: (string | number)[] = []
  if (split.days) {
    parts.push(`SELECT ${SLICE_COLS} FROM usage_daily WHERE day >= ? AND day < ?${w}`)
    args.push(split.days[0], split.days[1], ...wa)
  }
  for (const p of split.partial) {
    parts.push(`SELECT ? AS day, user_id, source, model, 1 AS requests, input_tokens AS input, output_tokens AS output, cache_read, cache_write, cost_usd, started_at AS last_at
      FROM usage WHERE started_at >= ? AND started_at < ?${w}`)
    args.push(p.day, p.from.toISOString(), p.to.toISOString(), ...wa)
  }
  if (!parts.length) return { sql: `SELECT ${SLICE_COLS} FROM usage_daily WHERE 0`, args: [] }
  return { sql: parts.join('\nUNION ALL\n'), args }
}
