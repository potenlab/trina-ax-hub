// Text of a team file for read_file and search_files (ported from Team AX server/src/files/extract.ts).
//   docx / pptx / odt   pandoc (--sandbox: no file or network access of its own)
//   xlsx / xls / ods    SheetJS   } in the office worker (office-worker.ts): a separate bun process, never on the
//   hwp / hwpx          hwp.ts    } hub's thread (a crafted 44-byte sheet once kept SheetJS busy for 44 s)
//   pdf                 pdftotext
// The bytes always come from a checked file descriptor (store.ts readRegular) and are fed to the converter on stdin,
// so a converter never opens a team path itself. Converters run isolated (isolate.ts): no network, no reading of the
// team folder or the hub's data, an empty work folder, a time limit and an output cap.
import path from 'node:path'
import { ToolError } from '../policy/errors'
import { runConverter } from './isolate'
import type { OfficeLimits } from './office-parse'
import { MARK } from './office-worker'

export const OFFICE_EXT = ['docx', 'pptx', 'odt', 'xlsx', 'xls', 'ods', 'pdf', 'hwp', 'hwpx'] as const
export const ext = (name: string) => (/\.([^./]+)$/.exec(name)?.[1] ?? '').toLowerCase()
export const isOffice = (name: string) => (OFFICE_EXT as readonly string[]).includes(ext(name))

/** Files that are never written or edited as text (the model would destroy them). */
export const BINARY_EXT = new Set([...OFFICE_EXT, 'doc', 'ppt', 'key', 'pages', 'numbers', 'zip', '7z', 'rar', 'gz', 'tar',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'ico', 'psd', 'ai', 'mp3', 'm4a', 'wav',
  'mp4', 'mov', 'avi', 'mkv', 'exe', 'dmg', 'pkg', 'app', 'dll', 'so', 'dylib', 'bin', 'sqlite', 'db'])

/** Converter binaries (null = not installed) and the server folders they must never read. */
export interface Converters { pandoc: string | null; pdftotext: string | null; denyRead?: string[] }

/** Extracted text is capped (a 50 MB spreadsheet would otherwise become hundreds of MB of text). */
export const TEXT_MAX = 8 * 1024 * 1024

async function convert(cmd: string, args: string[], bytes: Uint8Array, tools: Converters): Promise<string> {
  const name = path.basename(cmd)
  const r = await runConverter(cmd, args, bytes, { denyRead: tools.denyRead })
  if (r.killed === 'timeout') throw new ToolError(`could not convert the file to text (${name} took too long)`)
  if (r.killed === 'output') throw new ToolError(`could not convert the file to text (${name}: the text is too large)`)
  if (r.code !== 0) throw new ToolError(`could not convert the file to text (${name}: ${r.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200) || 'exit ' + r.code})`)
  return r.stdout.toString('utf8')
}

const cap = (s: string) => (s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) : s)

/** UTF-16 text with a byte-order mark (Windows Notepad's "Unicode"). */
export const utf16 = (b: Uint8Array): 'utf-16le' | 'utf-16be' | null =>
  b.length >= 2 && b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b.length >= 2 && b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : null

/** True when the bytes look like a binary file (a NUL byte near the start, and not UTF-16 text). */
export const looksBinary = (bytes: Uint8Array) => !utf16(bytes) && bytes.subarray(0, 8000).includes(0)

/**
 * Plain text: UTF-8 (BOM dropped), or UTF-16 with a BOM. Files that are not valid UTF-8 but are valid EUC-KR / CP949
 * (Korean Excel CSV exports, old Windows text files) are decoded as that, and `encoding` says so.
 */
export type TextEncoding = 'utf-8' | 'euc-kr' | 'utf-16'
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncoding } {
  const wide = utf16(bytes)
  if (wide) return { text: new TextDecoder(wide).decode(bytes), encoding: 'utf-16' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes), encoding: 'utf-8' }
  } catch {
    try { return { text: new TextDecoder('euc-kr', { fatal: true }).decode(bytes), encoding: 'euc-kr' } } catch {}
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' }
  }
}

