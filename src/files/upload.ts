// Receiving files from the browser (POST /files/upload, src/web/files.tsx). The multipart body is read as a stream and
// each file is written to disk while it arrives, into a private staging folder (<team>/.trina/uploads/<request>/), so
// a 50 MB file never sits in memory. When the whole request has arrived and is well formed, every staged file is put in
// place through FileService.commitUpload: permissions checked again, an existing file kept as an earlier version, the
// folder chain verified, then one rename. A request that breaks off halfway therefore changes nothing in the team
// folder.
//
// Memory: only one network chunk is held at a time. Bun's HTTP server has no back-pressure on request bodies, though: it
// keeps reading the socket, so if the disk were slower than the sender the surplus would wait in memory. A request is
// capped at 200 MB, and 3 uploads per person / 8 in all may run at once, which bounds even that.
//
// Fields must come before the files they apply to: `_csrf` (unless the x-csrf-token header carried it), `dir` (the
// folder, unless the URL carried it) and, optionally, `overwrite` and a `relpath` for the file that follows. A file part without a verified token is refused
// before a byte of it is read. The name of a file part is a path relative to `dir`: browsers send "영업/표.xlsx" for a
// dropped folder. It may not be absolute or hold "." / ".." segments, backslashes or NUL; everything else is up to the
// same rules as any other write (authorize(): name rules, hidden = missing, write permission).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Ctx } from '../context'
import { newId } from '../ids'
import { Denied } from '../policy/errors'
import { PRODUCT } from '../product'
import type { FileService } from './service'
import { describeFileError, type FileErrorKind } from './messages'
import { MultipartError, MultipartReader } from './multipart'

const MB = 1024 * 1024
/** One file */
export const UPLOAD_FILE_MAX = 50 * MB
/** All files of one request */
export const UPLOAD_REQUEST_MAX = 200 * MB
/** Boundaries, part headers and small fields on top of the file bytes */
export const UPLOAD_BODY_SLACK = 1 * MB
/** The most a /files/upload request body may be (the server's body limit for that one route) */
export const UPLOAD_BODY_MAX = UPLOAD_REQUEST_MAX + UPLOAD_BODY_SLACK
/** Files in one request (a dropped folder tree can hold many) */
export const UPLOAD_MAX_FILES = 1000
/** Uploads running at once, per person and in all (each holds a staging folder and a connection) */
const SLOTS_PER_USER = 3
const SLOTS_TOTAL = 8

export type UploadStatus = 'created' | 'replaced' | 'unchanged' | 'error'
export interface UploadItem {
  /** the name as sent (may hold folders) */
  name: string
  status: UploadStatus
  /** team-folder path of the stored file */
  path?: string
  size?: number
  /** the earlier version kept when a file was replaced */
  versionId?: string | null
  kind?: FileErrorKind
  /** Korean text for an error */
  message?: string
  /** HTTP status of the error */
  httpStatus?: number
}
export interface UploadOutcome { dir: string; overwrite: boolean; items: UploadItem[]; bytes: number }

/** The whole request is refused (nothing was changed). */
export class UploadRefused extends Error {
  constructor(readonly status: number, readonly code: 'csrf' | 'no_dir' | 'too_large' | 'too_many' | 'busy' | 'idle' | 'broken' | 'disk', message: string) { super(message) }
}

export interface UploadInput {
  stream: ReadableStream<Uint8Array>
  boundary: string
  /** whether a `_csrf` field value is this session's token */
  csrfOk(value: string): boolean
  /** the token already came and was right (x-csrf-token header) */
  csrfGiven?: boolean
  /** the folder, when the URL carried it */
  dir?: string | null
  /** the request's abort signal (the client went away) */
  signal?: AbortSignal
  /** smaller limits for tests */
  limits?: Partial<{ file: number; request: number; idleMs: number; files: number }>
}

// ---- concurrency ----
const running = new WeakMap<Ctx, { total: number; perUser: Map<string, number> }>()
function takeSlot(ctx: Ctx, userId: string): () => void {
  let s = running.get(ctx)
  if (!s) { s = { total: 0, perUser: new Map() }; running.set(ctx, s) }
  const mine = s.perUser.get(userId) ?? 0
  if (mine >= SLOTS_PER_USER || s.total >= SLOTS_TOTAL) throw new UploadRefused(429, 'busy', '지금 올리는 파일이 많아요. 올리던 것이 끝난 뒤에 다시 해 주세요.')
  s.total++
  s.perUser.set(userId, mine + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    s!.total--
    const n = (s!.perUser.get(userId) ?? 1) - 1
    if (n <= 0) s!.perUser.delete(userId); else s!.perUser.set(userId, n)
  }
}

