// search_files on ripgrep (ported from Team AX server/src/files/search.ts). The permission rules decide the allowed
// roots first; ripgrep only receives those roots as positional paths, and every hidden folder inside them as
// `--glob '!<path>'`, so folders the person cannot see are never opened. Every result path is checked again
// (visiblePath: access, name rules, regular file, a single link) before it is shown.
// Office documents (docx, pdf, hwp, ...) are searched through their extracted text, cached server-side under
// <dataDir>/textcache/<path>.txt and kept fresh by mtime. Extraction runs in isolated converter processes
// (extract.ts: pandoc, pdftotext, the office worker), never on the hub's thread, and a search waits for it only up
// to a time limit; what is left is indexed in the background.
import fs from 'node:fs'
import path from 'node:path'
import { atLeast, type Principal, type RuleSet } from '../policy/access'
import { visiblePath, type FsCtx } from '../policy/authorize'
import { ToolError } from '../policy/errors'
import { matchingPaths, walk } from '../policy/resolve'
import { badSegment, hiddenEntry } from '../policy/names'
import { PRODUCT } from '../product'
import { extractText, isOffice, OFFICE_EXT, type Converters } from './extract'
import { readRegular } from './store'

export const RG_BASE = ['--no-config', '--no-ignore', '--hidden', '--no-follow', '--one-file-system', '--max-filesize', '50M',
  '--regex-size-limit', '20M', '--dfa-size-limit', '50M', '--max-columns', '2000', '--max-columns-preview', '--no-messages']
const OFFICE_GLOB = `*.{${OFFICE_EXT.join(',')}}`
const SEARCH_TIMEOUT_MS = 30_000

const under = (anc: readonly string[], p: readonly string[]) => p.length > anc.length && anc.every((s, i) => s === p[i])
const joinRel = (s: readonly string[]) => (s.length ? s.join('/') : '.')
const strip = (p: string) => p.replace(/^\.\//, '')

/** Allowed search roots under `base` for this person, plus the folders inside them that must be skipped. */
export function allowedRoots(fx: FsCtx, rules: RuleSet, user: Principal, base: string[]): { roots: string[]; excludes: string[] } {
  const acc = (s: string[]) => atLeast(rules.access(user, s), 'read')
  // access can only change at a rule folder, at users/<x>, or at the system folder: collect those under base.
  // Rules match names on a canonical key (NFC, case on a case-insensitive disk), so a rule folder is found on disk
  // in whatever spelling it has there (ripgrep needs the actual names).
  const pts = new Map<string, string[]>()
  const add = (s: string[]) => { if (under(base, s)) pts.set(s.join('/'), s) }
  const baseKey = rules.key(base)
  for (const f of rules.ruleFolders()) {
    if (f === '') continue
    const segs = f.split('/')
    if (segs.length <= base.length || (baseKey !== '' && !rules.key(segs).startsWith(baseKey + '/'))) continue
    for (const actual of matchingPaths(fx.root, segs, fx.caseInsensitive)) add(actual)
  }
  add(['users', user.id])
  add([PRODUCT.systemDir])
  try { for (const n of fs.readdirSync(path.join(fx.root, 'users'))) add(['users', n]) } catch {}
  const sorted = [...pts.values()].sort((a, b) => a.length - b.length)
  const nearest = (p: string[]) => { let best = base; for (const q of sorted) if (under(q, p) && q.length > best.length) best = q; return best }
  const exists = (s: string[]) => { const w = walk(fx.root, s, false); return !w.problem && w.missing.length === 0 && w.actual.every((n, i) => n === s[i]) }
  const roots: string[] = []
  const excludes: string[] = []
  if (acc(base) && exists(base)) roots.push(joinRel(base))
  for (const p of sorted) {
    const ra = acc(nearest(p)), rp = acc(p)
    if (rp && !ra && exists(p)) roots.push(joinRel(p))
    if (!rp && ra) excludes.push(p.join('/'))
  }
  return { roots, excludes }
}

/** escape glob metacharacters in a literal path (names never contain backslashes) */
export const globEscape = (s: string) => s.replace(/[*?[\]{}!]/g, (c) => '\\' + c)
/** slash-containing globs are anchored at ripgrep's working directory (the team root) */
export const excludeArgs = (excludes: string[]) => excludes.flatMap((x) => ['--glob', '!' + globEscape(x), '--glob', '!' + globEscape(x) + '/**'])

interface RgResult { code: number | null; killed: null | 'cap' | 'timeout'; err: string }

/** Run rg; `onRecord` gets each NUL- or newline-terminated record and returns false to stop (result cap). */
export async function runRg(rg: string, args: string[], cwd: string, sep: '\n' | '\0', onRecord: (r: string) => boolean | void, timeoutMs = SEARCH_TIMEOUT_MS): Promise<RgResult> {
  const p = Bun.spawn([rg, ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/bin:/bin' } })
  let killed: RgResult['killed'] = null
  const t = setTimeout(() => { killed = 'timeout'; p.kill('SIGKILL') }, timeoutMs)
  const errP = new Response(p.stderr).text().catch(() => '')
  const dec = new TextDecoder()
  let buf = ''
  try {
    outer: for await (const chunk of p.stdout) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf(sep)) >= 0) {
        const rec = buf.slice(0, i); buf = buf.slice(i + 1)
        if (rec && onRecord(rec) === false) { killed = 'cap'; p.kill('SIGKILL'); break outer }
      }
    }
  } catch { /* closed by the kill */ }
  if (!killed && buf) onRecord(buf)
  const code = await p.exited
  clearTimeout(t)
  return { code, killed, err: (await errP).slice(0, 2000) }
}

