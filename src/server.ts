// Builds the app from the modules and serves it.
import { createApp, type Register } from './http/app'
import type { Ctx } from './context'
import { register as relay } from './relay/routes'
import { register as mcp } from './mcp/routes'
import { register as skills } from './skills/routes'
import { register as install } from './install/routes'
import { register as hub, start as startHub } from './hub/routes'
import { register as web } from './web/routes'
import { register as telemetry } from './telemetry/routes'
import { register as oauth } from './oauth/routes'
import { sweepSessions } from './auth/sessions'
import { sweepTokens } from './auth/tokens'
import { sweepEnrollCodes } from './auth/enroll'
import { pruneVersions } from './files/versions'
import { UPLOAD_BODY_MAX } from './files/upload'
import { bodyGuard } from './http/body-limit'

export const MODULES: Register[] = [relay, mcp, oauth, skills, install, telemetry, hub, web]

export interface Running { url: string; port: number; stop(): Promise<void> }

export function serve(ctx: Ctx, o: { background?: boolean } = {}): Running {
  const app = createApp(ctx, MODULES)
  // 64 MB for every route; the file upload streams its body to disk and takes up to 200 MB (src/files/upload.ts)
  const guard = bodyGuard({ default: 64 * 1024 * 1024, routes: { '/files/upload': UPLOAD_BODY_MAX } })
  const server = Bun.serve({
    hostname: ctx.config.host,
    port: ctx.config.port,
    // model answers stream for minutes; Bun's 10 s default would cut a quiet stream
    idleTimeout: 0,
    maxRequestBodySize: guard.max,
    fetch: (req, srv) => {
      const r = guard.apply(req)
      return r instanceof Response ? r : app.fetch(r, { ip: srv.requestIP(req)?.address ?? '' })
    },
  })
  // port 0 = pick a free one; write back the real port so URLs built from the config are right
  if (!ctx.config.port) ctx.config.port = server.port!
  const timers: Timer[] = []
  let stopHub: (() => Promise<void>) | null = null
  if (o.background !== false) {
    const sweep = () => {
      try { sweepSessions(ctx.db); sweepTokens(ctx.db); sweepEnrollCodes(ctx.db) } catch (e) { ctx.log.warn('sweep failed', { err: String(e) }) }
      // old file versions and trash: 90 days (the restore page shows what is kept)
      try { const n = pruneVersions(ctx, 90); if (n) ctx.log.info('old file versions removed', { count: n }) } catch (e) { ctx.log.warn('version prune failed', { err: String(e) }) }
    }
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
