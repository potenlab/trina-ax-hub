// One `usage` row per model request that reached (or tried to reach) Anthropic, and one `skill_events` row per Skill
// the model invoked. Writing a row must never break the answer, so failures are logged and swallowed.
import type { Ctx } from '../context'
import { newId } from '../ids'
import { nowIso } from '../db'
import { priceTable, tokenCounts, type ApiUsage } from './pricing'
import type { MessageSink } from './sse'

export interface Requester {
  userId: string
  tokenId: string
  source: 'pc' | 'hub'
  /** hub job that made the request (hub tokens only) */
  jobId: string | null
}

export class UsageRecorder implements MessageSink {
  /** upstream HTTP status; 0 = Anthropic never answered */
  status = 0
  model: string
  usage: ApiUsage = {}
  private done = false
  private readonly startedAt = nowIso()
  private readonly t0 = performance.now()

  constructor(private readonly ctx: Ctx, private readonly who: Requester, model: string) {
    this.model = model
  }

  skill(name: string) {
    try {
      this.ctx.db.query("INSERT INTO skill_events (user_id, skill, source, at) VALUES (?, ?, 'relay', ?)").run(this.who.userId, name, nowIso())
    } catch (e) {
      this.ctx.log.error('relay: could not record a skill event', { err: String((e as Error)?.message ?? e).slice(0, 200) })
    }
  }

  /** Writes the usage row once (stream end, client hang-up or upstream failure, whichever comes first). */
  finish() {
    if (this.done) return
    this.done = true
    try {
      const t = tokenCounts(this.usage)
      const model = this.model.slice(0, 100)
      const cost = priceTable(this.ctx.db).costUsd(model, this.usage)
      this.ctx.db.query(`INSERT INTO usage (id, user_id, token_id, source, job_id, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, status, started_at, duration_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId(), this.who.userId, this.who.tokenId, this.who.source, this.who.jobId, model,
        t.input, t.output, t.cacheRead, t.cacheWrite5m + t.cacheWrite1h, cost, this.status, this.startedAt, Math.round(performance.now() - this.t0))
    } catch (e) {
      this.ctx.log.error('relay: could not record usage', { err: String((e as Error)?.message ?? e).slice(0, 200) })
    }
  }
}
