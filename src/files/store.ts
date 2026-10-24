// Low-level file operations inside the team folder (ported from Team AX server/src/files/store.ts and
// team-files/place.ts). Callers must have authorize()d every path first.
//
// - Reads open the file with O_NOFOLLOW and check the descriptor (regular file, a single link), so a path swapped for
//   a symlink or a hard link after authorize() is never read.
// - Writes go to a temp file (O_CREAT|O_EXCL|O_NOFOLLOW, prefix PRODUCT.tmpPrefix) in the same folder, are fsynced,
//   the folder chain is lstat'ed again (verifyChain) and only then renamed over the target.
// - Old content is never lost: before an overwrite, edit or move-over the current bytes are copied to
//   .trina/versions/<id>; a delete renames the file into .trina/trash/<YYYY-MM-DD>/<id>/<name>. Both get a
//   file_versions row.
// Everything here is synchronous, so a read-compare-write sequence cannot interleave with another tool call in this
// process.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { PRODUCT } from '../product'
import { newId } from '../ids'
import { nowIso } from '../db'
import { Denied, ToolError } from '../policy/errors'
import { verifyChain } from '../policy/resolve'

const C = fs.constants
const CHUNK = 4 * 1024 * 1024

/** Largest file write_file / edit_file produce. */
export const MAX_WRITE_BYTES = 20 * 1024 * 1024

export type VersionReason = 'overwrite' | 'trash' | 'move'

/** Open a regular, singly linked file without following a final symlink. The caller closes the descriptor. */
export function openChecked(abs: string): { fd: number; st: fs.Stats } {
  let fd: number
  try { fd = fs.openSync(abs, C.O_RDONLY | C.O_NOFOLLOW | (C.O_NONBLOCK ?? 0)) } catch (e: any) {
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw new Denied('symbolic links are not followed')
    if (e.code === 'ENOENT') throw new ToolError('not found', 'not_found')
    if (e.code === 'EISDIR') throw new ToolError('this is a folder', 'is_folder')
    throw new ToolError(`cannot open the file (${e.code})`)
  }
  let st: fs.Stats
  try { st = fs.fstatSync(fd) } catch (e) { fs.closeSync(fd); throw e }
  if (st.isDirectory()) { fs.closeSync(fd); throw new ToolError('this is a folder', 'is_folder') }
  if (!st.isFile()) { fs.closeSync(fd); throw new Denied('not a regular file') }
  if (st.nlink > 1) { fs.closeSync(fd); throw new Denied('hard-linked files are refused') }
  return { fd, st }
}

/** Bytes of a regular, singly linked file (see openChecked). */
export function readRegular(abs: string, maxBytes: number, tooLarge = 'the file is too large'): { bytes: Buffer; st: fs.Stats } {
  const { fd, st } = openChecked(abs)
  try {
    if (st.size > maxBytes) throw new ToolError(tooLarge, 'too_large')
    const bytes = Buffer.alloc(st.size)
    let off = 0
    while (off < st.size) { const n = fs.readSync(fd, bytes, off, st.size - off, off); if (n <= 0) break; off += n }
    return { bytes: bytes.subarray(0, off), st }
  } finally { fs.closeSync(fd) }
}

/** Stream a checked file into `onChunk`; returns size and sha256 (files of any size, constant memory). */
function streamChecked(abs: string, onChunk?: (b: Buffer) => void): { size: number; sha256: string } {
  const { fd } = openChecked(abs)
  const h = crypto.createHash('sha256')
  const buf = Buffer.allocUnsafe(CHUNK)
  let size = 0
  try {
    for (let pos = 0; ; ) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos)
      if (n <= 0) break
      const part = buf.subarray(0, n)
      h.update(part)
      onChunk?.(part)
      pos += n
      size += n
    }
  } finally { fs.closeSync(fd) }
  return { size, sha256: h.digest('hex') }
}

export const sha256 = (b: Uint8Array | string) => crypto.createHash('sha256').update(b).digest('hex')

/** Create the missing parent folders of `segs` (names already checked by authorize) and lstat the chain again. */
export function ensureParents(root: string, segs: readonly string[]) {
  let cur = root
  for (let i = 0; i < segs.length - 1; i++) {
    cur = path.join(cur, segs[i]!)
    try { fs.mkdirSync(cur, { mode: 0o700 }) } catch (e: any) { if (e.code !== 'EEXIST') throw e }
  }
  verifyChain(root, [...segs], true)
}

const tmpPath = (dir: string) => path.join(dir, PRODUCT.tmpPrefix + crypto.randomBytes(8).toString('hex'))

