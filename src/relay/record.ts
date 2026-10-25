// One `usage` row per model request that reached (or tried to reach) Anthropic, and one `skill_events` row per Skill
// the model invoked. Writing a row must never break the answer, so failures are logged and swallowed.
import type { Ctx } from '../context'
import { newId } from '../ids'
import { nowIso } from '../db'
import { insertUsage } from '../usage/rollup'
import { priceTable, tokenCounts, type ApiUsage } from './pricing'
import type { MessageSink } from './sse'
import { noteStreamError } from './upstream'

export interface Requester {
  userId: string
  tokenId: string
  source: 'pc' | 'hub'
  /** hub job that made the request (hub tokens only) */
  jobId: string | null
}

/**
 * Characters of streamed output per token, for the estimate when a stream ends before message_delta (the client
 * hung up, or the upstream broke off) and the only output number seen is message_start's placeholder.
 * Claude's tokenizer gives roughly 3.5–4 characters per token for English and code and about 1–1.5 for Korean;
 * 2.5 sits between them, so a mixed Korean/English answer is counted about right rather than badly under-counted.
 * Thinking that was not streamed as text (display "omitted") is not seen, so the estimate is a floor; the recorded
 * number is max(reported, estimate).
 */
export const CHARS_PER_TOKEN = 2.5

export function estimateOutputTokens(chars: number): number {
  return chars > 0 ? Math.ceil(chars / CHARS_PER_TOKEN) : 0
}

export class UsageRecorder implements MessageSink {
  /** upstream HTTP status; 0 = Anthropic never answered */
  status = 0
  model: string
  usage: ApiUsage = {}
  outputChars = 0
  finalUsage = false
  private done = false
  private readonly startedAt = nowIso()
  private readonly t0 = performance.now()

  /** `onFinish` runs once, after the row is written (the relay frees the request's in-flight slot there). */
  constructor(private readonly ctx: Ctx, private readonly who: Requester, model: string, private readonly onFinish?: () => void) {
    this.model = model
  }

  skill(name: string) {
    try {
      this.ctx.db.query("INSERT INTO skill_events (user_id, skill, source, at) VALUES (?, ?, 'relay', ?)").run(this.who.userId, name, nowIso())
    } catch (e) {
      this.ctx.log.error('relay: could not record a skill event', { err: String((e as Error)?.message ?? e).slice(0, 200) })
    }
  }

  streamError(type: string, message: string) {
    noteStreamError(this.ctx, type, message)
  }

  /** The usage to record: as reported, with output estimated from the streamed text when the final numbers never
   * arrived. */
  recordedUsage(): ApiUsage {
    if (this.finalUsage || this.outputChars <= 0) return this.usage
    const reported = typeof this.usage.output_tokens === 'number' ? this.usage.output_tokens : 0
    return { ...this.usage, output_tokens: Math.max(reported, estimateOutputTokens(this.outputChars)) }
  }

  /** Writes the usage row once (stream end, client hang-up or upstream failure, whichever comes first). */
  finish() {
    if (this.done) return
    this.done = true
    try {
      const usage = this.recordedUsage()
      const t = tokenCounts(usage)
      const model = this.model.slice(0, 100)
      insertUsage(this.ctx.db, {
        id: newId(), userId: this.who.userId, tokenId: this.who.tokenId, source: this.who.source, jobId: this.who.jobId, model,
        input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite5m + t.cacheWrite1h,
        costUsd: priceTable(this.ctx.db).costUsd(model, usage), status: this.status, startedAt: this.startedAt,
        durationMs: Math.round(performance.now() - this.t0),
      })
    } catch (e) {
      this.ctx.log.error('relay: could not record usage', { err: String((e as Error)?.message ?? e).slice(0, 200) })
    } finally {
      this.onFinish?.()
    }
  }
}
