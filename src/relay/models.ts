// GET /v1/models: Anthropic's list for the company key, or a small built-in list when that is not available (no key
// yet, Anthropic unreachable or refusing). Claude Code only needs ids and limits from it.
import type { Ctx } from '../context'
import type { C } from '../http/app'
import { upstreamHeaders, upstreamUrl } from './proxy'

const MODELS_QUERY: Record<string, RegExp> = { limit: /^\d{1,4}$/, after_id: /^[A-Za-z0-9._-]{1,100}$/, before_id: /^[A-Za-z0-9._-]{1,100}$/ }
const TIMEOUT_MS = 10_000

/** Current models (platform.claude.com, 2026-10). `created_at` is a fixed placeholder; ids and limits are real. */
const STATIC: [id: string, name: string][] = [
  ['claude-opus-5-5', 'Claude Opus 5.5'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5'],
  ['claude-fable-5-1', 'Claude Fable 5.1'],
]

export function staticModels() {
  const data = STATIC.map(([id, display_name]) => ({
    type: 'model', id, display_name, created_at: '2026-01-01T00:00:00Z', max_input_tokens: 1_000_000, max_tokens: 128_000,
  }))
  return { data, has_more: false, first_id: data[0]!.id, last_id: data[data.length - 1]!.id }
}

export async function listModels(ctx: Ctx, c: C): Promise<Response> {
  const apiKey = ctx.secrets.getApiKey()
  const fromAnthropic = apiKey ? await upstreamModels(ctx, c.req.raw, apiKey) : null
  return fromAnthropic ?? Response.json(staticModels())
}

async function upstreamModels(ctx: Ctx, req: Request, apiKey: string): Promise<Response | null> {
  try {
    const url = upstreamUrl(ctx.config.upstreamBaseUrl, '/v1/models', new URL(req.url).searchParams, MODELS_QUERY)
    const up = await fetch(url, {
      headers: upstreamHeaders(req.headers, apiKey, false), redirect: 'manual',
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
    if (up.status === 401) ctx.log.warn('relay: Anthropic refused the company API key (401); check the key on the settings page', { path: '/v1/models' })
    if (up.status !== 200) { await up.body?.cancel().catch(() => {}); return null }
    const text = await up.text()
    const body = JSON.parse(text) as { data?: unknown }
    if (!Array.isArray(body?.data)) return null
    return new Response(text, { headers: { 'content-type': 'application/json' } })
  } catch {
    return null
  }
}
