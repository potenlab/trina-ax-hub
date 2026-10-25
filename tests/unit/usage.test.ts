// Usage: the daily rollup (backfill, catching up raw inserts, rebuilds), budgets read from it (token rule, block and
// wait), the block message copy, and the CSV export.
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import { openDb } from '../../src/db'
import { ensureUsageRollup, insertUsage, localDay, rebuildUsageRollup, splitRange, syncUsageRollup } from '../../src/usage/rollup'
import { blockMessage, budgetBlock, budgetGate, checkBudgets, createBudget, spend } from '../../src/usage/budgets'
import { activeDays, localDateTime, usageCsv, usageReport } from '../../src/usage/report'
import { parityCheck } from './usage-parity'

function freshDb(): Database {
  const db = openDb(':memory:')
  for (const [id, name] of [['u1', '김민수'], ['u2', '이영희'], ['u3', '=cmd|calc']]) {
    db.query("INSERT INTO users (id, username, name, role, created_at, updated_at) VALUES (?, ?, ?, 'member', 'x', 'x')").run(id, id === 'u1' ? 'minsu' : id, name)
  }
  db.query("INSERT INTO groups (id, name, created_at) VALUES ('g1', '영업', 'x'), ('g2', '개발팀', 'x')").run()
  db.query("INSERT INTO group_members (group_id, user_id) VALUES ('g1', 'u1'), ('g2', 'u1'), ('g2', 'u2')").run()
  return db
}

let n = 0
/** a raw usage row, written the way a test or an import would (not through the relay) */
function raw(db: Database, o: { user?: string; at?: Date; model?: string; source?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: number }) {
  db.query('INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, status, started_at) VALUES (?,?,?,?,?,?,?,?,?,200,?)')
    .run('raw' + ++n, o.user ?? 'u1', o.source ?? 'pc', o.model ?? 'claude-sonnet-5-5', o.input ?? 100, o.output ?? 10, o.cacheRead ?? 0, o.cacheWrite ?? 0, o.cost ?? 0.01, (o.at ?? new Date()).toISOString())
}
const daily = (db: Database) => db.query('SELECT * FROM usage_daily ORDER BY day, user_id, source, model').all()

