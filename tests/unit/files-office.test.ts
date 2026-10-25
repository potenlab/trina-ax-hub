// Spreadsheets and Hangul documents are read by the office worker, a separate isolated process: crafted or huge
// files can no longer freeze the hub (review: a 44-byte SYLK file named .xlsx kept SheetJS busy for 44 s on the
// server's thread; a 28 MB workbook stalled every request for 4.6 s).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { extractText, officeText } from '../../src/files/extract'
import { checkUnpacked, DEFAULT_LIMITS, spreadsheetText } from '../../src/files/office-parse'
import { hwpText, hwpxText } from '../../src/files/hwp'
import { officeCache } from '../../src/files/service'
import { hwpDoc, hwpxDoc, rg, xlsxBook } from './files-fixtures'
import { errorOf, makeWorld, type World } from './files-world'

const tools = { pandoc: null, pdftotext: null }
const SYLK = 'ID;PWXL\nC;Y1;X1;K"a"\nC;Y10000;X16384;K"b"\nE\n'

/** max event-loop stall (ms) while `fn` runs */
async function stallDuring<T>(fn: () => Promise<T>): Promise<{ value: T; stall: number }> {
  let stall = 0, last = performance.now()
  const t = setInterval(() => { const now = performance.now(); stall = Math.max(stall, now - last - 10); last = now }, 10)
  try { return { value: await fn(), stall } } finally { clearInterval(t) }
}

/** An xlsx whose sheet claims A1:XFD1048576 and holds a cell far out at XFD90000 (written by hand: SheetJS would
 * walk the whole claimed range to write it). */
function hugeRangeXlsx(): Uint8Array {
  const files = unzipSync(xlsxBook([['a', 1], ['b', 2]]))
  const name = Object.keys(files).find((k) => /worksheets\/sheet1\.xml$/.test(k))!
  files[name] = strToU8(strFromU8(files[name]!)
    .replace(/<dimension ref="[^"]*"/, '<dimension ref="A1:XFD1048576"')
    .replace('</sheetData>', '<row r="90000"><c r="XFD90000" t="inlineStr"><is><t>far</t></is></c></row></sheetData>'))
  return zipSync(files)
}

describe('crafted and huge spreadsheets', () => {
  test('a SYLK text file named .xlsx / .xls is refused at once, not parsed', async () => {
    for (const name of ['a.xlsx', 'a.ods', 'a.xls']) {
      const t0 = performance.now()
      expect(await errorOf(() => extractText(name, new TextEncoder().encode(SYLK), tools)), name).toContain('could not read this spreadsheet')
      expect(performance.now() - t0).toBeLessThan(5000)
    }
    // plain text under .xlsx too (SheetJS would read it as CSV)
    expect(await errorOf(() => extractText('a.xlsx', new TextEncoder().encode('a,b\n1,2\n'), tools))).toContain('could not read this spreadsheet')
  })
  test('.xls holding tab-separated text or HTML (bank and ERP exports) is still read', async () => {
    expect(await extractText('은행.xls', new TextEncoder().encode('날짜\t금액\n10-01\t35000\n'), tools)).toContain('10-01\t35000')
    expect(await extractText('거래.xls', new TextEncoder().encode('<table><tr><td>입금</td><td>500</td></tr></table>'), tools)).toContain('입금\t500')
  })
  test('a sheet claiming a huge range is cut to the cells it has, quickly', async () => {
    const t0 = performance.now()
    const text = await extractText('범위.xlsx', hugeRangeXlsx(), tools)
    expect(performance.now() - t0).toBeLessThan(10_000)
    expect(text).toContain('a\t1')
    expect(text).toContain('far')
    expect(text.length).toBeLessThan(DEFAULT_LIMITS.textMax)
  })
  test('the cell cap: an over-large sparse range is written row by row, bounded by its output', () => {
    const lim = { ...DEFAULT_LIMITS, sheetCells: 1000 }
    const text = spreadsheetText(hugeRangeXlsx(), 'xlsx', lim)
    const lines = text.split('\n\n# sheet: Notes')[0]!.split('\n')
    expect(lines[1]).toBe('a\t1')
    expect(lines.at(-1)!.endsWith('\tfar')).toBe(true)
    expect(lines.at(-1)!.split('\t').length).toBe(16384)
  })
  test('rows past the row cap are left out, with a note', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [`행${i}`, i])
    const text = spreadsheetText(xlsxBook(rows), 'xlsx', { ...DEFAULT_LIMITS, sheetRows: 10 })
    expect(text).toContain('# sheet: 매출 (tab-separated; the first 10 of 30 rows)')
    expect(text).toContain('행9\t9')
    expect(text).not.toContain('행10\t')
  })
  test('a zip that unpacks too far is refused, whatever its headers claim', async () => {
    const big = new Uint8Array(6 * 1024 * 1024) // zeros: a few KB compressed
    const zip = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'xl/worksheets/sheet1.xml': big })
    expect(await errorOf(() => officeText('xlsx', zip, tools, { limits: { unpackedMax: 1024 * 1024 } }))).toContain('unpacks to more than 1 MB')
    // the same with the sizes in both headers rewritten to a few bytes (SheetJS inflates until the stream ends)
    const lie = new Uint8Array(zip)
    const v = new DataView(lie.buffer)
    for (let i = 0; i + 4 <= lie.length; i++) {
      const sig = v.getUint32(i, true)
      if (sig === 0x04034b50) v.setUint32(i + 22, 10, true)
      if (sig === 0x02014b50) v.setUint32(i + 24, 10, true)
    }
    expect(() => checkUnpacked(lie, 1024 * 1024)).toThrow('unpacks to more than')
    expect(() => checkUnpacked(zip, 16 * 1024 * 1024)).not.toThrow()
    // Hangul: .hwpx (a zip) and the .hwp body share the cap
    expect(() => hwpxText(hwpxDoc('x'.repeat(5000)), { ...DEFAULT_LIMITS, unpackedMax: 1000 })).toThrow('unpacks to more than')
    expect(() => hwpText(hwpDoc('본문'.repeat(500)), { ...DEFAULT_LIMITS, unpackedMax: 100 })).toThrow('too large')
  })
  test('a worker that runs too long is killed', async () => {
    expect(await errorOf(() => officeText('xlsx', xlsxBook([['a']]), tools, { timeoutMs: 1 }))).toContain('in time')
  })
  test('a large workbook is read without stalling the hub', async () => {
    const rows: (string | number)[][] = [['날짜', '고객', '품목', '수량', '금액', '메모']]
    for (let i = 0; i < 40_000; i++) rows.push([`2026-10-${(i % 28) + 1}`, `고객${i}`, `품목${i % 500}`, i % 17, 1000 + (i % 300), `메모 ${i}`])
    const bytes = xlsxBook(rows)
    const { value, stall } = await stallDuring(() => extractText('큰.xlsx', bytes, tools))
    expect(value).toContain('고객39999')
    expect(stall).toBeLessThan(250) // in process this was the whole parse (seconds)
  }, 60_000)
})

