// Tiny office documents for the extraction and search tests (not a test file itself), generated on the fly so no
// third-party documents live in the repository.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import * as XLSX from 'xlsx'
import { which } from '../../src/config'

export const pandoc = which('pandoc')
export const pdftotext = which('pdftotext')
export const rg = which('rg')

/** A document made by pandoc from Markdown (docx, pptx, odt). Needs pandoc. */
export function pandocDoc(format: 'docx' | 'pptx' | 'odt', md: string): Uint8Array {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trina-fixture-'))
  try {
    const out = path.join(dir, `doc.${format}`)
    const r = Bun.spawnSync([pandoc!, '-f', 'markdown', '-t', format, '-o', out], { stdin: Buffer.from(md) })
    if (r.exitCode !== 0) throw new Error('pandoc failed: ' + r.stderr.toString())
    return new Uint8Array(fs.readFileSync(out))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

/** A one-page PDF with one ASCII text line (Helvetica); xref offsets computed. */
export function tinyPdf(line: string): Uint8Array {
  const content = `BT /F1 18 Tf 20 100 Td (${line.replace(/[()\\]/g, (c) => '\\' + c)}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}

/** A workbook with a '매출' sheet holding `rows` and a 'Notes' sheet. */
export function xlsxBook(rows: (string | number)[][], bookType: 'xlsx' | 'ods' = 'xlsx'): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '매출')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['memo'], ['두 번째 시트']]), 'Notes')
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType }) as Buffer)
}

// ---- HWP / HWPX containers (SheetJS CFB writes both) ----
const CFB = XLSX.CFB
function container(files: Record<string, Uint8Array | string>, fileType?: 'zip'): Uint8Array {
  const c = CFB.utils.cfb_new()
  for (const [p, v] of Object.entries(files)) CFB.utils.cfb_add(c, p, typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v))
  return new Uint8Array(CFB.write(c, { type: 'buffer', ...(fileType ? { fileType } : {}) }) as Buffer)
}
const u16 = (s: string) => Buffer.from(s, 'utf16le')
function record(tag: number, body: Uint8Array): Buffer {
  const h = Buffer.alloc(4)
  h.writeUInt32LE(((tag & 0x3ff) | (body.length << 20)) >>> 0, 0)
  return Buffer.concat([h, body])
}
const para = (...parts: Buffer[]) => Buffer.concat([record(66, Buffer.alloc(22)), record(67, Buffer.concat(parts))])
function fileHeader(flags: number) {
  const b = Buffer.alloc(256)
  b.write('HWP Document File', 0, 'latin1')
  b.writeUInt32LE(0x05010100, 32)
  b.writeUInt32LE(flags, 36)
  return b
}
/** A compressed HWP 5 document with one paragraph. */
export const hwpDoc = (text: string) => container({ FileHeader: fileHeader(1), 'BodyText/Section0': zlib.deflateRawSync(para(u16(text), Buffer.from([13, 0]))) })
/** An HWPX (OWPML zip) document with one paragraph; `text` is XML-escaped already. */
export const hwpxDoc = (text: string) => container({
  'Contents/section0.xml': `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hs:sec>`,
  mimetype: 'application/hwp+zip',
}, 'zip')
