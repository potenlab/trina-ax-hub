// Usage reports for the admin and personal pages. Days follow the server's local calendar.
import type { Database } from 'bun:sqlite'

export type GroupBy = 'user' | 'day' | 'model' | 'group' | 'source'
export interface UsageRow { key: string; label: string; requests: number; inputTokens: number; outputTokens: number; cacheTokens: number; costUsd: number }
export interface UsageReport { from: string; to: string; rows: UsageRow[]; totals: Omit<UsageRow, 'key' | 'label'> }

const AGG = `COUNT(*) AS requests, COALESCE(SUM(u.input_tokens), 0) AS inputTokens, COALESCE(SUM(u.output_tokens), 0) AS outputTokens,
  COALESCE(SUM(u.cache_read + u.cache_write), 0) AS cacheTokens, COALESCE(SUM(u.cost_usd), 0) AS costUsd`

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function usageReport(db: Database, o: { from: Date; to: Date; groupBy: GroupBy; userId?: string }): UsageReport {
  const range = [o.from.toISOString(), o.to.toISOString()]
  const who = o.userId ? ' AND u.user_id = ?' : ''
  const args = o.userId ? [...range, o.userId] : range
  let rows: UsageRow[]
  if (o.groupBy === 'day') {
    const days = new Map<string, UsageRow>()
    const raw = db.query(`SELECT started_at, input_tokens, output_tokens, cache_read, cache_write, cost_usd FROM usage u WHERE started_at >= ? AND started_at < ?${who}`).all(...args) as any[]
    for (const r of raw) {
      const key = localDay(new Date(r.started_at))
      const d = days.get(key) ?? { key, label: key, requests: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0 }
      d.requests++; d.inputTokens += r.input_tokens; d.outputTokens += r.output_tokens; d.cacheTokens += r.cache_read + r.cache_write; d.costUsd += r.cost_usd
      days.set(key, d)
    }
    rows = [...days.values()].sort((a, b) => a.key.localeCompare(b.key))
  } else {
    const sql = {
      user: `SELECT u.user_id AS key, COALESCE(p.name, u.user_id) AS label, ${AGG} FROM usage u LEFT JOIN users p ON p.id = u.user_id WHERE u.started_at >= ? AND u.started_at < ?${who} GROUP BY u.user_id ORDER BY costUsd DESC`,
      model: `SELECT u.model AS key, u.model AS label, ${AGG} FROM usage u WHERE u.started_at >= ? AND u.started_at < ?${who} GROUP BY u.model ORDER BY costUsd DESC`,
      source: `SELECT u.source AS key, CASE u.source WHEN 'pc' THEN 'PC' ELSE '맥미니(휴대폰·예약)' END AS label, ${AGG} FROM usage u WHERE u.started_at >= ? AND u.started_at < ?${who} GROUP BY u.source ORDER BY costUsd DESC`,
      group: `SELECT g.id AS key, g.name AS label, ${AGG} FROM usage u JOIN group_members m ON m.user_id = u.user_id JOIN groups g ON g.id = m.group_id WHERE u.started_at >= ? AND u.started_at < ?${who} GROUP BY g.id ORDER BY costUsd DESC`,
    }[o.groupBy]
    rows = db.query(sql).all(...args) as UsageRow[]
  }
  const totals = db.query(`SELECT ${AGG} FROM usage u WHERE u.started_at >= ? AND u.started_at < ?${who}`).get(...args) as UsageReport['totals']
  return { from: range[0]!, to: range[1]!, rows, totals }
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
  const raw = db.query(`SELECT p.id AS userId, p.name AS name, u.started_at AS at FROM users p LEFT JOIN usage u ON u.user_id = p.id AND u.started_at >= ? AND u.started_at < ? WHERE p.status = 'active'`).all(from.toISOString(), to.toISOString()) as { userId: string; name: string; at: string | null }[]
  const m = new Map<string, { userId: string; name: string; days: Set<string>; lastAt: string | null }>()
  for (const r of raw) {
    const e = m.get(r.userId) ?? { userId: r.userId, name: r.name, days: new Set<string>(), lastAt: null }
    if (r.at) { e.days.add(localDay(new Date(r.at))); if (!e.lastAt || r.at > e.lastAt) e.lastAt = r.at }
    m.set(r.userId, e)
  }
  return [...m.values()].map((e) => ({ userId: e.userId, name: e.name, days: e.days.size, lastAt: e.lastAt })).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))
}

/** Usage rows as CSV (for the admin export). */
export function usageCsv(db: Database, from: Date, to: Date): string {
  const rows = db.query(`SELECT u.started_at, COALESCE(p.username, u.user_id) AS username, u.source, u.model, u.input_tokens, u.output_tokens, u.cache_read, u.cache_write, u.cost_usd, u.status
    FROM usage u LEFT JOIN users p ON p.id = u.user_id WHERE u.started_at >= ? AND u.started_at < ? ORDER BY u.started_at`).all(from.toISOString(), to.toISOString()) as any[]
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const head = 'started_at,username,source,model,input_tokens,output_tokens,cache_read,cache_write,cost_usd,status'
  return [head, ...rows.map((r) => [r.started_at, r.username, r.source, r.model, r.input_tokens, r.output_tokens, r.cache_read, r.cache_write, r.cost_usd.toFixed(6), r.status].map(esc).join(','))].join('\n') + '\n'
}
