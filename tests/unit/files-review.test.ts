// Review fixes in the file service: move_file cannot invent an .xlsx / .hwp from text, Korean globs find names macOS
// wrote decomposed, and huge files are deleted or replaced without reading them on the hub's thread.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import { PRODUCT } from '../../src/product'
import { VERSION_COPY_MAX } from '../../src/files/store'
import { rg, xlsxBook } from './files-fixtures'
import { errorOf, makeWorld, type World } from './files-world'

let W: World
beforeAll(async () => { W = await makeWorld() })
afterAll(async () => { await W?.hub.stop() })
const versions = (rel: string) => W.hub.ctx.db.query('SELECT * FROM file_versions WHERE path = ? ORDER BY created_at, rowid').all(rel) as any[]

describe('move_file keeps a file\'s kind', () => {
  test('a text file cannot become an .xlsx, .hwp, .pdf or image by renaming', async () => {
    const s = W.svc(W.choi)
    s.write('shared/sylk.txt', 'ID;PWXL\nC;Y10000;X16384;K"b"\nE\n')
    for (const to of ['shared/sylk.xlsx', 'shared/sylk.XLS', 'shared/a.hwp', 'shared/a.hwpx', 'shared/a.pdf', 'shared/a.png', 'shared/a.docx', 'shared/a.zip']) {
      expect(await errorOf(() => s.move('shared/sylk.txt', to)), to).toContain('cannot be renamed')
    }
    expect(fs.existsSync(W.abs('shared/sylk.txt'))).toBe(true)
    expect(s.move('shared/sylk.txt', 'shared/sylk.csv').to).toBe('shared/sylk.csv') // text to text is fine
  })
  test('a real document moves and renames as before', () => {
    fs.writeFileSync(W.abs('shared/매출.xlsx'), xlsxBook([['월', '매출']]))
    const s = W.svc(W.choi)
    expect(s.move('shared/매출.xlsx', 'shared/2026/매출-10월.XLSX').to).toBe('shared/2026/매출-10월.XLSX')
    expect(s.move('shared/2026/매출-10월.XLSX', 'shared/2026/매출-10월.xlsx').to).toBe('shared/2026/매출-10월.xlsx')
  })
})

describe.skipIf(!rg)('Korean globs match decomposed (Finder) names', () => {
  beforeAll(() => {
    fs.mkdirSync(W.abs('shared/glob'), { recursive: true })
    fs.writeFileSync(W.abs(`shared/glob/${'회의록 10월.md'.normalize('NFD')}`), '견적 GLOBNEEDLE\n')
    fs.writeFileSync(W.abs(`shared/glob/${'보고서.md'.normalize('NFC')}`), '보고 GLOBNEEDLE\n')
    fs.writeFileSync(W.abs('shared/glob/plain.txt'), 'GLOBNEEDLE plain\n')
  })
  const nfd = `shared/glob/${'회의록 10월.md'.normalize('NFD')}`
  test('content mode', async () => {
    const s = W.svc(W.choi)
    const hits = async (glob: string) => ((await s.search({ query: 'GLOBNEEDLE', path: 'shared/glob', glob })).hits as { path: string }[]).map((h) => h.path).sort()
    expect(await hits('*회의록*'.normalize('NFC'))).toEqual([nfd])
    expect(await hits('*10월*')).toEqual([nfd])
    expect(await hits('*보고서*'.normalize('NFD'))).toEqual(['shared/glob/보고서.md'])
    expect(await hits('*.md')).toEqual([nfd, 'shared/glob/보고서.md'].sort())
    expect(await hits('*.TXT')).toEqual(['shared/glob/plain.txt'])
  })
  test('name mode', async () => {
    const s = W.svc(W.choi)
    const r = await s.search({ query: '10월', mode: 'name', path: 'shared/glob', glob: '*회의록*' })
    expect(r.hits.map((h) => h.path)).toEqual([nfd])
    const r2 = await s.search({ query: '회의록'.normalize('NFC'), mode: 'name' })
    expect(r2.hits.map((h) => h.path)).toEqual([nfd])
  })
})

describe('large files do not stall the hub', () => {
  const big = (rel: string, size: number) => { fs.writeFileSync(W.abs(rel), 'head\n'); fs.truncateSync(W.abs(rel), size) } // sparse: instant to make
  test('deleting a 2 GB file is a rename: nothing is read or hashed', () => {
    big('shared/meeting.mp4', 2 * 1024 ** 3)
    const t0 = performance.now()
    const r = W.svc(W.choi).remove('shared/meeting.mp4')
    expect(performance.now() - t0).toBeLessThan(300) // was 1.2 s, hashing the whole file
    const v = versions('shared/meeting.mp4')
    expect(v).toMatchObject([{ reason: 'trash', size: 2 * 1024 ** 3, sha256: '', stored_as: r.storedAs }])
    expect(fs.statSync(W.abs(r.storedAs!)).size).toBe(2 * 1024 ** 3)
  })
  test('overwriting a 2 GB file keeps it as a version by a link, not a copy', () => {
    big('shared/big.log', 2 * 1024 ** 3)
    const t0 = performance.now()
    const r = W.svc(W.choi).write('shared/big.log', 'short', { overwrite: true })
    expect(performance.now() - t0).toBeLessThan(300)
    const v = versions('shared/big.log')
    expect(v).toMatchObject([{ id: r.versionId, reason: 'overwrite', size: 2 * 1024 ** 3, sha256: '', stored_as: `${PRODUCT.systemDir}/versions/${r.versionId}-big.log` }])
    const kept = fs.statSync(W.abs(v[0].stored_as))
    expect(kept.size).toBe(2 * 1024 ** 3)
    expect(kept.nlink).toBe(1) // the team file is a new file now; the version is the old one's only name
    // only the first bytes: reading the whole 2 GB back took longer than the test's limit on a CI runner
    const fd = fs.openSync(W.abs(v[0].stored_as), 'r'); const head = Buffer.alloc(5); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd)
    expect(head.toString()).toBe('head\n')
    expect(W.read('shared/big.log')).toBe('short')
    expect(fs.statSync(W.abs('shared/big.log')).nlink).toBe(1)
  })
  test('move_file over a large file: the same', () => {
    W.svc(W.choi).write('shared/new.txt', 'new')
    big('shared/old2.txt', VERSION_COPY_MAX + 1)
    const r = W.svc(W.choi).move('shared/new.txt', 'shared/old2.txt', { overwrite: true })
    const v = versions('shared/old2.txt')
    expect(v).toMatchObject([{ id: r.replacedVersionId, reason: 'move', size: VERSION_COPY_MAX + 1, sha256: '' }])
    expect(W.read('shared/old2.txt')).toBe('new')
    expect(fs.statSync(W.abs(v[0].stored_as)).nlink).toBe(1)
  })
  test('small files are still copied and hashed', () => {
    const s = W.svc(W.choi)
    s.write('shared/small.md', 'v1')
    const r = s.write('shared/small.md', 'v2', { overwrite: true })
    const v = versions('shared/small.md')
    expect(v[0].sha256).toBe(new Bun.CryptoHasher('sha256').update('v1').digest('hex'))
    expect(v[0].stored_as).toBe(`${PRODUCT.systemDir}/versions/${r.versionId}-small.md`)
  })
})
