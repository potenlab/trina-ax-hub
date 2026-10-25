// Telemetry that arrives with the org token names its person by email (`user.email`, which Claude Code and Cowork put
// on every event once the person is signed in to Claude). This file maps an email to a hub person, keeps the list of
// emails the hub does not know, and the small "last received" status the admin page shows.
//
// The email is whatever the sender wrote: every member holds the org token, so a member could name someone else. The
// numbers are for the admin's overview (subscription usage never blocks anyone and is not in company budgets), not
// for billing. The page says so.
import type { Database } from 'bun:sqlite'
import { getSetting, setSetting } from '../db'

/** Distinct unknown emails kept (the latest ones win). */
export const UNKNOWN_EMAIL_CAP = 50

/** `user.email` as the hub compares it: trimmed, lower case, one address. Null when it is not an email. */
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  return e.length <= 254 && /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}$/.test(e) ? e : null
}

/** email → person id of the active people, or AMBIGUOUS when two active people share it. */
export const AMBIGUOUS = Symbol('ambiguous')
export type EmailIndex = Map<string, string | typeof AMBIGUOUS>

export function emailIndex(db: Database): EmailIndex {
  const idx: EmailIndex = new Map()
  for (const r of db.query("SELECT id, email FROM users WHERE status = 'active' AND email IS NOT NULL").all() as { id: string; email: string }[]) {
    const e = normalizeEmail(r.email)
    if (!e) continue
    idx.set(e, idx.has(e) ? AMBIGUOUS : r.id)
  }
  return idx
}

// unknown emails ------------------------------------------------------------------------------------------------------

export interface UnknownEmail {
  email: string
  records: number
  firstSeen: string
  lastSeen: string
  /** more than one active person has this email, so the hub cannot tell whose it is */
  ambiguous: boolean
}

/** Add counts for emails with no (single) hub person, then keep only the latest UNKNOWN_EMAIL_CAP. */
export function recordUnknownEmails(db: Database, counts: ReadonlyMap<string, number>, at: string) {
  if (!counts.size) return
  db.transaction(() => {
    const up = db.query(`INSERT INTO org_unknown_emails (email, records, first_seen, last_seen) VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET records = records + excluded.records, last_seen = excluded.last_seen`)
    for (const [email, n] of counts) up.run(email, n, at, at)
    db.query(`DELETE FROM org_unknown_emails WHERE email NOT IN
      (SELECT email FROM org_unknown_emails ORDER BY last_seen DESC, rowid DESC LIMIT ${UNKNOWN_EMAIL_CAP})`).run()
  })()
}

/** The list for the admin page, newest first. Emails that a person has since been given are dropped from it. */
export function listUnknownEmails(db: Database): UnknownEmail[] {
  const idx = emailIndex(db)
  const rows = db.query('SELECT email, records, first_seen AS firstSeen, last_seen AS lastSeen FROM org_unknown_emails ORDER BY last_seen DESC, rowid DESC').all() as Omit<UnknownEmail, 'ambiguous'>[]
  const out: UnknownEmail[] = []
  for (const r of rows) {
    const who = idx.get(r.email)
    if (typeof who === 'string') { db.query('DELETE FROM org_unknown_emails WHERE email = ?').run(r.email); continue }
    out.push({ ...r, ambiguous: who === AMBIGUOUS })
  }
  return out
}

export function clearUnknownEmails(db: Database) {
  db.query('DELETE FROM org_unknown_emails').run()
}

// last received -------------------------------------------------------------------------------------------------------

const STATS_KEY = 'claude_org_ingest'

export interface OrgIngestStats {
  /** when the last request carrying events arrived with the org token (null = never, or since the token was replaced) */
  lastAt: string | null
  /** events of that request that were stored for a person */
  lastStored: number
  /** events without any email since the token was made (the sender was not signed in to Claude) */
  missingEmail: number
}

const NONE: OrgIngestStats = { lastAt: null, lastStored: 0, missingEmail: 0 }

export function orgIngestStats(db: Database): OrgIngestStats {
  const v = getSetting<Partial<OrgIngestStats> | null>(db, STATS_KEY, null)
  if (!v || typeof v !== 'object') return { ...NONE }
  return {
    lastAt: typeof v.lastAt === 'string' ? v.lastAt : null,
    lastStored: Number.isFinite(v.lastStored) ? Number(v.lastStored) : 0,
    missingEmail: Number.isFinite(v.missingEmail) ? Number(v.missingEmail) : 0,
  }
}

export function recordOrgIngest(db: Database, r: { at: string; stored: number; missingEmail: number }) {
  const cur = orgIngestStats(db)
  setSetting(db, STATS_KEY, { lastAt: r.at, lastStored: r.stored, missingEmail: cur.missingEmail + r.missingEmail } satisfies OrgIngestStats)
}

/** A new org token starts a new count (the unknown-email list stays: those people still need an email). */
export function resetOrgIngestStats(db: Database) {
  setSetting(db, STATS_KEY, NONE)
}

/** People whose usage arrived with an org token in the last `days` days. */
export function orgReportingPeople(db: Database, days = 7): number {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const r = db.query(`SELECT COUNT(*) AS n FROM (
      SELECT user_id FROM usage WHERE started_at >= ? AND token_id IN (SELECT id FROM tokens WHERE kind = 'org')
      UNION
      SELECT user_id FROM tool_events WHERE at >= ? AND token_id IN (SELECT id FROM tokens WHERE kind = 'org'))`).get(since, since) as { n: number }
  return r.n
}
