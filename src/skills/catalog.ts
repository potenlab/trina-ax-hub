// The skill catalog: what is in the team folder's skills/ and who may use it.
//
//   skills/RULES.md                         company rules every Claude follows (MCP instructions, hub sessions)
//   skills/<pack>/                          a skill pack (folder). Who may use it = who may read the folder.
//   skills/<pack>/<skill>/SKILL.md          one skill (Claude Code skill format: YAML front matter name + description)
//   skills/<pack>/<skill>/...               files the skill uses (templates, scripts, references)
//
// A person gets one plugin ("company") holding every skill of every pack they can read, so new skills and new
// permissions reach their PC on the next marketplace update without touching their settings.
import fs from 'node:fs'
import path from 'node:path'
import type { Principal, RuleSet } from '../policy/access'
import { atLeast } from '../policy/access'
import { badSegment, hiddenEntry } from '../policy/names'

export const SKILLS_DIR = 'skills'
export const RULES_FILE = 'RULES.md'
const MAX_SKILL_FILES = 500
const MAX_SKILL_BYTES = 20 * 1024 * 1024

export interface Skill {
  /** pack folder name */
  pack: string
  /** skill folder name (also its command name) */
  dir: string
  name: string
  description: string
  /** team-folder path of the skill folder, e.g. skills/company/quote-draft */
  path: string
}

export interface FrontMatter { name?: string; description?: string; [k: string]: string | undefined }

/** Minimal YAML front matter reader: `key: value` lines between --- fences (quotes stripped). */
export function readFrontMatter(text: string): FrontMatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  const out: FrontMatter = {}
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = kv[2]!.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[kv[1]!] = v
  }
  return out
}

const okName = (n: string, depth: number) => !hiddenEntry(n, depth) && !n.startsWith('.') && badSegment(n) === null

/** Every skill on disk (no permission filter). */
export function scanSkills(root: string): Skill[] {
  const base = path.join(root, SKILLS_DIR)
  const out: Skill[] = []
  let packs: fs.Dirent[] = []
  try { packs = fs.readdirSync(base, { withFileTypes: true }) } catch { return out }
  for (const p of packs) {
    if (!p.isDirectory() || !okName(p.name, 1)) continue
    let skills: fs.Dirent[] = []
    try { skills = fs.readdirSync(path.join(base, p.name), { withFileTypes: true }) } catch { continue }
    for (const s of skills) {
      if (!s.isDirectory() || !okName(s.name, 2)) continue
      const file = path.join(base, p.name, s.name, 'SKILL.md')
      let text: string
      try {
        const st = fs.lstatSync(file)
        if (!st.isFile() || st.size > 256 * 1024) continue
        text = fs.readFileSync(file, 'utf8')
      } catch { continue }
      const fm = readFrontMatter(text)
      out.push({
        pack: p.name, dir: s.name,
        name: (fm.name || s.name).slice(0, 64),
        description: (fm.description || firstLine(text) || s.name).replace(/\s+/g, ' ').slice(0, 300),
        path: `${SKILLS_DIR}/${p.name}/${s.name}`,
      })
    }
  }
  return out.sort((a, b) => a.pack.localeCompare(b.pack) || a.dir.localeCompare(b.dir))
}

function firstLine(text: string): string {
  const body = text.replace(/^---[\s\S]*?\n---\s*/, '')
  return body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l.length > 0) ?? ''
}

/** Skills this person may use (they can read the skill's folder). */
export function skillsFor(root: string, rules: RuleSet, user: Principal): Skill[] {
  return scanSkills(root).filter((s) => atLeast(rules.access(user, s.path.split('/')), 'read'))
}

/** The company rules text this person sees (skills/RULES.md when readable), trimmed to `max` chars. */
export function rulesFor(root: string, rules: RuleSet, user: Principal, max = 2000): string {
  if (!atLeast(rules.access(user, [SKILLS_DIR, RULES_FILE]), 'read')) return ''
  try {
    const st = fs.lstatSync(path.join(root, SKILLS_DIR, RULES_FILE))
    if (!st.isFile()) return ''
    const t = fs.readFileSync(path.join(root, SKILLS_DIR, RULES_FILE), 'utf8').trim()
    return t.length > max ? t.slice(0, max) + '…' : t
  } catch { return '' }
}

/** All regular files of a skill folder (relative paths), for packaging. Symlinks and hidden files are skipped. */
export function skillFiles(root: string, skill: Skill): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = []
  let total = 0
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_SKILL_FILES || e.name.startsWith('.') || badSegment(e.name)) continue
      const abs = path.join(dir, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(abs, r)
      else if (e.isFile()) {
        const size = fs.statSync(abs).size
        if (total + size > MAX_SKILL_BYTES) continue
        total += size
        out.push({ rel: r, abs })
      }
    }
  }
  walk(path.join(root, skill.path), '')
  return out
}