describe('daily rollup', () => {
  test('rows written directly are picked up by the next read; backfill is idempotent', () => {
    const db = freshDb()
    const today = new Date()
    raw(db, { cost: 0.5 }); raw(db, { cost: 0.25, cacheRead: 9999 }); raw(db, { user: 'u2', cost: 1, at: new Date(today.getTime() - 3 * 86400_000) })
    expect(daily(db)).toHaveLength(0) // nothing read yet
    expect(spend(db, 'user', 'u1', new Date(today.getFullYear(), today.getMonth(), today.getDate())).usd).toBeCloseTo(0.75, 10)
    expect(daily(db)).toHaveLength(2)
    const before = JSON.stringify(daily(db))
    expect(ensureUsageRollup(db)).toEqual({ added: 0, rebuilt: false })
    expect(ensureUsageRollup(db)).toEqual({ added: 0, rebuilt: false })
    expect(JSON.stringify(daily(db))).toBe(before)
    raw(db, { cost: 2 })
    expect(ensureUsageRollup(db)).toEqual({ added: 1, rebuilt: false })
    expect(spend(db, 'user', 'u1', new Date(today.getFullYear(), today.getMonth(), today.getDate())).usd).toBeCloseTo(2.75, 10)
  })

  test('a database with usage from before the rollup existed is backfilled once at startup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trina-usage-'))
    const file = path.join(dir, 'hub.db')
    try {
      let db = openDb(file)
      for (let i = 0; i < 500; i++) raw(db, { user: i % 2 ? 'u1' : 'u2', at: new Date(Date.now() - i * 3600_000), cost: 0.001 })
      // as if the rows had been written by the version before the rollup: forget it
      db.exec('DELETE FROM usage_daily; UPDATE usage_rollup_state SET last_rowid = 0, time_zone = NULL')
      db.close()
      db = openDb(file)
      expect(ensureUsageRollup(db)).toEqual({ added: 500, rebuilt: false })
      expect((db.query('SELECT SUM(requests) AS n, SUM(cost_usd) AS c FROM usage_daily').get() as any)).toMatchObject({ n: 500 })
      expect(ensureUsageRollup(db)).toEqual({ added: 0, rebuilt: false })
      db.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a different server time zone rebuilds the days; removed rows rebuild too', () => {
    const db = freshDb()
    raw(db, {}); raw(db, { user: 'u2' })
    ensureUsageRollup(db)
    const before = JSON.stringify(daily(db))
    db.query("UPDATE usage_rollup_state SET time_zone = 'Mars/Olympus_Mons'").run()
    expect(ensureUsageRollup(db)).toEqual({ added: 2, rebuilt: true })
    expect(JSON.stringify(daily(db))).toBe(before)
    db.query("DELETE FROM usage WHERE user_id = 'u2'").run()
    expect(syncUsageRollup(db)).toBe(1)
    expect((db.query('SELECT SUM(requests) AS n FROM usage_daily').get() as any).n).toBe(1)
    expect(rebuildUsageRollup(db)).toBe(1)
  })

  test('insertUsage writes the row and the rollup together', () => {
    const db = freshDb()
    const at = new Date()
    insertUsage(db, { id: 'x1', userId: 'u1', tokenId: 't', source: 'hub', jobId: 'job1', model: 'claude-opus-5-5', input: 5, output: 6, cacheRead: 7, cacheWrite: 8, costUsd: 0.5, status: 200, startedAt: at.toISOString(), durationMs: 3 })
    expect(daily(db)).toEqual([{ day: localDay(at), user_id: 'u1', source: 'hub', model: 'claude-opus-5-5', requests: 1, input: 5, output: 6, cache_read: 7, cache_write: 8, cost_usd: 0.5, last_at: at.toISOString() }])
    expect(db.query('SELECT job_id, duration_ms FROM usage').get()).toEqual({ job_id: 'job1', duration_ms: 3 })
  })

  test('splitRange: period starts are whole days; other instants leave partial days at the ends', () => {
    const d = (day: number, h = 0, m = 0) => new Date(2026, 9, day, h, m)
    expect(splitRange(d(1), d(26))).toEqual({ days: ['2026-10-01', '2026-10-26'], partial: [] })
    expect(splitRange(d(1), new Date(2026, 10, 1))).toEqual({ days: ['2026-10-01', '2026-11-01'], partial: [] })
    expect(splitRange(d(3, 10), d(5, 7))).toEqual({ days: ['2026-10-04', '2026-10-05'], partial: [{ day: '2026-10-03', from: d(3, 10), to: d(4) }, { day: '2026-10-05', from: d(5), to: d(5, 7) }] })
    expect(splitRange(d(3, 10), d(3, 11))).toEqual({ days: null, partial: [{ day: '2026-10-03', from: d(3, 10), to: d(3, 11) }] })
    expect(splitRange(d(3, 10), d(4))).toEqual({ days: null, partial: [{ day: '2026-10-03', from: d(3, 10), to: d(4) }] })
    expect(splitRange(d(3), d(3, 5))).toEqual({ days: null, partial: [{ day: '2026-10-03', from: d(3), to: d(3, 5) }] })
    expect(splitRange(d(5), d(3))).toEqual({ days: null, partial: [] })
  })

  test('reports and budgets match a brute-force sum over raw rows (this zone; see also the zone runs below)', () => {
    const r = parityCheck(11)
    expect(r.mismatches).toEqual([])
    expect(r.checks).toBeGreaterThan(300)
  })

  test('the same in zones with DST and 30/45-minute offsets', async () => {
    const script = path.join(import.meta.dir, 'usage-parity.ts')
    for (const tz of ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'Pacific/Chatham']) {
      const p = Bun.spawn([process.execPath, script], { env: { ...process.env, TZ: tz }, stdout: 'pipe', stderr: 'pipe' })
      const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited])
      expect(code).toBe(0)
      const res = JSON.parse(out.trim().split('\n').pop()!)
      expect(res.mismatches).toEqual([])
      expect(res.zone.replace('Katmandu', 'Kathmandu')).toBe(tz)
    }
  }, 60_000)

  test('a budget check stays fast with 200,000 rows this month', () => {
    const db = freshDb()
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const ins = db.query("INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, status, started_at) VALUES (?,?,'pc','claude-opus-5-5',1000,200,50000,2000,0.05,200,?)")
    db.transaction(() => { for (let i = 0; i < 200_000; i++) ins.run('p' + i, ['u1', 'u2', 'u3'][i % 3], new Date(start + Math.random() * (now.getTime() - start)).toISOString()) })()
    ensureUsageRollup(db)
    createBudget(db, { subjectType: 'team', subjectId: null, period: 'month', limitUsd: 1e9, limitTokens: null, action: 'block' })
    createBudget(db, { subjectType: 'group', subjectId: 'g2', period: 'month', limitUsd: 1e9, limitTokens: null, action: 'block' })
    createBudget(db, { subjectType: 'user', subjectId: 'u1', period: 'day', limitUsd: 1e9, limitTokens: null, action: 'block' })
    budgetBlock(db, 'u1')
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) expect(budgetBlock(db, 'u1')).toBeNull()
    const each = (performance.now() - t0) / 20
    // scanning the raw rows took ~300 ms here; the rollup ~1 ms
    expect(each).toBeLessThan(25)
    expect(checkBudgets(db, 'u1').find((b) => b.budget.subjectType === 'team')!.budget.usedRequests).toBe(200_000)
  })
})

