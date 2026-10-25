// Folder rules match folder names the way the team folder's disk does: Unicode NFC always (macOS Finder writes Korean
// names decomposed, browsers send them composed) and case too when the disk ignores case. Review finding: a rule saved
// for shared/HR or composed shared/인사 stopped applying once the folder was made as shared/hr or decomposed, and the
// HR files became readable by everyone.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import { RuleSet, type Principal } from '../../src/policy/access'
import { listRules, setRule } from '../../src/policy/rules-admin'
import { matchingPaths } from '../../src/policy/resolve'
import { FileService } from '../../src/files/service'
import { rg } from './files-fixtures'
import { errorOf, makeWorld, type World } from './files-world'

const NFC = (s: string) => s.normalize('NFC')
const NFD = (s: string) => s.normalize('NFD')
const member: Principal = { id: 'm1', name: 'm', role: 'member', groups: [] }
const hrPerson: Principal = { id: 'h1', name: 'h', role: 'member', groups: ['g-hr'] }
const rule = (path: string, access: 'none' | 'read' | 'write', subject: ['everyone' | 'group', string | null] = ['everyone', null]) =>
  ({ path, subject_type: subject[0], subject_id: subject[1], access })

describe('RuleSet keys', () => {
  test('composed and decomposed names are the same folder, both ways', () => {
    for (const [saved, asked] of [[NFC('shared/인사'), NFD('shared/인사')], [NFD('shared/인사'), NFC('shared/인사')]]) {
      const rs = new RuleSet([rule('shared', 'write'), rule(saved!, 'none'), rule(saved!, 'write', ['group', 'g-hr'])])
      expect(rs.access(member, asked!.split('/'))).toBe('none')
      expect(rs.access(member, [...asked!.split('/'), '연봉.md'])).toBe('none')
      expect(rs.access(hrPerson, asked!.split('/'))).toBe('write')
      expect(rs.isRuleFolder(asked!.split('/'))).toBe(true)
      expect(rs.holdsRuleFolder(['shared'])).toBe(true)
    }
  })
  test('case counts only on a case-sensitive disk', () => {
    const rows = [rule('shared', 'write'), rule('shared/HR', 'none')]
    const ci = new RuleSet(rows, { caseInsensitive: true })
    expect(ci.access(member, ['shared', 'hr', 'pay.md'])).toBe('none')
    expect(ci.access(member, ['Shared', 'Hr'])).toBe('none')
    expect(ci.isRuleFolder(['shared', 'hr'])).toBe(true)
    const cs = new RuleSet(rows, { caseInsensitive: false })
    expect(cs.access(member, ['shared', 'hr', 'pay.md'])).toBe('write') // a different folder there
    expect(cs.access(member, ['shared', 'HR', 'pay.md'])).toBe('none')
  })
  test('listing below a closed folder follows a readable rule folder in any spelling', () => {
    const rs = new RuleSet([rule('finance', 'none'), rule(NFD('finance/공개'), 'read')], { caseInsensitive: true })
    expect(rs.canList(member, ['Finance'])).toBe(true)
    expect(rs.access(member, ['finance', NFC('공개'), 'a.md'])).toBe('read')
    expect(rs.access(member, ['finance', 'b.md'])).toBe('none')
  })
  test('a device someone else enrolled still cannot open the person\'s own folder', () => {
    const rs = new RuleSet([rule('shared', 'write')])
    const p: Principal = { ...member, noPersonal: true }
    expect(rs.access(p, ['users', p.id, 'a.md'])).toBe('none')
    expect(rs.hasVisibleDescendant(p, ['users'])).toBe(false)
    expect(rs.access(member, ['users', member.id, 'a.md'])).toBe('write')
  })
})

