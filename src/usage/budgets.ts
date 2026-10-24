// Budgets (ported from Team AX, adapted to the `usage` table). A budget belongs to the team, a group or a person,
// runs per day or per month (server-local calendar), limits USD and/or tokens, and either blocks or only warns.
import type { Database } from 'bun:sqlite'
import { newId } from '../ids'
import { HttpError } from '../http/errors'

export type Period = 'day' | 'month'
export type SubjectType = 'team' | 'group' | 'user'
export interface Budget {
  id: string; subjectType: SubjectType; subjectId: string | null; subjectName: string; period: Period
  limitUsd: number; limitTokens: number | null; action: 'block' | 'warn'; usedUsd: number; usedTokens: number
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

/** Spend since `from`: one person / a group's current members / everyone. Tokens = input + output + cache. */
export function spend(db: Database, t: SubjectType, id: string | null, from: Date): { usd: number; tokens: number } {
  let where = '1=1'
  const args: string[] = [from.toISOString()]
  if (t === 'user') { where = 'user_id = ?'; args.push(id ?? '') }
  else if (t === 'group') { where = 'user_id IN (SELECT user_id FROM group_members WHERE group_id = ?)'; args.push(id ?? '') }
  const r = db.query(`SELECT COALESCE(SUM(cost_usd), 0) AS usd, COALESCE(SUM(input_tokens + output_tokens + cache_read + cache_write), 0) AS tokens FROM usage WHERE started_at >= ? AND ${where}`).get(...args) as { usd: number; tokens: number }
  return { usd: Math.max(0, r.usd), tokens: Math.max(0, r.tokens) }
}

function subjectName(db: Database, t: SubjectType, id: string | null): string {
  if (t === 'team') return '회사 전체'
  const r = (t === 'group' ? db.query('SELECT name FROM groups WHERE id = ?') : db.query('SELECT name FROM users WHERE id = ?')).get(id) as { name: string } | null
  return r?.name ?? '(삭제됨)'
}

function toBudget(db: Database, r: Row, now = new Date()): Budget {
  const used = spend(db, r.subject_type, r.subject_id, periodStart(r.period, now))
  return { id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, subjectName: subjectName(db, r.subject_type, r.subject_id), period: r.period,
    limitUsd: r.limit_usd, limitTokens: r.limit_tokens, action: r.action, usedUsd: used.usd, usedTokens: used.tokens }
}

const COLS = 'id, subject_type, subject_id, period, limit_usd, limit_tokens, action'

export function listBudgets(db: Database): Budget[] {
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
  return toBudget(db, db.query(`SELECT ${COLS} FROM budgets WHERE id = ?`).get(id) as Row)
}

export function deleteBudget(db: Database, id: string) {
  if (db.query('DELETE FROM budgets WHERE id = ?').run(id).changes !== 1) throw new HttpError(404, 'not_found', '없는 예산이에요.')
}

/** Budgets that apply to this person (team, their groups, them), with whether each is used up. */
export function checkBudgets(db: Database, userId: string, now = new Date()): { budget: Budget; exceeded: boolean }[] {
  const rows = db.query(`SELECT ${COLS} FROM budgets WHERE subject_type = 'team'
    OR (subject_type = 'user' AND subject_id = ?)
    OR (subject_type = 'group' AND subject_id IN (SELECT group_id FROM group_members WHERE user_id = ?))`).all(userId, userId) as Row[]
  return rows.map((r) => {
    const budget = toBudget(db, r, now)
    const exceeded = (budget.limitUsd > 0 && budget.usedUsd >= budget.limitUsd) || (budget.limitTokens !== null && budget.usedTokens >= budget.limitTokens)
    return { budget, exceeded }
  })
}

/** A used-up "block" budget for this person, with the message to show; null = may spend. */
export function budgetBlock(db: Database, userId: string, now = new Date()): { budget: Budget; message: string } | null {
  const hit = checkBudgets(db, userId, now).find((b) => b.exceeded && b.budget.action === 'block')
  if (!hit) return null
  const at = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(periodEnd(hit.budget.period, now))
  const p = hit.budget.period === 'day' ? '오늘' : '이번 달'
  return { budget: hit.budget, message: `${p} AI 사용 한도(${hit.budget.subjectName})를 다 썼어요. ${at}부터 다시 쓸 수 있어요. 더 필요하면 관리자에게 말해 주세요.` }
}