describe('budgets', () => {
  test('token limits count input + output + cache writes, never cache reads; money is the full cost', () => {
    const db = freshDb()
    raw(db, { input: 1000, output: 500, cacheRead: 150_000, cacheWrite: 2000, cost: 0.3 })
    const day = new Date(); day.setHours(0, 0, 0, 0)
    expect(spend(db, 'user', 'u1', day)).toEqual({ usd: 0.3, tokens: 3500, requests: 1 })
    createBudget(db, { subjectType: 'user', subjectId: 'u1', period: 'day', limitUsd: 0, limitTokens: 3501, action: 'block' })
    expect(budgetBlock(db, 'u1')).toBeNull()
    raw(db, { input: 1, output: 0, cacheRead: 1_000_000, cacheWrite: 0, cost: 0 })
    expect(budgetBlock(db, 'u1')).not.toBeNull()
  })

  test('group and team spend; a group counts its current members', () => {
    const db = freshDb()
    raw(db, { user: 'u1', cost: 1 }); raw(db, { user: 'u2', cost: 2 }); raw(db, { user: 'u3', cost: 4 })
    const day = new Date(); day.setHours(0, 0, 0, 0)
    expect(spend(db, 'group', 'g2', day).usd).toBeCloseTo(3, 10)
    expect(spend(db, 'group', 'g1', day).usd).toBeCloseTo(1, 10)
    expect(spend(db, 'team', null, day).usd).toBeCloseTo(7, 10)
    expect(spend(db, 'user', 'u3', new Date(Date.now() + 86400_000)).usd).toBe(0)
  })

  test('block messages: plain Korean, when it opens again, per person / team / group', () => {
    const now = new Date(2026, 9, 25, 14, 30)
    expect(blockMessage({ subjectType: 'user', subjectName: '김민수', period: 'day' }, now))
      .toBe('오늘 쓸 수 있는 AI 한도를 다 썼어요. 내일(10월 26일) 0시부터 다시 쓸 수 있어요. 더 필요하면 관리자에게 말해 주세요.')
    expect(blockMessage({ subjectType: 'user', subjectName: '김민수', period: 'month' }, now))
      .toBe('이번 달 쓸 수 있는 AI 한도를 다 썼어요. 다음 달 1일부터 다시 쓸 수 있어요. 더 필요하면 관리자에게 말해 주세요.')
    expect(blockMessage({ subjectType: 'team', subjectName: '회사 전체', period: 'month' }, now))
      .toBe('회사 전체의 이번 달 AI 한도를 다 썼어요. 다음 달 1일부터 다시 쓸 수 있어요. 더 필요하면 관리자에게 말해 주세요.')
    expect(blockMessage({ subjectType: 'team', subjectName: '회사 전체', period: 'day' }, new Date(2026, 9, 31, 23, 59)))
      .toBe('회사 전체의 오늘 AI 한도를 다 썼어요. 내일(11월 1일) 0시부터 다시 쓸 수 있어요. 더 필요하면 관리자에게 말해 주세요.')
    expect(blockMessage({ subjectType: 'group', subjectName: '영업', period: 'month' }, now))
      .toBe('영업 팀의 이번 달 AI 한도를 다 썼어요. 다음 달 1일부터 다시 쓸 수 있어요. 더 필요하면 관리자에게 말해 주세요.')
    expect(blockMessage({ subjectType: 'group', subjectName: '개발팀', period: 'day' }, now)).toStartWith('개발팀의 오늘 AI 한도를 다 썼어요.')
  })

  test('budgetGate: used up → block; money left likely taken by running requests → wait; warn budgets never stop anyone', () => {
    const db = freshDb()
    raw(db, { cost: 0.3 }); raw(db, { cost: 0.3 }) // 2 requests, $0.30 each
    createBudget(db, { subjectType: 'user', subjectId: 'u1', period: 'day', limitUsd: 1, limitTokens: null, action: 'block' })
    createBudget(db, { subjectType: 'team', subjectId: null, period: 'day', limitUsd: 0.1, limitTokens: null, action: 'warn' })
    expect(budgetGate(db, 'u1')).toBeNull()
    expect(budgetGate(db, 'u1', { running: () => 0 })).toBeNull()
    expect(budgetGate(db, 'u1', { running: () => 1 })).toBeNull() // 0.6 + 0.3 < 1
    expect(budgetGate(db, 'u1', { running: () => 2 })).toMatchObject({ kind: 'wait', budget: { subjectType: 'user' } }) // 0.6 + 0.6 >= 1
    raw(db, { cost: 0.5 })
    expect(budgetGate(db, 'u1', { running: () => 0 })).toMatchObject({ kind: 'block', message: expect.stringContaining('오늘 쓸 수 있는 AI 한도를 다 썼어요') })
    expect(budgetGate(db, 'u2', { running: () => 5 })).toBeNull() // only the warn budget applies to u2
  })
})

