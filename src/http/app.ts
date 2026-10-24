// The one HTTP app. Routes by area:
//   /v1/*, /api/hello        model relay (Claude Code's ANTHROPIC_BASE_URL)         token auth   src/relay
//   /mcp                     MCP server for the PC's Claude Code                      token auth   src/mcp
//   /plugins/*               skill marketplace (marketplace.json + plugin zips)       token auth   src/skills
//   /install.sh, /install.ps1, /api/enroll   PC installer and code redemption        code         src/install
//   /app/*                   phone chat and schedules (hub sessions)                  session      src/hub
//   /, /login, /me, /admin/* web pages                                                session      src/web
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Ctx } from '../context'
import { verifySession, type SessionAuth } from '../auth/sessions'
import { verifyToken, tokenFromHeaders, type TokenAuth } from '../auth/tokens'
import { PRODUCT } from '../product'
import { HttpError, jsonError } from './errors'

export type AppEnv = {
  Variables: { session: SessionAuth | null; tokenAuth: TokenAuth | null; clientIp: string }
  Bindings: { ip?: string }
}
export type App = Hono<AppEnv>
export type C = Context<AppEnv>

/** Token-authenticated area (relay, MCP, marketplace). Answers 401 in the given shape. */
export const requireToken = (ctx: Ctx, shape: 'json' | 'anthropic' = 'json'): MiddlewareHandler<AppEnv> => async (c, next) => {
  const auth = verifyToken(ctx.db, tokenFromHeaders(c.req.raw.headers))
  if (!auth) {
    return shape === 'anthropic'
      ? c.json({ type: 'error', error: { type: 'authentication_error', message: 'Trina AX: 기기 토큰이 없거나 만료됐어요. PC 설치를 다시 해 주세요.' } }, 401)
      : jsonError(401, 'unauthorized', '기기 토큰이 없거나 만료됐어요.')
  }
  c.set('tokenAuth', auth)
  await next()
}

/** Reads the session cookie on every request (null when not logged in). */
export const sessionMiddleware = (ctx: Ctx): MiddlewareHandler<AppEnv> => async (c, next) => {
  c.set('session', verifySession(ctx.db, getCookie(c, PRODUCT.sessionCookie)))
  await next()
}

const wantsHtml = (c: C) => !c.req.path.startsWith('/api/') && (c.req.header('accept') ?? '').includes('text/html')

/** Logged-in person required; pages redirect to /login, APIs answer 401. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('session')) {
    if (wantsHtml(c) || c.req.method === 'GET') return c.redirect('/login?next=' + encodeURIComponent(c.req.path))
    return jsonError(401, 'unauthorized', '로그인이 필요해요.')
  }
  await next()
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.get('session')
  if (!s) return c.redirect('/login?next=' + encodeURIComponent(c.req.path))
  if (s.user.role !== 'owner' && s.user.role !== 'admin') return c.text('관리자만 볼 수 있는 페이지예요.', 403)
  await next()
}

export type Register = (app: App, ctx: Ctx) => void

export function createApp(ctx: Ctx, modules: Register[]): App {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('clientIp', c.env?.ip ?? '')
    c.set('session', null)
    c.set('tokenAuth', null)
    await next()
    c.header('x-content-type-options', 'nosniff')
    c.header('referrer-policy', 'same-origin')
  })
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      if (wantsHtml(c)) return c.text(err.message, err.status as any)
      return jsonError(err.status, err.code, err.message)
    }
    ctx.log.error('request failed', { path: c.req.path, err: String((err as Error)?.message ?? err).slice(0, 300) })
    return jsonError(500, 'internal', '서버에서 문제가 생겼어요.')
  })
  app.get('/healthz', (c) => c.json({ ok: true, product: PRODUCT.id, version: PRODUCT.version }))
  for (const m of modules) m(app, ctx)
  return app
}
