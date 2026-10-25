// The file service: everything a person (through their Claude) may do in the team folder, with their folder
// permissions. Bound to the hub context and one person; the MCP tools (src/mcp/tools.ts), hub sessions and tests
// call it directly. Every client path goes through authorize() (src/policy/authorize.ts).
//
// Hidden and missing look the same: a path the person may not see is answered exactly like one that is not there
// (the policy code does this for reads; existingForWrite() below does it for edits, moves and deletes too).
import fs from 'node:fs'
import path from 'node:path'
import type { Ctx } from '../context'
import { nowIso } from '../db'
import { atLeast, loadPrincipal, type Principal, type RuleSet } from '../policy/access'
import { authorize, type Authorized } from '../policy/authorize'
import { Denied, ToolError } from '../policy/errors'
import { badSegment, hiddenEntry } from '../policy/names'
import { verifyChain } from '../policy/resolve'
import { skillFiles, skillsFor, type Skill } from '../skills/catalog'
import { BINARY_EXT, decodeText, ext, extractText, IMAGE_MAX_BYTES, imageMime, isImageName, isOffice, looksBinary, utf16, type Converters, type TextEncoding } from './extract'
import { OfficeCache, searchContent, searchNames, type SearchDeps } from './search'
import { atomicWrite, hashRegular, MAX_WRITE_BYTES, moveToTrash, openChecked, placeFile, readRegular, renameChecked, sha256 } from './store'
import { dropChange, moveChange, recordChange, type ChangeSource } from './changes'

/** read_file: lines and characters returned per call. Claude Code keeps an MCP text result inline only up to about
 * 50,000 characters (above that it saves the result to a file on the PC and shows the model a 2 KB preview, which a
 * hub session without built-in tools cannot open), so a page stays well below that, line-number prefixes included. */
export const READ_MAX_LINES = 2000
export const READ_MAX_CHARS = 38_000
const READ_LINE_MAX_CHARS = 2000
const TEXT_FILE_MAX = 64 * 1024 * 1024
const OFFICE_FILE_MAX = 50 * 1024 * 1024
const LIST_MAX_ENTRIES = 500
const SKILL_MD_MAX = 256 * 1024

export interface ListEntry { path: string; name: string; type: 'file' | 'folder'; size?: number; mtime: string; mtimeMs: number; readOnly: boolean }
export interface ListResult { path: string; readOnly: boolean; entries: ListEntry[]; truncated: boolean }

export type ReadResult =
  | { kind: 'text'; path: string; lines: string[]; from: number; totalLines: number; cutAtChars: boolean; converted: boolean; encoding: TextEncoding }
  | { kind: 'image'; path: string; mimeType: string; data: string; size: number }

export interface SearchInput { query: string; path?: string; mode?: 'content' | 'name'; glob?: string; limit?: number }
export type SearchResult =
  | { mode: 'content'; path: string; hits: { path: string; line: number; text: string }[]; files: number; truncated: boolean; timedOut: boolean; officePending: number; literal: boolean }
  | { mode: 'name'; path: string; hits: { path: string; type: 'file' | 'folder'; size?: number; mtime: string }[]; truncated: boolean; timedOut: boolean }

export interface WriteResult { path: string; created: boolean; changed: boolean; size: number; versionId: string | null }
export interface EditResult { path: string; replacements: number; size: number; versionId: string }
export interface FolderResult { path: string; created: boolean }
export interface MoveResult { from: string; to: string; type: 'file' | 'folder'; replacedVersionId: string | null }
export interface DeleteResult { path: string; type: 'file' | 'folder'; versionId: string | null; storedAs: string | null }
export interface SkillResult { name: string; pack: string; path: string; description: string; text: string; files: string[] }

const caches = new WeakMap<Ctx, OfficeCache>()
/** The office-text cache of this hub (<dataDir>/textcache), one per context. */
export function officeCache(ctx: Ctx): OfficeCache {
  let c = caches.get(ctx)
  if (!c) { c = new OfficeCache(path.join(ctx.config.dataDir, 'textcache'), ctx.fx, converters(ctx)); caches.set(ctx, c) }
  return c
}
export const converters = (ctx: Ctx): Converters => ({ pandoc: ctx.config.pandocBin, pdftotext: ctx.config.pdftotextBin, denyRead: [ctx.fx.root, ctx.config.dataDir] })

