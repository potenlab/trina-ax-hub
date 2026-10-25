// The org-wide skills marketplace (served to the org token) holds only what every member may use, and the same
// skills are offered as per-skill .zip files for Claude's "Upload a skill".
import { afterAll, describe, expect, test } from 'bun:test'
import { strFromU8, unzipSync } from 'fflate'
import { testHub } from '../lib/hub'
import { setRule } from '../../src/policy/rules-admin'
import { sha256 } from '../../src/ids'
import { rotateOrgToken } from '../../src/org/token'
import { orgSkillZip, orgSkills } from '../../src/org/skillzips'
import { EVERYONE, ORG_PLUGIN_ID, archiveSha12, ORG_EDITION, marketplaceFor, pluginFor } from '../../src/skills/marketplace'
import { skillsFor } from '../../src/skills/catalog'
import { get } from './web-lib'

const hub = await testHub({ access: 'subscription', config: { publicUrl: 'https://acme.example' } })
afterAll(async () => { await hub.stop() })
const db = hub.ctx.db

const sales = hub.group('영업')
const park = await hub.user('park', { groups: [sales.id] })
const admin = await hub.user('boss', { role: 'admin' })
const named = await hub.user('named')
hub.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: "견적서 초안을 만든다"\n---\n# 견적\n')
hub.write('skills/company/quote/templates/견적서.md', '# {{회사}} 견적서\n')
hub.write('skills/company/quote/private/pay.md', '연봉')
hub.write('skills/company/notes/SKILL.md', '# 회의록 정리\n')
hub.write('skills/sales/pitch/SKILL.md', '---\nname: pitch\ndescription: 영업 제안서\n---\n# pitch\n')
hub.write('skills/admins/audit/SKILL.md', '---\nname: audit\ndescription: 관리자용\n---\n# a\n')
hub.write('skills/mine/solo/SKILL.md', '---\nname: solo\ndescription: 한 사람용\n---\n# s\n')
hub.write('skills/company/Korean 스킬/SKILL.md', '---\nname: 한글\ndescription: 한글 폴더\n---\n# k\n')
setRule(db, 'skills/sales', 'everyone', null, 'none')
setRule(db, 'skills/sales', 'group', sales.id, 'read')
setRule(db, 'skills/admins', 'everyone', null, 'none')
setRule(db, 'skills/admins', 'role', 'admin', 'read')
setRule(db, 'skills/mine', 'everyone', null, 'none')
setRule(db, 'skills/mine', 'user', named.id, 'read')
setRule(db, 'skills/company/quote/private', 'everyone', null, 'none')
hub.ctx.rulesChanged()

const org = rotateOrgToken(db, hub.owner.id).token
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const fetchOrg = (p: string, t = org) => fetch(hub.url + p, { headers: bearer(t) })

describe('org marketplace over HTTP', () => {
  test('marketplace.json: its own names, one archive plugin, an https link on the public address', async () => {
    const r = await fetchOrg('/plugins/marketplace.json')
    expect(r.status).toBe(200)
    const m = await r.json() as any
    expect(m.name).toBe('trina-ax-org')
    expect(ORG_PLUGIN_ID).toBe('company-all@trina-ax-org')
    expect(m.plugins).toHaveLength(1)
    const p = m.plugins[0]
    expect(p.name).toBe('company-all')
    expect(p.source.source).toBe('archive')
    expect(p.source.url).toBe(`https://acme.example/plugins/company-all-${p.source.sha256.slice(0, 12)}.zip`)
    expect(p.source.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(m)).not.toContain('"version"')
  })

  test('the archive holds exactly what every member may read: no group, role or single-person skill, no stricter sub-folder', async () => {
    const m = await (await fetchOrg('/plugins/marketplace.json')).json() as any
    const url = new URL(m.plugins[0].source.url)
    const r = await fetchOrg(url.pathname)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/zip')
    expect(r.headers.get('content-disposition')).toContain('company-all-')
    const zip = new Uint8Array(await r.arrayBuffer())
    expect(sha256(zip)).toBe(m.plugins[0].source.sha256)
    const files = unzipSync(zip)
    expect(Object.keys(files).sort()).toEqual([
      '.claude-plugin/plugin.json',
      'README.md',
      'skills/Korean 스킬/SKILL.md',
      'skills/notes/SKILL.md',
      'skills/quote/SKILL.md',
      'skills/quote/templates/견적서.md',
    ])
    const manifest = JSON.parse(strFromU8(files['.claude-plugin/plugin.json']!))
    expect(manifest.name).toBe('company-all')
    const all = Object.values(files).map((f) => strFromU8(f)).join('\n')
    for (const secret of ['pitch', '관리자용', '한 사람용', '연봉']) expect(all).not.toContain(secret)
    expect(strFromU8(files['README.md']!)).toContain('그룹별 스킬')
  })

  test('same permission logic as a person: it equals what a plain member with no groups gets', () => {
    const plain = skillsFor(hub.ctx.fx.root, hub.ctx.rules(), { id: 'zzzzzzzzzzzz', name: 'x', role: 'member', groups: [] }).map((s) => s.path)
    const everyone = skillsFor(hub.ctx.fx.root, hub.ctx.rules(), EVERYONE).map((s) => s.path)
    expect(everyone).toEqual(plain)
    expect(everyone).not.toContain('skills/sales/pitch')
    // a person with a group or a role gets more; the org edition never does
    const parkSkills = skillsFor(hub.ctx.fx.root, hub.ctx.rules(), { id: park.id, name: 'p', role: 'member', groups: [sales.id] }).map((s) => s.path)
    expect(parkSkills).toContain('skills/sales/pitch')
    expect(everyone.length).toBeLessThan(parkSkills.length)
  })

  test('a person token and the org token never get each other\'s archive', async () => {
    const m = await (await fetchOrg('/plugins/marketplace.json')).json() as any
    const orgPath = new URL(m.plugins[0].source.url).pathname
    const parkToken = hub.token(park.id)
    // the person's marketplace is the person's own
    const pm = await (await fetch(hub.url + '/plugins/marketplace.json', { headers: bearer(parkToken) })).json() as any
    expect(pm.name).toBe('trina-ax')
    expect(pm.plugins[0].name).toBe('company')
    expect((await fetch(hub.url + orgPath, { headers: bearer(parkToken) })).status).toBe(404)
    const personPath = new URL(pm.plugins[0].source.url).pathname
    expect((await fetchOrg(personPath)).status).toBe(404)
    // and the person's archive still has the group skill
    const files = unzipSync(new Uint8Array(await (await fetch(hub.url + personPath, { headers: bearer(parkToken) })).arrayBuffer()))
    expect(Object.keys(files)).toContain('skills/pitch/SKILL.md')
  })

  test('a changed skill folder changes the archive; an old link is gone', async () => {
    const m1 = await (await fetchOrg('/plugins/marketplace.json')).json() as any
    hub.write('skills/company/late/SKILL.md', '---\nname: late\ndescription: 새 스킬\n---\n# l\n')
    hub.ctx.rulesChanged()
    const m2 = await (await fetchOrg('/plugins/marketplace.json')).json() as any
    expect(m2.plugins[0].source.sha256).not.toBe(m1.plugins[0].source.sha256)
    expect((await fetchOrg(new URL(m1.plugins[0].source.url).pathname)).status).toBe(404)
    expect((await fetchOrg(new URL(m2.plugins[0].source.url).pathname)).status).toBe(200)
  })

  test('archive file names are checked per edition', () => {
    expect(archiveSha12('company-all-0123456789ab.zip', ORG_EDITION)).toBe('0123456789ab')
    expect(archiveSha12('company-0123456789ab.zip', ORG_EDITION)).toBeNull()
    expect(archiveSha12('company-all-0123456789ab.zip')).toBeNull()
  })

  test('the org build is cached with the person builds without mixing them up', () => {
    const a = pluginFor(hub.ctx, EVERYONE, ORG_EDITION)
    const b = marketplaceFor(hub.ctx, EVERYONE, 'https://acme.example', ORG_EDITION)
    expect(b.build.sha256).toBe(a.sha256)
    const person = pluginFor(hub.ctx, { id: named.id, name: 'n', role: 'member', groups: [] })
    expect(person.sha256).not.toBe(a.sha256)
  })
})

