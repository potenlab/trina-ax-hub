// Usage reports for the admin and personal pages. Days follow the server's local calendar. Totals come from the daily
// rollup (src/usage/rollup.ts; whole days) plus raw rows for partial days at the ends of a range; the CSV export
// lists raw rows.
import type { Database } from 'bun:sqlite'
import { syncUsageRollup, usageSlice } from './rollup'

export type GroupBy = 'user' | 'day' | 'model' | 'group' | 'source'
export interface UsageRow { key: string; label: string; requests: number; inputTokens: number; outputTokens: number; cacheTokens: number; costUsd: number }
export interface UsageReport { from: string; to: string; rows: UsageRow[]; totals: Omit<UsageRow, 'key' | 'label'> }

const AGG = `COALESCE(SUM(t.requests), 0) AS requests, COALESCE(SUM(t.input), 0) AS inputTokens, COALESCE(SUM(t.output), 0) AS outputTokens,
  COALESCE(SUM(t.cache_read + t.cache_write), 0) AS cacheTokens, COALESCE(SUM(t.cost_usd), 0) AS costUsd`

const SOURCE_LABEL = `CASE t.source WHEN 'pc' THEN 'PC' ELSE '맥미니(휴대폰·예약)' END`

export function usageReport(db: Database, o: { from: Date; to: Date; groupBy: GroupBy; userId?: string }): UsageReport {
  syncUsageRollup(db)
  const s = usageSlice(o.from, o.to, o.userId ? { sql: 'user_id = ?', args: [o.userId] } : undefined)
  const t = `(${s.sql}) t`
  const sql = {
    user: `SELECT t.user_id AS key, COALESCE(p.name, t.user_id) AS label, ${AGG} FROM ${t} LEFT JOIN users p ON p.id = t.user_id GROUP BY t.user_id ORDER BY costUsd DESC`,
    day: `SELECT t.day AS key, t.day AS label, ${AGG} FROM ${t} GROUP BY t.day ORDER BY t.day`,
    model: `SELECT t.model AS key, t.model AS label, ${AGG} FROM ${t} GROUP BY t.model ORDER BY costUsd DESC`,
    source: `SELECT t.source AS key, ${SOURCE_LABEL} AS label, ${AGG} FROM ${t} GROUP BY t.source ORDER BY costUsd DESC`,
    group: `SELECT g.id AS key, g.name AS label, ${AGG} FROM ${t} JOIN group_members m ON m.user_id = t.user_id JOIN groups g ON g.id = m.group_id GROUP BY g.id ORDER BY costUsd DESC`,
  }[o.groupBy]
  const rows = db.query(sql).all(...s.args) as UsageRow[]
  const totals = db.query(`SELECT ${AGG} FROM ${t}`).get(...s.args) as UsageReport['totals']
  return { from: o.from.toISOString(), to: o.to.toISOString(), rows, totals }
}

export interface CountRow { key: string; label: string; count: number; people: number }

/** Skills by use (relay-seen invocations plus skill files read through MCP). */
export function skillReport(db: Database, from: Date, to: Date, userId?: string): CountRow[] {
  const who = userId ? ' AND user_id = ?' : ''
  const args = userId ? [from.toISOString(), to.toISOString(), userId] : [from.toISOString(), to.toISOString()]
  return db.query(`SELECT skill AS key, skill AS label, COUNT(*) AS count, COUNT(DISTINCT user_id) AS people FROM skill_events WHERE at >= ? AND at < ?${who} GROUP BY skill ORDER BY count DESC LIMIT 100`).all(...args) as CountRow[]
}

/** MCP tools by use. */
export function toolReport(db: Database, from: Date, to: Date, userId?: string): CountRow[] {
  const who = userId ? ' AND user_id = ?' : ''
  const args = userId ? [from.toISOString(), to.toISOString(), userId] : [from.toISOString(), to.toISOString()]
  return db.query(`SELECT tool AS key, tool AS label, COUNT(*) AS count, COUNT(DISTINCT user_id) AS people FROM tool_events WHERE at >= ? AND at < ?${who} GROUP BY tool ORDER BY count DESC`).all(...args) as CountRow[]
}

/** People who used AI on how many distinct days in the window (adoption). */
export function activeDays(db: Database, from: Date, to: Date): { userId: string; name: string; days: number; lastAt: string | null }[] {
  syncUsageRollup(db)
  const s = usageSlice(from, to)
  const rows = db.query(`SELECT p.id AS userId, p.name AS name, COUNT(DISTINCT t.day) AS days, MAX(t.last_at) AS lastAt
    FROM users p LEFT JOIN (${s.sql}) t ON t.user_id = p.id WHERE p.status = 'active' GROUP BY p.id`).all(...s.args) as { userId: string; name: string; days: number; lastAt: string | null }[]
  return rows.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))
}

/** Local time as YYYY-MM-DD HH:mm (the server's time zone). */
export function localDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** One CSV cell. Text that a spreadsheet would run as a formula (= + - @ at the start) gets a leading apostrophe. */
function cell(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_HEAD = ['시각', '이름', '아이디', '그룹', '사용처', '모델', '입력 토큰', '출력 토큰', '캐시 읽기 토큰', '캐시 쓰기 토큰', '비용(USD)', '응답 코드']

/** Usage rows as CSV for the admin export: Korean headers, local time, who (name, username, groups), plain numbers.
 * Starts with a UTF-8 byte order mark so Excel reads the Korean text correctly. */
export function usageCsv(db: Database, from: Date, to: Date): string {
  const rows = db.query(`SELECT u.started_at, u.user_id, p.name, p.username, u.source, u.model, u.input_tokens, u.output_tokens, u.cache_read, u.cache_write, u.cost_usd, u.status
    FROM usage u LEFT JOIN users p ON p.id = u.user_id WHERE u.started_at >= ? AND u.started_at < ? ORDER BY u.started_at`).all(from.toISOString(), to.toISOString()) as any[]
  const groups = new Map<string, string[]>()
  for (const g of db.query('SELECT m.user_id, g.name FROM group_members m JOIN groups g ON g.id = m.group_id ORDER BY g.name').all() as { user_id: string; name: string }[]) {
    const list = groups.get(g.user_id) ?? []
    list.push(g.name)
    groups.set(g.user_id, list)
  }
  const lines = rows.map((r) => [
    localDateTime(new Date(r.started_at)), r.name ?? '(삭제된 사람)', r.username ?? r.user_id, (groups.get(r.user_id) ?? []).join(', '),
    r.source === 'pc' ? 'PC' : '맥미니(휴대폰·예약)', r.model, r.input_tokens, r.output_tokens, r.cache_read, r.cache_write,
    r.cost_usd.toFixed(6), r.status,
  ].map(cell).join(','))
  return '\uFEFF' + [CSV_HEAD.join(','), ...lines].join('\n') + '\n'
}
