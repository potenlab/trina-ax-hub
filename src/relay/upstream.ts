// What Anthropic said about the company key, for the admin dashboard (src/relay/health.ts) and the log. Error bodies
// still go back to Claude Code unchanged; here only their type and a trimmed message are kept, never our request
// body or the key.
import type { Ctx } from '../context'
import { noteUpstreamError, noteUpstreamOk } from './health'

/** Upstream statuses worth telling the admin about: the account or key is refused (400 credit balance, 401, 402,
 * 403), a model is not available to it (404), requests are too big (413), the organisation is rate limited (429), or
 * Anthropic is failing or overloaded (5xx, 529). */
export const NOTED_STATUS = (status: number) => [400, 401, 402, 403, 404, 413, 429].includes(status) || status >= 500

const CREDIT_RE = /credit balance|billing|purchase credits/i
/** an API key, should Anthropic ever quote one back */
const KEY_RE = /sk-ant-[A-Za-z0-9_-]+/g

/** type and message of an Anthropic error body ({ type: 'error', error: { type, message } }) */
export function errorInfo(body: ArrayBuffer | string | null): { type: string; message: string } {
  try {
    const text = typeof body === 'string' ? body : body ? new TextDecoder().decode(body.slice(0, 64 * 1024)) : ''
    const j = JSON.parse(text) as { error?: { type?: unknown; message?: unknown } }
    return { type: typeof j?.error?.type === 'string' ? j.error.type : '', message: typeof j?.error?.message === 'string' ? j.error.message : '' }
  } catch {
    return { type: '', message: '' }
  }
}

const clean = (s: string, max: number) => s.replace(KEY_RE, 'sk-ant-…').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)

/** After Anthropic answered (the body only for error statuses). Never throws. */
export function noteUpstream(ctx: Ctx, path: string, status: number, headers: Headers, body: ArrayBuffer | string | null) {
  try {
    if (status >= 200 && status < 300) { noteUpstreamOk(ctx.db); return }
    if (!NOTED_STATUS(status)) return
    const e = errorInfo(body)
    noteUpstreamError(ctx.db, { status, type: clean(e.type || `http_${status}`, 80), message: clean(e.message, 300) })
    // status and a fixed description only: the error text stays out of the log
    const f = { path, status, type: clean(e.type, 80) || undefined, requestId: headers.get('request-id') ?? undefined }
    if (status === 401) ctx.log.warn('relay: Anthropic refused the company API key (401); check the key on the settings page', f)
    else if (status === 403) ctx.log.warn('relay: Anthropic refused the request for this API key (403)', f)
    else if (status === 402 || (status === 400 && CREDIT_RE.test(e.message))) ctx.log.warn('relay: the company Anthropic account is out of credit; add credits in the Anthropic Console', f)
    else if (status >= 500) ctx.log.warn('relay: Anthropic error', f)
  } catch (e) {
    ctx.log.error('relay: could not note the upstream status', { err: String((e as Error)?.message ?? e).slice(0, 200) })
  }
}

/** An `error` event inside a stream (overloaded, api_error …). */
export function noteStreamError(ctx: Ctx, type: string, message: string) {
  try {
    const status = type === 'overloaded_error' ? 529 : type === 'rate_limit_error' ? 429 : 500
    noteUpstreamError(ctx.db, { status, type: clean(type, 80), message: clean(message, 300) })
    ctx.log.warn('relay: Anthropic error inside the answer stream', { type: clean(type, 80) })
  } catch {}
}
