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

/** Pre-login form token: GET the page, keep its cookie and the `_csrf` in the form. */
export async function preSession(hub: TestHub, path: string): Promise<Sess> {
  const r = await get(hub, path)
  const body = await r.text()
  const csrf = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]
  const pre = cookieValue(r, 'tax_pre')
  if (!csrf || !pre) throw new Error(`no pre-login form on ${path} (status ${r.status})`)
  return { cookie: `tax_pre=${pre}`, csrf }
}

/** Log in through the form. Returns the response and, on success, a session usable with get/post. */
export async function login(hub: TestHub, username: string, password: string, headers: Record<string, string> = {}): Promise<{ r: Response; sess: Sess | null }> {
  const pre = await preSession(hub, '/login')
  const r = await post(hub, '/login', pre, { username, password }, { headers })
  const id = cookieValue(r, PRODUCT.sessionCookie)
  if (!id) return { r, sess: null }
  // the page's forms carry the session's csrf
  const cookie = `${PRODUCT.sessionCookie}=${id}`
  const page = await get(hub, '/me/password', { cookie, csrf: '' })
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await page.text())?.[1] ?? ''
  return { r, sess: { cookie, csrf } }
}

/** The one-time secret shown on a page (temp password or enroll code). */
export const secretOn = (page: string) => /<span class="secret">([^<]+)<\/span>/.exec(page)?.[1] ?? null
