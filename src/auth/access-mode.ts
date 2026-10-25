// How a person reaches Claude (migrations/004_access_modes.sql):
//   subscription  their own Claude subscription (Team seat, Pro, Max) signed in on their PC. The hub never sees or
//                 relays that login; it supplies files (MCP), skills (plugin) and collects usage from telemetry.
//   company_key   model calls go through the hub's relay, billed to the company's Anthropic API key, with budgets.
// A person's own setting wins; otherwise the company default (setting `defaultModelAccess`, initially subscription).
import type { Database } from 'bun:sqlite'
import { getSetting, setSetting } from '../db'
import { HttpError } from '../http/errors'

export type ModelAccess = 'subscription' | 'company_key'
export const MODEL_ACCESS: ModelAccess[] = ['subscription', 'company_key']
export const MODEL_ACCESS_LABEL: Record<ModelAccess, string> = { subscription: '각자 Claude 구독', company_key: '회사 API 키' }

const isAccess = (v: unknown): v is ModelAccess => v === 'subscription' || v === 'company_key'

export function defaultModelAccess(db: Database): ModelAccess {
  const v = getSetting<unknown>(db, 'defaultModelAccess', 'subscription')
  return isAccess(v) ? v : 'subscription'
}

export function setDefaultModelAccess(db: Database, v: ModelAccess) {
  if (!isAccess(v)) throw new HttpError(400, 'validation', '구독 또는 회사 키 중에서 골라 주세요.')
  setSetting(db, 'defaultModelAccess', v)
}

/** The person's own choice (null = company default). */
export function userModelAccess(db: Database, userId: string): ModelAccess | null {
  const r = db.query('SELECT model_access FROM users WHERE id = ?').get(userId) as { model_access: string | null } | null
  return r && isAccess(r.model_access) ? r.model_access : null
}

/** What applies to this person now. */
export function modelAccessFor(db: Database, userId: string): ModelAccess {
  return userModelAccess(db, userId) ?? defaultModelAccess(db)
}

export function setUserModelAccess(db: Database, userId: string, v: ModelAccess | null) {
  if (v !== null && !isAccess(v)) throw new HttpError(400, 'validation', '구독 또는 회사 키 중에서 골라 주세요.')
  db.query('UPDATE users SET model_access = ? WHERE id = ?').run(v, userId)
}
