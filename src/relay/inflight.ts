// How many model requests are running through the relay right now, per person and for the whole company. Budgets are
// checked before a request and charged after it, so without a cap a burst of parallel requests (subagents, several
// windows) all pass a nearly used-up budget at once. Over the cap the relay answers 429 with a short retry-after;
// Claude Code retries a 429 by itself.
import type { Database } from 'bun:sqlite'
import { getSetting } from '../db'

export const DEFAULT_MAX_PER_USER = 6
export const DEFAULT_MAX_TOTAL = 40
/** settings keys that override the defaults (positive whole numbers) */
export const SETTING_PER_USER = 'relayMaxInflightPerUser'
export const SETTING_TOTAL = 'relayMaxInflight'
/** a slot older than this is dropped (a request whose end was somehow never seen must not block its person for good) */
const STALE_MS = 60 * 60_000

export interface Limits { perUser: number; total: number }

const positive = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback)

export function inflightLimits(db: Database): Limits {
  return {
    perUser: positive(getSetting<unknown>(db, SETTING_PER_USER, null), DEFAULT_MAX_PER_USER),
    total: positive(getSetting<unknown>(db, SETTING_TOTAL, null), DEFAULT_MAX_TOTAL),
  }
}

interface Slot { userId: string; at: number }

export class Inflight {
  private readonly slots = new Set<Slot>()

  /** running requests: all, or one person's */
  count(userId?: string): number {
    this.prune()
    if (userId === undefined) return this.slots.size
    let n = 0
    for (const s of this.slots) if (s.userId === userId) n++
    return n
  }

  /** Takes a slot, or says which cap is full. The release function is safe to call more than once. */
  acquire(userId: string, limits: Limits, now = Date.now()): { release: () => void } | { full: 'user' | 'total' } {
    this.prune(now)
    if (this.slots.size >= limits.total) return { full: 'total' }
    if (this.count(userId) >= limits.perUser) return { full: 'user' }
    const slot: Slot = { userId, at: now }
    this.slots.add(slot)
    return { release: () => { this.slots.delete(slot) } }
  }

  private prune(now = Date.now()) {
    for (const s of this.slots) if (now - s.at > STALE_MS) this.slots.delete(s)
  }
}

const trackers = new WeakMap<Database, Inflight>()

/** The tracker of one hub (keyed by its database; tests run several hubs in one process). */
export function inflightFor(db: Database): Inflight {
  let t = trackers.get(db)
  if (!t) trackers.set(db, t = new Inflight())
  return t
}
