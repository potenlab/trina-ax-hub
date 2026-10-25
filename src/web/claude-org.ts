// What the "Claude 조직 설정" page (/admin/claude, built by another module) saved about the company's Claude account.
// This module only READS the setting `claude_org`; the other module writes it with setSetting(db, 'claude_org', value):
//   { "plan": "team" | "individual" | null, "connectorName": string, "managedSettingsAt": string | null }
import type { Database } from 'bun:sqlite'
import { getSetting } from '../db'

export interface ClaudeOrg {
  /** team = the company has a Claude Team/Enterprise organization; individual = people use their own Pro/Max; null = not said */
  plan: 'team' | 'individual' | null
  /** the name the owner gave the connector in Claude (what people look for in the list) */
  connectorName: string | null
  /** when the owner put the company's Claude Code settings into Claude; null = not done */
  managedSettingsAt: string | null
}

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export function readClaudeOrg(db: Database): ClaudeOrg {
  const v = getSetting<unknown>(db, 'claude_org', null)
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return {
    plan: o.plan === 'team' || o.plan === 'individual' ? o.plan : null,
    connectorName: text(o.connectorName, 60),
    managedSettingsAt: text(o.managedSettingsAt, 40),
  }
}