// ---- staging ----
const stagingRoot = (ctx: Ctx) => path.join(ctx.fx.root, PRODUCT.systemDir, 'uploads')
let lastSweep = 0
/** Staging folders left by a crash (older than a day) go; the ones being filled are younger. */
function sweepStaging(ctx: Ctx) {
  if (Date.now() - lastSweep < 60_000) return
  lastSweep = Date.now()
  const root = stagingRoot(ctx)
  let names: string[]
  try { names = fs.readdirSync(root) } catch { return }
  for (const n of names) {
    try {
      const p = path.join(root, n)
      if (Date.now() - fs.lstatSync(p).mtimeMs > 86_400_000) fs.rmSync(p, { recursive: true, force: true })
    } catch { /* the next sweep */ }
  }
}

/** The names a browser sends are paths below `dir`; refuse the shapes that only an attacker or a broken client sends. */
function plainRelative(p: string): boolean {
  if (p.includes('\0') || p.includes('\\')) return false
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.startsWith('~')) return false
  return !p.split('/').some((s) => s === '.' || s === '..')
}

interface Written { size: number; sha256: string }

/** Write the current part to `file` (O_EXCL, no links followed). tooLarge: it went past `max`; the rest is skipped. */
async function stageFile(rd: MultipartReader, file: string, max: number): Promise<Written | 'too_large'> {
  const C = fs.constants
  const fh = await fs.promises.open(file, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600)
  const hash = crypto.createHash('sha256')
  let size = 0
  let over = false
  try {
    for (let chunk = await rd.read(); chunk; chunk = await rd.read()) {
      size += chunk.length
      if (size > max) { over = true; break }
      hash.update(chunk)
      for (let off = 0; off < chunk.length; ) off += (await fh.write(chunk, off, chunk.length - off)).bytesWritten
    }
    if (!over) await fh.sync()
  } finally { await fh.close() }
  if (over) {
    fs.rmSync(file, { force: true })
    await rd.skip()
    return 'too_large'
  }
  return { size, sha256: hash.digest('hex') }
}

/**
 * Read one upload request for `svc`'s person and put its files in the team folder. Per-file problems (a name the store
 * refuses, no write permission, a file over the limit, a name that exists) are reported in `items`; a problem with the
 * request itself (no token, too large, broken off) throws UploadRefused and nothing is changed.
 */
