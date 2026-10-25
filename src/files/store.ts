// Low-level file operations inside the team folder (ported from Team AX server/src/files/store.ts and
// team-files/place.ts). Callers must have authorize()d every path first.
//
// - Reads open the file with O_NOFOLLOW and check the descriptor (regular file, a single link), so a path swapped for
//   a symlink or a hard link after authorize() is never read.
// - Writes go to a temp file (O_CREAT|O_EXCL|O_NOFOLLOW, prefix PRODUCT.tmpPrefix) in the same folder, are fsynced,
//   the folder chain is lstat'ed again (verifyChain) and only then renamed over the target.
// - Old content is never lost: an overwrite, edit or move-over keeps the current file as
//   .trina/versions/<id>-<name> (older rows: .trina/versions/<id>), right before the rename that replaces it; a
//   delete renames the file into .trina/trash/<YYYY-MM-DD>/<id>/<name>. Both get a file_versions row (versions.ts
//   lists and restores them).
// - Large files never stall the hub: a delete is a rename (no hashing), and a file over VERSION_COPY_MAX is kept by
//   a hard link to the same inode (instant; the rename that follows leaves the version as its only name) instead of
//   a byte copy, with sha256 '' (not hashed).
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

/** Size and sha256 of a regular, singly linked file, read in chunks (never the whole file in memory). */
export function hashRegular(abs: string): { size: number; sha256: string } {
  const { fd, st } = openChecked(abs)
  try {
    const h = crypto.createHash('sha256')
    const buf = Buffer.allocUnsafe(CHUNK)
    for (let pos = 0; ; ) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos)
      if (n <= 0) break
      h.update(buf.subarray(0, n))
      pos += n
    }
    return { size: st.size, sha256: h.digest('hex') }
  } finally { fs.closeSync(fd) }
}

/**
 * The first `size` bytes of an open file as a web stream (for a download). Reads on demand, so a slow client holds back
 * the disk instead of filling memory; closes `fd` when the stream ends, fails or is cancelled. A plain web stream (not
 * a Node stream turned into one) lets the server send a Content-Length. If the file got shorter while it was sent the
 * stream errors, so the client sees a broken download instead of a short file that looks complete.
 */
export function fdStream(fd: number, size: number, chunk = 256 * 1024): ReadableStream<Uint8Array> {
  let pos = 0
  let closed = false
  const close = () => { if (!closed) { closed = true; try { fs.closeSync(fd) } catch { /* already gone */ } } }
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (pos >= size) { close(); ctrl.close(); return }
      const buf = Buffer.allocUnsafe(Math.min(chunk, size - pos))
      return new Promise<void>((resolve) => {
        fs.read(fd, buf, 0, buf.length, pos, (err, n) => {
          if (err || n <= 0) { close(); ctrl.error(err ?? new Error('the file got shorter while it was downloaded')); return resolve() }
          pos += n
          ctrl.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, n))
          resolve()
        })
      })
    },
    cancel() { close() },
  })
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

/** Keep the file being replaced as a version (see keepVersion). */
export interface KeepVersion { db: Database; userId: string; reason: VersionReason; /** its content when the caller already holds it (edit) */ bytes?: Uint8Array }

/**
 * Write `data` to team path `segs` atomically (temp file in the same folder, fsync, verifyChain, rename). With
 * `keep`, an existing target is kept as a version right before the rename; returns that version's id.
 */
export function atomicWrite(root: string, segs: readonly string[], data: Uint8Array, keep?: KeepVersion): string | null {
  return placeAtomically(root, segs, (tmp) => {
    const fd = fs.openSync(tmp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600)
    try {
      let off = 0
      while (off < data.length) off += fs.writeSync(fd, data, off, data.length - off)
      fs.fsyncSync(fd)
    } finally { fs.closeSync(fd) }
  }, keep)
}

/**
 * Copy the server-side file `src` (a stored version under .trina) to team path `segs` atomically, like atomicWrite.
 * A clone where the disk can (APFS: instant at any size), else a kernel copy.
 */
export function atomicCopy(root: string, segs: readonly string[], src: string, keep?: KeepVersion): string | null {
  return placeAtomically(root, segs, (tmp) => {
    if (!fs.lstatSync(src).isFile()) throw new ToolError('the stored copy is not a regular file')
    fs.copyFileSync(src, tmp, C.COPYFILE_EXCL | C.COPYFILE_FICLONE)
    fs.chmodSync(tmp, 0o600)
    const fd = fs.openSync(tmp, C.O_RDONLY | C.O_NOFOLLOW)
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  }, keep)
}

