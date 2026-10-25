// The hub's cookie names and the https test they depend on.
import type { Context } from 'hono'

/** True when the browser reached the hub over https: directly, or through the Cloudflare tunnel (x-forwarded-proto). */
export const isHttps = (c: Context) =>
  new URL(c.req.url).protocol === 'https:' || (c.req.header('x-forwarded-proto') ?? '').split(',')[0]!.trim().toLowerCase() === 'https'

/**
 * On https the hub's cookies carry the `__Host-` prefix, so the browser takes them only from this exact host (Secure,
 * Path=/, never a Domain). Customer hubs share a parent domain (<company>.trina.app): without the prefix one hub could
 * set `tax_session=…; Domain=trina.app` and another hub would read it (cookie tossing: a forced session, a known
 * double-submit form token). Plain http on the office LAN can't use the prefix (it needs Secure) and keeps the bare
 * name; that address is a different host anyway.
 */
export const cookieName = (c: Context, base: string) => (isHttps(c) ? `__Host-${base}` : base)
