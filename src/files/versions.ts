// Earlier versions and deleted files (file_versions): list, restore, prune. store.ts keeps them — an overwrite, edit
// or move-over keeps the old file under .trina/versions/<id>-<name> (rows from before: .trina/versions/<id>), a delete
// moves it to .trina/trash/<day>/<id>/<name>. The admin page (src/web/admin/versions.tsx) and the CLI call this;
// they check that the person is an admin or the owner. Here, the person must also be able to read the original path
// (so nobody, admins included, restores or sees another person's users/<id>/ files) and write the target path.
import fs from 'node:fs'
import path from 'node:path'
import type { Ctx } from '../context'
import { HttpError } from '../http/errors'
import { atLeast, loadPrincipal, type Principal } from '../policy/access'
import { authorize, type Authorized } from '../policy/authorize'
import { Denied, ToolError } from '../policy/errors'
import { PRODUCT } from '../product'
import { atomicCopy, type VersionReason } from './store'

export interface VersionRow {
  id: string
  /** the original path in the team folder */
  path: string
  name: string
  reason: VersionReason
  size: number
  /** '' when not hashed (a deleted file, or a very large one) */
  sha256: string
  userId: string | null
  userName: string | null
  createdAt: string
  /** where the copy is kept, relative to the team folder */
  storedAs: string
  /** whether the kept copy is still there (prune or someone on the hub may have removed it) */
  stored: boolean
  /** pass as `before` to get the next (older) page */
  cursor: string
}

/** .trina/versions/<name> or .trina/trash/<day>/<id>/<name>: the only places a kept copy can be */
const STORED = new RegExp(`^${PRODUCT.systemDir.replace('.', '\\.')}/(versions/[^/]+|trash/[^/]+/[^/]+/[^/]+)$`)

/** Absolute path of a row's kept copy, or null when stored_as is not one this module would ever write. */
function storedAbs(ctx: Ctx, storedAs: string): string | null {
  if (!STORED.test(storedAs) || storedAs.split('/').some((s) => s === '..' || s === '.' || s === '')) return null
  return path.join(ctx.fx.root, ...storedAs.split('/'))
}

const isFile = (p: string | null) => { if (!p) return false; try { return fs.lstatSync(p).isFile() } catch { return false } }

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

/**
 * Versions, newest first. `path`: only paths starting with it (a folder or the start of a file name; composed or
 * decomposed Korean alike). `before`: a row's `cursor` (or an ISO time) to page further back. `viewer`: a user id;
 * then only versions of paths that person may read are listed (so another person's users/<id>/ never shows).
 */
export function listVersions(ctx: Ctx, o: { path?: string; limit?: number; before?: string; viewer?: string } = {}): VersionRow[] {
  const limit = Math.max(1, Math.min(o.limit ?? 100, 1000))
  const where: string[] = []
  const args: (string | number)[] = []
  const prefix = (o.path ?? '').trim().replace(/^\/+/, '')
  if (prefix) {
    const forms = [...new Set([prefix.normalize('NFC'), prefix.normalize('NFD')])]
    where.push('(' + forms.map(() => "v.path LIKE ? ESCAPE '\\'").join(' OR ') + ')')
    for (const f of forms) args.push(likeEscape(f) + '%')
  }
  if (o.before) {
    const [at, id] = o.before.split('|')
    if (id) {
      where.push('(v.created_at < ? OR (v.created_at = ? AND v.rowid < COALESCE((SELECT rowid FROM file_versions WHERE id = ?), 0)))')
      args.push(at!, at!, id)
    } else { where.push('v.created_at < ?'); args.push(at!) }
  }
  let viewer: Principal | null = null
  if (o.viewer) { viewer = loadPrincipal(ctx.db, o.viewer); if (!viewer) return [] }
  const rules = ctx.rules()
  const out: VersionRow[] = []
  const sql = `SELECT v.*, v.rowid AS rid, u.name AS user_name FROM file_versions v LEFT JOIN users u ON u.id = v.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.created_at DESC, v.rowid DESC LIMIT ? OFFSET ?`
  // with a viewer some rows are skipped: read on until the page is full
  for (let offset = 0; out.length < limit; offset += 500) {
    const rows = ctx.db.query(sql).all(...args, 500, offset) as any[]
    for (const r of rows) {
      if (viewer && !atLeast(rules.access(viewer, r.path.split('/')), 'read')) continue
      out.push({
        id: r.id, path: r.path, name: r.path.split('/').pop() ?? r.path, reason: r.reason, size: r.size, sha256: r.sha256,
        userId: r.user_id, userName: r.user_name ?? null, createdAt: r.created_at, storedAs: r.stored_as,
        stored: isFile(storedAbs(ctx, r.stored_as)), cursor: `${r.created_at}|${r.id}`,
      })
      if (out.length >= limit) break
    }
    if (rows.length < 500) break
  }
  return out
}