/**
 * Move the server-side file `src` (a finished upload staged under .trina/uploads, a regular file this process made)
 * to team path `segs` atomically: the folder chain is checked again, an existing target is kept as a version (keep)
 * and `src` is renamed over it, so nobody ever sees half a file. Where `src` lies on another disk (EXDEV) it is copied
 * in next to the target first. Returns the id of the version that was kept.
 */
export function placeFile(root: string, segs: readonly string[], src: string, keep?: KeepVersion): string | null {
  const sst = fs.lstatSync(src)
  if (!sst.isFile() || sst.nlink > 1) throw new ToolError('the received file is not a regular file')
  ensureParents(root, segs)
  verifyChain(root, [...segs], true)
  const target = path.join(root, ...segs)
  assertReplaceable(target)
  const kept = keep && fs.existsSync(target) ? keepVersion(root, segs, keep) : null
  try {
    fs.renameSync(src, target)
  } catch (e: any) {
    kept?.undo()
    if (e?.code === 'EXDEV') return atomicCopy(root, segs, src, keep)
    throw e
  }
  return kept?.id ?? null
}

/** fill(tmp) creates the temp file; then verifyChain, the target check, the version (keep) and the rename. */
function placeAtomically(root: string, segs: readonly string[], fill: (tmp: string) => void, keep?: KeepVersion): string | null {
  ensureParents(root, segs)
  const dir = path.join(root, ...segs.slice(0, -1))
  const target = path.join(dir, segs[segs.length - 1]!)
  const tmp = tmpPath(dir)
  let kept: Kept | null = null
  try {
    fill(tmp)
    verifyChain(root, [...segs], true)
    assertReplaceable(target)
    if (keep && fs.existsSync(target)) kept = keepVersion(root, segs, keep)
    fs.renameSync(tmp, target)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    kept?.undo()
    throw e
  }
  return kept?.id ?? null
}

/**
 * Rename an authorized team entry to another authorized team path (parents created; both chains re-checked). With
 * `keep`, a file being replaced is kept as a version right before the rename; returns that version's id.
 */
export function renameChecked(root: string, from: readonly string[], to: readonly string[], replaceFile: boolean, keep?: KeepVersion): string | null {
  ensureParents(root, to)
  verifyChain(root, [...from])
  verifyChain(root, [...to], true)
  const target = path.join(root, ...to)
  if (replaceFile) assertReplaceable(target)
  else if (fs.existsSync(target) || isLink(target)) throw new ToolError(`'${to.join('/')}' already exists`, 'exists')
  const kept = replaceFile && keep && fs.existsSync(target) ? keepVersion(root, to, keep) : null
  try {
    fs.renameSync(path.join(root, ...from), target)
  } catch (e) { kept?.undo(); throw e }
  return kept?.id ?? null
}

const isLink = (p: string) => { try { return fs.lstatSync(p).isSymbolicLink() } catch { return false } }

// ---------------- versions and trash ----------------
const systemPath = (root: string, ...segs: string[]) => path.join(root, PRODUCT.systemDir, ...segs)

/** Files up to this size are copied (and hashed) into the version store; larger ones are kept by a hard link. */
export const VERSION_COPY_MAX = 32 * 1024 * 1024