describe('the hub keeps answering while a document is read', () => {
  let W: World
  beforeAll(async () => { W = await makeWorld() })
  afterAll(async () => { await W?.hub.stop() })

  test('read_file of a crafted .xlsx: refused quickly, /healthz answers meanwhile', async () => {
    fs.writeFileSync(W.abs('shared/sylk.xlsx'), SYLK)
    const read = errorOf(() => W.svc(W.choi).read('shared/sylk.xlsx'))
    const h0 = performance.now()
    expect((await fetch(W.hub.url + '/healthz')).status).toBe(200)
    expect(performance.now() - h0).toBeLessThan(1000)
    expect(await read).toContain('could not read this spreadsheet')
  })
})

describe('search indexing', () => {
  let W: World
  beforeAll(async () => { W = await makeWorld() })
  afterAll(async () => { await W?.hub.stop() })

  test.skipIf(!rg)('office text is indexed by the worker; a search does not wait past its time limit', async () => {
    fs.mkdirSync(W.abs('shared/idx'), { recursive: true })
    for (let i = 0; i < 3; i++) fs.writeFileSync(W.abs(`shared/idx/공지${i}.hwpx`), hwpxDoc(`색인 NEEDLE${i}`))
    fs.writeFileSync(W.abs('shared/idx/깨짐.xlsx'), SYLK)
    const cache = officeCache(W.hub.ctx)
    const filter = (rel: string) => { try { return fs.lstatSync(W.abs(rel)) } catch { return null } }
    // no time to wait: everything is left to the background
    const r = await cache.refresh(rg!, ['shared/idx'], [], filter, 40, 0)
    expect(r.pending).toBe(4)
    for (let i = 0; i < 100 && !['공지0', '공지1', '공지2', '깨짐'].every((n) => fs.existsSync(cache.cachePath(`shared/idx/${n}.${n === '깨짐' ? 'xlsx' : 'hwpx'}`))); i++) await Bun.sleep(100)
    const s = await W.svc(W.choi).search({ query: 'NEEDLE1', path: 'shared/idx' })
    expect(s.mode === 'content' && s.hits.map((h) => h.path)).toEqual(['shared/idx/공지1.hwpx'])
    expect(fs.readFileSync(cache.cachePath('shared/idx/깨짐.xlsx'), 'utf8')).toBe('') // failed: cached empty, not retried
    expect(path.isAbsolute(cache.dir)).toBe(true)
  }, 30_000)
})
