// One hub-session service per Ctx: the job runner (with the chat and schedule hooks) and the scheduler.
// Routes reach it through hubFor(ctx); start(ctx, selfUrl) in routes.ts starts it once the server listens.
import type { Ctx } from '../context'
import { dayStart } from '../ui/format'
import { chatHooks } from './chats'
import { HubRunner, type HubOptions } from './runner'
import { Scheduler, scheduleHooks } from './schedules'

export class HubService {
  readonly runner: HubRunner
  readonly scheduler: Scheduler
  private running = false

  constructor(readonly ctx: Ctx, opts: Partial<HubOptions> = {}) {
    this.runner = new HubRunner(ctx, { chat: chatHooks(ctx), schedule: scheduleHooks(ctx) }, opts)
    this.scheduler = new Scheduler(ctx, (o) => this.runner.enqueue(o))
  }

  get started() { return this.running }

  /** `selfUrl` = this server's loopback URL (relay and MCP for the sessions). */
  start(selfUrl: string, o: { scheduler?: boolean } = {}) {
    if (this.running) return
    this.running = true
    this.runner.start(selfUrl)
    if (o.scheduler !== false) this.scheduler.start()
  }

  async stop() {
    this.scheduler.stop()
    await this.runner.stop()
    this.running = false
  }

  /** Counts for admins (no content): running / queued now, finished today. */
  stats() {
    const since = dayStart().toISOString()
    const day = this.ctx.db.query("SELECT status, COUNT(*) AS n FROM hub_jobs WHERE finished_at >= ? GROUP BY status").all(since) as { status: string; n: number }[]
    const count = (s: string) => day.find((r) => r.status === s)?.n ?? 0
    return { ...this.runner.stats(), doneToday: count('done'), failedToday: count('failed') }
  }
}

/** Can the hub run phone chats and scheduled jobs? They run `claude -p` on the hub with the company API key. */
export const hubChatReady = (ctx: Ctx): boolean => !!ctx.config.claudeBin && !!ctx.secrets.getApiKey()

const hubs = new WeakMap<Ctx, HubService>()

/** The hub-session service of this Ctx (created on first use; options apply when it is created). */
export function hubFor(ctx: Ctx, opts?: Partial<HubOptions>): HubService {
  let h = hubs.get(ctx)
  if (!h) { h = new HubService(ctx, opts); hubs.set(ctx, h) }
  else if (opts) Object.assign(h.runner.opts, opts)
  return h
}