/** Whether a converter for this file type is available on this hub. */
export function canExtract(name: string, tools: Converters): boolean {
  switch (ext(name)) {
    case 'docx': case 'pptx': case 'odt': return !!tools.pandoc
    case 'pdf': return !!tools.pdftotext
    default: return true
  }
}

/** Text of an office document, or of a text file. Throws ToolError for binaries and missing converters. */
export async function extractText(name: string, bytes: Uint8Array, tools: Converters): Promise<string> {
  const e = ext(name)
  switch (e) {
    case 'docx': case 'pptx': case 'odt':
      if (!tools.pandoc) throw new ToolError(`.${e} files cannot be read on this hub (pandoc is not installed); ask the admin to install it`)
      return cap(await convert(tools.pandoc, ['--sandbox', '-f', e, '-t', 'plain', '--wrap=none'], bytes, tools))
    case 'xlsx': case 'xls': case 'ods': case 'hwp': case 'hwpx':
      return cap(await officeText(e, bytes, tools))
    case 'pdf':
      if (!tools.pdftotext) throw new ToolError('PDF files cannot be read on this hub (pdftotext is not installed); ask the admin to install poppler')
      return cap(await convert(tools.pdftotext, ['-layout', '-enc', 'UTF-8', '-', '-'], bytes, tools))
    default:
      if (looksBinary(bytes)) throw new ToolError('this is a binary file; it cannot be shown as text')
      return decodeText(bytes).text
  }
}

// ---------------- the office worker ----------------
const WORKER = path.join(import.meta.dir, 'office-worker.ts')
/** the hub's code (the worker and its modules): the only server folder the isolated worker may read */
const APP_ROOT = path.resolve(import.meta.dir, '..', '..')
export const OFFICE_TIMEOUT_MS = 30_000
/** office workers at once on this hub (each may use a few hundred MB on a huge workbook); the rest wait */
export const OFFICE_WORKERS = 3

let running = 0
const waiting: (() => void)[] = []
async function inSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running < OFFICE_WORKERS) running++
  else await new Promise<void>((r) => waiting.push(r)) // the slot is handed over by the one finishing
  try { return await fn() } finally {
    const next = waiting.shift()
    if (next) next(); else running--
  }
}

/**
 * Text of a spreadsheet or Hangul document, read by the office worker in its own isolated process: killed after
 * `timeoutMs`, output capped. `limits` override the worker's caps (tests).
 */
export async function officeText(kind: 'xlsx' | 'xls' | 'ods' | 'hwp' | 'hwpx', bytes: Uint8Array, tools: Converters,
  o: { timeoutMs?: number; limits?: Partial<OfficeLimits> } = {}): Promise<string> {
  const what = kind === 'hwp' || kind === 'hwpx' ? 'Hangul document' : 'spreadsheet'
  return inSlot(async () => {
    const r = await runConverter(process.execPath, ['--no-install', '--no-env-file', WORKER, kind, JSON.stringify(o.limits ?? {})], bytes,
      { denyRead: tools.denyRead, allowRead: [APP_ROOT], timeoutMs: o.timeoutMs ?? OFFICE_TIMEOUT_MS, maxStdout: 4 * TEXT_MAX })
    if (r.killed === 'timeout') throw new ToolError(`could not read this ${what}: it is too large or too complex to convert in time`)
    if (r.killed === 'output') throw new ToolError(`could not read this ${what}: the text is too large`)
    if (r.code === 0) return r.stdout.toString('utf8')
    const msg = r.stderr.split('\n').filter((l) => l.startsWith(MARK)).pop()?.slice(MARK.length).trim()
    throw new ToolError(msg || `could not read this ${what} (damaged, password-protected or not a .${kind} file)`)
  })
}

// ---------------- images (read_file returns them as MCP image content) ----------------
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
export const isImageName = (name: string) => IMAGE_EXT.has(ext(name))

/**
 * The image type from the file's first bytes (never from the name alone: a file named .png that is not a PNG would
 * make the model API refuse the whole conversation).
 */
export function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}