describe('the rules in a running hub', () => {
  let W: World
  beforeAll(async () => { W = await makeWorld() })
  afterAll(async () => { await W?.hub.stop() })
  const ci = () => W.hub.ctx.fx.caseInsensitive
  const db = () => W.hub.ctx.db

  test('setRule keeps one folder row per folder, composed, whatever spelling it is given', async () => {
    const g = W.hub.group('인사팀')
    setRule(db(), NFD('shared/급여'), 'everyone', null, 'none', { caseInsensitive: ci() })
    setRule(db(), NFC('shared/급여'), 'group', g.id, 'write', { caseInsensitive: ci() })
    const rows = (db().query("SELECT path FROM folders WHERE path LIKE 'shared/%'").all() as { path: string }[]).filter((r) => NFC(r.path) === NFC('shared/급여'))
    expect(rows.map((r) => r.path)).toEqual([NFC('shared/급여')])
    expect(listRules(db()).filter((r) => r.path === NFC('shared/급여')).length).toBe(2)
    // removing through the other spelling removes it
    setRule(db(), NFD('shared/급여'), 'group', g.id, null, { caseInsensitive: ci() })
    setRule(db(), NFD('shared/급여'), 'everyone', null, null, { caseInsensitive: ci() })
    expect(listRules(db()).filter((r) => NFC(r.path) === NFC('shared/급여'))).toEqual([])
    if (ci()) {
      setRule(db(), 'shared/Ops', 'everyone', null, 'read', { caseInsensitive: true })
      setRule(db(), 'shared/ops', 'everyone', null, 'write', { caseInsensitive: true })
      expect(listRules(db()).filter((r) => r.path.toLowerCase() === 'shared/ops').map((r) => [r.path, r.access])).toEqual([['shared/Ops', 'write']])
      setRule(db(), 'shared/OPS', 'everyone', null, null, { caseInsensitive: true })
    }
    expect(await errorOf(() => setRule(db(), 'Users/x', 'everyone', null, 'read'))).toContain('개인 폴더')
  })

  /** A rule saved for `typed` before the folder exists; the folder then appears as `made` (Finder, a copy, a tool). */
  async function savedBeforeMade(label: string, typed: string, made: string) {
    const hr = W.hub.group('HR-' + label)
    const lead = await W.hub.user('lead-' + label, { groups: [hr.id] })
    setRule(db(), typed, 'everyone', null, 'none', { caseInsensitive: ci() })
    setRule(db(), typed, 'group', hr.id, 'write', { caseInsensitive: ci() })
    W.hub.ctx.rulesChanged()
    // a member cannot make the look-alike through the tools either
    expect(await errorOf(() => W.svc(W.choi).makeFolder(made))).toContain('not found or no access')
    fs.mkdirSync(W.abs(made), { recursive: true }) // Finder on the hub
    const leadSvc = FileService.forUser(W.hub.ctx, lead.id)
    leadSvc.write(`${typed}/salaries.md`, `SECRET-${label}`)
    expect(fs.readdirSync(W.abs(made))).toEqual(['salaries.md']) // the lead's file went into the folder on disk
    const s = W.svc(W.choi)
    for (const p of [`${typed}/salaries.md`, `${made}/salaries.md`]) expect(await errorOf(() => s.read(p))).toContain('not found or no access')
    expect(s.list('shared').entries.map((e) => e.path)).not.toContain(made)
    if (rg) {
      const r = await s.search({ query: `SECRET-${label}` })
      expect(r.hits).toEqual([])
      const n = await s.search({ query: 'salaries', mode: 'name' })
      expect(n.hits).toEqual([])
    }
    // and the group still gets in under either spelling
    expect(((await leadSvc.read(`${made}/salaries.md`)) as any).lines[0]).toBe(`SECRET-${label}`)
  }

  test('rule saved for composed Korean, folder made decomposed (macOS Finder)', async () => {
    await savedBeforeMade('nfd', NFC('shared/인사'), NFD('shared/인사'))
  })
  test('rule saved decomposed, folder made composed', async () => {
    await savedBeforeMade('nfc', NFD('shared/총무'), NFC('shared/총무'))
  })
  test('rule saved as shared/Payroll, folder made as shared/payroll (case-insensitive disk)', async () => {
    if (!ci()) { console.log('case-sensitive team folder: skipped'); return }
    await savedBeforeMade('case', 'shared/Payroll', 'shared/payroll')
  })

  test.skipIf(!rg)('a readable rule folder below a closed one is searched in its on-disk spelling', async () => {
    fs.mkdirSync(W.abs(`finance/${NFD('공개')}`), { recursive: true })
    fs.writeFileSync(W.abs(`finance/${NFD('공개')}/결산.md`), 'PUBLIC-NEEDLE 결산\n')
    setRule(db(), NFC('finance/공개'), 'everyone', null, 'read', { caseInsensitive: ci() })
    W.hub.ctx.rulesChanged()
    expect(matchingPaths(W.root, ['finance', NFC('공개')], ci())).toEqual([['finance', NFD('공개')]])
    const r = await W.svc(W.choi).search({ query: 'PUBLIC-NEEDLE' })
    expect(r.hits.map((h) => h.path)).toEqual([`finance/${NFD('공개')}/결산.md`])
    expect((await W.svc(W.choi).search({ query: 'CANARY-FIN' })).hits).toEqual([])
    expect(W.svc(W.choi).list('finance').entries.map((e) => e.name)).toEqual([NFD('공개')])
  })

  test('moving or deleting a rule folder is refused in any spelling', async () => {
    W.svc(W.admin).makeFolder('shared/proj-r')
    setRule(db(), 'shared/proj-r', 'everyone', null, 'write', { caseInsensitive: ci() })
    W.hub.ctx.rulesChanged()
    expect(await errorOf(() => W.svc(W.choi).remove(ci() ? 'shared/PROJ-R' : 'shared/proj-r'))).toContain('only an admin')
    expect(await errorOf(() => W.svc(W.admin).move('shared', 'shared-old'))).toContain('permissions')
  })
})
