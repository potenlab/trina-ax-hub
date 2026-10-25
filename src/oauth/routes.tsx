/** @jsxImportSource hono/jsx */
// OAuth for Claude app connectors (claude.ai web, Claude Desktop, Claude mobile, Cowork, and Claude Code if wanted).
// Each person adds the hub's MCP address as a custom connector in their own Claude app (their own subscription),
// signs in here with their hub account and approves; the connector then works with that person's folder permissions.
// Follows what Claude's connector docs require (claude.com/docs/connectors/building/authentication):
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 (resource = <origin>/mcp, one authorization server)
//   GET  /.well-known/oauth-authorization-server       RFC 8414
//   POST /oauth/register                               RFC 7591 dynamic client registration (public clients, no secret)
//   GET  /oauth/authorize                              code + PKCE S256 only; RFC 8707 `resource` checked
//   GET  /oauth/continue/:id, POST same                login (hub session) and the consent page
//   POST /oauth/token                                  authorization_code / refresh_token (refresh tokens rotate)
//   POST /oauth/revoke                                 RFC 7009
// The MCP endpoint answers 401 with `WWW-Authenticate: Bearer resource_metadata=…` (src/mcp/routes.ts), which is how
// Claude discovers all this. Access tokens are `tokens` rows of kind 'connector' (1 hour); the relay refuses them.
import crypto from 'node:crypto'
import type { Context } from 'hono'
import type { AppEnv, C, Register } from '../http/app'
import { sessionMiddleware } from '../http/app'
import type { Database } from 'bun:sqlite'
import type { Ctx } from '../context'
import { nowIso } from '../db'
import { secret, sha256, safeEqual } from '../ids'
import { issueToken } from '../auth/tokens'
import { csrfOk } from '../auth/sessions'
import { getUser } from '../auth/users'
import { RateLimiter } from '../auth/rate-limit'
import { audit } from '../audit'
import { Page, Csrf } from '../ui/layout'
import { effectiveUrls, companyName } from '../web/settings'

export const ACCESS_TTL_S = 3600
const REFRESH_TTL_MS = 60 * 86_400_000
const CODE_TTL_MS = 10 * 60_000
const PENDING_TTL_MS = 15 * 60_000
/** Stored registered apps, all together. Registration is open (Claude registers itself), so the table is bounded. */
export const MAX_CLIENTS = 2000
/** A registered app nobody has used for this long is forgotten (its connections would need no refresh either). */
export const CLIENT_IDLE_MS = 30 * 86_400_000
/**
 * Registrations per client address per hour. Behind the Cloudflare tunnel the address is Anthropic's shared egress
 * (160.79.104.0/21), so every employee of a company registering from Claude's cloud counts against one address;
 * 20 an hour was too few for a rollout day.
 */
export const REGISTER_PER_IP_PER_HOUR = 300
const PRUNE_EVERY_MS = 10 * 60_000
const SCOPES = ['mcp', 'offline_access']
const REFRESH_PREFIX = 'taxr_'

/** Redirect URIs Claude uses: claude.ai for the web, desktop and mobile apps; a loopback /callback for Claude Code. */
const CLAUDE_CALLBACKS = new Set(['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'])

function isLoopbackCallback(u: URL): boolean {
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.pathname === '/callback' && !u.hash
}

/** May a client register this redirect URI at all? */
export function redirectAllowed(uri: string, extra: string[] = []): boolean {
  let u: URL
  try { u = new URL(uri) } catch { return false }
  if (u.username || u.password) return false
  return CLAUDE_CALLBACKS.has(uri) || extra.includes(uri) || isLoopbackCallback(u)
}

/** Does `given` match one of the client's registered URIs? Exact, except a loopback port may differ (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], given: string): boolean {
  if (registered.includes(given)) return true
  let g: URL
  try { g = new URL(given) } catch { return false }
  if (!isLoopbackCallback(g)) return false
  return registered.some((r) => { try { const u = new URL(r); return isLoopbackCallback(u) && u.hostname === g.hostname } catch { return false } })
}

/** The public origin the client used (through the Cloudflare tunnel: Host + x-forwarded-proto), else the configured
 *  public address, else this request's origin. Issuer and resource must equal what the person typed into Claude. */