// ---------------- office text cache ----------------
/** Extracted text of office documents, mirrored under <dataDir>/textcache/<path>.txt (server-only, 0700). */
export class OfficeCache {
  private inflight = new Map<string, Promise<void>>()
  constructor(readonly dir: string, private fx: FsCtx, private tools: Converters) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }) }
  cachePath(rel: string) { return path.join(this.dir, rel + '.txt') }
  fresh(rel: string, st: fs.Stats) {
    try { return Math.floor(fs.statSync(this.cachePath(rel)).mtimeMs) === Math.floor(st.mtimeMs) } catch { return false }
  }
  /** (re)extract one file; the content is read through the checked descriptor */
  update(rel: string): Promise<void> {
    const running = this.inflight.get(rel)
    if (running) return running
    const job = (async () => {
      const { bytes, st } = readRegular(path.join(this.fx.root, ...rel.split('/')), 50 * 1024 * 1024)
      let text: string
      try { text = await extractText(rel, bytes, this.tools) } catch { text = '' }
      const dst = this.cachePath(rel)
      fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 })
      fs.writeFileSync(dst, text, { mode: 0o600 })
      fs.utimesSync(dst, st.atime, st.mtime)
    })().finally(() => this.inflight.delete(rel))
    this.inflight.set(rel, job)
    return job
  }
  /**
   * Extract stale office files under the roots: up to `budget` of them now (4 at a time, waiting at most `waitMs`),
   * the rest in the background. `pending` = stale files not indexed yet when it returns.
   */
  async refresh(rg: string, roots: string[], excludes: string[], filter: (rel: string) => fs.Stats | null, budget = 40, waitMs = 15_000): Promise<{ pending: number }> {
    if (!roots.length) return { pending: 0 }
    const stale: string[] = []
    await runRg(rg, ['--files', '--null', ...RG_BASE, '--glob-case-insensitive', '--glob', OFFICE_GLOB, ...excludeArgs(excludes), '--', ...roots], this.fx.root, '\0', (r) => {
      const rel = strip(r)
      if (!isOffice(rel)) return
      const st = filter(rel)
      if (st && !this.fresh(rel, st)) stale.push(rel)
    }, 60_000)
    const deadline = Date.now() + waitMs
    let done = 0
    let next = 0
    const limit = Math.min(budget, stale.length)
    while (next < limit && Date.now() < deadline) {
      const end = Math.min(next + 4, limit)
      const batch = stale.slice(next, end).map((r) => this.update(r).catch(() => {}).then(() => { done++ }))
      next = end
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([Promise.all(batch), new Promise<void>((res) => { timer = setTimeout(res, Math.max(0, deadline - Date.now())) })])
      clearTimeout(timer)
    }
    const later = stale.slice(next)
    if (later.length) void (async () => { for (const r of later) await this.update(r).catch(() => {}) })()
    return { pending: stale.length - done }
  }
}

