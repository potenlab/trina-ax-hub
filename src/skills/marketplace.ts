// The skills marketplace: one Claude Code plugin per person, named "company", holding every skill they may read.
//
//   GET /plugins/marketplace.json            { name: 'trina-ax', owner, plugins: [{ name: 'company', source: archive }] }
//   GET /plugins/company-<sha12>.zip         .claude-plugin/plugin.json, README.md, skills/<dir>/SKILL.md + files
//
// No `version` anywhere: Claude Code then uses the archive's sha256 as the version, so a changed zip is an update.
// The zip is deterministic (src/skills/zip.ts), so unchanged skills keep the same sha and nothing is re-downloaded.
//
// Building is cheap to skip: a person's plan (which files go where, with their size/mtime/mode) is hashed into a key;
// a cached build for that key is reused. People with the same skills share one cached zip. The cache is dropped
// whenever the skills folder or the rules change (ctx.events 'skills').
import fs from 'node:fs'
import type { Ctx } from '../context'
import type { Config } from '../config'
import { hubUrl } from '../config'
import { getSetting } from '../db'
import { sha256 } from '../ids'
import { atLeast, type Principal } from '../policy/access'
import { PRODUCT } from '../product'
import { skillFiles, skillsFor } from './catalog'
import { deterministicZip, safeZipPath, type ZipEntry } from './zip'

export const PLUGIN_NAME = 'company'
/** what goes into enabledPlugins and `claude plugin install` */
export const PLUGIN_ID = `${PLUGIN_NAME}@${PRODUCT.marketplaceName}`
/** Claude Code refuses archives over 256 MiB; stay well below */
const MAX_PLUGIN_BYTES = 200 * 1024 * 1024
/** memory held by cached zips */
const CACHE_MAX_BYTES = 256 * 1024 * 1024
const ARCHIVE_FILE = /^company-([0-9a-f]{12})\.zip$/

export interface PackagedSkill {
  pack: string
  /** folder name on the hub */
  dir: string
  /** folder name inside the plugin (differs from `dir` when two packs use the same name) */
  pluginDir: string
  /** the skill's name inside the plugin (front matter `name`, made unique) */
  name: string
  description: string
  /** team-folder path, e.g. skills/company/quote */
  path: string
}

export interface PluginBuild {
  /** sha256 of the zip bytes (64 hex) */
  sha256: string
  sha12: string
  zip: Uint8Array
  skills: PackagedSkill[]
  /** team-folder paths left out (over the size limit, unreadable) */
  skipped: string[]
}

export interface MarketplaceJson {
  name: string
  owner: { name: string }
  description: string
  plugins: { name: string; description: string; source: { source: 'archive'; url: string; sha256: string } }[]
}

// ---------------------------------------------------------------------------------------------------------------
// URLs

/** Where PCs reach this hub: the configured public or LAN address, else the address this request came in on (a PC
 *  that fetched the installer from http://192.168.1.17:47900 must not be told 127.0.0.1). */
export function hubBase(config: Config, requestUrl?: string): string {
  if (config.publicUrl || config.lanUrl || !requestUrl) return hubUrl(config)
  try { return new URL(requestUrl).origin } catch { return hubUrl(config) }
}

// Claude Code only sends the marketplace's auth header to archive URLs on the same origin as the marketplace.json,
// so both are always built from the same base.
export const marketplaceUrl = (base: string) => `${base}/plugins/marketplace.json`
export const archiveUrl = (base: string, sha: string) => `${base}/plugins/company-${sha.slice(0, 12)}.zip`

/** sha12 from an archive file name, or null when the name is not one of ours */
export function archiveSha12(file: string): string | null {
  return ARCHIVE_FILE.exec(file)?.[1] ?? null
}

/** Why PCs cannot install skills from this hub yet (Korean, for the personal page and the installer), or null when
 *  they can. Claude Code only downloads plugin archives over https from a non-loopback, non-link-local host. */
export function skillsUnavailableReason(config: Config): string | null {
  const u = config.publicUrl
  if (!u) return '허브에 공개 주소(https)가 아직 없어서 회사 스킬은 설치되지 않아요. 관리자에게 공개 주소 설정을 부탁해 주세요. 회사 파일은 지금도 쓸 수 있어요.'
  let url: URL
  try { url = new URL(u) } catch { return '허브의 공개 주소가 올바르지 않아서 회사 스킬을 설치할 수 없어요. 관리자에게 알려 주세요.' }
  if (url.protocol !== 'https:') return '허브의 공개 주소가 https가 아니라서 회사 스킬을 설치할 수 없어요. 관리자에게 알려 주세요.'
  if (loopbackOrLinkLocal(url.hostname)) return '허브의 공개 주소가 이 컴퓨터 안 주소라서 회사 스킬을 설치할 수 없어요. 관리자에게 알려 주세요.'
  return null
}