export function originOf(c: C, ctx: Ctx): string {
  if (!c.get('localDirect')) {
    const proto = (c.req.header('x-forwarded-proto') ?? '').split(',')[0]!.trim().toLowerCase()
    const host = (c.req.header('host') ?? '').trim().toLowerCase()
    if (proto === 'https' && /^[a-z0-9.-]{1,253}(:\d{1,5})?$/.test(host)) return `https://${host.replace(/:443$/, '')}`
  }
  const pub = effectiveUrls(ctx).publicUrl
  if (pub) return pub.replace(/\/+$/, '')
  return new URL(c.req.url).origin
}

/** RFC 8707 canonical form: lowercase scheme/host, no default port, no trailing slash, no fragment. */
export function canonicalResource(v: string): string | null {
  try {
    const u = new URL(v)
    if (u.hash) return null
    const port = (u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80') ? '' : u.port
    return `${u.protocol}//${u.hostname.toLowerCase()}${port ? ':' + port : ''}${u.pathname.replace(/\/+$/, '')}`
  } catch { return null }
}

const b64url = (b: Buffer) => b.toString('base64url')
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/
export const pkceChallenge = (verifier: string) => b64url(crypto.createHash('sha256').update(verifier).digest())

interface Pending {
  clientId: string; clientName: string; redirectUri: string; challenge: string; state: string | null
  scope: string; resource: string | null; origin: string; createdAt: number
}

function oauthError(status: number, error: string, description: string) {
  return new Response(JSON.stringify({ error, error_description: description }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

function withParams(uri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(uri)
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v)
  return u.toString()
}

const ErrorPage = (p: { title: string; text: string }) => (
  <Page title={p.title} narrow>
    <h1>{p.title}</h1>
    <div class="notice bad">{p.text}</div>
    <p class="muted small">Claude 앱의 커넥터 설정에서 이 허브 주소를 다시 추가해 보세요. 계속 안 되면 관리자에게 알려 주세요.</p>
  </Page>
)

const ConsentPage = (p: { company: string; app: string; person: string; csrf: string; id: string; origin: string }) => (
  <Page title="Claude 앱 연결" narrow>
    <h1>Claude 앱을 회사 허브에 연결할까요?</h1>
    <p class="lead">{p.app}이(가) {p.company} 허브에 {p.person}님으로 연결하려고 해요.</p>
    <div class="card">
      <b>허용하면 Claude가 할 수 있는 일</b>
      <ul>
        <li>{p.person}님이 볼 수 있는 회사 폴더의 파일을 찾고 읽기</li>
        <li>{p.person}님이 쓸 수 있는 폴더에 파일을 만들고 고치기 (지운 파일은 보관돼요)</li>
        <li>{p.person}님이 쓸 수 있는 회사 스킬 읽기</li>
      </ul>
      <p class="muted small">AI 사용은 {p.person}님 본인의 Claude 구독으로 해요. 연결은 언제든 '내 PC' 페이지에서 끊을 수 있어요.</p>
    </div>
    <form method="post" action={`/oauth/continue/${p.id}`} class="row">
      <Csrf token={p.csrf} />
      <button class="btn primary" type="submit" name="decision" value="allow">허용</button>
      <button class="btn" type="submit" name="decision" value="deny">거부</button>
    </form>
    <p class="muted small">주소: {p.origin}</p>
  </Page>
)

const html = (c: Context<AppEnv>, node: unknown, status = 200) => c.html('<!doctype html>' + String(node), status as any)

export const register: Register = (app, ctx) => {
  const db = ctx.db
  const pending = new Map<string, Pending>()
  const registerLimit = new RateLimiter(REGISTER_PER_IP_PER_HOUR, 3600_000)
  let lastPrune = 0
  const tokenLimit = new RateLimiter(120, 60_000)
  const sweep = () => { const t = Date.now(); for (const [k, v] of pending) if (t - v.createdAt > PENDING_TTL_MS) pending.delete(k) }
  const extraRedirects = () => {
    const r = db.query("SELECT value FROM settings WHERE key = 'oauthRedirectExtra'").get() as { value: string } | null
    try { const v = r ? JSON.parse(r.value) : []; return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
  }

  // ---- discovery ----------------------------------------------------------------------------------------------
  const protectedResource = (c: C) => {
    const origin = originOf(c, ctx)
    return c.json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: SCOPES, bearer_methods_supported: ['header'], resource_name: `${companyName(ctx)} · Trina AX` }, 200, { 'cache-control': 'no-store' })
  }
  app.get('/.well-known/oauth-protected-resource', protectedResource)
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource)
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const o = originOf(c, ctx)
    return c.json({
      issuer: o, authorization_endpoint: `${o}/oauth/authorize`, token_endpoint: `${o}/oauth/token`,
      registration_endpoint: `${o}/oauth/register`, revocation_endpoint: `${o}/oauth/revoke`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: SCOPES,
      authorization_response_iss_parameter_supported: true,
    }, 200, { 'cache-control': 'no-store' })
  })

  // ---- dynamic client registration ---------------------------------------------------------------------------------
  app.post('/oauth/register', async (c) => {
    if (!registerLimit.take(c.get('clientIp'))) return oauthError(429, 'slow_down', 'too many registrations')
    let b: any
    try { b = await c.req.json() } catch { return oauthError(400, 'invalid_client_metadata', 'body must be JSON') }
    const uris = Array.isArray(b?.redirect_uris) ? b.redirect_uris.filter((u: unknown) => typeof u === 'string') as string[] : []
    if (!uris.length || uris.length > 10) return oauthError(400, 'invalid_redirect_uri', 'redirect_uris required')
    const extra = extraRedirects()
    const bad = uris.find((u) => !redirectAllowed(u, extra))
    if (bad) return oauthError(400, 'invalid_redirect_uri', 'only Claude callbacks (claude.ai, or a loopback /callback) are allowed')
    const method = b?.token_endpoint_auth_method ?? 'none'
    if (method !== 'none') return oauthError(400, 'invalid_client_metadata', 'only public clients (token_endpoint_auth_method none) are supported')
    // keep the table bounded: forget apps idle for 30 days (at most every 10 minutes, and at once when the table is full)
    const count = () => (db.query('SELECT COUNT(*) AS n FROM oauth_clients').get() as { n: number }).n
    const tick = Date.now()
    if (tick - lastPrune > PRUNE_EVERY_MS || count() >= MAX_CLIENTS) {
      lastPrune = tick
      const gone = pruneClients(db, tick)
      if (gone) ctx.log.info('registered apps forgotten', { count: gone })
    }
    if (count() >= MAX_CLIENTS) {
      // still full: make room from the oldest apps that never finished connecting, never from ones in use
      db.query('DELETE FROM oauth_clients WHERE client_id IN (SELECT client_id FROM oauth_clients WHERE last_used_at IS NULL ORDER BY created_at LIMIT 100)').run()
      if (count() >= MAX_CLIENTS) return oauthError(429, 'slow_down', 'too many registered apps')
    }
    const name = (typeof b?.client_name === 'string' ? b.client_name : 'Claude').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || 'Claude'
    const clientId = 'tac_' + secret(18)
    const now = nowIso()
    db.query('INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?,?,?,?)').run(clientId, name, JSON.stringify(uris), now)
    return c.json({
      client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris,
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    }, 201, { 'cache-control': 'no-store' })
  })

  // ---- authorization -------------------------------------------------------------------------------------------
  const client = (id: string) => db.query('SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id = ?').get(id) as { client_id: string; name: string; redirect_uris: string } | null

  app.get('/oauth/authorize', (c) => {
    sweep()
    const q = (k: string) => c.req.query(k) ?? ''
    const cl = client(q('client_id'))
    // until the client and its redirect URI are known good, errors are shown here and never redirected
    if (!cl) return html(c, <ErrorPage title="연결할 수 없어요" text="등록되지 않은 앱이에요." />, 400)
    const redirectUri = q('redirect_uri')
    let registered: string[] = []
    try { registered = JSON.parse(cl.redirect_uris) } catch {}
    if (!redirectUri || !redirectMatches(registered, redirectUri)) return html(c, <ErrorPage title="연결할 수 없어요" text="돌아갈 주소가 등록된 것과 달라요." />, 400)
    const state = c.req.query('state') ?? null
    const back = (error: string, description: string) => c.redirect(withParams(redirectUri, { error, error_description: description, state, iss: originOf(c, ctx) }))
    if (q('response_type') !== 'code') return back('unsupported_response_type', 'only code is supported')
    if (q('code_challenge_method') !== 'S256' || !CHALLENGE.test(q('code_challenge'))) return back('invalid_request', 'PKCE with S256 is required')
    const origin = originOf(c, ctx)
    const resourceIn = c.req.query('resource')
    let resource: string | null = null
    if (resourceIn !== undefined) {
      resource = canonicalResource(resourceIn)
      const ok = resource && [canonicalResource(`${origin}/mcp`), canonicalResource(origin)].includes(resource)
      if (!ok) return back('invalid_target', 'unknown resource')
    }
    const scope = (q('scope') || 'mcp').split(/\s+/).filter((s) => SCOPES.includes(s)).join(' ') || 'mcp'
    const id = secret(18)
    pending.set(id, { clientId: cl.client_id, clientName: cl.name, redirectUri, challenge: q('code_challenge'), state, scope, resource, origin, createdAt: Date.now() })
    return c.redirect(`/oauth/continue/${id}`)
  })

  app.use('/oauth/continue/*', sessionMiddleware(ctx))

  app.get('/oauth/continue/:id', (c) => {
    sweep()
    const id = c.req.param('id')
    const p = pending.get(id)
    if (!p) return html(c, <ErrorPage title="연결 시간이 지났어요" text="Claude 앱에서 연결을 처음부터 다시 해 주세요." />, 400)
    const s = c.get('session')
    if (!s) return c.redirect('/login?next=' + encodeURIComponent(`/oauth/continue/${id}`))
    // after choosing the new password the person comes straight back here to finish connecting
    if (getUser(db, s.user.id)?.mustChangePassword) return c.redirect('/me/password?next=' + encodeURIComponent(`/oauth/continue/${id}`))
    return html(c, <ConsentPage company={companyName(ctx)} app={p.clientName} person={s.user.name} csrf={s.csrf} id={id} origin={p.origin} />)
  })

  app.post('/oauth/continue/:id', async (c) => {
    const id = c.req.param('id')
    const p = pending.get(id)
    if (!p) return html(c, <ErrorPage title="연결 시간이 지났어요" text="Claude 앱에서 연결을 처음부터 다시 해 주세요." />, 400)
    const s = c.get('session')
    if (!s) return c.redirect('/login?next=' + encodeURIComponent(`/oauth/continue/${id}`), 303)
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
    if (!csrfOk(s, form._csrf)) return html(c, <ErrorPage title="다시 시도해 주세요" text="보안 확인에 실패했어요. 페이지를 새로 고친 뒤 다시 눌러 주세요." />, 403)
    pending.delete(id)
    if (form.decision !== 'allow') {
      audit(db, { actor: s.user.id, action: 'connector.deny', target: p.clientId, detail: { app: p.clientName } })
      return c.redirect(withParams(p.redirectUri, { error: 'access_denied', error_description: 'the person declined', state: p.state, iss: p.origin }), 303)
    }
    const code = secret(32)
    db.query('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, resource, scope, expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(sha256(code), p.clientId, s.user.id, p.redirectUri, p.challenge, p.resource, p.scope, new Date(Date.now() + CODE_TTL_MS).toISOString())
    audit(db, { actor: s.user.id, action: 'connector.allow', target: p.clientId, detail: { app: p.clientName } })
    return c.redirect(withParams(p.redirectUri, { code, state: p.state, iss: p.origin }), 303)
  })

  // ---- tokens ------------------------------------------------------------------------------------------------------
  const issuePair = (userId: string, clientId: string, clientName: string, resource: string | null, scope: string) => {
    const access = issueToken(db, userId, 'connector', `Claude 앱 (${clientName})`.slice(0, 80), { ttlMs: ACCESS_TTL_S * 1000, createdBy: userId })
    const refresh = REFRESH_PREFIX + secret(32)
    db.query('INSERT INTO oauth_refresh (token_hash, client_id, user_id, access_token_id, resource, scope, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(sha256(refresh), clientId, userId, access.id, resource, scope, nowIso(), new Date(Date.now() + REFRESH_TTL_MS).toISOString())
    db.query('UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?').run(nowIso(), clientId)
    return { access_token: access.token, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope }
  }

  const params = async (c: C): Promise<Record<string, string>> => {
    const ct = c.req.header('content-type') ?? ''
    const out: Record<string, string> = {}
    try {
      if (ct.includes('application/json')) { const j = await c.req.json(); for (const [k, v] of Object.entries(j ?? {})) if (typeof v === 'string') out[k] = v }
      else { const f = await c.req.parseBody(); for (const [k, v] of Object.entries(f)) if (typeof v === 'string') out[k] = v }
    } catch {}
    return out
  }

  app.post('/oauth/token', async (c) => {
    if (!tokenLimit.take(c.get('clientIp'))) return oauthError(429, 'slow_down', 'too many requests')
    const f = await params(c)
    const cl = client(f.client_id ?? '')
    if (!cl) return oauthError(401, 'invalid_client', 'unknown client')
    if (f.grant_type === 'authorization_code') {
      const row = db.query('SELECT * FROM oauth_codes WHERE code_hash = ?').get(sha256(f.code ?? '')) as any
      if (!row || row.client_id !== cl.client_id) return oauthError(400, 'invalid_grant', 'unknown code')
      if (row.used_at) {
        // a code used twice: whatever the first use issued is suspect (RFC 6749 §4.1.2)
        db.query(`UPDATE tokens SET revoked_at = ? WHERE kind = 'connector' AND revoked_at IS NULL AND id IN
          (SELECT access_token_id FROM oauth_refresh WHERE client_id = ? AND user_id = ? AND created_at >= ?)`).run(nowIso(), row.client_id, row.user_id, row.used_at)
        db.query('UPDATE oauth_refresh SET revoked_at = ? WHERE client_id = ? AND user_id = ? AND revoked_at IS NULL AND created_at >= ?').run(nowIso(), row.client_id, row.user_id, row.used_at)
        return oauthError(400, 'invalid_grant', 'code already used')
      }
      if (row.expires_at < nowIso()) return oauthError(400, 'invalid_grant', 'code expired')
      if ((f.redirect_uri ?? '') !== row.redirect_uri) return oauthError(400, 'invalid_grant', 'redirect_uri differs')
      if (!VERIFIER.test(f.code_verifier ?? '') || !safeEqual(pkceChallenge(f.code_verifier!), row.code_challenge)) return oauthError(400, 'invalid_grant', 'PKCE check failed')
      if (f.resource !== undefined && row.resource && canonicalResource(f.resource) !== row.resource) return oauthError(400, 'invalid_target', 'resource differs')
      const user = getUser(db, row.user_id)
      if (!user || user.status !== 'active') return oauthError(400, 'invalid_grant', 'account is off')
      db.query('UPDATE oauth_codes SET used_at = ? WHERE code_hash = ?').run(nowIso(), row.code_hash)
      return c.json(issuePair(row.user_id, cl.client_id, cl.name, row.resource, row.scope ?? 'mcp'), 200, { 'cache-control': 'no-store' })
    }
    if (f.grant_type === 'refresh_token') {
      const h = sha256(f.refresh_token ?? '')
      const row = db.query('SELECT * FROM oauth_refresh WHERE token_hash = ?').get(h) as any
      if (!row || row.client_id !== cl.client_id) return oauthError(400, 'invalid_grant', 'unknown refresh token')
      if (row.revoked_at || row.expires_at < nowIso()) return oauthError(400, 'invalid_grant', 'refresh token is no longer valid')
      const user = getUser(db, row.user_id)
      if (!user || user.status !== 'active') return oauthError(400, 'invalid_grant', 'account is off')
      // rotate: the old refresh token and its access token stop working
      db.query('UPDATE oauth_refresh SET revoked_at = ? WHERE token_hash = ?').run(nowIso(), h)
      if (row.access_token_id) db.query('UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), row.access_token_id)
      return c.json(issuePair(row.user_id, cl.client_id, cl.name, row.resource, row.scope ?? 'mcp'), 200, { 'cache-control': 'no-store' })
    }
    return oauthError(400, 'unsupported_grant_type', 'authorization_code or refresh_token')
  })

  app.post('/oauth/revoke', async (c) => {
    const f = await params(c)
    const t = f.token ?? ''
    if (t.startsWith(REFRESH_PREFIX)) {
      const row = db.query('SELECT access_token_id FROM oauth_refresh WHERE token_hash = ?').get(sha256(t)) as { access_token_id: string | null } | null
      db.query('UPDATE oauth_refresh SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(nowIso(), sha256(t))
      if (row?.access_token_id) db.query('UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), row.access_token_id)
    } else if (t) {
      db.query("UPDATE tokens SET revoked_at = ? WHERE token_hash = ? AND kind = 'connector' AND revoked_at IS NULL").run(nowIso(), sha256(t))
    }
    return c.body(null, 200)
  })
}

/**
 * Forget registered apps that nobody used for 30 days (last token issue, else the day they registered) and that hold no
 * live refresh token. Their codes and refresh rows go with them. Returns how many were removed.
 */
export function pruneClients(db: Database, now = Date.now()): number {
  const total = () => (db.query('SELECT COUNT(*) AS n FROM oauth_clients').get() as { n: number }).n
  const before = total() // (the delete's own change count also counts the codes and refresh rows that go with a client)
  db.query(`DELETE FROM oauth_clients WHERE COALESCE(last_used_at, created_at) < ?
    AND NOT EXISTS (SELECT 1 FROM oauth_refresh r WHERE r.client_id = oauth_clients.client_id AND r.revoked_at IS NULL AND r.expires_at > ?)`)
    .run(new Date(now - CLIENT_IDLE_MS).toISOString(), new Date(now).toISOString())
  return before - total()
}

/** End a person's Claude app connections (their page, or an admin). Returns how many were cut. */
export function revokeConnectors(ctx: Ctx, userId: string, clientId?: string): number {
  const now = nowIso()
  const where = clientId ? 'user_id = ? AND client_id = ?' : 'user_id = ?'
  const args = clientId ? [userId, clientId] : [userId]
  const n = ctx.db.query(`UPDATE oauth_refresh SET revoked_at = ? WHERE ${where} AND revoked_at IS NULL`).run(now, ...args).changes
  ctx.db.query(`UPDATE tokens SET revoked_at = ? WHERE kind = 'connector' AND revoked_at IS NULL AND id IN (SELECT access_token_id FROM oauth_refresh WHERE ${where})`).run(now, ...args)
  return n
}

/** A person's live Claude app connections (newest first). */
export function listConnectors(ctx: Ctx, userId: string) {
  return ctx.db.query(`SELECT c.client_id AS clientId, c.name AS app, MIN(r.created_at) AS since, MAX(r.created_at) AS lastRefresh
    FROM oauth_refresh r JOIN oauth_clients c ON c.client_id = r.client_id
    WHERE r.user_id = ? AND r.revoked_at IS NULL AND r.expires_at > ? GROUP BY c.client_id ORDER BY lastRefresh DESC`).all(userId, nowIso()) as { clientId: string; app: string; since: string; lastRefresh: string }[]
}
