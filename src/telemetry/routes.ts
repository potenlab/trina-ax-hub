// Usage from PCs that use their own Claude subscription. Claude Code's OpenTelemetry export (logs, OTLP/HTTP JSON)
// sends one `claude_code.api_request` event per model call with the model, token counts and an estimated cost; the
// installer points it here with the PC's device token (settings.json env, see src/install/enroll.ts).
//
//   POST /otel/v1/logs     events → usage rows (source 'sub'), skill and tool counts
//   POST /otel/v1/metrics  accepted and ignored (the events carry everything we show)
//
// Nothing here relays or sees the person's Claude login. Prompt text is never stored (Claude Code redacts it unless
// OTEL_LOG_USER_PROMPTS is set, and we ignore user_prompt events anyway).
import type { Register } from '../http/app'
import { requireToken } from '../http/app'
import { jsonError } from '../http/errors'
import type { Ctx } from '../context'
import { newId } from '../ids'
import { nowIso } from '../db'
import { insertUsage } from '../usage/rollup'
import { modelAccessFor } from '../auth/access-mode'

const MAX_BODY = 5 * 1024 * 1024
const MODEL_RE = /^[a-z0-9][a-z0-9.@:_-]{0,99}$/i

type AnyValue = { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean }
type KeyValue = { key?: string; value?: AnyValue }

const val = (v: AnyValue | undefined): string | number | boolean | undefined => {
  if (!v || typeof v !== 'object') return undefined
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return typeof v.intValue === 'string' ? Number(v.intValue) : v.intValue
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  return undefined
}

function attrs(list: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (!Array.isArray(list)) return out
  for (const kv of list as KeyValue[]) {
    if (!kv || typeof kv.key !== 'string') continue
    const v = val(kv.value)
    if (v !== undefined) out[kv.key] = v
  }
  return out
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : 0
}
const int = (v: unknown) => Math.min(Math.round(num(v)), 1e9)
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '')

/** The event's time: `event.timestamp` (ISO) or the record's timeUnixNano, else now. Never more than a day ahead. */
function eventTime(a: Record<string, unknown>, rec: { timeUnixNano?: string | number; observedTimeUnixNano?: string | number }): string {
  const iso = typeof a['event.timestamp'] === 'string' ? Date.parse(a['event.timestamp'] as string) : NaN
  const nano = Number(rec.timeUnixNano ?? rec.observedTimeUnixNano ?? NaN)
  const ms = Number.isFinite(iso) ? iso : Number.isFinite(nano) && nano > 0 ? Math.floor(nano / 1e6) : Date.now()
  return new Date(Math.min(ms, Date.now() + 86_400_000)).toISOString()
}

export interface IngestResult { requests: number; skills: number; tools: number; ignored: number }

