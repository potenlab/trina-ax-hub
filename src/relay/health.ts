// Relay health for the admin dashboard: the last time Anthropic accepted the company key and the last error it gave
// (credit exhausted, key revoked, overloaded …). The relay writes these settings; pages only read them.
import type { Database } from 'bun:sqlite'
import { getSetting, setSetting } from '../db'

export interface UpstreamError { status: number; type: string; message: string; at: string }
export interface RelayHealth { lastOkAt: string | null; lastError: UpstreamError | null }

const OK_KEY = 'relayLastOkAt'
const ERR_KEY = 'relayLastUpstreamError'

export function relayHealth(db: Database): RelayHealth {
  return { lastOkAt: getSetting<string | null>(db, OK_KEY, null), lastError: getSetting<UpstreamError | null>(db, ERR_KEY, null) }
}

let lastOkWrite = 0
/** Called by the relay after a successful upstream answer (written at most once a minute). */
export function noteUpstreamOk(db: Database, now = Date.now()) {
  if (now - lastOkWrite < 60_000) return
  lastOkWrite = now
  setSetting(db, OK_KEY, new Date(now).toISOString())
}

/** Called by the relay when Anthropic refuses or fails (message trimmed; never a key or a body we sent). */
export function noteUpstreamError(db: Database, e: Omit<UpstreamError, 'at'>, now = Date.now()) {
  setSetting(db, ERR_KEY, { status: e.status, type: e.type.slice(0, 80), message: e.message.slice(0, 300), at: new Date(now).toISOString() })
}

/** The error is still news when nothing has succeeded since. */
export function upstreamProblem(h: RelayHealth): UpstreamError | null {
  if (!h.lastError) return null
  if (h.lastOkAt && h.lastOkAt > h.lastError.at) return null
  return h.lastError
}
