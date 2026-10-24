// A small company for the files / MCP tests (not a test file itself).
//
//   owner  대표 (role owner)          admin  관리자 (role admin)
//   park   member of 영업 (sales)      choi   member, no group       han  member of 재무 (finance)
//
//   shared/             everyone write (initTeamFolder)      shared/hello.md, shared/sub/deep.md
//   shared/hr/          everyone none (a hidden folder below a writable one)    salaries.md   CANARY-HR
//   skills/             everyone read                         skills/company/quote/SKILL.md (+ template.md)
//   skills/sales-pack/  everyone none, 영업 read (a hidden folder below a read-only one)   pitch skill
//   notice/             everyone read (read-only for members)  notice/rules.md
//   sales/              everyone none, 영업 write (group-only)  sales/plan.md   CANARY-SALES
//   finance/            everyone none, 재무 write               finance/budget.md   CANARY-FIN
//   users/<park>/       park only                               diary.md   CANARY-PARK
import fs from 'node:fs'
import path from 'node:path'
import { testHub, type TestHub } from '../lib/hub'
import { setRule } from '../../src/policy/rules-admin'
import { loadPrincipal, type Principal } from '../../src/policy/access'
import { FileService } from '../../src/files/service'
import type { User } from '../../src/auth/users'

export interface World {
  hub: TestHub
  root: string
  owner: User; admin: User; park: User; choi: User; han: User
  sales: { id: string; name: string }; finance: { id: string; name: string }
  svc(u: User): FileService
  p(u: User): Principal
  abs(rel: string): string
  read(rel: string): string
}

export async function makeWorld(o: Parameters<typeof testHub>[0] = {}): Promise<World> {
  const hub = await testHub(o)
  const db = hub.ctx.db
  const sales = hub.group('영업')
  const finance = hub.group('재무')
  const admin = await hub.user('admin1', { role: 'admin' })
  const park = await hub.user('park', { groups: [sales.id] })
  const choi = await hub.user('choi')
  const han = await hub.user('han', { groups: [finance.id] })

  hub.write('shared/hello.md', '# 안녕하세요\n첫 줄\n둘째 줄\n')
  hub.write('shared/sub/deep.md', 'deep file\n')
  hub.write('shared/hr/salaries.md', 'CANARY-HR 연봉표\n')
  hub.write('skills/RULES.md', '항상 존댓말로 답한다.\n고객 이름은 밖에 알리지 않는다.')
  hub.write('skills/company/quote/SKILL.md', '---\nname: quote\ndescription: 견적서 초안을 만든다\n---\n# 견적\n템플릿을 읽고 채운다.\n')
  hub.write('skills/company/quote/template.md', '견적서 템플릿\n')
  hub.write('skills/sales-pack/pitch/SKILL.md', '---\nname: pitch\ndescription: 영업 제안서 CANARY-PITCH\n---\n')
  hub.write('notice/rules.md', '사내 규정\n')
  hub.write('sales/plan.md', 'CANARY-SALES 3분기 매출 계획\n')
  hub.write('finance/budget.md', 'CANARY-FIN 예산\n')
  hub.write(`users/${park.id}/diary.md`, 'CANARY-PARK 일기\n')

  setRule(db, 'shared/hr', 'everyone', null, 'none')
  setRule(db, 'skills/sales-pack', 'everyone', null, 'none')
  setRule(db, 'skills/sales-pack', 'group', sales.id, 'read')
  setRule(db, 'notice', 'everyone', null, 'read')
  setRule(db, 'sales', 'everyone', null, 'none')
  setRule(db, 'sales', 'group', sales.id, 'write')
  setRule(db, 'finance', 'everyone', null, 'none')
  setRule(db, 'finance', 'group', finance.id, 'write')
  hub.ctx.rulesChanged()

  const root = hub.ctx.fx.root
  const p = (u: User) => loadPrincipal(db, u.id)!
  return {
    hub, root, owner: hub.owner, admin, park, choi, han, sales, finance,
    p,
    svc: (u) => new FileService(hub.ctx, p(u)),
    abs: (rel) => path.join(root, ...rel.split('/')),
    read: (rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8'),
  }
}

/** The error message of a call (sync or async), or null when it succeeded. */
export async function errorOf(fn: () => unknown): Promise<string | null> {
  try { await fn(); return null } catch (e) { return (e as Error).message }
}

/** An answer with the typed path replaced, so a hidden probe and a missing control can be compared. */
export const masked = (msg: string | null, typed: string) => (msg ?? '<ok>').split(typed).join('<PATH>')