/** The target of a write or move-over must be missing or a regular, singly linked file. */
function assertReplaceable(target: string) {
  let st: fs.Stats
  try { st = fs.lstatSync(target) } catch (e: any) { if (e.code === 'ENOENT') return; throw e }
  if (!st.isFile() || st.nlink > 1) throw new Denied('the target is not a regular file')
}

/** Write `data` to team path `segs` atomically (temp file in the same folder, fsync, verifyChain, rename). */
export function atomicWrite(root: string, segs: readonly string[], data: Uint8Array) {
  ensureParents(root, segs)
  const dir = path.join(root, ...segs.slice(0, -1))
  const target = path.join(dir, segs[segs.length - 1]!)
  const tmp = tmpPath(dir)
  const fd = fs.openSync(tmp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600)
  try {
    try {
      let off = 0
      while (off < data.length) off += fs.writeSync(fd, data, off, data.length - off)
      fs.fsyncSync(fd)
    } finally { fs.closeSync(fd) }
    verifyChain(root, [...segs], true)
    assertReplaceable(target)
    fs.renameSync(tmp, target)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

/** Rename an authorized team entry to another authorized team path (parents created; both chains re-checked). */
export function renameChecked(root: string, from: readonly string[], to: readonly string[], replaceFile: boolean) {
  ensureParents(root, to)
  verifyChain(root, [...from])
  verifyChain(root, [...to], true)
  const target = path.join(root, ...to)
  if (replaceFile) assertReplaceable(target)
  else if (fs.existsSync(target) || isLink(target)) throw new ToolError(`'${to.join('/')}' already exists`, 'exists')
  fs.renameSync(path.join(root, ...from), target)
}

const isLink = (p: string) => { try { return fs.lstatSync(p).isSymbolicLink() } catch { return false } }

// ---------------- versions and trash ----------------
const systemPath = (root: string, ...segs: string[]) => path.join(root, PRODUCT.systemDir, ...segs)

function insertVersion(db: Database, v: { id: string; path: string; storedAs: string; size: number; sha256: string; userId: string; reason: VersionReason }) {
  db.query('INSERT INTO file_versions (id, path, stored_as, size, sha256, user_id, reason, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(v.id, v.path, v.storedAs, v.size, v.sha256, v.userId, v.reason, nowIso())
}

/**
 * Keep the current content of team file `rel` before it is replaced. `bytes`: the content when the caller already
 * holds it (edit); otherwise it is copied from the checked file. Returns the file_versions id.
 */
export function saveVersion(db: Database, root: string, rel: string, userId: string, reason: VersionReason, bytes?: Uint8Array): string {
  const id = newId(16)
  const dir = systemPath(root, 'versions')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dest = path.join(dir, id)
  let info: { size: number; sha256: string }
  if (bytes) {
    fs.writeFileSync(dest, bytes, { mode: 0o600, flag: 'wx' })
    info = { size: bytes.length, sha256: sha256(bytes) }
  } else {
    const out = fs.openSync(dest, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600)
    try {
      info = streamChecked(path.join(root, ...rel.split('/')), (b) => { let off = 0; while (off < b.length) off += fs.writeSync(out, b, off, b.length - off) })
      fs.fsyncSync(out)
    } catch (e) { fs.closeSync(out); fs.rmSync(dest, { force: true }); throw e }
    fs.closeSync(out)
  }
  try {
    insertVersion(db, { id, path: rel, storedAs: `${PRODUCT.systemDir}/versions/${id}`, ...info, userId, reason })
  } catch (e) { fs.rmSync(dest, { force: true }); throw e }
  return id
}

/** Server-local calendar day, YYYY-MM-DD (trash folders are named by the day people see). */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Move team file `segs` into .trina/trash/<day>/<id>/<name> (a rename: nothing is unlinked) with a version row. */
export function moveToTrash(db: Database, root: string, segs: readonly string[], userId: string): { id: string; storedAs: string; size: number } {
  const rel = segs.join('/')
  const abs = path.join(root, ...segs)
  const info = streamChecked(abs)
  const id = newId(16)
  const name = segs[segs.length - 1]!
  const day = localDay()
  const dir = systemPath(root, 'trash', day, id)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  verifyChain(root, [...segs])
  fs.renameSync(abs, path.join(dir, name))
  const storedAs = `${PRODUCT.systemDir}/trash/${day}/${id}/${name}`
  try {
    insertVersion(db, { id, path: rel, storedAs, ...info, userId, reason: 'trash' })
  } catch (e) {
    // put it back: a delete without its record would look like a lost file
    try { fs.renameSync(path.join(dir, name), abs) } catch {}
    throw e
  }
  return { id, storedAs, size: info.size }
}