/** Text extraction of uploaded documents, one at a time in the background (search finds them without waiting). */
const indexing = new WeakMap<Ctx, Promise<void>>()
/** A document was created or replaced at `rel`: forget its old text and, for Office/PDF/HWP, extract the new one. */
export function indexFile(ctx: Ctx, rel: string) {
  const cache = officeCache(ctx)
  cache.forget(rel)
  if (!isOffice(rel)) return
  const prev = indexing.get(ctx) ?? Promise.resolve()
  indexing.set(ctx, prev.then(() => cache.update(rel)).catch(() => {}))
}
/** Resolves when the documents queued by indexFile have been read (tests wait for it). */
export const indexingDone = (ctx: Ctx): Promise<void> => indexing.get(ctx) ?? Promise.resolve()

const hiddenMessage = (input: unknown) => `not found or no access: '${typeof input === 'string' ? input : ''}'`
const isUnder = (base: string, p: string) => base === '' ? p !== '' : p.startsWith(base + '/')
/** Server-local "YYYY-MM-DD HH:mm" (what people in the office read). */
export const localTime = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export class FileService {
  /** `source`: where the calls come from ('mcp' = a person's Claude or a hub session, 'web' = the /files page); it is
   * written next to "who changed this last" (changes.ts). */
  constructor(readonly ctx: Ctx, readonly user: Principal, readonly source: ChangeSource = 'mcp') {}

  /** The service for a person as they are now; refuses a disabled or deleted account. */
  static forUser(ctx: Ctx, userId: string, source: ChangeSource = 'mcp'): FileService {
    const user = loadPrincipal(ctx.db, userId)
    if (!user) throw new Denied('this account is disabled')
    return new FileService(ctx, user, source)
  }

  /** Bookkeeping after a file was created or changed: who, and the text index (a replaced document's old text goes). */
  private changed(rel: string, index = false) {
    recordChange(this.ctx.db, rel, this.user.id, this.source)
    if (index) indexFile(this.ctx, rel)
  }

  private get fx() { return this.ctx.fx }
  private rules(): RuleSet { return this.ctx.rules() }

  /** authorize() for a write that needs an existing entry; a missing one is refused like a hidden one. */
  private existingForWrite(rules: RuleSet, input: string): Authorized {
    try {
      return authorize(this.fx, rules, this.user, input, 'write', { mustExist: true })
    } catch (e) {
      if (e instanceof ToolError && e.code === 'not_found') throw new Denied(hiddenMessage(input))
      throw e
    }
  }

  private isAdmin() { return this.user.role === 'owner' || this.user.role === 'admin' }

  /** root, users/ and users/<id>/ never move or go away */
  private assertNotProtected(segs: readonly string[], what: string) {
    if (segs.length === 0 || (segs[0] === 'users' && segs.length <= 2)) throw new ToolError(`'${segs.join('/') || '/'}' cannot be ${what}`, 'protected')
  }

  /** Is `segs` a folder with its own permission rules, or does it hold one? (canonical names, like the rules) */
  private holdsRules(rules: RuleSet, segs: readonly string[]) {
    return rules.holdsRuleFolder(segs)
  }

  // ---------------- list ----------------
  list(input?: string, depth = 1): ListResult {
    const rules = this.rules()
    const r = authorize(this.fx, rules, this.user, input ?? '', 'list')
    if (!r.st!.isDirectory()) throw new ToolError(`'${r.rel}' is a file; use read_file to read it`, 'not_folder')
    const entries: ListEntry[] = []
    let truncated = false
    const visit = (segs: string[], level: number) => {
      let names: fs.Dirent[]
      try { names = fs.readdirSync(path.join(this.fx.root, ...segs), { withFileTypes: true }) } catch { return }
      names.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      for (const e of names) {
        if (entries.length >= LIST_MAX_ENTRIES) { truncated = true; return }
        const child = [...segs, e.name]
        const entry = this.visibleEntry(rules, child, e)
        if (!entry) continue
        entries.push(entry)
        if (entry.type === 'folder' && level < depth) visit(child, level + 1)
      }
    }
    visit(r.segs, 1)
    return { path: r.rel, readOnly: !atLeast(rules.access(this.user, r.segs), 'write'), entries, truncated }
  }

  /** The entry as the person sees it in a listing, or null when it does not show (same test as siblingVisible). */
  private visibleEntry(rules: RuleSet, segs: string[], e: fs.Dirent): ListEntry | null {
    const name = segs[segs.length - 1]!
    if (hiddenEntry(name, segs.length - 1) || badSegment(name) !== null || e.isSymbolicLink()) return null
    let st: fs.Stats
    try { st = fs.lstatSync(path.join(this.fx.root, ...segs)) } catch { return null }
    const readOnly = !atLeast(rules.access(this.user, segs), 'write')
    if (st.isDirectory()) {
      if (!rules.canList(this.user, segs)) return null
      return { path: segs.join('/'), name, type: 'folder', mtime: localTime(st.mtimeMs), mtimeMs: st.mtimeMs, readOnly }
    }
    if (!st.isFile() || st.nlink > 1 || !atLeast(rules.access(this.user, segs), 'read')) return null
    return { path: segs.join('/'), name, type: 'file', size: st.size, mtime: localTime(st.mtimeMs), mtimeMs: st.mtimeMs, readOnly }
  }

  // ---------------- read ----------------
  async read(input: string, o: { offset?: number; limit?: number } = {}): Promise<ReadResult> {
    const r = authorize(this.fx, this.rules(), this.user, input, 'read')
    if (r.st!.isDirectory()) throw new ToolError(`'${r.rel}' is a folder; use list_files to see what is inside`, 'is_folder')
    if (isImageName(r.rel)) {
      const mb = (n: number) => (n / 1048576).toFixed(1)
      if (r.st!.size > IMAGE_MAX_BYTES) throw new ToolError(`the image is too large to show (${mb(r.st!.size)} MB; the limit is ${mb(IMAGE_MAX_BYTES)} MB)`, 'too_large')
      const { bytes } = readRegular(r.abs, IMAGE_MAX_BYTES, 'the image is too large to show')
      const mimeType = imageMime(bytes)
      if (!mimeType) throw new ToolError(`'${r.rel}' is not a valid PNG, JPEG, GIF or WebP image`)
      return { kind: 'image', path: r.rel, mimeType, data: bytes.toString('base64'), size: bytes.length }
    }
    let text: string
    let encoding: TextEncoding = 'utf-8'
    const converted = isOffice(r.rel)
    if (converted) text = await this.officeText(r)
    else {
      const { bytes } = readRegular(r.abs, TEXT_FILE_MAX, `the file is too large to read (over ${TEXT_FILE_MAX / 1048576} MB)`)
      if (looksBinary(bytes)) throw new ToolError(`'${r.rel}' is a binary file; it cannot be shown as text`, 'binary')
      ;({ text, encoding } = decodeText(bytes))
    }
    const all = text.split(/\r?\n/)
    if (all.length && all[all.length - 1] === '') all.pop()
    const from = o.offset ?? 1
    const limit = Math.min(o.limit ?? READ_MAX_LINES, READ_MAX_LINES)
    if (all.length && from > all.length) throw new ToolError(`offset ${from} is past the end of the file (${all.length} lines)`)
    const lines: string[] = []
    let chars = 0
    let cutAtChars = false
    for (let i = from - 1; i < all.length && lines.length < limit; i++) {
      let l = all[i]!
      if (l.length > READ_LINE_MAX_CHARS) l = l.slice(0, READ_LINE_MAX_CHARS) + '… (line cut)'
      const n = l.length + 8 // "     12<tab>" prefix and the newline
      if (chars + n > READ_MAX_CHARS && lines.length) { cutAtChars = true; break }
      chars += n
      lines.push(l)
    }
    return { kind: 'text', path: r.rel, lines, from, totalLines: all.length, cutAtChars, converted, encoding }
  }

  /** Extracted text of an office document; reuses the search cache when it is fresh and stores what it extracts. */
  private async officeText(r: Authorized): Promise<string> {
    const cache = officeCache(this.ctx)
    if (r.st && cache.fresh(r.rel, r.st)) {
      try { const t = fs.readFileSync(cache.cachePath(r.rel), 'utf8'); if (t) return t } catch {}
    }
    const { bytes, st } = readRegular(r.abs, OFFICE_FILE_MAX, `the document is too large to convert (over ${OFFICE_FILE_MAX / 1048576} MB)`)
    const text = await extractText(r.rel, bytes, converters(this.ctx))
    try {
      const dst = cache.cachePath(r.rel)
      fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 })
      fs.writeFileSync(dst, text, { mode: 0o600 })
      fs.utimesSync(dst, st.atime, st.mtime)
    } catch { /* the cache is only an optimisation */ }
    return text
  }

  // ---------------- search ----------------
  async search(o: SearchInput): Promise<SearchResult> {
    const rules = this.rules()
    const base = authorize(this.fx, rules, this.user, o.path ?? '', 'list')
    const isFile = !base.st!.isDirectory()
    const limit = Math.max(1, Math.min(o.limit ?? 100, 500))
    const mode = o.mode ?? 'content'
    const rg = this.ctx.config.rgBin
    if (!rg) {
      if (mode === 'content') throw new ToolError("searching inside files is not available on this hub (ripgrep is not installed); use mode 'name' or ask the admin to install ripgrep")
      return { mode: 'name', path: base.rel, ...this.walkNames(rules, base.segs, isFile, o.query, limit) }
    }
    const d: SearchDeps = { fx: this.fx, rules, user: this.user, rg, office: officeCache(this.ctx) }
    if (mode === 'name') {
      const r = await searchNames(d, base.segs, isFile, { query: o.query, glob: o.glob, limit })
      return { mode: 'name', path: base.rel, hits: r.hits.map((h) => ({ path: h.path, type: h.type, size: h.size, mtime: localTime(h.mtimeMs) })), truncated: r.truncated, timedOut: r.timedOut }
    }
    const r = await searchContent(d, base.segs, isFile, { query: o.query, glob: o.glob, limit })
    return { mode: 'content', path: base.rel, ...r }
  }

  /** Name search without ripgrep: a bounded walk with the listing's visibility rules. */
  private walkNames(rules: RuleSet, base: string[], isFile: boolean, query: string, limit: number) {
    const fold = (s: string) => s.normalize('NFKC').toLowerCase()
    const q = fold(query.trim())
    const hits: { path: string; type: 'file' | 'folder'; size?: number; mtime: string }[] = []
    let seen = 0
    let truncated = false
    if (isFile) {
      const name = base[base.length - 1]!
      const st = fs.lstatSync(path.join(this.fx.root, ...base))
      if (fold(name).includes(q)) hits.push({ path: base.join('/'), type: 'file', size: st.size, mtime: localTime(st.mtimeMs) })
      return { hits, truncated, timedOut: false }
    }
    const visit = (segs: string[]) => {
      let names: fs.Dirent[]
      try { names = fs.readdirSync(path.join(this.fx.root, ...segs), { withFileTypes: true }) } catch { return }
      for (const e of names) {
        if (++seen > 100_000 || hits.length >= limit) { truncated = true; return }
        const child = [...segs, e.name]
        const entry = this.visibleEntry(rules, child, e)
        if (!entry) continue
        if (fold(entry.name).includes(q)) hits.push({ path: entry.path, type: entry.type, size: entry.size, mtime: entry.mtime })
        if (entry.type === 'folder') visit(child)
      }
    }
    visit(base)
    return { hits, truncated, timedOut: false }
  }

  // ---------------- write / edit ----------------
  write(input: string, content: string, o: { overwrite?: boolean } = {}): WriteResult {
    const data = Buffer.from(content, 'utf8')
    if (data.length > MAX_WRITE_BYTES) throw new ToolError(`the content is too large (${(data.length / 1048576).toFixed(1)} MB; the limit is ${MAX_WRITE_BYTES / 1048576} MB)`, 'too_large')
    const r = authorize(this.fx, this.rules(), this.user, input, 'write', { createDirs: true })
    if (BINARY_EXT.has(ext(r.rel))) throw new ToolError(`'.${ext(r.rel)}' files cannot be written as text; write a .md, .txt or .csv file instead`, 'binary')
    if (!r.exists) {
      atomicWrite(this.fx.root, r.segs, data)
      this.changed(r.rel)
      return { path: r.rel, created: true, changed: true, size: data.length, versionId: null }
    }
    if (r.st!.isDirectory()) throw new ToolError(`'${r.rel}' is a folder`, 'is_folder')
    if (!o.overwrite) {
      throw new ToolError(`'${r.rel}' already exists. Use edit_file to change part of it, or call write_file again with overwrite: true to replace it (the current version is kept on the hub)`, 'exists')
    }
    // same size: compare (both at most MAX_WRITE_BYTES); the old version is streamed into the store either way
    if (r.st!.size === data.length && sha256(readRegular(r.abs, MAX_WRITE_BYTES).bytes) === sha256(data)) {
      return { path: r.rel, created: false, changed: false, size: data.length, versionId: null }
    }
    const versionId = atomicWrite(this.fx.root, r.segs, data, { db: this.ctx.db, userId: this.user.id, reason: 'overwrite' })
    this.changed(r.rel)
    return { path: r.rel, created: false, changed: true, size: data.length, versionId }
  }

  edit(input: string, oldString: string, newString: string, replaceAll = false): EditResult {
    if (oldString === '') throw new ToolError('old_string must not be empty (use write_file to create a file)')
    if (oldString === newString) throw new ToolError('old_string and new_string are the same; nothing to change')
    const r = this.existingForWrite(this.rules(), input)
    if (r.st!.isDirectory()) throw new ToolError(`'${r.rel}' is a folder`, 'is_folder')
    if (BINARY_EXT.has(ext(r.rel))) throw new ToolError(`'.${ext(r.rel)}' files cannot be edited as text; only text files (.md, .txt, .csv, ...) can be edited`, 'binary')
    const current = readRegular(r.abs, MAX_WRITE_BYTES, `the file is too large to edit (over ${MAX_WRITE_BYTES / 1048576} MB)`).bytes
    if (looksBinary(current)) throw new ToolError(`'${r.rel}' is a binary file; it cannot be edited as text`, 'binary')
    const notUtf8 = new ToolError(`'${r.rel}' is not UTF-8 text (it may be EUC-KR or UTF-16); editing it here could damage it. Write a new file instead`, 'encoding')
    if (utf16(current)) throw notUtf8
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(current) } catch { throw notUtf8 }
    let from = oldString, to = newString
    let n = count(text, from)
    // Windows line endings: the model's strings come with "\n"
    if (n === 0 && text.includes('\r\n') && from.includes('\n') && !from.includes('\r')) {
      from = from.replace(/\n/g, '\r\n'); to = to.replace(/\n/g, '\r\n')
      n = count(text, from)
    }
    if (n === 0) throw new ToolError(`old_string was not found in '${r.rel}'. Read the file again and copy the exact text, including spaces and line breaks`, 'no_match')
    if (n > 1 && !replaceAll) throw new ToolError(`old_string occurs ${n} times in '${r.rel}'. Add more surrounding text so it matches exactly once, or set replace_all: true`, 'ambiguous')
    const next = replaceAll ? text.split(from).join(to) : spliceOnce(text, from, to)
    const data = Buffer.from(next, 'utf8')
    if (data.length > MAX_WRITE_BYTES) throw new ToolError(`the result would be too large (over ${MAX_WRITE_BYTES / 1048576} MB)`, 'too_large')
    const versionId = atomicWrite(this.fx.root, r.segs, data, { db: this.ctx.db, userId: this.user.id, reason: 'overwrite', bytes: current })
    this.changed(r.rel)
    return { path: r.rel, replacements: replaceAll ? n : 1, size: data.length, versionId: versionId! }
  }

  // ---------------- folders ----------------
  makeFolder(input: string): FolderResult {
    const r = authorize(this.fx, this.rules(), this.user, input, 'write', { createDirs: true })
    if (r.segs.length === 0) return { path: '', created: false }
    if (r.exists) {
      if (r.st!.isDirectory()) return { path: r.rel, created: false }
      throw new ToolError(`'${r.rel}' is a file, not a folder`, 'exists')
    }
    let cur = this.fx.root
    for (let i = 0; i < r.segs.length; i++) {
      cur = path.join(cur, r.segs[i]!)
      if (i < r.existing) continue
      try { fs.mkdirSync(cur, { mode: 0o700 }) } catch (e: any) { if (e.code !== 'EEXIST') throw e }
    }
    verifyChain(this.fx.root, r.segs)
    return { path: r.rel, created: true }
  }

  // ---------------- move ----------------
  move(fromInput: string, toInput: string, o: { overwrite?: boolean } = {}): MoveResult {
    const rules = this.rules()
    const fr = this.existingForWrite(rules, fromInput)
    this.assertNotProtected(fr.segs, 'moved')
    const isDir = fr.st!.isDirectory()
    if (isDir && this.holdsRules(rules, fr.segs)) {
      throw new ToolError(`'${fr.rel}' has its own folder permissions (or holds a folder that does), so it cannot be moved with this tool; ask an admin`, 'rule_folder')
    }
    const tr = authorize(this.fx, rules, this.user, toInput, 'write', { createDirs: true, movingFrom: fr.segs })
    // a rename must not turn a text file into an .xlsx / .hwp / ... (write_file refuses those names for the same
    // reason: the converters would then parse whatever the text says, and people would open a broken document)
    if (!isDir && ext(tr.rel) !== ext(fr.rel) && BINARY_EXT.has(ext(tr.rel))) {
      throw new ToolError(`a file cannot be renamed to '.${ext(tr.rel)}' (that would not make it a real .${ext(tr.rel)} file); keep its extension, or write a .md, .txt or .csv file instead`, 'binary')
    }
    if (tr.exists && tr.rel === fr.rel) {
      // the same entry: a case-only / Unicode-form rename on a case-insensitive volume, or nothing to do
      const typed = toInput.normalize('NFC').split('/').filter((s) => s && s !== '.').pop() ?? ''
      const current = fr.segs[fr.segs.length - 1]!
      if (typed === '' || typed === current.normalize('NFC')) return { from: fr.rel, to: tr.rel, type: isDir ? 'folder' : 'file', replacedVersionId: null }
      const target = [...fr.segs.slice(0, -1), typed]
      verifyChain(this.fx.root, fr.segs)
      fs.renameSync(fr.abs, path.join(this.fx.root, ...target))
      this.moved(fr.rel, target.join('/'))
      return { from: fr.rel, to: target.join('/'), type: isDir ? 'folder' : 'file', replacedVersionId: null }
    }
    if (isDir && isUnder(fr.rel, tr.rel)) throw new ToolError(`a folder cannot be moved into itself ('${tr.rel}')`, 'invalid')
    if (tr.exists && tr.st!.isDirectory()) {
      throw new ToolError(`'${tr.rel}' is an existing folder; give the full new path including the name, e.g. '${tr.rel}/${fr.segs[fr.segs.length - 1]}'`, 'exists')
    }
    this.assertNotProtected(tr.segs, 'replaced')
    if (tr.exists) {
      if (isDir) throw new ToolError(`'${tr.rel}' already exists`, 'exists')
      if (!o.overwrite) throw new ToolError(`'${tr.rel}' already exists. Pick another name, or pass overwrite: true to replace it (the replaced file is kept on the hub)`, 'exists')
    }
    const replacedVersionId = renameChecked(this.fx.root, fr.segs, tr.segs, tr.exists, tr.exists ? { db: this.ctx.db, userId: this.user.id, reason: 'move' } : undefined)
    this.moved(fr.rel, tr.rel)
    return { from: fr.rel, to: tr.rel, type: isDir ? 'folder' : 'file', replacedVersionId }
  }

  // ---------------- delete ----------------
  remove(input: string): DeleteResult {
    const rules = this.rules()
    const r = this.existingForWrite(rules, input)
    this.assertNotProtected(r.segs, 'deleted')
    if (!r.st!.isDirectory()) {
      const t = moveToTrash(this.ctx.db, this.fx.root, r.segs, this.user.id)
      dropChange(this.ctx.db, r.rel)
      officeCache(this.ctx).forget(r.rel)
      return { path: r.rel, type: 'file', versionId: t.id, storedAs: t.storedAs }
    }
    // emptiness first: a folder holding something the person cannot see answers just "not empty"
    const names = fs.readdirSync(r.abs).filter((n) => n !== '.DS_Store')
    if (names.length) throw new ToolError(`the folder '${r.rel}' is not empty; delete or move the files inside it first`, 'not_empty')
    if (rules.isRuleFolder(r.segs) && !this.isAdmin()) {
      throw new ToolError(`'${r.rel}' has its own folder permissions, so only an admin can delete it`, 'rule_folder')
    }
    verifyChain(this.fx.root, r.segs)
    fs.rmSync(path.join(r.abs, '.DS_Store'), { force: true })
    fs.rmdirSync(r.abs)
    officeCache(this.ctx).forget(r.rel)
    return { path: r.rel, type: 'folder', versionId: null, storedAs: null }
  }

  /** A file or folder was renamed or moved: its "who changed it" rows and its cached text go along. */
  private moved(from: string, to: string) {
    moveChange(this.ctx.db, from, to)
    officeCache(this.ctx).move(from, to)
  }

  // ---------------- upload (the /files page; src/files/upload.ts receives the bytes) ----------------
  /**
   * First look at an upload target, before any byte is received: the person must be able to write there, the name must
   * be one the store accepts, and an existing file is replaced only with `overwrite`. A hidden folder answers like a
   * missing one. Missing folders on the way are created when the file is placed.
   */
  planUpload(input: string, overwrite: boolean): { rel: string; exists: boolean } {
    const r = this.uploadTarget(input, overwrite)
    return { rel: r.rel, exists: r.exists }
  }

  private uploadTarget(input: string, overwrite: boolean): Authorized {
    const r = authorize(this.fx, this.rules(), this.user, input, 'write', { createDirs: true })
    if (r.segs.length === 0) throw new ToolError('a file needs a name', 'invalid')
    this.assertNotProtected(r.segs, 'replaced')
    if (r.exists) {
      if (r.st!.isDirectory()) throw new ToolError(`'${r.rel}' is a folder`, 'is_folder')
      if (!overwrite) throw new ToolError(`'${r.rel}' already exists`, 'exists')
    }
    return r
  }

  /**
   * Put a received file (staged on the hub's disk, `sha256` of its bytes) at `input`. Everything is checked again
   * here (the rules may have changed while the bytes came in). A file already there is kept as an earlier version
   * (90 days, like an overwrite through write_file); the same content again changes nothing.
   */
  commitUpload(input: string, staged: { abs: string; size: number; sha256: string }, o: { overwrite: boolean }): WriteResult {
    const r = this.uploadTarget(input, o.overwrite)
    if (r.exists && r.st!.size === staged.size && hashRegular(r.abs).sha256 === staged.sha256) {
      return { path: r.rel, created: false, changed: false, size: staged.size, versionId: null }
    }
    const versionId = placeFile(this.fx.root, r.segs, staged.abs, r.exists ? { db: this.ctx.db, userId: this.user.id, reason: 'overwrite' } : undefined)
    this.changed(r.rel, true)
    return { path: r.rel, created: !r.exists, changed: true, size: staged.size, versionId }
  }

  // ---------------- download ----------------
  /** Open a file for download: a regular, singly linked file, never a link. The caller closes `fd`. */
  openDownload(input: string): { rel: string; name: string; fd: number; size: number; mtimeMs: number } {
    const r = authorize(this.fx, this.rules(), this.user, input, 'read')
    if (r.st!.isDirectory()) throw new ToolError(`'${r.rel}' is a folder`, 'is_folder')
    const { fd, st } = openChecked(r.abs)
    return { rel: r.rel, name: r.segs[r.segs.length - 1]!, fd, size: st.size, mtimeMs: st.mtimeMs }
  }

  /** One entry the person can see (file or folder), for the manage page; null when it is not visible. */
  entry(input: string): ListEntry | null {
    const rules = this.rules()
    let r: Authorized
    try { r = authorize(this.fx, rules, this.user, input, 'list') } catch { return null }
    if (r.segs.length === 0) return null
    return this.visibleEntry(rules, r.segs, { isSymbolicLink: () => false } as fs.Dirent)
  }

  /**
   * Folders the person may write in (where something can be moved to), as team-folder paths ('' = the top level, for
   * admins), by a bounded walk from the top: shallow first, at most `limit` of them.
   */
  writableFolders(limit = 300, maxDepth = 4): string[] {
    const rules = this.rules()
    const out: string[] = []
    if (atLeast(rules.access(this.user, []), 'write')) out.push('')
    let level: string[][] = [[]]
    for (let depth = 1; depth <= maxDepth && level.length && out.length < limit; depth++) {
      const next: string[][] = []
      for (const parent of level) {
        let names: fs.Dirent[]
        try { names = fs.readdirSync(path.join(this.fx.root, ...parent), { withFileTypes: true }) } catch { continue }
        names.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
        for (const e of names) {
          if (out.length >= limit) return out
          const child = [...parent, e.name]
          const entry = this.visibleEntry(rules, child, e)
          if (!entry || entry.type !== 'folder') continue
          if (!entry.readOnly) out.push(entry.path)
          next.push(child)
        }
      }
      level = next
    }
    return out
  }

  // ---------------- skills ----------------
  /** The skills this person may use (they can read the skill's folder). */
  skills(): Skill[] { return skillsFor(this.fx.root, this.rules(), this.user) }

  /** A skill's SKILL.md and file list; records a skill_events row (source 'mcp'). */
  readSkill(name: string): SkillResult {
    const rules = this.rules()
    const all = skillsFor(this.fx.root, rules, this.user)
    const skill = pickSkill(all, name)
    const md = authorize(this.fx, rules, this.user, `${skill.path}/SKILL.md`, 'read')
    const { bytes } = readRegular(md.abs, SKILL_MD_MAX, 'SKILL.md is too large')
    const files = skillFiles(this.fx.root, skill)
      .map((f) => `${skill.path}/${f.rel}`)
      .filter((p) => !p.endsWith('/SKILL.md') && this.visible(rules, p))
    this.ctx.db.query('INSERT INTO skill_events (user_id, skill, source, at) VALUES (?, ?, ?, ?)').run(this.user.id, skill.name, 'mcp', nowIso())
    return { name: skill.name, pack: skill.pack, path: skill.path, description: skill.description, text: decodeText(bytes).text, files }
  }

  private visible(rules: RuleSet, rel: string) {
    try { authorize(this.fx, rules, this.user, rel, 'read'); return true } catch { return false }
  }
}