describe('reports', () => {
  test('usage by day, user, group and source; adoption counts distinct days and the last request', () => {
    const db = freshDb()
    const today = new Date(); today.setHours(12, 0, 0, 0)
    const yesterday = new Date(today.getTime() - 86400_000)
    raw(db, { at: today, cost: 1, cacheRead: 5, cacheWrite: 1 }); raw(db, { at: yesterday, cost: 2, source: 'hub' }); raw(db, { user: 'u2', at: today, cost: 4 })
    const from = new Date(yesterday); from.setHours(0, 0, 0, 0)
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const byDay = usageReport(db, { from, to, groupBy: 'day' })
    expect(byDay.rows.map((r) => [r.key, r.requests, r.costUsd])).toEqual([[localDay(yesterday), 1, 2], [localDay(today), 2, 5]])
    expect(byDay.totals).toEqual({ requests: 3, inputTokens: 300, outputTokens: 30, cacheTokens: 6, costUsd: 7 })
    expect(usageReport(db, { from, to, groupBy: 'user' }).rows.map((r) => [r.label, r.costUsd])).toEqual([['이영희', 4], ['김민수', 3]])
    expect(usageReport(db, { from, to, groupBy: 'group' }).rows.map((r) => [r.label, r.costUsd])).toEqual([['개발팀', 7], ['영업', 3]])
    expect(usageReport(db, { from, to, groupBy: 'source', userId: 'u1' }).rows.map((r) => [r.label, r.costUsd])).toEqual([['허브(휴대폰·예약)', 2], ['PC (회사 키)', 1]])
    const ad = activeDays(db, from, to)
    expect(ad.map((a) => [a.userId, a.days, a.lastAt])).toEqual([['u1', 2, today.toISOString()], ['u2', 1, today.toISOString()], ['u3', 0, null]])
  })

  test('CSV: UTF-8 BOM, Korean headers, local time, name, username and groups, plain numbers, no formulas', () => {
    const db = freshDb()
    const at = new Date(2026, 9, 25, 9, 5, 30)
    raw(db, { at, cost: 1.25, input: 1200, output: 300, cacheRead: 5000, cacheWrite: 7 })
    raw(db, { user: 'u3', at: new Date(2026, 9, 25, 10, 0), source: 'hub', cost: 0.0000004 })
    raw(db, { user: 'gone', at: new Date(2026, 9, 25, 11, 0) })
    const csv = usageCsv(db, new Date(2026, 9, 25), new Date(2026, 9, 26))
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trimEnd().split('\n')
    expect(lines[0]).toBe('시각,이름,아이디,그룹,사용처,모델,입력 토큰,출력 토큰,캐시 읽기 토큰,캐시 쓰기 토큰,비용(USD),응답 코드')
    expect(lines[1]).toBe('2026-10-25 09:05,김민수,minsu,"개발팀, 영업",PC (회사 키),claude-sonnet-5-5,1200,300,5000,7,1.250000,200')
    expect(lines[2]).toBe("2026-10-25 10:00,'=cmd|calc,u3,,허브(휴대폰·예약),claude-sonnet-5-5,100,10,0,0,0.000000,200")
    expect(lines[3]).toBe('2026-10-25 11:00,(삭제된 사람),gone,,PC (회사 키),claude-sonnet-5-5,100,10,0,0,0.010000,200')
    expect(lines).toHaveLength(4)
    expect(localDateTime(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 03:04')
  })
})
