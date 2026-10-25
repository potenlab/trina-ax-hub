// Budgets (ported from Team AX, adapted to the `usage` table). A budget belongs to the team, a group or a person,
// runs per day or per month (server-local calendar), limits USD and/or tokens, and either blocks or only warns.
// Spend is read from the daily rollup (src/usage/rollup.ts), so a check costs the same with 1,000 or 1,000,000 rows.
import type { Database } from 'bun:sqlite'
import { newId } from '../ids'
import { HttpError } from '../http/errors'
import { syncUsageRollup, usageSlice } from './rollup'

export type Period = 'day' | 'month'
export type SubjectType = 'team' | 'group' | 'user'
export interface Budget {
  id: string; subjectType: SubjectType; subjectId: string | null; subjectName: string; period: Period
  limitUsd: number; limitTokens: number | null; action: 'block' | 'warn'; usedUsd: number; usedTokens: number
  /** model requests in the period so far */
  usedRequests: number
}
export interface BudgetInput { subjectType: SubjectType; subjectId: string | null; period: Period; limitUsd: number; limitTokens: number | null; action: 'block' | 'warn' }
interface Row { id: string; subject_type: SubjectType; subject_id: string | null; period: Period; limit_usd: number; limit_tokens: number | null; action: 'block' | 'warn' }

export function periodStart(period: Period, now = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (period === 'month') d.setDate(1)
  return d
}

export function periodEnd(period: Period, now = new Date()): Date {
  const d = periodStart(period, now)
  if (period === 'day') d.setDate(d.getDate() + 1)
  else d.setMonth(d.getMonth() + 1)
  return d
}

/** a local midnight after any usage row */
const FOREVER = new Date(9999, 0, 1)

export interface Spend { usd: number; tokens: number; requests: number }

/**
 * Spend in [from, to): one person / a group's current members / everyone. Money is the full cost. Tokens are
 * input + output + cache writes: cache reads are left out, because Claude Code reads its whole cached context
 * (30k–150k tokens) again on every call and a token limit would otherwise run out in a day while costing little.
 */
export function spend(db: Database, t: SubjectType, id: string | null, from: Date, to: Date = FOREVER): Spend {
  syncUsageRollup(db)
  return spendOf(db, t, id, from, to)
}

function spendOf(db: Database, t: SubjectType, id: string | null, from: Date, to: Date): Spend {
  const who = t === 'user' ? { sql: 'user_id = ?', args: [id ?? ''] }
    : t === 'group' ? { sql: 'user_id IN (SELECT user_id FROM group_members WHERE group_id = ?)', args: [id ?? ''] }
    : undefined
  const s = usageSlice(from, to, who)
  const r = db.query(`SELECT COALESCE(SUM(cost_usd), 0) AS usd, COALESCE(SUM(input + output + cache_write), 0) AS tokens, COALESCE(SUM(requests), 0) AS requests FROM (${s.sql})`).get(...s.args) as Spend
  return { usd: Math.max(0, r.usd), tokens: Math.max(0, r.tokens), requests: r.requests }
}

function subjectName(db: Database, t: SubjectType, id: string | null): string {
  if (t === 'team') return '회사 전체'
  const r = (t === 'group' ? db.query('SELECT name FROM groups WHERE id = ?') : db.query('SELECT name FROM users WHERE id = ?')).get(id) as { name: string } | null
  return r?.name ?? '(삭제됨)'
}

/** (the rollup must be in sync) */
function toBudget(db: Database, r: Row, now = new Date()): Budget {
  const used = spendOf(db, r.subject_type, r.subject_id, periodStart(r.period, now), FOREVER)
  return { id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, subjectName: subjectName(db, r.subject_type, r.subject_id), period: r.period,
    limitUsd: r.limit_usd, limitTokens: r.limit_tokens, action: r.action, usedUsd: used.usd, usedTokens: used.tokens, usedRequests: used.requests }
}

const COLS = 'id, subject_type, subject_id, period, limit_usd, limit_tokens, action'

export function listBudgets(db: Database): Budget[] {
  syncUsageRollup(db)
  return (db.query(`SELECT ${COLS} FROM budgets ORDER BY subject_type DESC, subject_id, period`).all() as Row[]).map((r) => toBudget(db, r))
}

function check(db: Database, b: BudgetInput) {
  if (b.subjectType === 'team') { if (b.subjectId !== null) throw new HttpError(400, 'validation', '회사 전체 예산에는 대상을 고르지 않아요.') }
  else if (!b.subjectId) throw new HttpError(400, 'validation', '대상을 골라 주세요.')
  else if (b.subjectType === 'group' && !db.query('SELECT 1 FROM groups WHERE id = ?').get(b.subjectId)) throw new HttpError(400, 'validation', '없는 그룹이에요.')
  else if (b.subjectType === 'user' && !db.query('SELECT 1 FROM users WHERE id = ?').get(b.subjectId)) throw new HttpError(400, 'validation', '없는 사람이에요.')
  if (!(b.limitUsd >= 0) || (b.limitTokens !== null && !(b.limitTokens > 0))) throw new HttpError(400, 'validation', '한도는 0 이상이어야 해요.')
  if (b.limitUsd === 0 && b.limitTokens === null) throw new HttpError(400, 'validation', '달러 한도나 토큰 한도 중 하나는 정해 주세요.')
}