/** Record the events of one OTLP logs request for this person (exported for tests). */
export function ingestLogs(ctx: Ctx, who: { userId: string; tokenId: string }, body: unknown): IngestResult {
  const res: IngestResult = { requests: 0, skills: 0, tools: 0, ignored: 0 }
  const resourceLogs = (body as { resourceLogs?: unknown })?.resourceLogs
  if (!Array.isArray(resourceLogs)) return res
  // a person on the company key is already counted by the relay; telemetry would count them twice
  const countRequests = modelAccessFor(ctx.db, who.userId) === 'subscription'
  const skill = ctx.db.query('INSERT INTO skill_events (user_id, skill, source, at) VALUES (?, ?, ?, ?)')
  const tool = ctx.db.query('INSERT INTO tool_events (user_id, token_id, tool, summary, ok, at) VALUES (?, ?, ?, ?, ?, ?)')
  for (const rl of resourceLogs as { resource?: { attributes?: unknown }; scopeLogs?: unknown }[]) {
    const resAttrs = attrs(rl?.resource?.attributes)
    for (const sl of (Array.isArray(rl?.scopeLogs) ? rl.scopeLogs : []) as { logRecords?: unknown }[]) {
      for (const rec of (Array.isArray(sl?.logRecords) ? sl.logRecords : []) as Record<string, any>[]) {
        const a: Record<string, unknown> = { ...resAttrs, ...attrs(rec?.attributes) }
        const bodyName = typeof rec?.body?.stringValue === 'string' ? rec.body.stringValue : ''
        const name = String(a['event.name'] ?? bodyName).replace(/^claude_code\./, '')
        const at = eventTime(a, rec ?? {})
        if (name === 'api_request') {
          if (!countRequests) { res.ignored++; continue }
          const model = str(a['model'], 100)
          if (!MODEL_RE.test(model)) { res.ignored++; continue }
          // the same event sent twice (an exporter retry) must count once
          const seq = str(a['event.sequence'], 40) || str(a['request_id'], 120)
          const session = str(a['session.id'], 80)
          const extId = seq && session ? `otel:${who.userId}:${session}:${seq}` : null
          insertUsage(ctx.db, {
            id: newId(), userId: who.userId, tokenId: who.tokenId, source: 'sub', jobId: null, model,
            input: int(a['input_tokens']), output: int(a['output_tokens']), cacheRead: int(a['cache_read_tokens']), cacheWrite: int(a['cache_creation_tokens']),
            costUsd: Math.min(num(a['cost_usd']), 10_000), status: 200, startedAt: at, durationMs: int(a['duration_ms']), extId,
          })
          res.requests++
        } else if (name === 'skill_activated') {
          const s = str(a['skill.name'], 120)
          // third-party plugin skills arrive as the placeholder "custom_skill" unless tool details are on
          if (s && s !== 'custom_skill') { skill.run(who.userId, s.replace(/^company:/, ''), 'telemetry', at); res.skills++ } else res.ignored++
        } else if (name === 'tool_result') {
          const t = str(a['tool_name'], 64)
          // MCP calls to this hub are already in tool_events from the MCP endpoint itself
          if (!t || t === 'mcp_tool' || t.startsWith('mcp__')) { res.ignored++; continue }
          tool.run(who.userId, who.tokenId, `pc:${t}`, '', String(a['success']) === 'false' ? 0 : 1, at)
          res.tools++
        } else res.ignored++
      }
    }
  }
  return res
}

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > MAX_BODY) throw new Error('too large')
  let bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.length > MAX_BODY) throw new Error('too large')
  if ((req.headers.get('content-encoding') ?? '').toLowerCase() === 'gzip') {
    bytes = Bun.gunzipSync(bytes)
    if (bytes.length > MAX_BODY * 4) throw new Error('too large')
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export const register: Register = (app, ctx) => {
  app.use('/otel/*', requireToken(ctx, 'json'))

  app.post('/otel/v1/logs', async (c) => {
    const auth = c.get('tokenAuth')!
    if (!(c.req.header('content-type') ?? '').includes('json')) return jsonError(415, 'unsupported', 'OTLP/HTTP JSON만 받아요 (OTEL_EXPORTER_OTLP_PROTOCOL=http/json).')
    let body: unknown
    try { body = await readJson(c.req.raw) } catch { return jsonError(400, 'bad_request', '읽을 수 없는 요청이에요.') }
    try {
      const r = ingestLogs(ctx, { userId: auth.user.id, tokenId: auth.token.id }, body)
      if (r.requests) ctx.log.info('telemetry', { user: auth.user.id, requests: r.requests, at: nowIso() })
    } catch (e) {
      ctx.log.warn('telemetry ingest failed', { err: String((e as Error)?.message ?? e).slice(0, 200) })
    }
    return c.json({})
  })

  app.post('/otel/v1/metrics', async (c) => {
    try { await c.req.arrayBuffer() } catch {}
    return c.json({})
  })

  app.all('/otel/*', () => jsonError(404, 'not_found', '없는 주소예요.'))
}
