// Forwarding Claude Code's model requests to Anthropic with the company's API key. The PC's Claude Code sends its
// device token; the relay checks the request, swaps the token for the company key, sends only an allowed set of
// headers, streams the answer back as it arrives and records what the request used (src/relay/record.ts).
import type { Ctx } from '../context'
import type { C } from '../http/app'
import type { TokenAuth } from '../auth/tokens'
import { apiError } from '../http/errors'
import { budgetGate, type Budget } from '../usage/budgets'
import { modelAccessFor } from '../auth/access-mode'
import { MessageTap, tapMessage } from './sse'
import { UsageRecorder, type Requester } from './record'
import { inflightFor, inflightLimits, type Inflight } from './inflight'
import { noteUpstream } from './upstream'

export type MessagesPath = '/v1/messages' | '/v1/messages/count_tokens'

/** What people see (Claude Code shows the message). */
export const MSG = {
  connector: 'Trina AX: Claude 앱 커넥터 연결로는 모델을 부를 수 없어요.',
  subscription: 'Trina AX: 이 PC는 본인 Claude 구독으로 쓰도록 설정돼 있어요. 터미널에서 claude 를 실행하고 /login 으로 본인 구독에 로그인해 주세요. 회사 키로 써야 하면 관리자에게 말해 주세요.',
  noKey: 'Trina AX: 회사 Anthropic API 키가 아직 등록되지 않았어요. 관리자에게 등록해 달라고 말해 주세요.',
  badBody: 'Trina AX: 요청 본문이 JSON 객체가 아니에요.',
  badModel: 'Trina AX: Claude 모델 이름이 아니에요.',
  refused: (key: string) => `Trina AX: 회사 허브에서는 ${key} 기능을 쓸 수 없어요.`,
  refusedTool: (type: string) => `Trina AX: 회사 허브에서는 ${type} 도구를 쓸 수 없어요. Anthropic 서버에서 코드를 실행하거나 허브가 비용을 셀 수 없는 도구예요.`,
  busyUser: (n: number) => `Trina AX: 한 사람이 동시에 보낼 수 있는 요청(${n}개)이 다 찼어요. 잠시 뒤 자동으로 다시 보내요.`,
  busyTotal: (n: number) => `Trina AX: 지금 회사 전체에서 동시에 처리 중인 요청(${n}개)이 다 찼어요. 잠시 뒤 자동으로 다시 보내요.`,
  budgetWait: 'Trina AX: 진행 중인 요청이 남은 AI 한도를 다 쓸 수도 있어서 잠시 기다려요. 그 요청이 끝나면 자동으로 다시 보내요.',
  unreachable: 'Trina AX: 허브가 Anthropic 서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.',
  redirect: 'Trina AX: Anthropic 서버가 다른 주소로 넘기려고 해서 막았어요. 관리자에게 알려 주세요.',
  notFound: 'Trina AX: 허브에서는 이 API를 쓸 수 없어요.',
} as const

/** Claude Code would retry these; they will not get better by retrying. */
export const NO_RETRY = { 'x-should-retry': 'false' }
/** busy: Claude Code retries a 429 by itself, after this many seconds */
export const RETRY_SOON = { 'retry-after': '2', 'x-should-retry': 'true' }

const MODEL_RE = /^claude-[a-z0-9][a-z0-9.-]{0,79}$/
/** body keys that would make Anthropic reach out on the company's account (MCP connector, code execution) */
const REFUSED_KEYS = ['mcp_servers', 'container']
/**
 * Server tools refused in `tools[]`: they run code in a container on Anthropic's side (code execution, billed per
 * container hour; the *_code_execution names are its sub-tools), connect to MCP servers from Anthropic (the MCP
 * connector's toolset), or call a second model whose tokens the relay cannot price (advisor). Everything else
 * passes: Claude Code's own tools have no `type` (or "custom"); web search is priced (src/relay/pricing.ts), web
 * fetch and tool search cost only tokens; bash, text editor, computer, browser and memory tools run on the PC.
 */
const REFUSED_TOOL = /^(?:code_execution|bash_code_execution|text_editor_code_execution|mcp_toolset|advisor)(?:_|$)/i

/** The first refused server tool type in a request's tools, or null. */
export function refusedTool(tools: unknown): string | null {
  if (!Array.isArray(tools)) return null
  for (const t of tools) {
    const type = t && typeof t === 'object' ? (t as Record<string, unknown>).type : undefined
    if (typeof type === 'string' && REFUSED_TOOL.test(type)) return type.replace(/[^\w.-]/g, '').slice(0, 60)
  }
  return null
}
/** the only request headers that reach Anthropic; the device token, cookies and everything else stay here */
export const FORWARD_HEADERS = ['anthropic-version', 'anthropic-beta', 'accept', 'user-agent', 'x-app'] as const
const DEFAULT_VERSION = '2023-06-01'
/** response headers not passed back: hop-by-hop, encodings fetch already undid, cookies, and Anthropic's own host
 * and account details */
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'upgrade',
  'proxy-authenticate', 'set-cookie', 'alt-svc', 'strict-transport-security', 'anthropic-organization-id'])
