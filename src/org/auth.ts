// Token middleware for the two routes that also accept the org token (telemetry and the skills marketplace).
// Everything else keeps using `requireToken` / `verifyToken`, which never return an org token.
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../http/app'
import { DISCONNECTED } from '../http/app'
import { jsonError } from '../http/errors'
import type { Ctx } from '../context'
import { tokenFromHeaders, verifyToken } from '../auth/tokens'
import { ORG_TOKEN_PREFIX, verifyOrgToken } from './token'

/** A person's token (sets `tokenAuth`) or the org token (sets `orgAuth`); 401 otherwise. */
export const requireTokenOrOrg = (ctx: Ctx): MiddlewareHandler<AppEnv> => async (c, next) => {
  const raw = tokenFromHeaders(c.req.raw.headers)
  if (raw?.startsWith(ORG_TOKEN_PREFIX)) {
    const org = verifyOrgToken(ctx.db, raw)
    if (!org) return jsonError(401, 'unauthorized', '조직 토큰이 맞지 않거나 새로 바뀌었어요. 관리자에게 Claude 조직 설정을 다시 붙여 넣어 달라고 해 주세요.')
    c.set('orgAuth', org)
    return next()
  }
  const auth = verifyToken(ctx.db, raw)
  if (!auth) return jsonError(401, 'unauthorized', DISCONNECTED)
  c.set('tokenAuth', auth)
  return next()
}
