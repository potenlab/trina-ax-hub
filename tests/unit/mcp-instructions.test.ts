// The MCP `instructions`: who the person is, how files are reached, the company rules and their skills, at most
// 3,500 characters however many skills or how long RULES.md is.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import { makeWorld, type World } from './files-world'
import { buildInstructions, COMPANY_NAME_SETTING, INSTRUCTIONS_MAX } from '../../src/mcp/instructions'
import { setSetting } from '../../src/db'
import { updateUser } from '../../src/auth/users'

let W: World
beforeAll(async () => { W = await makeWorld() })
afterAll(async () => { await W?.hub.stop() })

const ins = (u: Parameters<World['svc']>[0]) => buildInstructions(W.hub.ctx, W.p(u))

describe('instructions', () => {
  test('name, role, groups, personal folder, tools, rules and skills', () => {
    updateUser(W.hub.ctx.db, W.park.id, { name: '박영업' })
    setSetting(W.hub.ctx.db, COMPANY_NAME_SETTING, '트리숲')
    const s = ins(W.park)
    expect(s).toContain('Trina AX: the shared file hub of 트리숲.')
    expect(s).toContain('You are working with 박영업 (member; groups: 영업).')
    expect(s).toContain(`users/${W.park.id}/`)
    for (const t of ['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'make_folder', 'move_file', 'delete_file', 'read_skill']) expect(s).toContain(t)
    expect(s).toContain('Company rules (skills/RULES.md)')
    expect(s).toContain('항상 존댓말로 답한다.')
    expect(s).toContain('"company" plugin')
    expect(s).toContain('- quote: 견적서 초안을 만든다')
    expect(s).toContain('- pitch: 영업 제안서')
    expect(s.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX)
  })
  test('only the skills the person may use; no rules section when RULES.md is unreadable or missing', () => {
    const s = ins(W.choi)
    expect(s).toContain('- quote:')
    expect(s).not.toContain('pitch')
    expect(s).toContain('(member)')
    fs.renameSync(W.abs('skills/RULES.md'), W.abs('skills/RULES.bak'))
    try { expect(ins(W.choi)).not.toContain('Company rules') } finally { fs.renameSync(W.abs('skills/RULES.bak'), W.abs('skills/RULES.md')) }
  })
  test('200 skills with long descriptions stay within the limit and say how many are left out', () => {
    for (let i = 0; i < 200; i++) W.hub.write(`skills/company/skill-${String(i).padStart(3, '0')}/SKILL.md`, `---\nname: skill-${i}\ndescription: ${'긴 설명 '.repeat(60)}\n---\n`)
    const s = ins(W.choi)
    expect(s.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX)
    expect(s).toMatch(/- … and \d+ more \(list_files skills\/ or read_skill to see them\)/)
    expect(s).toContain('항상 존댓말로 답한다.') // the rules keep their room
    expect(s).toContain('- quote:')
  })
  test('a very long RULES.md is cut with a pointer to the file', () => {
    W.hub.write('skills/RULES.md', '규칙 시작.\n' + '이 규칙을 지킨다. '.repeat(1500))
    const s = ins(W.admin)
    expect(s.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX)
    expect(s).toContain('규칙 시작.')
    expect(s).toContain('(read skills/RULES.md for the rest)')
    expect(s).toContain('(admin)')
  })
  test('long names and odd characters stay on one line', () => {
    updateUser(W.hub.ctx.db, W.choi.id, { name: '최\n'.repeat(80) })
    const s = ins(W.choi)
    expect(s.split('\n')[1]!.startsWith('You are working with 최 최')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX)
  })
})
