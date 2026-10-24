// The MCP endpoint each PC's Claude Code registers as the HTTP server "trina" (MCP Streamable HTTP, JSON-RPC 2.0).
// Answers are plain application/json (no SSE stream, no session id). Auth: the device (or hub) token as
// `Authorization: Bearer`. The person is loaded again for every tool call, so a changed group, role or a disabled
// account applies from the next call.
import type { Register } from '../http/app'
import { requireToken } from '../http/app'
import type { Ctx } from '../context'
import type { TokenAuth } from '../auth/tokens'
import { loadPrincipal } from '../policy/access'
import { PRODUCT } from '../product'
import { buildInstructions } from './instructions'
import { callTool, hasTool, recordToolEvent, toolList } from './tools'

export const MCP_PATH = '/mcp'
export const KNOWN_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
/** write_file content is capped at 20 MB; JSON escaping can grow it */
const MAX_BODY_BYTES = 48 * 1024 * 1024

type Id = string | number | null
interface RpcError { code: number; message: string; data?: unknown }
type Reply = { jsonrpc: '2.0'; id: Id; result: unknown } | { jsonrpc: '2.0'; id: Id; error: RpcError }

const ok = (id: Id, result: unknown): Reply => ({ jsonrpc: '2.0', id, result })
const fail = (id: Id, code: number, message: string): Reply => ({ jsonrpc: '2.0', id, error: { code, message } })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export const register: Register = (app, ctx) => {
  // no server-initiated stream: the spec's answer to GET is 405
  app.get(MCP_PATH, () => new Response(null, { status: 405, headers: { allow: 'POST, DELETE' } }))
  // no sessions to end
  app.delete(MCP_PATH, () => new Response(null, { status: 200 }))
  app.post(MCP_PATH, requireToken(ctx, 'json'), async (c) => {
    const auth = c.get('tokenAuth')!
    const declared = Number(c.req.header('content-length') ?? 0)
    if (declared > MAX_BODY_BYTES) return json(fail(null, -32600, 'request too large'), 413)
    const raw = await c.req.text()
    if (raw.length > MAX_BODY_BYTES) return json(fail(null, -32600, 'request too large'), 413)
    let body: unknown
    try { body = JSON.parse(raw) } catch { return json(fail(null, -32700, 'Parse error'), 400) }

    if (Array.isArray(body)) {
      if (body.length === 0) return json(fail(null, -32600, 'Invalid Request: empty batch'), 400)
      const replies: Reply[] = []
      // one after another: a batch may write and then read the same file
      for (const m of body) { const r = await handle(ctx, auth, m); if (r) replies.push(r) }
      return replies.length ? json(replies) : new Response(null, { status: 202 })
    }
    const reply = await handle(ctx, auth, body)
    return reply ? json(reply) : new Response(null, { status: 202 })
  })
}

const isId = (v: unknown): v is Id => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))

/** One JSON-RPC message; null for notifications (and for responses, which this server never asked for). */
export async function handle(ctx: Ctx, auth: TokenAuth, msg: unknown): Promise<Reply | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return fail(null, -32600, 'Invalid Request')
  const m = msg as Record<string, unknown>
  const hasId = 'id' in m
  const id: Id = hasId && isId(m.id) ? m.id : null
  if (typeof m.method !== 'string') {
    if (hasId && ('result' in m || 'error' in m)) return null
    return fail(id, -32600, 'Invalid Request')
  }
  if (m.jsonrpc !== '2.0' || (hasId && !isId(m.id))) return fail(id, -32600, 'Invalid Request')
  // notifications (notifications/initialized, notifications/cancelled, ...): nothing to do, nothing to answer
  if (!hasId) return null
  const params = (m.params && typeof m.params === 'object' ? m.params : {}) as Record<string, unknown>

  switch (m.method) {
    case 'initialize': {
      const user = loadPrincipal(ctx.db, auth.user.id)
      if (!user) return fail(id, -32001, 'this account is disabled')
      const asked = params.protocolVersion
      return ok(id, {
        protocolVersion: typeof asked === 'string' && KNOWN_PROTOCOL_VERSIONS.includes(asked) ? asked : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: PRODUCT.id, version: PRODUCT.version },
        instructions: buildInstructions(ctx, user),
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: toolList() })
    case 'tools/call': {
      const name = params.name
      if (typeof name !== 'string' || !name) return fail(id, -32602, 'Invalid params: tool name missing')
      const user = loadPrincipal(ctx.db, auth.user.id)
      if (!user) {
        recordToolEvent(ctx, auth.user.id, auth.token.id, name, { summary: 'account disabled', isError: true })
        return ok(id, { content: [{ type: 'text', text: 'Error: this account is disabled.' }], isError: true })
      }
      if (!hasTool(name)) {
        recordToolEvent(ctx, user.id, auth.token.id, name, { summary: 'unknown tool', isError: true })
        return fail(id, -32602, `Unknown tool: ${name.slice(0, 64)}`)
      }
      const out = await callTool(ctx, user, auth.token.id, name, params.arguments ?? {})
      return ok(id, { content: out.content, ...(out.isError ? { isError: true } : {}) })
    }
    default:
      return fail(id, -32601, `Method not found: ${m.method.slice(0, 64)}`)
  }
}
