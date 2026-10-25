// Folder permission resolution (ported from Team AX). Paths are arrays of actual on-disk names (see resolve.ts) plus,
// for a path being created, the names as typed. Rule paths and request paths are compared on a canonical key
// (pathKey): Unicode NFC always (macOS Finder writes Korean names decomposed, a browser sends them composed), and
// lowercase as well when the team folder's file system ignores case (then 'shared/HR' and 'shared/hr' are one
// folder). Otherwise a rule saved for one spelling stopped applying to a folder made with the other.
import type { Database } from 'bun:sqlite'
import { PRODUCT } from '../product'

export type Access = 'none' | 'read' | 'write'
export type Role = 'owner' | 'admin' | 'member'
export interface Principal {
  id: string; name: string; role: Role; groups: string[]
  /** set for a device someone else enrolled that the person has not approved: their own users/<id>/ stays closed */
  noPersonal?: boolean
}

interface Rule { subject_type: 'everyone' | 'role' | 'group' | 'user'; subject_id: string | null; access: Access }
const RANK: Record<Access, number> = { none: 0, read: 1, write: 2 }
export const atLeast = (a: Access, b: Access) => RANK[a] >= RANK[b]

/** One path segment as rules compare it. */
export const segKey = (s: string, caseInsensitive: boolean) =>
  caseInsensitive ? s.normalize('NFC').toLowerCase().normalize('NFC') : s.normalize('NFC')
/** A team-folder path ('' = root) as rules compare it. */
export const pathKey = (segs: readonly string[], caseInsensitive: boolean) => segs.map((s) => segKey(s, caseInsensitive)).join('/')

export function loadPrincipal(db: Database, userId: string): Principal | null {
  const u = db.query("SELECT id, name, role, status FROM users WHERE id = ?").get(userId) as any
  if (!u || u.status !== 'active') return null
  const groups = (db.query('SELECT group_id FROM group_members WHERE user_id = ?').all(userId) as any[]).map((r) => r.group_id)
  return { id: u.id, name: u.name, role: u.role, groups }
}

export class RuleSet {
  /** rules by canonical folder key */
  private byKey = new Map<string, Rule[]>()
  /** canonical key -> the folder path as saved (the first spelling seen) */
  private saved = new Map<string, string>()
  readonly caseInsensitive: boolean
  constructor(rows: { path: string; subject_type: Rule['subject_type']; subject_id: string | null; access: Access }[], o: { caseInsensitive?: boolean } = {}) {
    this.caseInsensitive = o.caseInsensitive ?? false
    for (const r of rows) {
      const k = this.key(r.path === '' ? [] : r.path.split('/'))
      const list = this.byKey.get(k) ?? []
      list.push({ subject_type: r.subject_type, subject_id: r.subject_id, access: r.access })
      this.byKey.set(k, list)
      if (!this.saved.has(k)) this.saved.set(k, r.path)
    }
  }
  static load(db: Database, o: { caseInsensitive?: boolean } = {}): RuleSet {
    return new RuleSet(db.query('SELECT f.path, r.subject_type, r.subject_id, r.access FROM folder_rules r JOIN folders f ON f.id = r.folder_id ORDER BY f.rowid').all() as any, o)
  }
  /** the canonical key of a path (segments) */
  key(segs: readonly string[]): string { return pathKey(segs, this.caseInsensitive) }
  /** folder paths that carry at least one rule, as saved (one per folder; compare them with key(), never exactly) */
  ruleFolders(): string[] { return [...this.saved.values()] }
  /** whether the folder `segs` has rules of its own */
  isRuleFolder(segs: readonly string[]): boolean { return this.byKey.has(this.key(segs)) }
  /** whether `segs` has rules of its own or holds a folder that does */
  holdsRuleFolder(segs: readonly string[]): boolean {
    const k = this.key(segs)
    for (const f of this.byKey.keys()) if (f === k || k === '' || f.startsWith(k + '/')) return true
    return false
  }

  access(p: Principal, segs: readonly string[]): Access {
    if (segs.length && segs[0] === PRODUCT.systemDir) return 'none'
    if (segs.some((s) => s.startsWith(PRODUCT.tmpPrefix))) return 'none'
    // users/<id>/ (tab 2 rules 2-3): the person's own folder is always write; anyone else's is none for every role,
    // owner and admin included, and rules there are ignored (the admin API refuses them; a moved folder or a
    // restored backup could still bring one in).
    if (segs[0] === 'users' && segs.length >= 2) return segs[1] === p.id && !p.noPersonal ? 'write' : 'none'
    // users/ itself only holds the personal folders: nobody writes there directly (no files beside the folders, no
    // folder for a person who does not exist yet, no renaming or trashing the whole tree)
    if (segs.length === 1 && segs[0] === 'users') return 'read'
    if (p.role === 'owner' || p.role === 'admin') return 'write' // everything else
    const ks = segs.map((s) => segKey(s, this.caseInsensitive))
    for (let len = ks.length; len >= 0; len--) {
      const rules = this.byKey.get(ks.slice(0, len).join('/'))
      if (!rules) continue
      const mine = rules.filter((r) => applies(r, p))
      if (mine.length) return pick(mine)
    }
    return 'none'
  }

  /** true when something strictly below `segs` is readable (so the folder may be listed for navigation) */
  hasVisibleDescendant(p: Principal, segs: readonly string[]): boolean {
    if (segs.length && segs[0] === PRODUCT.systemDir) return false
    if (segs[0] === 'users') {
      if (segs.length === 1) return !p.noPersonal // own personal folder below
      return segs[1] === p.id && !p.noPersonal
    }
    if (p.role === 'owner' || p.role === 'admin') return true
    const ks = segs.map((s) => segKey(s, this.caseInsensitive))
    const cands = [...[...this.byKey.keys()].map((f) => (f === '' ? [] : f.split('/'))).filter((c) => c[0] !== 'users'), ...(p.noPersonal ? [] : [['users', p.id]])]
    for (const c of cands) {
      if (c.length > ks.length && ks.every((s, i) => s === c[i]) && atLeast(this.access(p, c), 'read')) return true
    }
    return false
  }
  canList(p: Principal, segs: readonly string[]) { return atLeast(this.access(p, segs), 'read') || this.hasVisibleDescendant(p, segs) }
}

function applies(r: Rule, p: Principal): boolean {
  switch (r.subject_type) {
    case 'everyone': return true
    case 'role': return r.subject_id === p.role
    case 'group': return r.subject_id !== null && p.groups.includes(r.subject_id)
    case 'user': return r.subject_id === p.id
  }
}
// personal > group (widest) > role > everyone
function pick(rules: Rule[]): Access {
  for (const t of ['user', 'group', 'role', 'everyone'] as const) {
    const xs = rules.filter((r) => r.subject_type === t)
    if (xs.length) return xs.reduce<Access>((a, r) => (RANK[r.access] > RANK[a] ? r.access : a), 'none')
  }
  return 'none'
}
