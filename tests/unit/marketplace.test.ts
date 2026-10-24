import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync } from 'fflate'
import { testHub, type TestHub } from '../lib/hub'
import { deterministicZip, safeZipPath } from '../../src/skills/zip'
import {
  archiveSha12, cachedBuilds, hubBase, marketplaceFor, pluginFor, renameSkill, skillsUnavailableReason,
} from '../../src/skills/marketplace'
import { setRule } from '../../src/policy/rules-admin'
import { loadPrincipal, type Principal } from '../../src/policy/access'
import { setSetting } from '../../src/db'
import { sha256 } from '../../src/ids'
import type { Config } from '../../src/config'

// --- tiny zip reader for the fields fflate's unzip does not expose (method, DOS time, Unix mode) ---------------
interface CentralEntry { name: string; method: number; time: number; date: number; madeBy: number; mode: number }
function centralDirectory(zip: Uint8Array): CentralEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let eocd = zip.length - 22
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: CentralEntry[] = []
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50)
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true)
    out.push({
      name: strFromU8(zip.subarray(p + 46, p + 46 + nlen)),
      madeBy: v.getUint8(p + 5),
      method: v.getUint16(p + 10, true),
      time: v.getUint16(p + 12, true),
      date: v.getUint16(p + 14, true),
      mode: v.getUint32(p + 38, true) >>> 16,
    })
    p += 46 + nlen + xlen + clen
  }
  return out
}

describe('deterministic zip', () => {
  const entries = [
    { path: 'skills/b/SKILL.md', data: strToU8('# b\n') },
    { path: '.claude-plugin/plugin.json', data: strToU8('{"name":"company"}\n') },
    { path: 'skills/a/run.sh', data: strToU8('#!/bin/sh\necho hi\n'), executable: true },
    { path: 'skills/a/한글 파일.md', data: strToU8('안녕\n') },
  ]

  test('same entries in any order give the same bytes, later too', async () => {
    const a = deterministicZip(entries)
    const b = deterministicZip([...entries].reverse())
    expect(sha256(b)).toBe(sha256(a))
    await Bun.sleep(1100) // the DOS timestamp has 2-second resolution; make sure "now" is not in there
    expect(sha256(deterministicZip(entries))).toBe(sha256(a))
  })

  test('entries are sorted, dated 1980-01-01 00:00, Unix modes 0644 / 0755, UTF-8 names', () => {
    const cd = centralDirectory(deterministicZip(entries))
    expect(cd.map((e) => e.name)).toEqual(['.claude-plugin/plugin.json', 'skills/a/run.sh', 'skills/a/한글 파일.md', 'skills/b/SKILL.md'])
    for (const e of cd) {
      expect(e.date).toBe((0 << 9) | (1 << 5) | 1)
      expect(e.time).toBe(0)
      expect(e.madeBy).toBe(3)
    }
    expect(cd.find((e) => e.name.endsWith('run.sh'))!.mode).toBe(0o100755)
    expect(cd.find((e) => e.name.endsWith('SKILL.md'))!.mode).toBe(0o100644)
    const files = unzipSync(deterministicZip(entries))
    expect(strFromU8(files['skills/a/한글 파일.md']!)).toBe('안녕\n')
  })

  test('compressed formats and very repetitive files are stored (Claude Code refuses >50x expansion)', () => {
    const zip = deterministicZip([
      { path: 'a.txt', data: strToU8('hello world, this compresses a little but not too much. 0123456789 abcdefghijklmnop') },
      { path: 'b.png', data: new Uint8Array(500) },
      { path: 'c.csv', data: strToU8('0,'.repeat(50_000)) },
      { path: 'd.md', data: strToU8(Array.from({ length: 300 }, (_, i) => `line ${i} ${sha256(String(i))}`).join('\n')) },
    ])
    const m = Object.fromEntries(centralDirectory(zip).map((e) => [e.name, e.method]))
    expect(m).toEqual({ 'a.txt': 8, 'b.png': 0, 'c.csv': 0, 'd.md': 8 })
    expect(strFromU8(unzipSync(zip)['c.csv']!).length).toBe(100_000)
  })

  test('refuses unsafe and duplicate paths', () => {
    for (const p of ['/abs', '../x', 'a/../b', 'a//b', 'a\\b', 'C:/x', '', 'a/./b']) expect(safeZipPath(p)).toBe(false)
    expect(safeZipPath('skills/a/SKILL.md')).toBe(true)
    expect(() => deterministicZip([{ path: '../x', data: new Uint8Array() }])).toThrow()
    expect(() => deterministicZip([{ path: 'a', data: new Uint8Array() }, { path: 'a', data: new Uint8Array() }])).toThrow()
  })
})

