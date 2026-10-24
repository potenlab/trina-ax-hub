// Builds the app from the modules and serves it.
import { createApp, type Register } from './http/app'
import type { Ctx } from './context'
import { register as relay } from './relay/routes'
import { register as mcp } from './mcp/routes'
import { register as skills } from './skills/routes'
import { register as install } from './install/routes'
import { register as hub, start as startHub } from './hub/routes'
import { register as web } from './web/routes'
import { sweepSessions } from './auth/sessions'
import { sweepTokens } from './auth/tokens'
import { sweepEnrollCodes } from './auth/enroll'

export const MODULES: Register[] = [relay, mcp, skills, install, hub, web]

export interface Running { url: string; port: number; stop(): Promise<void> }

export function serve(ctx: Ctx, o: { background?: boolean } = {}): Running {
  const app = createApp(ctx, MODULES)
  const server = Bun.serve({
    hostname: ctx.config.host,
    port: ctx.config.port,
    // model answers stream for minutes; Bun's 10 s default would cut a quiet stream
    idleTimeout: 0,
    maxRequestBodySize: 64 * 1024 * 1024,
    fetch: (req, srv) => app.fetch(req, { ip: srv.requestIP(req)?.address ?? '' }),
  })
  // port 0 = pick a free one; write back the real port so URLs built from the config are right
  if (!ctx.config.port) ctx.config.port = server.port!
  const timers: Timer[] = []
  let stopHub: (() => Promise<void>) | null = null
  if (o.background !== false) {
    const sweep = () => { try { sweepSessions(ctx.db); sweepTokens(ctx.db); sweepEnrollCodes(ctx.db) } catch (e) { ctx.log.warn('sweep failed', { err: String(e) }) } }
    sweep()
    timers.push(setInterval(sweep, 3600_000))
    stopHub = startHub(ctx, `http://127.0.0.1:${server.port}`)
  }
  const url = `http://${ctx.config.host === '0.0.0.0' ? '127.0.0.1' : ctx.config.host}:${server.port}`
  return {
    url,
    port: server.port!,
    async stop() {
      for (const t of timers) clearInterval(t)
      await stopHub?.()
      server.stop(true)
    },
  }
}
