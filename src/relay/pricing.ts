// What a model request cost, in USD, from the `usage` object the API returns. Prices are USD per million tokens
// (platform.claude.com pricing, 2026-10-25). Admins can override or add entries through the `pricing` setting:
// an array of { match (regex on the model id), input, output, cacheWrite5m, cacheWrite1h, cacheRead }; overrides
// are tried first, then the defaults. A model nothing matches is priced as the most expensive entry.
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { getSetting } from '../db'

export interface Rates { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number }
export interface PriceEntry extends Rates {
  /** regex (case-insensitive) tested against the model id */
  match: string
  /** other rates when the prompt (input + cache reads + cache writes) is over `above` tokens */
  longPrompt?: Rates & { above: number }
}

/** The usage object of a Messages API response (message_start / message_delta / non-streaming body). */
export interface ApiUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null
  server_tool_use?: { web_search_requests?: number | null } | null
  speed?: string | null
  inference_geo?: string | null
}

/** Token numbers of one request, cache writes split by lifetime. */
export interface TokenCounts { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number; webSearches: number }

/** Fast mode (`speed: "fast"`) costs twice the standard rates; caching multipliers apply on top. */
export const FAST_MULTIPLIER = 2
/** US-only inference (`inference_geo: "us"`) costs 1.1x on every token category. */
export const US_GEO_MULTIPLIER = 1.1
/** Web search: $10 per 1,000 searches, on top of tokens. */
export const WEB_SEARCH_USD = 0.01

const rates = (input: number, output: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number): Rates =>
  ({ input, output, cacheWrite5m, cacheWrite1h, cacheRead })
/** A model id of these families, optionally with a date snapshot (`-20251101`) or `-latest`. */
const ids = (families: string) => `^claude-(?:${families})(?:-\\d{8}|-latest)?$`

/** Most specific first: the first entry whose `match` fits wins. */
export const DEFAULT_PRICES: readonly PriceEntry[] = [
  { match: ids('fable-5-1|mythos-5-1'), ...rates(10, 50, 12.5, 20, 0.25) },
  { match: ids('fable-5|mythos-5'), ...rates(10, 50, 12.5, 20, 1) },
  { match: ids('opus-5-5'), ...rates(4, 20, 5, 8, 0.2) },
  { match: ids('opus-5|opus-4-[5-8]'), ...rates(5, 25, 6.25, 10, 0.5) },
  { match: ids('opus-4|opus-4-1'), ...rates(15, 75, 18.75, 30, 1.5) },
  { match: ids('sonnet-5-5'), ...rates(2, 10, 2.5, 4, 0.1) },
  { match: ids('sonnet-5'), ...rates(2, 10, 2.5, 4, 0.2) },
  { match: ids('sonnet-4(?:-\\d)?'), ...rates(3, 15, 3.75, 6, 0.3) },
  { match: ids('haiku-5-5'), ...rates(0.1, 0.5, 0.125, 0.2, 0.01), longPrompt: { above: 100_000, ...rates(0.5, 2.5, 0.625, 1, 0.05) } },
  { match: ids('haiku-4-5'), ...rates(1, 5, 1.25, 2, 0.1) },
]

const price = z.number().finite().nonnegative()
const ratesSchema = { input: price, output: price, cacheWrite5m: price, cacheWrite1h: price, cacheRead: price }
const entrySchema = z.object({
  match: z.string().min(1).max(200),
  ...ratesSchema,
  longPrompt: z.object({ above: z.number().int().positive(), ...ratesSchema }).optional(),
})

interface Compiled { entry: PriceEntry; re: RegExp }

function compile(entries: readonly PriceEntry[]): Compiled[] {
  const out: Compiled[] = []
  for (const entry of entries) {
    try { out.push({ entry, re: new RegExp(entry.match, 'i') }) } catch { /* a bad regex in the setting is skipped */ }
  }
  return out
}

const DEFAULTS = compile(DEFAULT_PRICES)

/** A price table: the given overrides (invalid ones dropped) before the defaults. */
export class PriceTable {
  private readonly table: Compiled[]
  private readonly fallback: PriceEntry

  constructor(overrides: unknown = []) {
    const valid = Array.isArray(overrides)
      ? overrides.flatMap((o) => { const r = entrySchema.safeParse(o); return r.success ? [r.data as PriceEntry] : [] })
      : []
    this.table = [...compile(valid), ...DEFAULTS]
    // unknown models: the dearest entry, so a new model never looks cheaper than it is
    this.fallback = this.table.map((c) => c.entry).reduce((a, b) => (b.output > a.output || (b.output === a.output && b.input > a.input) ? b : a))
  }

  /** The entry that prices this model (the most expensive one when nothing matches). */
  entryFor(model: string): PriceEntry {
    return this.table.find((c) => c.re.test(model))?.entry ?? this.fallback
  }

  costUsd(model: string, usage: ApiUsage): number {
    return costOf(this.entryFor(model), usage)
  }
}

/** The table in effect: the `pricing` setting's overrides, then the defaults. */
export function priceTable(db: Database): PriceTable {
  return new PriceTable(getSetting<unknown>(db, 'pricing', []))
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** Splits cache writes by lifetime: the `cache_creation` breakdown when present, else all 5-minute writes. Any part
 * of `cache_creation_input_tokens` the breakdown does not explain counts as 5-minute writes. */
export function tokenCounts(u: ApiUsage): TokenCounts {
  const total = n(u.cache_creation_input_tokens)
  const w1h = n(u.cache_creation?.ephemeral_1h_input_tokens)
  const w5m = Math.max(n(u.cache_creation?.ephemeral_5m_input_tokens), total - w1h)
  return {
    input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens),
    cacheWrite5m: w5m, cacheWrite1h: w1h, webSearches: n(u.server_tool_use?.web_search_requests),
  }
}

/** Cost of one request under one price entry. */
export function costOf(entry: PriceEntry, usage: ApiUsage): number {
  const t = tokenCounts(usage)
  const prompt = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h
  const r: Rates = entry.longPrompt && prompt > entry.longPrompt.above ? entry.longPrompt : entry
  let tokens = t.input * r.input + t.output * r.output + t.cacheWrite5m * r.cacheWrite5m + t.cacheWrite1h * r.cacheWrite1h + t.cacheRead * r.cacheRead
  if (usage.speed === 'fast') tokens *= FAST_MULTIPLIER
  if (usage.inference_geo === 'us') tokens *= US_GEO_MULTIPLIER
  return tokens / 1e6 + t.webSearches * WEB_SEARCH_USD
}
