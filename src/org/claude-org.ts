// The "Claude 조직 설정" setting (setting key `claude_org`), shared with the employee first-run page, which only READS it.
//
//   { "plan": "team" | "individual" | null, "connectorName": string, "managedSettingsAt": string | null }
//
//   plan               which Claude plan the company is on, picked at step 0 of /admin/claude. null = not picked yet,
//                      or the company uses its own API key (then see `companyKeyChosen`)
//   connectorName      what the admin names the connector in Claude ("<회사 이름> AI" until changed)
//   managedSettingsAt  when the admin said "붙여 넣었어요" (ISO). Set back to null whenever the org token is replaced,
//                      because the pasted JSON then no longer works
//   companyKeyChosen   step 0 was answered "회사 API 키" (extra, optional; readers of the three fields can ignore it)
//
// Readers never get a malformed value: whatever is stored is cleaned on the way out.
import type { Database } from 'bun:sqlite'
import { getSetting, setSetting } from '../db'
import { PRODUCT } from '../product'

export const CLAUDE_ORG_KEY = 'claude_org'

export type ClaudeOrgPlan = 'team' | 'individual'

export interface ClaudeOrg {
  plan: ClaudeOrgPlan | null
  connectorName: string
  managedSettingsAt: string | null
  companyKeyChosen?: boolean
}

const MAX_NAME = 60

function companyNameOf(db: Database): string {
  const v = getSetting<unknown>(db, 'companyName', '')
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : PRODUCT.displayName
}

/** The suggested connector name: "<회사 이름> AI". */
export const defaultConnectorName = (db: Database) => `${companyNameOf(db)} AI`.slice(0, MAX_NAME)

/** Plain text on one line (names end up in Claude's screens and in our pages). */
export function cleanConnectorName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : ''
}

export function getClaudeOrg(db: Database): ClaudeOrg {
  const raw = getSetting<Partial<Record<keyof ClaudeOrg, unknown>> | null>(db, CLAUDE_ORG_KEY, null)
  const v = raw && typeof raw === 'object' ? raw : {}
  const at = typeof v.managedSettingsAt === 'string' && !Number.isNaN(Date.parse(v.managedSettingsAt)) ? v.managedSettingsAt : null
  const out: ClaudeOrg = {
    plan: v.plan === 'team' || v.plan === 'individual' ? v.plan : null,
    connectorName: cleanConnectorName(v.connectorName) || defaultConnectorName(db),
    managedSettingsAt: at,
  }
  if (v.companyKeyChosen === true && out.plan === null) out.companyKeyChosen = true
  return out
}

/** Change some fields; the rest stay. Returns what is stored now. */
export function setClaudeOrg(db: Database, patch: Partial<ClaudeOrg>): ClaudeOrg {
  const cur = getClaudeOrg(db)
  const next: ClaudeOrg = { ...cur, ...patch }
  next.connectorName = cleanConnectorName(next.connectorName) || defaultConnectorName(db)
  if (next.plan !== null) delete next.companyKeyChosen
  else if (!next.companyKeyChosen) delete next.companyKeyChosen
  setSetting(db, CLAUDE_ORG_KEY, next)
  return getClaudeOrg(db)
}
