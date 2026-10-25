// One .zip per company skill, for Claude's admin console: Organization settings › Plugins & skills › Add › Upload a skill.
// Claude gives an uploaded skill to every member at once, so only skills every member may read are offered here (the
// same "everyone" principal as the org marketplace). A zip holds the skill's folder (SKILL.md and its files) as its only
// top-level folder. An uploaded skill is a copy: it does not follow later changes in the team folder.
import fs from 'node:fs'
import type { Ctx } from '../context'
import { atLeast } from '../policy/access'
import { skillFiles, skillsFor } from '../skills/catalog'
import { EVERYONE } from '../skills/marketplace'
import { deterministicZip, safeZipPath, type ZipEntry } from '../skills/zip'

export interface OrgSkill {
  pack: string
  /** folder name on the hub, also the folder inside the zip */
  dir: string
  name: string
  description: string
  /** team-folder path, e.g. skills/company/quote */
  path: string
  files: number
  bytes: number
  /** folder name is ASCII lower case, digits and hyphens (what Claude's skill format asks for) */
  portable: boolean
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface Picked { rel: string; abs: string; size: number; executable: boolean }

/** The files of a skill that every member may read (a sub-folder can carry a stricter rule than the skill itself). */
function pickFiles(ctx: Ctx, skill: Found): Picked[] | null {
  const root = ctx.fx.root
  const rules = ctx.rules()
  let list: { rel: string; abs: string }[]
  try { list = skillFiles(root, skill) } catch { return null }
  const segs = skill.path.split('/')
  const out: Picked[] = []
  const seen = new Set<string>()
  for (const f of list) {
    if (!atLeast(rules.access(EVERYONE, [...segs, ...f.rel.split('/')]), 'read')) continue
    let st: fs.Stats
    try { st = fs.statSync(f.abs) } catch { continue }
    if (!st.isFile()) continue
    const rel = f.rel.normalize('NFC')
    if (seen.has(rel)) continue
    seen.add(rel)
    out.push({ rel, abs: f.abs, size: st.size, executable: (st.mode & 0o111) !== 0 })
  }
  return out.some((f) => f.rel === 'SKILL.md') ? out : null
}

type Found = { pack: string; dir: string; name: string; description: string; path: string }

const describe = (s: Found, files: Picked[]): OrgSkill => ({
  pack: s.pack, dir: s.dir, name: s.name, description: s.description, path: s.path,
  files: files.length, bytes: files.reduce((n, f) => n + f.size, 0),
  portable: KEBAB.test(s.dir) && s.dir.length <= 64,
})

/** Skills every member may use, with their size. */
export function orgSkills(ctx: Ctx): OrgSkill[] {
  const out: OrgSkill[] = []
  for (const s of skillsFor(ctx.fx.root, ctx.rules(), EVERYONE)) {
    const files = pickFiles(ctx, s)
    if (files) out.push(describe(s, files))
  }
  return out
}

/** The zip for one skill (by its team-folder path), or null when every member may not use it or it has no SKILL.md. */
export function orgSkillZip(ctx: Ctx, skillPath: string): { skill: OrgSkill; zip: Uint8Array } | null {
  const skill = skillsFor(ctx.fx.root, ctx.rules(), EVERYONE).find((s) => s.path === skillPath)
  if (!skill) return null
  const files = pickFiles(ctx, skill)
  if (!files) return null
  const entries: ZipEntry[] = []
  for (const f of files) {
    const zipPath = `${skill.dir.normalize('NFC')}/${f.rel}`
    if (!safeZipPath(zipPath)) continue
    let data: Uint8Array
    try { data = fs.readFileSync(f.abs) } catch { continue }
    entries.push({ path: zipPath, data, executable: f.executable })
  }
  return { skill: describe(skill, files), zip: deterministicZip(entries) }
}