/** query parameters forwarded on the message paths (Claude Code adds ?beta=true) */
const MESSAGES_QUERY: Record<string, RegExp> = { beta: /^true$/ }
const JOB_RE = /^[A-Za-z0-9_-]{1,64}$/

export type BodyCheck = { body: Record<string, unknown>; model: string } | { refuse: Response }

/** The request body, parsed and checked; or the refusal to answer with. Content blocks and betas are not filtered. */
export function checkBody(raw: string): BodyCheck {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { parsed = null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { refuse: apiError(400, 'invalid_request_error', MSG.badBody) }
  const body = parsed as Record<string, unknown>
  const refused = REFUSED_KEYS.find((k) => Object.hasOwn(body, k))
  if (refused) return { refuse: apiError(403, 'permission_error', MSG.refused(refused)) }
  const tool = refusedTool(body.tools)
  if (tool) return { refuse: apiError(403, 'permission_error', MSG.refusedTool(tool)) }
  if (typeof body.model !== 'string' || !MODEL_RE.test(body.model)) return { refuse: apiError(400, 'invalid_request_error', MSG.badModel) }
  return { body, model: body.model }
}

/** Headers for Anthropic: the allowed ones as they came, plus the company key. */
export function upstreamHeaders(from: Headers, apiKey: string, json: boolean): Headers {
  const h = new Headers()
  for (const k of FORWARD_HEADERS) {
    const v = from.get(k)
    if (v !== null) h.set(k, v)
  }
  if (!h.has('anthropic-version')) h.set('anthropic-version', DEFAULT_VERSION)
  if (json) h.set('content-type', 'application/json')
  h.set('x-api-key', apiKey)
  return h
}

/** Anthropic's response headers minus what must not be passed on. */
export function responseHeaders(from: Headers): Headers {
  const h = new Headers()
  for (const [k, v] of from) if (!DROP_RESPONSE.has(k.toLowerCase())) h.append(k, v)
  return h
}

/** base + path + only the allowed query parameters. */
export function upstreamUrl(base: string, path: string, query: URLSearchParams, allowed: Record<string, RegExp>): string {
  const q = new URLSearchParams()
  for (const [k, v] of query) if (allowed[k]?.test(v)) q.append(k, v)
  const s = q.toString()
  return base.replace(/\/+$/, '') + path + (s ? '?' + s : '')
}

/** Who is asking: hub tokens are hub sessions, and only they may name the hub job (x-trina-job). */
export function requester(auth: TokenAuth, h: Headers): Requester {
  const hub = auth.token.kind === 'hub'
  const job = hub ? h.get('x-trina-job')?.trim() ?? '' : ''
  return { userId: auth.user.id, tokenId: auth.token.id, source: hub ? 'hub' : 'pc', jobId: JOB_RE.test(job) ? job : null }
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)
const isRedirect = (status: number) => status >= 300 && status < 400
const isEventStream = (h: Headers) => (h.get('content-type') ?? '').toLowerCase().includes('text/event-stream')

/** POST /v1/messages and /v1/messages/count_tokens (token already checked by requireToken). */
export async function relayMessages(ctx: Ctx, c: C, path: MessagesPath): Promise<Response> {
  const auth = c.get('tokenAuth')!
  // Claude app connectors (OAuth) are for files and skills only, never for spending the company key
  if (auth.token.kind === 'connector') return apiError(403, 'permission_error', MSG.connector, NO_RETRY)
  // a person set to use their own subscription never spends the company key from their PC (hub sessions may)
  if (auth.token.kind === 'device' && modelAccessFor(ctx.db, auth.user.id) === 'subscription') return apiError(403, 'permission_error', MSG.subscription, NO_RETRY)
  const apiKey = ctx.secrets.getApiKey()
  if (!apiKey) return apiError(503, 'api_error', MSG.noKey, NO_RETRY)
  const checked = checkBody(await c.req.text())
  if ('refuse' in checked) return checked.refuse
  const req = c.req.raw
  let recorder: UsageRecorder | null = null
  // counting tokens costs nothing, so only real model calls are held to the budget and the in-flight caps
  if (path === '/v1/messages') {
    const inflight = inflightFor(ctx.db)
    const gate = budgetGate(ctx.db, auth.user.id, { running: (b) => runningFor(ctx, inflight, b) })
    // 403, not 429, for a used-up budget: Claude Code retries a 429 by itself
    if (gate?.kind === 'block') return apiError(403, 'permission_error', gate.message)
    if (gate?.kind === 'wait') return apiError(429, 'rate_limit_error', MSG.budgetWait, RETRY_SOON)
    const limits = inflightLimits(ctx.db)
    const slot = inflight.acquire(auth.user.id, limits)
    if ('full' in slot) return apiError(429, 'rate_limit_error', slot.full === 'user' ? MSG.busyUser(limits.perUser) : MSG.busyTotal(limits.total), RETRY_SOON)
    recorder = new UsageRecorder(ctx, requester(auth, req.headers), checked.model, slot.release)
  }
  const url = upstreamUrl(ctx.config.upstreamBaseUrl, path, new URL(req.url).searchParams, MESSAGES_QUERY)
  try {
    // re-serialized: what goes out is exactly what was checked (a raw body could hide a duplicate key)
    return await forward(ctx, { req, url, path, body: JSON.stringify(checked.body), apiKey, recorder })
  } catch (e) {
    recorder?.finish() // frees the in-flight slot
    throw e
  }
}

/** Requests running now that count against a budget. */
function runningFor(ctx: Ctx, inflight: Inflight, b: Budget): number {
  if (b.subjectType === 'team') return inflight.count()
  if (b.subjectType === 'user') return inflight.count(b.subjectId ?? '')
  const members = ctx.db.query('SELECT user_id FROM group_members WHERE group_id = ?').all(b.subjectId) as { user_id: string }[]
  return members.reduce((n, m) => n + inflight.count(m.user_id), 0)
}

interface Forward { req: Request; url: string; path: string; body: string; apiKey: string; recorder: UsageRecorder | null }

async function forward(ctx: Ctx, o: Forward): Promise<Response> {
  const { req, recorder } = o
  // the client hanging up cancels the upstream request and records what was seen
  const upstream = new AbortController()
  const clientGone = () => { upstream.abort(); recorder?.finish() }
  if (req.signal.aborted) clientGone()
  else req.signal.addEventListener('abort', clientGone, { once: true })

  let up: Response
  try {
    const init: RequestInit & { timeout: boolean } = {
      method: 'POST', headers: upstreamHeaders(req.headers, o.apiKey, true), body: o.body, signal: upstream.signal,
      // never follow: a redirect would take the company key (fetch keeps x-api-key across hosts) somewhere else
      redirect: 'manual',
      // Bun's fetch gives up on a quiet connection after a while; a long answer may think for minutes
      timeout: false,
    }
    up = await fetch(o.url, init)
  } catch (e) {
    recorder?.finish()
    if (!upstream.signal.aborted) ctx.log.warn('relay: Anthropic could not be reached', { path: o.path, err: errText(e) })
    return apiError(502, 'api_error', MSG.unreachable)
  }
  if (recorder) recorder.status = up.status

  if (isRedirect(up.status)) {
    await up.body?.cancel().catch(() => {})
    recorder?.finish()
    ctx.log.warn('relay: Anthropic answered with a redirect; not followed', { path: o.path, status: up.status })
    return apiError(502, 'api_error', MSG.redirect, NO_RETRY)
  }

  const headers = responseHeaders(up.headers)
  if (up.ok && up.body && isEventStream(up.headers)) {
    noteUpstream(ctx, o.path, up.status, up.headers, null)
    return new Response(passThrough(up.body, recorder, upstream), { status: up.status, headers })
  }
  let bytes: ArrayBuffer
  try { bytes = await up.arrayBuffer() } catch (e) {
    recorder?.finish()
    if (!upstream.signal.aborted) ctx.log.warn('relay: Anthropic answer broke off', { path: o.path, err: errText(e) })
    return apiError(502, 'api_error', MSG.unreachable)
  }
  noteUpstream(ctx, o.path, up.status, up.headers, up.ok ? null : bytes)
  if (recorder) {
    if (up.ok) try { tapMessage(recorder, JSON.parse(new TextDecoder().decode(bytes))) } catch { /* not JSON: nothing to count */ }
    recorder.finish()
  }
  // error bodies go back exactly as Anthropic wrote them
  return new Response(bytes, { status: up.status, headers })
}

/** The answer as it arrives (pull-based, no read-ahead), with the tap reading usage and skills on the way. */
function passThrough(body: ReadableStream<Uint8Array>, recorder: UsageRecorder | null, upstream: AbortController): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const tap = recorder ? new MessageTap(recorder) : null
  const end = () => { tap?.end(); recorder?.finish() }
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      try {
        const { value, done } = await reader.read()
        if (done) { end(); ctl.close(); return }
        ctl.enqueue(value)
        tap?.push(value)
      } catch (e) {
        end() // the stream broke off: what was seen still counts
        ctl.error(e)
      }
    },
    cancel() {
      end()
      upstream.abort()
      reader.cancel().catch(() => {})
    },
  }, { highWaterMark: 0 })
}