export function getVersion(ctx: Ctx, id: string): VersionRow | null {
  const r = ctx.db.query('SELECT v.*, u.name AS user_name FROM file_versions v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = ?').get(id) as any
  if (!r) return null
  return {
    id: r.id, path: r.path, name: r.path.split('/').pop() ?? r.path, reason: r.reason, size: r.size, sha256: r.sha256,
    userId: r.user_id, userName: r.user_name ?? null, createdAt: r.created_at, storedAs: r.stored_as,
    stored: isFile(storedAbs(ctx, r.stored_as)), cursor: `${r.created_at}|${r.id}`,
  }
}

const bad = (message: string, status = 400) => new HttpError(status, 'validation', message)

/** authorize() for a restore target, as a message an admin reads. */
function target(ctx: Ctx, actor: Principal, input: string): Authorized {
  try {
    return authorize(ctx.fx, ctx.rules(), actor, input, 'write', { createDirs: true })
  } catch (e) {
    if (e instanceof Denied || e instanceof ToolError) throw bad(`'${input}'에는 되살릴 수 없어요. 그 폴더에 쓸 권한이 없거나 경로가 올바르지 않아요.`)
    throw e
  }
}

/** "보고서 (복원).md", "보고서 (복원 2).md", ... next to `segs`: the first name that is free (and not a look-alike). */
function freeTarget(ctx: Ctx, actor: Principal, segs: readonly string[]): Authorized {
  const name = segs[segs.length - 1]!
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; n <= 50; n++) {
    const cand = [...segs.slice(0, -1), `${stem} (복원${n > 1 ? ' ' + n : ''})${ext}`].join('/')
    let r: Authorized
    try { r = authorize(ctx.fx, ctx.rules(), actor, cand, 'write', { createDirs: true }) } catch { continue }
    if (!r.exists) return r
  }
  throw bad('비어 있는 이름을 찾지 못했어요. 다른 위치를 골라 되살려 주세요.')
}

/**
 * Copy a kept version back to its original path (or `o.to`). Nothing is overwritten silently: when a file is there
 * now, it is kept as a new version first (like an overwrite), except that a deleted file is restored next to it under
 * a free name ("이름 (복원).md"). Written with the same atomic write as the tools (temp file, checks, rename).
 * The actor must be able to read the original path and write the target. Callers check admin/owner.
 */
export function restoreVersion(ctx: Ctx, versionId: string, actorUserId: string, o: { to?: string } = {}): { path: string } {
  const v = getVersion(ctx, versionId)
  if (!v) throw bad('그 이전 버전을 찾을 수 없어요.', 404)
  const actor = loadPrincipal(ctx.db, actorUserId)
  if (!actor) throw bad('꺼졌거나 없는 계정이에요.', 403)
  if (!atLeast(ctx.rules().access(actor, v.path.split('/')), 'read')) {
    throw bad('이 파일을 되살릴 수 없어요. 개인 폴더(users/)의 파일은 그 사람만 다룰 수 있어요.')
  }
  const src = storedAbs(ctx, v.storedAs)
  if (!isFile(src)) throw bad('보관된 사본이 이미 정리돼서 되살릴 수 없어요.')
  let t = target(ctx, actor, o.to ?? v.path)
  if (t.segs.length === 0) throw bad('파일 이름까지 적어 주세요.')
  if (t.exists && v.reason === 'trash' && !o.to) t = freeTarget(ctx, actor, t.segs)
  if (t.exists && t.st!.isDirectory()) throw bad(`'${t.rel}'에는 같은 이름의 폴더가 있어요. 다른 위치를 골라 주세요.`)
  try {
    atomicCopy(ctx.fx.root, t.segs, src!, t.exists ? { db: ctx.db, userId: actor.id, reason: 'overwrite' } : undefined)
  } catch (e) {
    if (e instanceof Denied || e instanceof ToolError) throw bad(`'${t.rel}'에 되살리지 못했어요. 그 자리의 파일이 일반 파일이 아니거나, 쓰는 동안 바뀌었어요.`)
    throw e
  }
  return { path: t.rel }
}

/** Delete kept copies (and their rows) older than `olderThanDays`. Returns how many were removed. */
export function pruneVersions(ctx: Ctx, olderThanDays = 90): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
  const rows = ctx.db.query('SELECT id, stored_as FROM file_versions WHERE created_at < ?').all(cutoff) as { id: string; stored_as: string }[]
  let n = 0
  for (const r of rows) {
    const abs = storedAbs(ctx, r.stored_as)
    try {
      if (abs) {
        fs.rmSync(abs, { force: true })
        // trash: .trina/trash/<day>/<id>/<name> — the <id> and <day> folders go once empty
        if (r.stored_as.startsWith(`${PRODUCT.systemDir}/trash/`)) {
          for (const d of [path.dirname(abs), path.dirname(path.dirname(abs))]) { try { fs.rmdirSync(d) } catch { break } }
        }
      }
      ctx.db.query('DELETE FROM file_versions WHERE id = ?').run(r.id)
      n++
    } catch { /* left for the next run */ }
  }
  return n
}
