// Spreadsheet text and the zip size check, for the office worker (office-worker.ts). This code parses whatever
// people put in the team folder, so it runs in that separate, killable process, never on the hub's own thread:
// SheetJS is synchronous, detects the format from the content, and a 44-byte file claiming a huge range took 44 s.
// Limits here keep the work proportional to what comes out:
//   - the container must match the extension (an .xlsx / .ods is a zip, or an encrypted OLE file),
//   - a zip may unpack to at most `unpackedMax` bytes in total, counted by actually inflating every entry the way
//     SheetJS will (declared sizes can lie, entries can overlap),
//   - at most `sheetRows` rows per sheet are read (SheetJS sheetRows, dense storage),
//   - a sheet whose range covers more than `sheetCells` cells is first shrunk to the rows and columns actually used,
//     and if it is still that large it is written by a writer whose work is bounded by the text it produces.
import zlib from 'node:zlib'
import * as XLSX from 'xlsx'
import { ToolError } from '../policy/errors'

export interface OfficeLimits {
  /** bytes a zip container (xlsx, ods, hwpx) or an HWP document's body may unpack to, in total */
  unpackedMax: number
  /** rows read per sheet */
  sheetRows: number
  /** cells per sheet converted by SheetJS's own CSV writer */
  sheetCells: number
  /** characters of text returned */
  textMax: number
}

export const DEFAULT_LIMITS: OfficeLimits = {
  unpackedMax: 320 * 1024 * 1024,
  sheetRows: 100_000,
  sheetCells: 2_000_000,
  textMax: 8 * 1024 * 1024,
}

const mb = (n: number) => Math.round(n / 1048576)

export const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
export const isCfb = (b: Uint8Array) => b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1

/**
 * Refuse a zip that unpacks to more than `max` bytes. Mirrors how SheetJS's CFB reader walks a zip: the last
 * end-of-central-directory record, each central-directory entry's local header, and deflate data read until the
 * stream ends (it does not trust the sizes in the headers, so neither does this). Each entry is counted, so entries
 * that share compressed data are counted every time they would be unpacked.
 */
export function checkUnpacked(b: Uint8Array, max: number): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const u16 = (o: number) => (o + 2 <= b.length ? v.getUint16(o, true) : -1)
  const u32 = (o: number) => (o + 4 <= b.length ? v.getUint32(o, true) : -1)
  let eocd = -1
  for (let i = b.length - 4; i >= 0; i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break }
  if (eocd < 0) throw new ToolError('could not read this document (damaged: not a complete zip file)')
  const count = u16(eocd + 8)
  let p = u32(eocd + 16)
  const tooLarge = () => new ToolError(`could not read this document: it unpacks to more than ${mb(max)} MB`)
  let total = 0
  // like SheetJS: no signature checks, the entry and local header fields are read where the directory says
  for (let i = 0; i < count && p >= 0; i++) {
    const nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32)
    const local = u32(p + 42)
    if (nameLen < 0 || extraLen < 0 || commentLen < 0 || local < 0) break
    p += 46 + nameLen + extraLen + commentLen
    const method = u16(local + 8), csize = u32(local + 18), lname = u16(local + 26), lextra = u16(local + 28)
    if (method < 0 || lname < 0 || lextra < 0) continue
    const start = local + 30 + lname + lextra
    if (start > b.length) continue
    if (method === 0) total += Math.min(Math.max(csize, 0), b.length - start)
    else if (method === 8) {
      const room = max - total
      let out: Buffer
      try { out = zlib.inflateRawSync(b.subarray(start), { maxOutputLength: room + 1 }) } catch (e: any) {
        if (e?.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError) throw tooLarge()
        throw new ToolError('could not read this document (damaged: a part of it cannot be unpacked)')
      }
      total += out.length
    }
    if (total > max) throw tooLarge()
  }
}

/** SYLK and DIF text: formats nobody saves as .xls on purpose, and SheetJS's slowest readers. */
const textSpreadsheet = (b: Uint8Array) => {
  const from = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0
  const head = new TextDecoder('latin1').decode(b.subarray(from, from + 16))
  return /^ID;/.test(head) || /^TABLE\r?\n0,1/.test(head)
}

type Sheet = XLSX.WorkSheet & { '!data'?: (XLSX.CellObject[] | undefined)[] }