function loopbackOrLinkLocal(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h) || /^169\.254\./.test(h) ||
    /^fe[89ab][0-9a-f]:/.test(h) || h === '0.0.0.0' || /^::ffff:127\./.test(h)
}

export function companyName(ctx: Ctx): string {
  const v = getSetting<unknown>(ctx.db, 'companyName', '')
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : PRODUCT.displayName
}

// ---------------------------------------------------------------------------------------------------------------
// Plan: what goes into a person's zip (metadata only, no file contents)

interface PlannedFile { zipPath: string; abs: string; size: number; mtimeMs: number; executable: boolean; renameTo?: string }
interface Plan { key: string; files: PlannedFile[]; generated: ZipEntry[]; skills: PackagedSkill[]; skipped: string[] }

function plan(ctx: Ctx, user: Principal): Plan {
  const root = ctx.fx.root
  const rules = ctx.rules()
  const company = companyName(ctx)
  const usedDirs = new Set<string>()
  const usedNames = new Set<string>()
  const files: PlannedFile[] = []
  const skills: PackagedSkill[] = []
  const skipped: string[] = []
  let total = 0

  for (const skill of skillsFor(root, rules, user)) {
    let list: { rel: string; abs: string }[]
    try { list = skillFiles(root, skill) } catch { skipped.push(skill.path); continue }
    const skillSegs = skill.path.split('/')
    const picked: PlannedFile[] = []
    const seen = new Set<string>()
    let bytes = 0
    for (const f of list) {
      // a sub-folder of a skill may carry a stricter rule than the skill itself
      if (!atLeast(rules.access(user, [...skillSegs, ...f.rel.split('/')]), 'read')) continue
      let st: fs.Stats
      try { st = fs.statSync(f.abs) } catch { continue }
      if (!st.isFile()) continue
      const rel = f.rel.normalize('NFC') // macOS may hand out decomposed Hangul; keep names portable
      if (seen.has(rel)) continue
      seen.add(rel)
      picked.push({ zipPath: rel, abs: f.abs, size: st.size, mtimeMs: st.mtimeMs, executable: (st.mode & 0o111) !== 0 })
      bytes += st.size
    }
    if (!picked.some((f) => f.zipPath === 'SKILL.md')) { skipped.push(skill.path); continue }
    if (total + bytes > MAX_PLUGIN_BYTES) {
      ctx.log.warn('skill left out of plugin: size limit', { skill: skill.path, bytes })
      skipped.push(skill.path)
      continue
    }
    total += bytes

    const pack = skill.pack.normalize('NFC')
    const pluginDir = unique(skill.dir.normalize('NFC'), pack, usedDirs)
    const fmName = frontMatterName(picked.find((f) => f.zipPath === 'SKILL.md')!.abs)
    // Claude Code names a skill by its front matter `name`, else by its folder
    const original = fmName ?? pluginDir
    const name = unique(original, pack, usedNames)
    const renameTo = name !== original ? name : undefined
    for (const f of picked) {
      const zipPath = `skills/${pluginDir}/${f.zipPath}`
      if (!safeZipPath(zipPath)) continue
      files.push({ ...f, zipPath, renameTo: f.zipPath === 'SKILL.md' ? renameTo : undefined })
    }
    skills.push({ pack: skill.pack, dir: skill.dir, pluginDir, name, description: skill.description, path: skill.path })
  }

  const manifest = { name: PLUGIN_NAME, description: pluginDescription(company, skills.length), author: { name: company } }
  const generated: ZipEntry[] = [
    { path: '.claude-plugin/plugin.json', data: utf8(JSON.stringify(manifest, null, 2) + '\n') },
    { path: 'README.md', data: utf8(readme(company, skills)) },
  ]
  const key = sha256(JSON.stringify({
    v: 1,
    generated: generated.map((g) => [g.path, sha256(g.data)]),
    files: files.map((f) => [f.zipPath, f.abs, f.size, f.mtimeMs, f.executable, f.renameTo ?? null]),
  }))
  return { key, files, generated, skills, skipped }
}