function insertVersion(db: Database, v: { id: string; path: string; storedAs: string; size: number; sha256: string; userId: string; reason: VersionReason }) {
  db.query('INSERT INTO file_versions (id, path, stored_as, size, sha256, user_id, reason, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(v.id, v.path, v.storedAs, v.size, v.sha256, v.userId, v.reason, nowIso())
}

/** `<id>-<name>`, the name shortened (extension kept) so the whole stays within 255 bytes. */
export function storedName(id: string, name: string): string {
  const room = 255 - Buffer.byteLength(id + '-')
  if (Buffer.byteLength(name) <= room) return `${id}-${name}`
  const dot = name.lastIndexOf('.')
  const extPart = dot > 0 && Buffer.byteLength(name.slice(dot)) <= 32 ? name.slice(dot) : ''
  let stem = [...name.slice(0, name.length - extPart.length)]
  while (stem.length && Buffer.byteLength(stem.join('') + extPart) > room) stem.pop()
  return `${id}-${stem.join('')}${extPart}`
}

interface Kept { id: string; undo(): void }

/**
 * Keep the current content of team file `segs` (about to be replaced by a rename) as
 * .trina/versions/<id>-<name> with a file_versions row. `keep.bytes` when the caller holds the content; otherwise
 * the checked file is copied (and hashed) when small, or hard-linked (not hashed: sha256 '') when large.
 */
function keepVersion(root: string, segs: readonly string[], keep: KeepVersion): Kept {
  const rel = segs.join('/')
  const id = newId(16)
  const name = storedName(id, segs[segs.length - 1]!)
  const dir = systemPath(root, 'versions')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dest = path.join(dir, name)
  let info: { size: number; sha256: string }
  if (keep.bytes) {
    fs.writeFileSync(dest, keep.bytes, { mode: 0o600, flag: 'wx' })
    info = { size: keep.bytes.length, sha256: sha256(keep.bytes) }
  } else {
    const abs = path.join(root, ...segs)
    const { fd, st } = openChecked(abs)
    try {
      info = st.size <= VERSION_COPY_MAX ? copyFd(fd, dest) : { size: st.size, sha256: linkOrCopy(abs, dest, st) }
    } finally { fs.closeSync(fd) }
  }
  try {
    insertVersion(keep.db, { id, path: rel, storedAs: `${PRODUCT.systemDir}/versions/${name}`, ...info, userId: keep.userId, reason: keep.reason })
  } catch (e) { fs.rmSync(dest, { force: true }); throw e }
  return {
    id,
    undo() {
      fs.rmSync(dest, { force: true })
      try { keep.db.query('DELETE FROM file_versions WHERE id = ?').run(id) } catch {}
    },
  }
}

/** Copy an open checked file into a new file `dest`, hashing it. */
function copyFd(fd: number, dest: string): { size: number; sha256: string } {
  const out = fs.openSync(dest, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600)
  const h = crypto.createHash('sha256')
  const buf = Buffer.allocUnsafe(CHUNK)
  let size = 0
  try {
    for (let pos = 0; ; ) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos)
      if (n <= 0) break
      const part = buf.subarray(0, n)
      h.update(part)
      let off = 0
      while (off < n) off += fs.writeSync(out, part, off, n - off)
      pos += n
      size += n
    }
    fs.fsyncSync(out)
  } catch (e) { fs.closeSync(out); fs.rmSync(dest, { force: true }); throw e }
  fs.closeSync(out)
  return { size, sha256: h.digest('hex') }
}

/**
 * A second name for the checked file `abs` (same inode `st`) at `dest`: instant, whatever the size. Where the disk
 * has no hard links, a clone or kernel copy instead. Either way the result is checked to be that same file.
 * Returns the sha256 to store ('' = not hashed).
 */
function linkOrCopy(abs: string, dest: string, st: fs.Stats): string {
  const same = (p: string) => { try { const s = fs.lstatSync(p); return s.isFile() && s.ino === st.ino && s.dev === st.dev } catch { return false } }
  try {
    fs.linkSync(abs, dest)
    if (!same(dest)) { fs.rmSync(dest, { force: true }); throw new Denied('path changed while saving the earlier version') }
    return ''
  } catch (e: any) {
    if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS'].includes(e?.code)) throw e
  }
  fs.copyFileSync(abs, dest, C.COPYFILE_EXCL | C.COPYFILE_FICLONE)
  fs.chmodSync(dest, 0o600)
  if (!same(abs)) { fs.rmSync(dest, { force: true }); throw new Denied('path changed while saving the earlier version') }
  return ''
}

/** Server-local calendar day, YYYY-MM-DD (trash folders are named by the day people see). */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Move team file `segs` into .trina/trash/<day>/<id>/<name> (a rename: nothing is unlinked, nothing is read, so a
 * file of any size goes at once) with a version row (sha256 '': not hashed).
 */
export function moveToTrash(db: Database, root: string, segs: readonly string[], userId: string): { id: string; storedAs: string; size: number } {
  const rel = segs.join('/')
  const abs = path.join(root, ...segs)
  const { fd, st } = openChecked(abs) // a regular, singly linked file, not a link
  fs.closeSync(fd)
  const id = newId(16)
  const name = segs[segs.length - 1]!
  const day = localDay()
  const dir = systemPath(root, 'trash', day, id)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  verifyChain(root, [...segs])
  fs.renameSync(abs, path.join(dir, name))
  const storedAs = `${PRODUCT.systemDir}/trash/${day}/${id}/${name}`
  try {
    insertVersion(db, { id, path: rel, storedAs, size: st.size, sha256: '', userId, reason: 'trash' })
  } catch (e) {
    // put it back: a delete without its record would look like a lost file
    try { fs.renameSync(path.join(dir, name), abs) } catch {}
    throw e
  }
  return { id, storedAs, size: st.size }
}