describe('renameSkill', () => {
  test('replaces, adds or creates the front matter name', () => {
    expect(renameSkill('---\nname: report\ndescription: x\n---\n# r\n', 'sales-report')).toBe('---\nname: "sales-report"\ndescription: x\n---\n# r\n')
    expect(renameSkill('---\ndescription: x\n---\nbody', 'b')).toBe('---\nname: "b"\ndescription: x\n---\nbody')
    expect(renameSkill('# no front matter\n', 'c')).toBe('---\nname: "c"\n---\n# no front matter\n')
    expect(renameSkill('---\r\nname: a\r\n---\r\nx', 'z')).toBe('---\r\nname: "z"\r\n---\r\nx')
  })
})

describe('urls', () => {
  const cfg = (o: Partial<Config>) => ({ host: '127.0.0.1', port: 47900, publicUrl: null, lanUrl: null, ...o }) as Config
  test('hub base: public, then LAN, then the address the request came in on', () => {
    expect(hubBase(cfg({ publicUrl: 'https://acme.example.com' }), 'http://192.168.1.5:47900/x')).toBe('https://acme.example.com')
    expect(hubBase(cfg({ lanUrl: 'http://192.168.1.17:47900' }), 'http://10.0.0.1/x')).toBe('http://192.168.1.17:47900')
    expect(hubBase(cfg({}), 'http://192.168.1.17:47900/install.sh')).toBe('http://192.168.1.17:47900')
    expect(hubBase(cfg({}))).toBe('http://127.0.0.1:47900')
  })
  test('skills need an https public URL that is not loopback or link-local', () => {
    expect(skillsUnavailableReason(cfg({}))).toContain('공개 주소')
    expect(skillsUnavailableReason(cfg({ publicUrl: 'http://acme.example.com' }))).toContain('https')
    expect(skillsUnavailableReason(cfg({ publicUrl: 'https://127.0.0.1:8443' }))).not.toBeNull()
    expect(skillsUnavailableReason(cfg({ publicUrl: 'https://localhost' }))).not.toBeNull()
    expect(skillsUnavailableReason(cfg({ publicUrl: 'https://169.254.169.254' }))).not.toBeNull()
    expect(skillsUnavailableReason(cfg({ publicUrl: 'https://[::1]' }))).not.toBeNull()
    expect(skillsUnavailableReason(cfg({ publicUrl: 'https://acme.ax.trina.app' }))).toBeNull()
  })
  test('archive names', () => {
    expect(archiveSha12('company-0123456789ab.zip')).toBe('0123456789ab')
    for (const f of ['company-0123456789AB.zip', 'company-0123456789a.zip', 'other-0123456789ab.zip', 'company-0123456789ab.zip.bak']) expect(archiveSha12(f)).toBeNull()
  })
})

let hub: TestHub
afterAll(async () => { await hub?.stop() })