export async function receiveUpload(svc: FileService, input: UploadInput): Promise<UploadOutcome> {
  const ctx = svc.ctx
  const fileMax = input.limits?.file ?? UPLOAD_FILE_MAX
  const requestMax = input.limits?.request ?? UPLOAD_REQUEST_MAX
  const filesMax = input.limits?.files ?? UPLOAD_MAX_FILES
  const rd = new MultipartReader(input.stream, input.boundary, { maxBytes: requestMax + UPLOAD_BODY_SLACK, idleMs: input.limits?.idleMs, signal: input.signal })
  let release: () => void
  try { release = takeSlot(ctx, svc.user.id) } catch (e) { await rd.drain(); throw e }
  sweepStaging(ctx)
  const stage = path.join(stagingRoot(ctx), newId(12))
  let csrf = !!input.csrfGiven
  let dir: string | null = input.dir ?? null
  let overwrite = false
  // `relpath`: the path of the next file below `dir` ("영업/2026/표.xlsx"); browsers do not all keep folder names in a file name
  let relpath: string | null = null
  let bytes = 0
  let n = 0
  const items: UploadItem[] = []
  const staged: { item: UploadItem; rel: string; abs: string; size: number; sha256: string; overwrite: boolean }[] = []
  const fail = (name: string, e: unknown): UploadItem => {
    const d = describeFileError(e)
    return { name, status: 'error', kind: d.kind, message: d.text, httpStatus: d.status }
  }
  try {
    for (let part = await rd.next(); part; part = await rd.next()) {
      if (part.filename === null) {
        // an ordinary field
        const value = await rd.text(2048)
        if (part.name === '_csrf') { if (!input.csrfOk(value)) throw new UploadRefused(403, 'csrf', '보안 확인에 실패했어요. 페이지를 새로 고친 뒤 다시 해 주세요.'); csrf = true }
        else if (part.name === 'dir' && n === 0) dir = value.normalize('NFC')
        else if (part.name === 'overwrite') overwrite = value === '1' || value === 'on' || value === 'true'
        else if (part.name === 'relpath') relpath = value.normalize('NFC')
        continue
      }
      // a file: the person and the folder must be settled before its first byte is read
      if (!csrf) throw new UploadRefused(403, 'csrf', '보안 확인에 실패했어요. 페이지를 새로 고친 뒤 다시 해 주세요.')
      if (dir === null) throw new UploadRefused(400, 'no_dir', '올릴 폴더가 정해지지 않았어요. 페이지를 새로 고친 뒤 다시 해 주세요.')
      if (part.filename === '') { relpath = null; await rd.skip(); continue } // the form was sent with no file chosen
      if (++n > filesMax) throw new UploadRefused(413, 'too_many', `한 번에 올릴 수 있는 파일은 ${filesMax}개까지예요.`)
      const name = (relpath || part.filename).normalize('NFC')
      relpath = null
      const item: UploadItem = { name, status: 'error' }
      items.push(item)
      let rel: string
      try {
        if (!plainRelative(name) || !plainRelative(dir)) throw new Denied("'..' is not allowed")
        rel = dir.replace(/\/+$/, '') ? `${dir.replace(/\/+$/, '')}/${name}` : name
        svc.planUpload(rel, overwrite)
      } catch (e) {
        Object.assign(item, fail(name, e))
        await rd.skip()
        continue
      }
      fs.mkdirSync(stage, { recursive: true, mode: 0o700 })
      const abs = path.join(stage, String(n))
      let w: Written | 'too_large'
      try { w = await stageFile(rd, abs, fileMax) } catch (e: any) {
        if (e?.code === 'ENOSPC') throw new UploadRefused(507, 'disk', '허브의 저장 공간이 부족해서 올리지 못했어요. 관리자에게 알려 주세요.')
        throw e
      }
      if (w === 'too_large') {
        Object.assign(item, { status: 'error', kind: 'too_large', message: `파일이 너무 커요. 한 파일은 ${Math.round(fileMax / MB)}MB까지 올릴 수 있어요.`, httpStatus: 413 })
        continue
      }
      bytes += w.size
      if (bytes > requestMax) throw new UploadRefused(413, 'too_large', `한 번에 올릴 수 있는 크기(${Math.round(requestMax / MB)}MB)를 넘었어요. 나눠서 올려 주세요.`)
      Object.assign(item, { size: w.size })
      staged.push({ item, rel: rel!, abs, size: w.size, sha256: w.sha256, overwrite })
    }
    // the whole request arrived: put the files in place
    for (const f of staged) {
      try {
        const r = svc.commitUpload(f.rel, { abs: f.abs, size: f.size, sha256: f.sha256 }, { overwrite: f.overwrite })
        Object.assign(f.item, { status: r.created ? 'created' : r.changed ? 'replaced' : 'unchanged', path: r.path, size: r.size, versionId: r.versionId })
      } catch (e) {
        Object.assign(f.item, fail(f.item.name, e))
      }
    }
    return { dir: dir ?? '', overwrite, items, bytes }
  } catch (e) {
    if (e instanceof MultipartError) {
      // the request is refused as a whole; an oversized body is still read to its end so the answer can be sent
      if (e.fault === 'limit') { await rd.drain(); throw new UploadRefused(413, 'too_large', `한 번에 올릴 수 있는 크기(${Math.round(requestMax / MB)}MB)를 넘었어요. 나눠서 올려 주세요.`) }
      if (e.fault === 'idle') throw new UploadRefused(408, 'idle', '한참 동안 파일이 오지 않아 멈췄어요. 다시 올려 주세요.')
      throw new UploadRefused(400, 'broken', '올리던 중에 연결이 끊겼거나 형식이 맞지 않아요. 다시 올려 주세요.')
    }
    if (e instanceof UploadRefused) await rd.drain()
    throw e
  } finally {
    release()
    fs.rmSync(stage, { recursive: true, force: true })
  }
}
