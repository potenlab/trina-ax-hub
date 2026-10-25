// Skills marketplace routes. Claude Code on a PC fetches these with `Authorization: Bearer <device token>`, which it
// takes from the marketplace source's `headers` in ~/.claude/settings.json (the PC installer writes them).
//
//   GET /plugins/marketplace.json        the person's marketplace (one plugin, "company")
//   GET /plugins/company-<sha12>.zip     the person's current plugin archive; any other sha → 404
//
// With the org token (Claude admin console managed settings) the same two routes serve the org edition instead:
// marketplace "trina-ax-org", plugin "company-all", built for an everyone principal (skills any member may read), and
// the archive is company-all-<sha12>.zip. The org token never gets a person's own plugin, and a person's token never
// gets the org plugin's name (their archive link would 404).
import type { C, Register } from '../http/app'
import { jsonError } from '../http/errors'
import { requireTokenOrOrg } from '../org/auth'
import { ORG_EDITION, PERSON_EDITION, archiveSha12, hubBase, marketplaceFor, pluginFor, EVERYONE } from './marketplace'

const NO_STORE = { 'cache-control': 'no-store' }
const HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i

/**
 * The https origin this PC used to reach us (through the Cloudflare tunnel: Host = the public name, x-forwarded-proto
 * = https). Claude Code sends the marketplace's auth header only to archive URLs on the same origin as the
 * marketplace.json it fetched, so archive links must use that origin, not whatever the public address is today
 * (a PC set up before the address changed would otherwise get 401 on every update).
 */
function pcOrigin(c: C): string | null {
  if (c.get('localDirect')) return null
  const proto = (c.req.header('x-forwarded-proto') ?? '').split(',')[0]!.trim().toLowerCase()
  const host = (c.req.header('host') ?? '').trim()
  if (proto !== 'https' || !HOST.test(host) || /^(localhost|127\.|0\.0\.0\.0)/i.test(host)) return null
  return `https://${host.toLowerCase()}`
}

export const register: Register = (app, ctx) => {
  // a person's token, or the org token
  app.use('/plugins/*', requireTokenOrOrg(ctx))

  app.get('/plugins/marketplace.json', (c) => {
    const base = pcOrigin(c) ?? hubBase(ctx.config, c.req.url)
    if (c.get('orgAuth')) return c.json(marketplaceFor(ctx, EVERYONE, base, ORG_EDITION).json, 200, NO_STORE)
    const { user } = c.get('tokenAuth')!
    const { json } = marketplaceFor(ctx, user, base)
    return c.json(json, 200, NO_STORE)
  })

  app.get('/plugins/:file', (c) => {
    const org = c.get('orgAuth')
    const ed = org ? ORG_EDITION : PERSON_EDITION
    const sha12 = archiveSha12(c.req.param('file'), ed)
    if (!sha12) return jsonError(404, 'not_found', '없는 파일이에요.')
    const auth = c.get('tokenAuth')
    const build = pluginFor(ctx, org ? EVERYONE : auth!.user, ed)
    // Only the archive this person would get right now: an old link (or someone else's) must not leak skills that
    // were removed or that this person may not read.
    if (build.sha12 !== sha12) return jsonError(404, 'not_found', '스킬 묶음이 바뀌었어요. 마켓플레이스를 다시 받아 주세요.')
    ctx.log.info('plugin archive served', { user: auth?.user.id ?? 'org', token: (org?.token ?? auth!.token).id, sha: sha12, bytes: build.zip.length, skills: build.skills.length })
    return c.body(build.zip as Uint8Array<ArrayBuffer>, 200, {
      ...NO_STORE,
      'content-type': 'application/zip',
      'content-length': String(build.zip.length),
      'content-disposition': `attachment; filename="${ed.plugin}-${sha12}.zip"`,
    })
  })

  app.all('/plugins/*', () => jsonError(404, 'not_found', '없는 주소예요.'))
}
