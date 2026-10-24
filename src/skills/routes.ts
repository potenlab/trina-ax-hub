// Skills marketplace routes. Claude Code on a PC fetches these with `Authorization: Bearer <device token>`, which it
// takes from the marketplace source's `headers` in ~/.claude/settings.json (the PC installer writes them).
//
//   GET /plugins/marketplace.json        the person's marketplace (one plugin, "company")
//   GET /plugins/company-<sha12>.zip     the person's current plugin archive; any other sha → 404
import type { Register } from '../http/app'
import { requireToken } from '../http/app'
import { jsonError } from '../http/errors'
import { archiveSha12, hubBase, marketplaceFor, pluginFor } from './marketplace'

const NO_STORE = { 'cache-control': 'no-store' }

export const register: Register = (app, ctx) => {
  app.use('/plugins/*', requireToken(ctx, 'json'))

  app.get('/plugins/marketplace.json', (c) => {
    const { user } = c.get('tokenAuth')!
    const { json } = marketplaceFor(ctx, user, hubBase(ctx.config, c.req.url))
    return c.json(json, 200, NO_STORE)
  })

  app.get('/plugins/:file', (c) => {
    const sha12 = archiveSha12(c.req.param('file'))
    if (!sha12) return jsonError(404, 'not_found', '없는 파일이에요.')
    const { user, token } = c.get('tokenAuth')!
    const build = pluginFor(ctx, user)
    // Only the archive this person would get right now: an old link (or someone else's) must not leak skills that
    // were removed or that this person may not read.
    if (build.sha12 !== sha12) return jsonError(404, 'not_found', '스킬 묶음이 바뀌었어요. 마켓플레이스를 다시 받아 주세요.')
    ctx.log.info('plugin archive served', { user: user.id, token: token.id, sha: sha12, bytes: build.zip.length, skills: build.skills.length })
    return c.body(build.zip as Uint8Array<ArrayBuffer>, 200, {
      ...NO_STORE,
      'content-type': 'application/zip',
      'content-length': String(build.zip.length),
      'content-disposition': `attachment; filename="company-${sha12}.zip"`,
    })
  })

  app.all('/plugins/*', () => jsonError(404, 'not_found', '없는 주소예요.'))
}