function count(text: string, needle: string): number {
  let n = 0
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) n++
  return n
}
const spliceOnce = (text: string, from: string, to: string) => { const i = text.indexOf(from); return text.slice(0, i) + to + text.slice(i + from.length) }

/** Find a skill by name, folder name, "company:<name>" (the plugin's command form) or path. */
function pickSkill(all: Skill[], input: string): Skill {
  const raw = input.trim().replace(/^\/+/, '')
  const q = raw.replace(/^company:/i, '').replace(/\/SKILL\.md$/i, '').replace(/\/+$/, '')
  const fold = (s: string) => s.normalize('NFC').toLowerCase()
  const tries: ((s: Skill) => boolean)[] = [
    (s) => s.path === q || `${s.pack}/${s.dir}` === q,
    (s) => s.name === q,
    (s) => s.dir === q,
    (s) => fold(s.name) === fold(q) || fold(s.dir) === fold(q) || fold(s.path) === fold(q),
  ]
  for (const t of tries) {
    const found = all.filter(t)
    if (found.length === 1) return found[0]!
    if (found.length > 1) throw new ToolError(`several skills are called '${input}': ${found.map((s) => s.path).join(', ')}; pass the path instead`, 'ambiguous')
  }
  const names = all.slice(0, 40).map((s) => s.name).join(', ')
  throw new ToolError(all.length ? `no skill called '${input}' is available to you. Available skills: ${names}${all.length > 40 ? ', …' : ''}` : `no skill called '${input}' is available to you (you have no company skills yet)`, 'not_found')
}