export function createBudget(db: Database, b: BudgetInput): Budget {
  check(db, b)
  const id = newId()
  db.query(`INSERT INTO budgets (${COLS}) VALUES (?,?,?,?,?,?,?)`).run(id, b.subjectType, b.subjectId, b.period, b.limitUsd, b.limitTokens, b.action)
  syncUsageRollup(db)
  return toBudget(db, db.query(`SELECT ${COLS} FROM budgets WHERE id = ?`).get(id) as Row)
}

export function deleteBudget(db: Database, id: string) {
  if (db.query('DELETE FROM budgets WHERE id = ?').run(id).changes !== 1) throw new HttpError(404, 'not_found', '없는 예산이에요.')
}

const isExceeded = (b: Budget) => (b.limitUsd > 0 && b.usedUsd >= b.limitUsd) || (b.limitTokens !== null && b.usedTokens >= b.limitTokens)

/** Budgets that apply to this person (team, their groups, them), with whether each is used up. */
export function checkBudgets(db: Database, userId: string, now = new Date()): { budget: Budget; exceeded: boolean }[] {
  syncUsageRollup(db)
  const rows = db.query(`SELECT ${COLS} FROM budgets WHERE subject_type = 'team'
    OR (subject_type = 'user' AND subject_id = ?)
    OR (subject_type = 'group' AND subject_id IN (SELECT group_id FROM group_members WHERE user_id = ?))`).all(userId, userId) as Row[]
  return rows.map((r) => {
    const budget = toBudget(db, r, now)
    return { budget, exceeded: isExceeded(budget) }
  })
}

/** What a person reads when a budget stops them (Claude Code shows it as the error). */
export function blockMessage(b: Pick<Budget, 'subjectType' | 'subjectName' | 'period'>, now = new Date()): string {
  const end = periodEnd(b.period, now)
  const when = b.period === 'day' ? `내일(${end.getMonth() + 1}월 ${end.getDate()}일) 0시부터` : '다음 달 1일부터'
  const span = b.period === 'day' ? '오늘' : '이번 달'
  const whose = b.subjectType === 'team' ? `회사 전체의 ${span}`
    : b.subjectType === 'group' ? `${b.subjectName.endsWith('팀') ? b.subjectName : `${b.subjectName} 팀`}의 ${span}`
    : `${span} 쓸 수 있는`
  return `${whose} AI 한도를 다 썼어요. ${when} 다시 쓸 수 있어요. 더 필요하면 관리자에게 말해 주세요.`
}

/** A used-up "block" budget for this person, with the message to show; null = may spend. */
export function budgetBlock(db: Database, userId: string, now = new Date()): { budget: Budget; message: string } | null {
  const hit = checkBudgets(db, userId, now).find((b) => b.exceeded && b.budget.action === 'block')
  return hit ? { budget: hit.budget, message: blockMessage(hit.budget, now) } : null
}

export type BudgetGate =
  /** used up: refuse until the period ends */
  | { kind: 'block'; budget: Budget; message: string }
  /** not used up, but the requests already running for this budget are likely to use up the money left: try again
   * when they are done */
  | { kind: 'wait'; budget: Budget }

/**
 * The check before a model request. Besides used-up budgets it holds back a request when a "block" money limit
 * would probably be passed by what is already running: each running request is assumed to cost what this budget's
 * requests cost on average so far in the period. With nothing running, a request is never held back, so at most the
 * requests already running can overshoot a limit (the relay also caps how many run at once).
 * `running(b)` = how many requests that count against budget b are in flight now.
 */
export function budgetGate(db: Database, userId: string, o: { now?: Date; running?: (b: Budget) => number } = {}): BudgetGate | null {
  const now = o.now ?? new Date()
  const all = checkBudgets(db, userId, now).filter((b) => b.budget.action === 'block')
  const hit = all.find((b) => b.exceeded)
  if (hit) return { kind: 'block', budget: hit.budget, message: blockMessage(hit.budget, now) }
  if (!o.running) return null
  for (const { budget: b } of all) {
    if (!(b.limitUsd > 0) || b.usedRequests === 0) continue
    const n = o.running(b)
    if (n > 0 && b.usedUsd + (b.usedUsd / b.usedRequests) * n >= b.limitUsd) return { kind: 'wait', budget: b }
  }
  return null
}