export interface SearchDeps { fx: FsCtx; rules: RuleSet; user: Principal; rg: string; office: OfficeCache | null; timeoutMs?: number }

function rootsFor(d: SearchDeps, baseSegs: string[], baseIsFile: boolean) {
  if (baseIsFile) return { roots: visiblePath(d.fx, d.rules, d.user, baseSegs.join('/')) ? [baseSegs.join('/')] : [], excludes: [] }
  return allowedRoots(d.fx, d.rules, d.user, baseSegs)
}

/** A user glob: no '/' = matched against the file name, with '/' = against the path below the search folder. */
export function globMatcher(glob: string | undefined, baseSegs: string[], caseInsensitive: boolean): ((rel: string) => boolean) | null {
  if (!glob) return null
  if (glob.startsWith('!')) throw new ToolError('negated globs are not supported')
  const fold = (s: string) => (caseInsensitive ? s.normalize('NFC').toLowerCase() : s.normalize('NFC'))
  let g: Bun.Glob
  try { g = new Bun.Glob(fold(glob)) } catch { throw new ToolError('invalid glob') }
  const prefix = baseSegs.length ? baseSegs.join('/') + '/' : ''
  if (!glob.includes('/')) return (rel) => g.match(fold(rel.slice(rel.lastIndexOf('/') + 1)))
  return (rel) => g.match(fold(rel.startsWith(prefix) ? rel.slice(prefix.length) : rel)) || g.match(fold(rel))
}

// ---------------- content search ----------------
export interface ContentHit { path: string; line: number; text: string }
export interface ContentResult { hits: ContentHit[]; files: number; truncated: boolean; timedOut: boolean; officePending: number; literal: boolean }

const LINE_PREVIEW = 300

export async function searchContent(d: SearchDeps, baseSegs: string[], baseIsFile: boolean, o: { query: string; glob?: string; limit: number }): Promise<ContentResult> {
  const { roots, excludes } = rootsFor(d, baseSegs, baseIsFile)
  const res: ContentResult = { hits: [], files: 0, truncated: false, timedOut: false, officePending: 0, literal: false }
  if (!roots.length) return res
  const match = globMatcher(o.glob, baseSegs, true)
  const seen = new Map<string, boolean>()
  const files = new Set<string>()
  const ok = (rel: string) => {
    let v = seen.get(rel)
    if (v === undefined) {
      v = !!visiblePath(d.fx, d.rules, d.user, rel) && (!match || match(rel))
      seen.set(rel, v)
    }
    return v
  }
  const onRecord = (map: (p: string) => string | null) => (rec: string) => {
    let j: any
    try { j = JSON.parse(rec) } catch { return }
    if (j.type !== 'match') return
    const raw = j.data.path.text ?? Buffer.from(j.data.path.bytes, 'base64').toString('utf8')
    const rel = map(raw)
    if (!rel || !ok(rel)) return
    if (res.hits.length >= o.limit) { res.truncated = true; return false }
    let text: string = (j.data.lines.text ?? Buffer.from(j.data.lines.bytes ?? '', 'base64').toString('utf8')).replace(/\r?\n$/, '')
    text = text.trim()
    if (text.length > LINE_PREVIEW) text = text.slice(0, LINE_PREVIEW) + '…'
    res.hits.push({ path: rel, line: j.data.line_number, text })
    files.add(rel)
  }
  const run = async (literal: boolean) => {
    const common = [...RG_BASE, '--json', '-i', ...(literal ? ['-F'] : [])]
    // ripgrep matches globs on the bytes of the name: a Korean glob typed composed would miss names macOS wrote
    // decomposed (and the reverse), so a non-ASCII glob is left to the normalizing matcher in ok()
    const nameGlob = o.glob && !o.glob.includes('/') && /^[\x20-\x7e]*$/.test(o.glob) ? ['--glob', o.glob] : []
    // later globs win in ripgrep: the user glob first, then the exclusions
    const args = [...common, '--glob-case-insensitive', ...nameGlob, '--glob', '!' + OFFICE_GLOB, ...excludeArgs(excludes), '-e', o.query, '--', ...roots.filter((r) => !isOffice(r))]
    return runRg(d.rg, args, d.fx.root, '\n', onRecord((p) => strip(p)), d.timeoutMs)
  }
  let r = roots.some((x) => !isOffice(x)) ? await run(false) : { code: 1, killed: null, err: '' } as RgResult
  // an invalid regular expression (unbalanced "(" in a title, say): search for the text literally instead
  if (r.code === 2 && !r.killed && !res.hits.length && /regex|parse|error/i.test(r.err)) {
    res.literal = true
    r = await run(true)
  }
  if (r.killed === 'timeout') { res.timedOut = true; res.files = files.size; return res }

  // office documents: the same search over the extracted-text cache, paths mapped back to the originals
  if (!res.truncated && d.office) {
    const office = d.office
    const { pending } = await office.refresh(d.rg, roots, excludes, (rel) => visiblePath(d.fx, d.rules, d.user, rel))
    res.officePending = pending
    const croots = roots.map((x) => (isOffice(x) ? x + '.txt' : x)).filter((x) => fs.existsSync(path.join(office.dir, x)))
    if (croots.length) {
      const args = [...RG_BASE, '--json', '-i', ...(res.literal ? ['-F'] : []), '--glob', '*.txt', ...excludeArgs(excludes), '-e', o.query, '--', ...croots]
      const map = (p: string) => { const real = strip(p).replace(/\.txt$/, ''); return isOffice(real) ? real : null }
      const r2 = await runRg(d.rg, args, office.dir, '\n', onRecord(map), d.timeoutMs)
      if (r2.killed === 'timeout') res.timedOut = true
    }
  }
  res.files = files.size
  return res
}

