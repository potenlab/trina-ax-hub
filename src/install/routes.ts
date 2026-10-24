// PC installer routes.
//
//   GET  /install.sh, /install.ps1   the installer, rendered with this hub's URL (text/plain; no secrets inside)
//   POST /api/enroll                 { code, deviceName?, os? } → EnrollResponse (see enroll.ts)
//   POST /api/unenroll               Bearer device token → revokes that token (uninstall, re-install)
//
// Guessing limits on /api/enroll: 10 failed attempts per client address and 5 per code prefix (first four
// characters) per hour. The prefix limit slows down guessing spread over many addresses.
import type { C, Register } from '../http/app'
import { requireToken } from '../http/app'
import { jsonError } from '../http/errors'
import { hubBase } from '../skills/marketplace'
import { audit } from '../audit'
import { revokeToken } from '../auth/tokens'
import { EnrollBody, enroll, normalizeCode } from './enroll'
import { FailureLimiter, clientAddress } from './limits'
import { renderScript, type ScriptKind } from './scripts'

const HOUR = 3600_000
const MAX_BODY = 4096

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export const register: Register = (app, ctx) => {
  const perAddress = new FailureLimiter(10, HOUR)
  const perPrefix = new FailureLimiter(5, HOUR)

  const script = (kind: ScriptKind) => (c: C) => {
    let text: string
    try { text = renderScript(kind, hubBase(ctx.config, c.req.url)) } catch (e) {
      ctx.log.error('install script render failed', { kind, err: String((e as Error).message) })
      return new Response('# 허브 주소 설정이 올바르지 않아서 설치 스크립트를 만들 수 없어요. 관리자에게 알려 주세요.\nexit 1\n', {
        status: 500, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
  }
  app.get('/install.sh', script('sh'))
  app.get('/install.ps1', script('ps1'))

  app.post('/api/enroll', async (c) => {
    const ip = clientAddress(c)
    if (perAddress.blocked(ip)) {
      ctx.log.warn('enroll rate limited', { ip })
      return jsonError(429, 'rate_limited', '시도가 너무 많아요. 한 시간쯤 뒤에 다시 해 주세요.')
    }
    const text = await c.req.text()
    let body: unknown = null
    if (text.length <= MAX_BODY) try { body = JSON.parse(text) } catch {}
    const parsed = EnrollBody.safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation', '연결 코드를 보내 주세요.')

    const code = normalizeCode(parsed.data.code)
    const prefix = code.slice(0, 4)
    if (perPrefix.blocked(prefix)) {
      ctx.log.warn('enroll rate limited (code prefix)', { ip })
      return jsonError(429, 'rate_limited', '이 코드로 너무 여러 번 시도했어요. 관리자에게 새 코드를 받아 주세요.')
    }
    const r = code.length === 12 ? enroll(ctx, { ...parsed.data, code }, ip, hubBase(ctx.config, c.req.url)) : null
    if (!r) {
      perAddress.fail(ip)
      perPrefix.fail(prefix)
      return jsonError(400, 'invalid_code', '연결 코드가 맞지 않거나, 이미 썼거나, 만료됐어요. 새 코드를 받아 주세요.')
    }
    return json(r)
  })

  app.post('/api/unenroll', requireToken(ctx, 'json'), (c) => {
    const { token, user } = c.get('tokenAuth')!
    if (token.kind !== 'device') return jsonError(400, 'validation', 'PC 토큰만 해제할 수 있어요.')
    revokeToken(ctx.db, token.id, user.id)
    audit(ctx.db, { actor: user.id, action: 'device.unenroll', target: token.id, detail: { device: token.name } })
    return json({ ok: true })
  })
}
