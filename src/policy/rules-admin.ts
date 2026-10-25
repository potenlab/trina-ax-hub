// Managing folder rules (admin pages, setup). The rule model is Team AX's: rules sit on folders, the nearest folder
// with a rule that applies to the person decides; owner/admin write everywhere except other people's users/<id>/.
import type { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { newId } from '../ids'
import { HttpError } from '../http/errors'
import { parseInput } from './resolve'
import { pathKey, type Access } from './access'

export type Subject = 'everyone' | 'role' | 'group' | 'user'
export interface RuleView { path: string; subjectType: Subject; subjectId: string | null; subjectName: string; access: Access }

export function listRules(db: Database): RuleView[] {
  return (db.query(`SELECT f.path, r.subject_type, r.subject_id, r.access,
      CASE r.subject_type WHEN 'group' THEN (SELECT name FROM groups WHERE id = r.subject_id)
                          WHEN 'user' THEN (SELECT name FROM users WHERE id = r.subject_id)
                          WHEN 'role' THEN r.subject_id ELSE '모두' END AS subject_name
    FROM folder_rules r JOIN folders f ON f.id = r.folder_id ORDER BY f.path, r.subject_type`).all() as any[])
    .map((r) => ({ path: r.path, subjectType: r.subject_type, subjectId: r.subject_id, subjectName: r.subject_name ?? '(삭제됨)', access: r.access }))
}

/**
 * Set (or with access null, remove) one rule. `folder` is a team-folder path ('' = root). Rules match folders on the
 * canonical key (access.ts pathKey), so the path is stored composed (NFC), and a rule for a folder that already has
 * rules under another spelling (decomposed, or another case on a case-insensitive team folder) joins that folder's
 * row instead of making a second one. Pass `caseInsensitive` = ctx.fx.caseInsensitive.
 */
export function setRule(db: Database, folder: string, subjectType: Subject, subjectId: string | null, access: Access | null,
  o: { caseInsensitive?: boolean } = {}) {
  const segs = (folder === '' ? [] : parseInput(folder)).map((s) => s.normalize('NFC'))
  if (segs.length >= 1 && segs[0]!.toLowerCase() === 'users') throw new HttpError(400, 'validation', '개인 폴더(users/)에는 규칙을 둘 수 없어요.')
  const key = pathKey(segs, o.caseInsensitive ?? false)
  if (subjectType === 'everyone') subjectId = null
  else if (!subjectId) throw new HttpError(400, 'validation', '대상을 골라 주세요.')
  if (subjectType === 'role' && !['admin', 'member'].includes(subjectId!)) throw new HttpError(400, 'validation', '역할은 admin 또는 member예요.')
  if (subjectType === 'group' && !db.query('SELECT 1 FROM groups WHERE id = ?').get(subjectId)) throw new HttpError(400, 'validation', '없는 그룹이에요.')
  if (subjectType === 'user' && !db.query('SELECT 1 FROM users WHERE id = ?').get(subjectId)) throw new HttpError(400, 'validation', '없는 사람이에요.')
  db.transaction(() => {
    // every row of the same folder (any spelling): a removal clears the subject's rule from all of them
    const same = (db.query('SELECT id, path FROM folders ORDER BY rowid').all() as { id: string; path: string }[])
      .filter((r) => pathKey(r.path === '' ? [] : r.path.split('/'), o.caseInsensitive ?? false) === key)
    for (const r of same) db.query('DELETE FROM folder_rules WHERE folder_id = ? AND subject_type = ? AND subject_id IS ?').run(r.id, subjectType, subjectId)
    let f = same[0] ?? null
    if (access !== null) {
      if (!f) { f = { id: newId(), path: segs.join('/') }; db.query('INSERT INTO folders (id, path) VALUES (?, ?)').run(f.id, f.path) }
      // NULL subject ids never compare equal in the primary key, hence the delete above
      db.query('INSERT INTO folder_rules (folder_id, subject_type, subject_id, access) VALUES (?,?,?,?)').run(f.id, subjectType, subjectId, access)
    }
    for (const r of same) db.query('DELETE FROM folders WHERE id = ? AND NOT EXISTS (SELECT 1 FROM folder_rules WHERE folder_id = ?)').run(r.id, r.id)
  })()
}

/** First-run layout: shared/ (everyone writes), skills/ (everyone reads; admins write), users/. */
export function initTeamFolder(db: Database, root: string) {
  for (const d of ['shared', 'skills', 'skills/company', 'users']) fs.mkdirSync(path.join(root, d), { recursive: true })
  const readme = path.join(root, 'skills', 'company', 'README.md')
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      '# 회사 스킬',
      '',
      '이 폴더 아래에 스킬 폴더를 만들면 모든 직원 PC의 Claude에 자동으로 설치됩니다.',
      '',
      '- 스킬 하나 = 폴더 하나: `skills/company/<스킬 이름>/SKILL.md`',
      '- 부서 전용 스킬은 `skills/<부서 폴더>/` 아래에 두고, 그 폴더의 읽기 권한을 부서 그룹에만 주세요.',
      '- `skills/RULES.md`에 적은 내용은 모든 직원의 Claude가 항상 따르는 회사 규칙이 됩니다.',
      '',
    ].join('\n'))
  }
  if (!db.query('SELECT 1 FROM folders').get()) {
    setRule(db, 'shared', 'everyone', null, 'write')
    setRule(db, 'skills', 'everyone', null, 'read')
  }
}
