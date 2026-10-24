// search_files: only what the person may read is searched and shown (content and name modes), office documents are
// searched through their text, links are not followed, and the edges (glob, bad regex, limits, no ripgrep).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import { errorOf, makeWorld, masked, type World } from './files-world'
import { FileService, type SearchResult } from '../../src/files/service'
import { hwpxDoc, pandoc, pandocDoc, rg, xlsxBook } from './files-fixtures'

let W: World
beforeAll(async () => {
  W = await makeWorld()
  W.hub.write('shared/notes/meeting.md', '회의록\n매출(3분기) 목표 달성\nCANARY-SHARED ok\n')
  W.hub.write('shared/notes/todo.txt', 'todo: 견적서 보내기\n')
  fs.writeFileSync(W.abs('shared/공지.hwpx'), hwpxDoc('사내 공지 CANARY-HWPX'))
  fs.writeFileSync(W.abs('sales/forecast.xlsx'), xlsxBook([['월', '메모'], ['3월', 'CANARY-XLSX 전망']]))
  if (pandoc) fs.writeFileSync(W.abs('sales/report.docx'), pandocDoc('docx', '# 보고\n\nCANARY-DOCX 분기 실적\n'))
  fs.symlinkSync(W.abs('finance'), W.abs('shared/fin-link'))
})
afterAll(async () => { await W?.hub.stop() })

const content = async (u: Parameters<World['svc']>[0], query: string, o: { path?: string; glob?: string; limit?: number } = {}) => {
  const r = await W.svc(u).search({ query, mode: 'content', ...o })
  if (r.mode !== 'content') throw new Error('mode')
  return r
}
const names = async (u: Parameters<World['svc']>[0], query: string, o: { path?: string; glob?: string } = {}) => {
  const r = await W.svc(u).search({ query, mode: 'name', ...o })
  if (r.mode !== 'name') throw new Error('mode')
  return r.hits.map((h) => h.path + (h.type === 'folder' ? '/' : ''))
}
const canaries = (r: Extract<SearchResult, { mode: 'content' }>) => [...new Set(r.hits.map((h) => /CANARY-[A-Z]+/.exec(h.text)?.[0]).filter(Boolean))].sort()