// ---------------- name search ----------------
export interface NameHit { path: string; type: 'file' | 'folder'; size?: number; mtimeMs: number }
export interface NameResult { hits: NameHit[]; truncated: boolean; timedOut: boolean }

/** Files (and the folders on their paths) whose name contains `query` (case- and Unicode-form-insensitive). */
export async function searchNames(d: SearchDeps, baseSegs: string[], baseIsFile: boolean, o: { query: string; glob?: string; limit: number }): Promise<NameResult> {
  const { roots, excludes } = rootsFor(d, baseSegs, baseIsFile)
  const res: NameResult = { hits: [], truncated: false, timedOut: false }
  if (!roots.length) return res
  const fold = (s: string) => s.normalize('NFKC').toLowerCase()
  const q = fold(o.query.trim())
  const match = globMatcher(o.glob, baseSegs, true)
  const folders = new Set<string>()
  const all: NameHit[] = []
  const r = await runRg(d.rg, ['--files', '--null', ...RG_BASE, ...excludeArgs(excludes), '--', ...roots], d.fx.root, '\0', (rec) => {
    const rel = strip(rec)
    const segs = rel.split('/')
    // folders on the way whose own name matches (below the search folder only)
    for (let i = baseSegs.length + 1; i < segs.length; i++) {
      const f = segs.slice(0, i).join('/')
      if (folders.has(f) || !fold(segs[i - 1]!).includes(q)) continue
      folders.add(f)
      const fsegs = segs.slice(0, i)
      if (fsegs.some((s, k) => badSegment(s) !== null || hiddenEntry(s, k))) continue
      if (!match && d.rules.canList(d.user, fsegs)) {
        try { all.push({ path: f, type: 'folder', mtimeMs: fs.lstatSync(path.join(d.fx.root, ...segs.slice(0, i))).mtimeMs }) } catch {}
      }
    }
    if (!fold(segs[segs.length - 1]!).includes(q) || (match && !match(rel))) return
    const st = visiblePath(d.fx, d.rules, d.user, rel)
    if (st) all.push({ path: rel, type: 'file', size: st.size, mtimeMs: st.mtimeMs })
    if (all.length >= 20_000) return false
  }, d.timeoutMs)
  if (r.killed === 'timeout') res.timedOut = true
  if (r.killed === 'cap') res.truncated = true
  // folders first, then the most recently changed files
  all.sort((a, b) => (a.type === b.type ? b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path) : a.type === 'folder' ? -1 : 1))
  if (all.length > o.limit) res.truncated = true
  res.hits = all.slice(0, o.limit)
  return res
}
