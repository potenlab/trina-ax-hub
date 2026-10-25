// Helpers for the web page tests: browser-like GET/POST with a session cookie, redirects not followed.
import type { TestHub } from '../lib/hub'
import { PRODUCT } from '../../src/product'

export interface Sess { cookie: string; csrf: string }
type Fields = Record<string, string | string[]>

export const html = { accept: 'text/html,application/xhtml+xml' }

export function get(hub: TestHub, path: string, sess?: Sess | null, headers: Record<string, string> = {}) {
  return fetch(hub.url + path, { headers: { ...html, ...(sess ? { cookie: sess.cookie } : {}), ...headers }, redirect: 'manual' })
}

/** Form post. `_csrf` is the session's unless `csrf` says otherwise (false = leave it out). */
export function post(hub: TestHub, path: string, sess: Sess | null, fields: Fields = {}, o: { csrf?: string | false; headers?: Record<string, string> } = {}) {
  const body = new URLSearchParams()
  if (o.csrf !== false) body.append('_csrf', o.csrf ?? sess?.csrf ?? '')
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) body.append(k, x)
  return fetch(hub.url + path, {
    method: 'POST', body, redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...html, ...(sess ? { cookie: sess.cookie } : {}), ...o.headers },
  })
}

/** GET the page a 303/302 points at (same session). */
export async function follow(hub: TestHub, r: Response, sess: Sess | null): Promise<{ status: number; text: string; path: string }> {
  const loc = r.headers.get('location')
  if (!loc) throw new Error(`no redirect (status ${r.status}): ${(await r.text()).slice(0, 300)}`)
  const path = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc
  const g = await get(hub, path.split('#')[0]!, sess)
  return { status: g.status, text: await g.text(), path }
}

export async function text(r: Response | Promise<Response>) { return (await r).text() }

export function setCookies(r: Response): string[] { return r.headers.getSetCookie() }

export function cookieValue(r: Response, name: string): string | null {
  for (const c of setCookies(r)) {
    const m = new RegExp(`^${name}=([^;]*)`).exec(c)
    if (m) return m[1]!
  }
  return null
}

/** The cookie a response set under `base`, with or without the `__Host-` prefix the hub uses on https. */
export function hubCookie(r: Response, base: string): string | null {
  for (const name of [`__Host-${base}`, base]) {
    const v = cookieValue(r, name)
    if (v !== null) return `${name}=${v}`
  }
  return null
}

/** Pre-login form token: GET the page, keep its cookie and the `_csrf` in the form. */
export async function preSession(hub: TestHub, path: string, headers: Record<string, string> = {}): Promise<Sess> {
  const r = await get(hub, path, null, headers)
  const body = await r.text()
  const csrf = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]
  const pre = hubCookie(r, 'tax_pre')
  if (!csrf || !pre) throw new Error(`no pre-login form on ${path} (status ${r.status})`)
  return { cookie: pre, csrf }
}

/** Log in through the form. Returns the response and, on success, a session usable with get/post. */
export async function login(hub: TestHub, username: string, password: string, headers: Record<string, string> = {}): Promise<{ r: Response; sess: Sess | null }> {
  const pre = await preSession(hub, '/login', headers)
  const r = await post(hub, '/login', pre, { username, password }, { headers })
  const cookie = hubCookie(r, PRODUCT.sessionCookie)
  if (!cookie) return { r, sess: null }
  // the page's forms carry the session's csrf
  const page = await get(hub, '/me/password', { cookie, csrf: '' }, headers)
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await page.text())?.[1] ?? ''
  return { r, sess: { cookie, csrf } }
}

/** The one-time secret shown on a page (temp password or enroll code). */
export const secretOn = (page: string) => /<span class="secret"[^>]*>([^<]+)<\/span>/.exec(page)?.[1] ?? null

/** The /join/<token> link shown on a page (a just-made invite or reset link): its path and the token. */
export function inviteOn(page: string): { path: string; token: string } | null {
  const m = /\/join\/([A-Za-z0-9_-]{43})/.exec(page)
  return m ? { path: `/join/${m[1]}`, token: m[1]! } : null
}

/** Visible text of a page: tags, scripts and styles removed, entities decoded, spaces squeezed (for plain "contains" checks). */
export const pageText = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<\/?(b|i|em|strong|code|span|a|small|u)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ')

export const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
}

/** A live Claude app connection for a person, as the OAuth flow leaves it (client + refresh row). */
export function connectApp(hub: TestHub, userId: string, app = 'Claude'): string {
  const id = 'tac_' + Math.random().toString(36).slice(2, 12)
  const now = new Date().toISOString()
  hub.ctx.db.query('INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?,?,?,?)').run(id, app, '["https://claude.ai/api/mcp/auth_callback"]', now)
  hub.ctx.db.query('INSERT INTO oauth_refresh (token_hash, client_id, user_id, access_token_id, resource, scope, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('h_' + id, id, userId, null, null, 'mcp', now, new Date(Date.now() + 60 * 86_400_000).toISOString())
  return id
}

/** One MCP tool call on record for a person (what a Claude app user leaves on the hub). */
export function toolCall(hub: TestHub, userId: string, at = new Date().toISOString()) {
  hub.ctx.db.query("INSERT INTO tool_events (user_id, token_id, tool, summary, ok, at) VALUES (?, NULL, 'list_files', '/', 1, ?)").run(userId, at)
}