describe('marketplace over HTTP', async () => {
  hub = await testHub()
  const db = hub.ctx.db
  const sales = hub.group('영업')
  const park = await hub.user('park', { groups: [sales.id] })
  const choi = await hub.user('choi')
  const lee = await hub.user('lee')
  hub.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: "견적서 초안을 만든다"\n---\n# 견적\n')
  hub.write('skills/company/quote/templates/견적서.md', '# {{회사}} 견적서\n')
  hub.write('skills/company/quote/.secret', 'hidden files never ship')
  hub.write('skills/sales/pitch/SKILL.md', '---\nname: pitch\ndescription: 영업 제안서\n---\n# pitch\n')
  hub.write('skills/sales/quote/SKILL.md', '---\nname: quote\ndescription: 영업용 견적\n---\n# sales quote\n')
  hub.write('skills/company/notes/SKILL.md', '# 회의록 정리\n')
  hub.write('skills/company/notes/private/salary.md', '연봉표')
  hub.write('skills/company/README.md', 'not a skill')
  setRule(db, 'skills/sales', 'everyone', null, 'none')
  setRule(db, 'skills/sales', 'group', sales.id, 'read')
  setRule(db, 'skills/company/notes/private', 'everyone', null, 'none')
  hub.ctx.rulesChanged()
  const parkToken = hub.token(park.id)
  const choiToken = hub.token(choi.id)
  const leeToken = hub.token(lee.id)
  const principal = (id: string) => loadPrincipal(db, id) as Principal

  const get = (p: string, token?: string) => fetch(hub.url + p, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  const market = async (token: string) => {
    const r = await get('/plugins/marketplace.json', token)
    expect(r.status).toBe(200)
    return await r.json() as any
  }
  const archive = async (token: string) => {
    const m = await market(token)
    const r = await get(new URL(m.plugins[0].source.url).pathname, token)
    expect(r.status).toBe(200)
    const zip = new Uint8Array(await r.arrayBuffer())
    return { m, zip, files: unzipSync(zip), headers: r.headers }
  }

  test('a token is required', async () => {
    expect((await get('/plugins/marketplace.json')).status).toBe(401)
    expect((await get('/plugins/marketplace.json', 'tax_nope')).status).toBe(401)
    expect((await get('/plugins/company-0123456789ab.zip')).status).toBe(401)
  })

  test('marketplace.json shape (no version anywhere)', async () => {
    setSetting(db, 'companyName', '에이크미')
    const m = await market(parkToken)
    expect(m.name).toBe('trina-ax')
    expect(m.owner).toEqual({ name: '에이크미' })
    expect(typeof m.description).toBe('string')
    expect(m.plugins).toHaveLength(1)
    const p = m.plugins[0]
    expect(p.name).toBe('company')
    expect(p.source.source).toBe('archive')
    expect(p.source.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(p.source.url).toBe(`${hub.url}/plugins/company-${p.source.sha256.slice(0, 12)}.zip`)
    expect(JSON.stringify(m)).not.toContain('"version"')
  })

  test('archive layout: plugin.json, README, skills with their files; nothing hidden or forbidden', async () => {
    const { m, zip, files, headers } = await archive(parkToken)
    expect(sha256(zip)).toBe(m.plugins[0].source.sha256)
    expect(headers.get('content-type')).toBe('application/zip')
    expect(headers.get('cache-control')).toBe('no-store')
    const manifest = JSON.parse(strFromU8(files['.claude-plugin/plugin.json']!))
    expect(manifest.name).toBe('company')
    expect(manifest.version).toBeUndefined()
    expect(manifest.author).toEqual({ name: '에이크미' })
    expect(Object.keys(files).sort()).toEqual([
      '.claude-plugin/plugin.json',
      'README.md',
      'skills/notes/SKILL.md',
      'skills/pitch/SKILL.md',
      'skills/quote/SKILL.md',
      'skills/quote/templates/견적서.md',
      'skills/sales-quote/SKILL.md',
    ])
    expect(strFromU8(files['README.md']!)).toContain('견적서 초안을 만든다')
    // same folder name in two packs: the later pack is prefixed and its front matter name made unique
    expect(strFromU8(files['skills/quote/SKILL.md']!)).toContain('# 견적')
    expect(strFromU8(files['skills/sales-quote/SKILL.md']!)).toStartWith('---\nname: "sales-quote"\n')
    expect(strFromU8(files['skills/sales-quote/SKILL.md']!)).toContain('# sales quote')
  })

  test('contents follow folder permissions', async () => {
    const { files } = await archive(choiToken)
    expect(Object.keys(files).filter((f) => f.startsWith('skills/')).sort()).toEqual([
      'skills/notes/SKILL.md', 'skills/quote/SKILL.md', 'skills/quote/templates/견적서.md',
    ])
  })

  test("another person's archive is a 404", async () => {
    const parkSha = (await market(parkToken)).plugins[0].source.sha256 as string
    const choiSha = (await market(choiToken)).plugins[0].source.sha256 as string
    expect(parkSha).not.toBe(choiSha)
    expect((await get(`/plugins/company-${parkSha.slice(0, 12)}.zip`, choiToken)).status).toBe(404)
    expect((await get(`/plugins/company-${choiSha.slice(0, 12)}.zip`, parkToken)).status).toBe(404)
    expect((await get('/plugins/other.zip', parkToken)).status).toBe(404)
  })

  test('people with the same skills share one build; unchanged content keeps its sha', async () => {
    const a = pluginFor(hub.ctx, principal(choi.id))
    const b = pluginFor(hub.ctx, principal(lee.id))
    expect(b.sha256).toBe(a.sha256)
    expect(b).toBe(a) // the cached object itself
    expect((await market(leeToken)).plugins[0].source.sha256).toBe(a.sha256)
    // touching a file without changing it gives a new plan but the same zip
    const f = path.join(hub.ctx.fx.root, 'skills/company/quote/SKILL.md')
    fs.utimesSync(f, new Date(), new Date(Date.now() + 5000))
    expect(pluginFor(hub.ctx, principal(choi.id)).sha256).toBe(a.sha256)
  })

  test('a changed skill gives a new sha; the old archive is then a 404', async () => {
    const before = (await market(choiToken)).plugins[0].source.sha256 as string
    hub.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: "견적서 초안을 만든다"\n---\n# 견적 v2\n')
    const after = (await market(choiToken)).plugins[0].source.sha256 as string
    expect(after).not.toBe(before)
    expect((await get(`/plugins/company-${before.slice(0, 12)}.zip`, choiToken)).status).toBe(404)
    const { files } = await archive(choiToken)
    expect(strFromU8(files['skills/quote/SKILL.md']!)).toContain('# 견적 v2')
  })

  test('a new permission reaches the person on the next fetch', async () => {
    expect((await archive(choiToken)).files['skills/pitch/SKILL.md']).toBeUndefined()
    setRule(db, 'skills/sales', 'user', choi.id, 'read')
    hub.ctx.rulesChanged()
    expect((await archive(choiToken)).files['skills/pitch/SKILL.md']).toBeDefined()
    setRule(db, 'skills/sales', 'user', choi.id, null)
    hub.ctx.rulesChanged()
  })

  test("the 'skills' event drops the cache", () => {
    pluginFor(hub.ctx, principal(park.id))
    expect(cachedBuilds(hub.ctx)).toBeGreaterThan(0)
    hub.ctx.events.emit('skills')
    expect(cachedBuilds(hub.ctx)).toBe(0)
  })

  test('scripts keep their executable bit', async () => {
    hub.write('skills/company/quote/scripts/run.sh', '#!/bin/sh\necho ok\n')
    fs.chmodSync(path.join(hub.ctx.fx.root, 'skills/company/quote/scripts/run.sh'), 0o755)
    const { zip } = await archive(choiToken)
    const cd = centralDirectory(zip)
    expect(cd.find((e) => e.name === 'skills/quote/scripts/run.sh')!.mode).toBe(0o100755)
    expect(cd.find((e) => e.name === 'skills/quote/SKILL.md')!.mode).toBe(0o100644)
  })

  test('the public URL is used for archive URLs when set', async () => {
    hub.ctx.config.publicUrl = 'https://acme.ax.trina.app'
    try {
      const m = await market(parkToken)
      expect(m.plugins[0].source.url).toStartWith('https://acme.ax.trina.app/plugins/company-')
      const { json } = marketplaceFor(hub.ctx, principal(park.id), 'https://acme.ax.trina.app')
      expect(json.plugins[0]!.source.url).toBe(m.plugins[0].source.url)
    } finally { hub.ctx.config.publicUrl = null }
  })

  test('someone with no readable skills still gets a valid (empty) plugin', async () => {
    setRule(db, 'skills', 'user', lee.id, 'none')
    hub.ctx.rulesChanged()
    const { files, m } = await archive(leeToken)
    expect(Object.keys(files).sort()).toEqual(['.claude-plugin/plugin.json', 'README.md'])
    expect(m.plugins[0].description).toContain('없어요')
  })
})

describe('archive links follow the address the PC used', async () => {
  const { testHub } = await import('../lib/hub')
  const hub = await testHub()
  const u = await hub.user('origin-user')
  hub.write('skills/company/a/SKILL.md', '---\nname: a\ndescription: a\n---\n')
  hub.ctx.config.publicUrl = 'https://new-name.example.com'
  test('a PC that reached the hub through an older public name keeps getting archives there', async () => {
    const r = await fetch(hub.url + '/plugins/marketplace.json', { headers: { authorization: 'Bearer ' + hub.token(u.id), host: 'old-name.example.com', 'x-forwarded-proto': 'https', 'cf-ray': '1' } })
    const j = await r.json() as any
    expect(j.plugins[0].source.url.startsWith('https://old-name.example.com/plugins/company-')).toBe(true)
  })
  test('without a forwarded https origin the configured public address is used', async () => {
    const r = await fetch(hub.url + '/plugins/marketplace.json', { headers: { authorization: 'Bearer ' + hub.token(u.id) } })
    const j = await r.json() as any
    expect(j.plugins[0].source.url.startsWith('https://new-name.example.com/plugins/company-')).toBe(true)
    await hub.stop()
  })
})