/** Text of every sheet, tab-separated, each under "# sheet: <name>". */
export function spreadsheetText(bytes: Uint8Array, kind: 'xlsx' | 'xls' | 'ods', lim: OfficeLimits = DEFAULT_LIMITS): string {
  const damaged = () => new ToolError('could not read this spreadsheet (damaged or password-protected)')
  const zip = isZip(bytes)
  // SheetJS reads by content: a text file renamed to .xlsx would be parsed as whatever its text claims to be
  if (kind !== 'xls' && !zip && !isCfb(bytes)) throw damaged()
  // .xls: also the HTML / XML / tab-separated files that bank and ERP exports save under that name
  if (kind === 'xls' && textSpreadsheet(bytes)) throw damaged()
  if (zip) checkUnpacked(bytes, lim.unpackedMax)
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(bytes, { type: 'array', dense: true, sheetRows: lim.sheetRows, cellFormula: false, cellHTML: false, cellStyles: false })
  } catch { throw damaged() }
  const parts: string[] = []
  let size = 0
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name] as Sheet | undefined
    if (!sheet) continue
    const full = sheet['!fullref'] && sheet['!ref'] ? XLSX.utils.decode_range(sheet['!fullref']) : null
    const shown = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null
    // only when the row cap cut it (a sheet's declared size can be anything)
    const cut = full && shown && full.e.r > shown.e.r && shown.e.r - shown.s.r + 1 >= lim.sheetRows ? `; the first ${(shown.e.r - shown.s.r + 1).toLocaleString('en-US')} of ${(full.e.r - full.s.r + 1).toLocaleString('en-US')} rows` : ''
    const part = `# sheet: ${name} (tab-separated${cut})\n` + sheetBody(sheet, lim, lim.textMax - size)
    parts.push(part)
    size += part.length
    if (size > lim.textMax) break
  }
  const text = parts.join('\n\n')
  return text.length > lim.textMax ? text.slice(0, lim.textMax) : text
}

function sheetBody(sheet: Sheet, lim: OfficeLimits, room: number): string {
  if (!sheet['!ref'] || room <= 0) return ''
  let r = XLSX.utils.decode_range(sheet['!ref'])
  const area = (x: XLSX.Range) => (x.e.r - x.s.r + 1) * (x.e.c - x.s.c + 1)
  if (area(r) > lim.sheetCells) {
    const used = usedRange(sheet, r)
    if (!used) return ''
    r = used
    sheet['!ref'] = XLSX.utils.encode_range(r)
  }
  if (area(r) <= lim.sheetCells) return XLSX.utils.sheet_to_csv(sheet, { FS: '\t', blankrows: false })
  return sparseTsv(sheet, r, room)
}

/** Rows of a sheet as [row index, cells by column], whatever the storage (dense arrays or "A1" keys). */
function* rowsOf(sheet: Sheet, r: XLSX.Range): Generator<[number, (XLSX.CellObject | undefined)[]]> {
  const data = sheet['!data']
  if (data) {
    for (let R = r.s.r; R <= Math.min(r.e.r, data.length - 1); R++) { const row = data[R]; if (row && row.length) yield [R, row] }
    return
  }
  const rows = new Map<number, (XLSX.CellObject | undefined)[]>()
  for (const k of Object.keys(sheet)) {
    if (k[0] === '!') continue
    const a = XLSX.utils.decode_cell(k)
    if (a.r < r.s.r || a.r > r.e.r || a.c < r.s.c || a.c > r.e.c) continue
    let row = rows.get(a.r)
    if (!row) rows.set(a.r, (row = []))
    row[a.c] = (sheet as any)[k]
  }
  for (const R of [...rows.keys()].sort((x, y) => x - y)) yield [R, rows.get(R)!]
}

/** The last row and column that hold a cell (the first row and column of the range are kept). */
function usedRange(sheet: Sheet, r: XLSX.Range): XLSX.Range | null {
  let maxR = -1, maxC = -1
  for (const [R, row] of rowsOf(sheet, r)) { maxR = R; maxC = Math.max(maxC, Math.min(row.length - 1, r.e.c)) }
  if (maxR < 0 || maxC < r.s.c) return null
  return { s: r.s, e: { r: maxR, c: maxC } }
}

const field = (cell: XLSX.CellObject | undefined): string => {
  if (!cell || cell.t === 'z') return ''
  let t: string
  try { t = cell.w ?? XLSX.utils.format_cell(cell) } catch { t = cell.v == null ? '' : String(cell.v) }
  return /[\t\n]/.test(t) || t.charCodeAt(0) === 34 ? `"${t.replace(/"/g, '""')}"` : t
}

/** Like sheet_to_csv for a huge, mostly empty range: only rows that exist, cut at `room` characters. */
function sparseTsv(sheet: Sheet, r: XLSX.Range, room: number): string {
  const out: string[] = []
  let size = 0
  for (const [, row] of rowsOf(sheet, r)) {
    const cells: string[] = []
    let last = -1
    for (let C = r.s.c; C <= Math.min(row.length - 1, r.e.c); C++) {
      const f = field(row[C])
      cells.push(f)
      if (f !== '') last = cells.length - 1
      if (cells.length > room) break
    }
    if (last < 0) continue
    const line = cells.slice(0, last + 1).join('\t')
    out.push(line)
    size += line.length + 1
    if (size > room) break
  }
  return out.join('\n')
}