describe('per-skill .zip for "Upload a skill"', () => {
  test('lists only skills every member may use, with their files', () => {
    const list = orgSkills(hub.ctx)
    expect(list.map((s) => s.path)).toEqual(['skills/company/Korean 스킬', 'skills/company/late', 'skills/company/notes', 'skills/company/quote'])
    const quote = list.find((s) => s.dir === 'quote')!
    expect(quote.files).toBe(2) // SKILL.md and templates/견적서.md; private/ is closed to everyone
    expect(quote.portable).toBe(true)
    expect(list.find((s) => s.dir === 'Korean 스킬')!.portable).toBe(false)
  })

  test('a zip is the skill\'s folder: SKILL.md and its files under one top-level folder', () => {
    const z = orgSkillZip(hub.ctx, 'skills/company/quote')!
    const files = unzipSync(z.zip)
    expect(Object.keys(files).sort()).toEqual(['quote/SKILL.md', 'quote/templates/견적서.md'])
    expect(strFromU8(files['quote/SKILL.md']!)).toContain('견적서 초안을 만든다')
    // same bytes every time
    expect(sha256(orgSkillZip(hub.ctx, 'skills/company/quote')!.zip)).toBe(sha256(z.zip))
  })

  test('skills that not everyone may use, and made-up paths, give nothing', () => {
    for (const p of ['skills/sales/pitch', 'skills/admins/audit', 'skills/mine/solo', 'skills/company/nothing', '../etc', 'skills/company/quote/private', 'skills/company']) {
      expect(orgSkillZip(hub.ctx, p)).toBeNull()
    }
  })

  test('the download route is for admins only and checks the same thing', async () => {
    const owner = hub.session(hub.owner.id)
    const adm = hub.session(admin.id)
    const mem = hub.session(park.id)
    const url = (p: string) => `/admin/claude/skill.zip?path=${encodeURIComponent(p)}`
    for (const s of [owner, adm]) {
      const r = await get(hub, url('skills/company/quote'), s)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toBe('application/zip')
      expect(r.headers.get('content-disposition')).toContain('quote.zip')
      expect(Object.keys(unzipSync(new Uint8Array(await r.arrayBuffer()))).sort()).toEqual(['quote/SKILL.md', 'quote/templates/견적서.md'])
      // an admin can read the admin-only skill on the hub, but it must not be uploaded for everyone
      expect((await get(hub, url('skills/admins/audit'), s)).status).toBe(404)
      expect((await get(hub, url('skills/sales/pitch'), s)).status).toBe(404)
    }
    expect((await get(hub, url('skills/company/quote'), mem)).status).toBe(403)
    const out = await get(hub, url('skills/company/quote'))
    expect(out.status).toBe(302)
    // a Korean folder name gets an ASCII fallback and an encoded real name
    const k = await get(hub, url('skills/company/Korean 스킬'), owner)
    expect(k.status).toBe(200)
    expect(k.headers.get('content-disposition')).toContain("filename*=UTF-8''")
  })
})