describe.skipIf(!rg)('content search', () => {
  test('each person finds exactly what they may read', async () => {
    expect(canaries(await content(W.choi, 'CANARY'))).toEqual(['CANARY-HWPX', 'CANARY-SHARED'])
    expect(canaries(await content(W.park, 'CANARY'))).toEqual(['CANARY-HWPX', 'CANARY-PARK', 'CANARY-PITCH', 'CANARY-SALES', 'CANARY-SHARED', 'CANARY-XLSX', ...(pandoc ? ['CANARY-DOCX'] : [])].sort())
    expect(canaries(await content(W.han, 'CANARY'))).toEqual(['CANARY-FIN', 'CANARY-HWPX', 'CANARY-SHARED'])
    // admins and the owner: everything except other people's personal folders
    for (const u of [W.admin, W.owner]) {
      const c = canaries(await content(u, 'CANARY'))
      expect(c).toContain('CANARY-HR')
      expect(c).toContain('CANARY-FIN')
      expect(c).not.toContain('CANARY-PARK')
    }
  })
  test('hits carry path, line number and the line', async () => {
    const r = await content(W.choi, '견적서')
    expect(r.hits).toContainEqual({ path: 'shared/notes/todo.txt', line: 1, text: 'todo: 견적서 보내기' })
    expect(r.files).toBeGreaterThanOrEqual(1)
  })
  test('office documents are searched through their text', async () => {
    const x = await content(W.park, '전망')
    expect(x.hits.map((h) => h.path)).toContain('sales/forecast.xlsx')
    if (pandoc) expect((await content(W.park, '분기 실적')).hits.map((h) => h.path)).toEqual(['sales/report.docx'])
    expect((await content(W.choi, '전망')).hits).toEqual([])
    expect((await content(W.choi, '사내 공지')).hits.map((h) => h.path)).toEqual(['shared/공지.hwpx'])
  })
  test('path narrows the search; a hidden path answers like a missing one', async () => {
    expect((await content(W.park, 'CANARY', { path: 'sales' })).hits.every((h) => h.path.startsWith('sales/'))).toBe(true)
    expect((await content(W.choi, 'CANARY', { path: 'shared/notes/meeting.md' })).hits.map((h) => h.path)).toEqual(['shared/notes/meeting.md'])
    const hidden = await errorOf(() => content(W.choi, 'x', { path: 'sales' }))
    expect(hidden).toContain('not found or no access')
    expect(masked(hidden, 'sales')).toBe(masked(await errorOf(() => content(W.choi, 'x', { path: 'nosuch' })), 'nosuch'))
    expect(canaries(await content(W.choi, 'CANARY', { path: 'shared' }))).toEqual(['CANARY-HWPX', 'CANARY-SHARED'])
  })
  test('glob filters by file name or by path', async () => {
    expect((await content(W.choi, 'CANARY|견적', { glob: '*.txt' })).hits.map((h) => h.path)).toEqual(['shared/notes/todo.txt'])
    expect((await content(W.choi, 'CANARY', { path: 'shared', glob: 'notes/*.md' })).hits.map((h) => h.path)).toEqual(['shared/notes/meeting.md'])
    expect(await errorOf(() => content(W.choi, 'x', { glob: '!*.md' }))).toContain('negated')
  })
  test('an invalid regular expression is searched as plain text', async () => {
    const r = await content(W.choi, '매출(3분기')
    expect(r.literal).toBe(true)
    expect(r.hits.map((h) => h.path)).toEqual(['shared/notes/meeting.md'])
    expect((await content(W.choi, '매출\\(3분기\\)')).hits.length).toBe(1)
  })
  test('the limit cuts the result', async () => {
    for (let i = 0; i < 30; i++) W.hub.write(`shared/many/f${i}.txt`, 'needle-xyz\n')
    const r = await content(W.choi, 'needle-xyz', { limit: 10 })
    expect(r.hits.length).toBe(10)
    expect(r.truncated).toBe(true)
  })
  test('symbolic links are not followed', async () => {
    expect((await content(W.choi, 'CANARY-FIN')).hits).toEqual([])
    expect((await content(W.han, 'CANARY-FIN')).hits.map((h) => h.path)).toEqual(['finance/budget.md'])
  })
})

describe.skipIf(!rg)('name search', () => {
  test('files and folders by name, only visible ones', async () => {
    expect(await names(W.choi, 'budget')).toEqual([])
    expect(await names(W.han, 'budget')).toEqual(['finance/budget.md'])
    expect(await names(W.choi, 'salaries')).toEqual([])
    expect(await names(W.admin, 'salaries')).toEqual(['shared/hr/salaries.md'])
    expect(await names(W.admin, 'hr')).toContain('shared/hr/')
    expect(await names(W.choi, 'hr')).not.toContain('shared/hr/')
    expect(await names(W.admin, 'diary')).toEqual([])
    expect(await names(W.park, 'diary')).toEqual([`users/${W.park.id}/diary.md`])
  })
  test('case- and Unicode-form-insensitive; Korean names', async () => {
    expect(await names(W.choi, 'MEETING')).toEqual(['shared/notes/meeting.md'])
    expect(await names(W.choi, '공지'.normalize('NFD'))).toEqual(['shared/공지.hwpx'])
    expect(await names(W.choi, 'notes')).toContain('shared/notes/')
  })
})

describe('without ripgrep', () => {
  test('name search walks the folders; content search says it is unavailable', async () => {
    const ctx = { ...W.hub.ctx, config: { ...W.hub.ctx.config, rgBin: null } }
    const svc = (u: Parameters<World['svc']>[0]) => new FileService(ctx, W.p(u))
    const r = await svc(W.choi).search({ query: 'meeting', mode: 'name' })
    expect(r.hits.map((h) => h.path)).toEqual(['shared/notes/meeting.md'])
    expect((await svc(W.choi).search({ query: 'budget', mode: 'name' })).hits).toEqual([])
    expect(await errorOf(() => svc(W.choi).search({ query: 'x' }))).toContain('not available')
  })
})