/** `name`, then `<pack>-name`, then `<pack>-name-2`, … (case-insensitive, since file systems often are) */
function unique(name: string, pack: string, used: Set<string>): string {
  const free = (n: string) => !used.has(n.toLowerCase())
  let out = name
  if (!free(out)) out = `${pack}-${name}`
  for (let i = 2; !free(out); i++) out = `${pack}-${name}-${i}`
  used.add(out.toLowerCase())
  return out
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function frontMatterName(abs: string): string | null {
  let text: string
  try { text = fs.readFileSync(abs, 'utf8') } catch { return null }
  const fm = FRONT_MATTER.exec(text)
  if (!fm) return null
  const line = fm[1]!.split(/\r?\n/).find((l) => /^name:\s*\S/.test(l))
  if (!line) return null
  let v = line.replace(/^name:\s*/, '').trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  return v || null
}

/** Give a SKILL.md a new front matter `name` (only used when two skills would otherwise share a name). */
export function renameSkill(text: string, name: string): string {
  const quoted = JSON.stringify(name) // a JSON string is a valid YAML double-quoted scalar
  const fm = FRONT_MATTER.exec(text)
  if (!fm) return `---\nname: ${quoted}\n---\n${text}`
  const nl = fm[0].includes('\r\n') ? '\r\n' : '\n'
  const lines = fm[1]!.split(/\r?\n/)
  const i = lines.findIndex((l) => /^name:/.test(l))
  if (i >= 0) lines[i] = `name: ${quoted}`
  else lines.unshift(`name: ${quoted}`)
  return `---${nl}${lines.join(nl)}${nl}---${nl}` + text.slice(fm[0].length)
}

function readme(company: string, skills: PackagedSkill[]): string {
  const lines = [
    `# ${company} 회사 스킬`,
    '',
    '이 플러그인은 회사 허브(Trina AX)가 만들어요. 여기서 고치면 다음 업데이트 때 사라지니,',
    '스킬을 바꾸려면 회사 폴더의 `skills/` 아래 원본을 고쳐 주세요.',
    '',
  ]
  if (!skills.length) lines.push('지금은 쓸 수 있는 스킬이 없어요.')
  for (const s of skills) lines.push(`- **${s.name}** — ${s.description} (\`${s.path}\`)`)
  return lines.join('\n') + '\n'
}

const pluginDescription = (company: string, n: number) =>
  n ? `${company} 회사 스킬 ${n}개 (Trina AX 허브가 관리해요)` : `${company} 회사 스킬 (아직 쓸 수 있는 스킬이 없어요)`

const utf8 = (s: string) => new TextEncoder().encode(s)

// ---------------------------------------------------------------------------------------------------------------
// Build + cache

class BuildCache {
  private map = new Map<string, PluginBuild>()
  private bytes = 0
  get(key: string): PluginBuild | undefined {
    const b = this.map.get(key)
    if (b) { this.map.delete(key); this.map.set(key, b) } // most recently used last
    return b
  }
  set(key: string, b: PluginBuild) {
    if (b.zip.length > CACHE_MAX_BYTES) return
    const old = this.map.get(key)
    if (old) { this.bytes -= old.zip.length; this.map.delete(key) }
    this.map.set(key, b)
    this.bytes += b.zip.length
    for (const [k, v] of this.map) {
      if (this.bytes <= CACHE_MAX_BYTES) break
      this.map.delete(k)
      this.bytes -= v.zip.length
    }
  }
  clear() { this.map.clear(); this.bytes = 0 }
  get size() { return this.map.size }
}

const caches = new WeakMap<Ctx, BuildCache>()
function cacheFor(ctx: Ctx): BuildCache {
  let c = caches.get(ctx)
  if (!c) {
    const cache = new BuildCache()
    ctx.events.on('skills', () => cache.clear())
    caches.set(ctx, cache)
    c = cache
  }
  return c
}

/** The person's plugin as it should be right now (cached by content). */
export function pluginFor(ctx: Ctx, user: Principal): PluginBuild {
  const p = plan(ctx, user)
  const cache = cacheFor(ctx)
  const hit = cache.get(p.key)
  if (hit) return hit
  const entries: ZipEntry[] = [...p.generated]
  let complete = true
  for (const f of p.files) {
    let data: Uint8Array
    try { data = fs.readFileSync(f.abs) } catch { complete = false; continue }
    if (f.renameTo !== undefined) data = utf8(renameSkill(new TextDecoder().decode(data), f.renameTo))
    entries.push({ path: f.zipPath, data, executable: f.executable })
  }
  const zip = deterministicZip(entries)
  const sha = sha256(zip)
  const build: PluginBuild = { sha256: sha, sha12: sha.slice(0, 12), zip, skills: p.skills, skipped: p.skipped }
  // a file vanished between planning and reading: serve this build but do not remember it under the plan's key
  if (complete) cache.set(p.key, build)
  return build
}

/** marketplace.json for this person (and the build it points at). `base` = hubBase(). */
export function marketplaceFor(ctx: Ctx, user: Principal, base: string): { json: MarketplaceJson; build: PluginBuild } {
  const build = pluginFor(ctx, user)
  const company = companyName(ctx)
  return {
    build,
    json: {
      name: PRODUCT.marketplaceName,
      owner: { name: company },
      description: `${company} 회사 스킬 마켓플레이스 (Trina AX)`,
      plugins: [{
        name: PLUGIN_NAME,
        description: pluginDescription(company, build.skills.length),
        source: { source: 'archive', url: archiveUrl(base, build.sha256), sha256: build.sha256 },
      }],
    },
  }
}

/** number of cached builds (tests, diagnostics) */
export const cachedBuilds = (ctx: Ctx) => cacheFor(ctx).size
