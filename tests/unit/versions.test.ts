// Earlier versions and deleted files: list, restore (the MCP text promises "an admin can restore it"), prune, and the
// admin page /admin/versions (mounted here on its own app; the lead mounts it in src/web/routes.tsx).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createApp, sessionMiddleware } from '../../src/http/app'
import { makeWeb, pageGuard } from '../../src/web/kit'
import { mountVersions } from '../../src/web/admin/versions'
import { getVersion, listVersions, pruneVersions, restoreVersion } from '../../src/files/versions'
import { newId } from '../../src/ids'
import { nowIso } from '../../src/db'
import { PRODUCT } from '../../src/product'
import { errorOf, makeWorld, type World } from './files-world'

let W: World
beforeAll(async () => { W = await makeWorld() })
afterAll(async () => { await W?.hub.stop() })
const db = () => W.hub.ctx.db
const rowsOf = (rel: string) => db().query('SELECT * FROM file_versions WHERE path = ? ORDER BY created_at, rowid').all(rel) as any[]

describe('listVersions', () => {
  test('newest first, with who, why, size and whether the copy is still kept', () => {
    const s = W.svc(W.choi)
    s.write('shared/list/a.md', 'a1')
    s.write('shared/list/a.md', 'a2', { overwrite: true })
    s.edit('shared/list/a.md', 'a2', 'a3')
    s.remove('shared/list/a.md')
    const v = listVersions(W.hub.ctx, { path: 'shared/list/' })
    expect(v.map((x) => x.reason)).toEqual(['trash', 'overwrite', 'overwrite'])
    expect(v[0]).toMatchObject({ path: 'shared/list/a.md', name: 'a.md', userId: W.choi.id, userName: 'choi', size: 2, stored: true })
    expect(v.every((x) => x.createdAt && x.storedAs.startsWith(PRODUCT.systemDir + '/'))).toBe(true)
    fs.rmSync(W.abs(v[2]!.storedAs))
    expect(listVersions(W.hub.ctx, { path: 'shared/list/' })[2]!.stored).toBe(false)
  })
  test('path filter is a prefix, composed or decomposed; paging with the cursor', () => {
    const name = '견적서'.normalize('NFD')
    fs.mkdirSync(W.abs('shared/page'), { recursive: true })
    for (let i = 0; i < 5; i++) { fs.writeFileSync(W.abs(`shared/page/${name}${i}.md`), `v${i}`); W.svc(W.choi).remove(`shared/page/${name}${i}.md`) }
    const all = listVersions(W.hub.ctx, { path: 'shared/page/견적'.normalize('NFC') })
    expect(all.length).toBe(5)
    const first = listVersions(W.hub.ctx, { path: 'shared/page', limit: 2 })
    const next = listVersions(W.hub.ctx, { path: 'shared/page', limit: 10, before: first[1]!.cursor })
    expect([...first, ...next].map((x) => x.id)).toEqual(all.map((x) => x.id))
    expect(listVersions(W.hub.ctx, { path: 'shared/page_' })).toEqual([]) // LIKE wildcards are literal
  })
  test('with a viewer, another person\'s personal folder never shows, admins included', () => {
    const own = `users/${W.park.id}/메모.md`
    W.svc(W.park).write(own, '개인 v1')
    W.svc(W.park).write(own, '개인 v2', { overwrite: true })
    expect(listVersions(W.hub.ctx, { path: 'users/', viewer: W.admin.id }).map((x) => x.path)).not.toContain(own)
    expect(listVersions(W.hub.ctx, { path: 'users/', viewer: W.park.id }).map((x) => x.path)).toContain(own)
    expect(listVersions(W.hub.ctx, { path: 'sales/', viewer: W.choi.id })).toEqual([]) // a folder choi cannot read
  })
})

describe('restoreVersion', () => {
  test('an overwritten file comes back; what was there is kept as a new version first', () => {
    const s = W.svc(W.choi)
    s.write('shared/r/plan.md', '초안')
    s.write('shared/r/plan.md', '최종', { overwrite: true })
    const old = rowsOf('shared/r/plan.md')[0]
    expect(restoreVersion(W.hub.ctx, old.id, W.admin.id)).toEqual({ path: 'shared/r/plan.md' })
    expect(W.read('shared/r/plan.md')).toBe('초안')
    const after = rowsOf('shared/r/plan.md')
    expect(after.length).toBe(2)
    expect(fs.readFileSync(W.abs(after[1].stored_as), 'utf8')).toBe('최종')
    expect(after[1]).toMatchObject({ reason: 'overwrite', user_id: W.admin.id })
  })
  test('a deleted file goes back to its place, or next to it when the name is taken', () => {
    const s = W.svc(W.choi)
    s.write('shared/r/공지.md', '첫 공지')
    const t = s.remove('shared/r/공지.md')
    expect(restoreVersion(W.hub.ctx, t.versionId!, W.admin.id).path).toBe('shared/r/공지.md')
    expect(W.read('shared/r/공지.md')).toBe('첫 공지')
    s.write('shared/r/공지.md', '새 공지', { overwrite: true })
    expect(restoreVersion(W.hub.ctx, t.versionId!, W.admin.id).path).toBe('shared/r/공지 (복원).md')
    expect(restoreVersion(W.hub.ctx, t.versionId!, W.admin.id).path).toBe('shared/r/공지 (복원 2).md')
    expect(W.read('shared/r/공지.md')).toBe('새 공지')
    expect(W.read('shared/r/공지 (복원).md')).toBe('첫 공지')
  })
  test('to another place; into a missing folder; a deleted folder is made again', () => {
    const s = W.svc(W.choi)
    s.write('shared/r/gone/x.md', 'x')
    const t = s.remove('shared/r/gone/x.md')
    s.remove('shared/r/gone')
    expect(restoreVersion(W.hub.ctx, t.versionId!, W.admin.id).path).toBe('shared/r/gone/x.md')
    expect(restoreVersion(W.hub.ctx, t.versionId!, W.admin.id, { to: 'shared/r/elsewhere/y.md' }).path).toBe('shared/r/elsewhere/y.md')
    expect(W.read('shared/r/elsewhere/y.md')).toBe('x')
  })
  test('rows from before the name was kept in the stored file still restore', () => {
    const id = newId(16)
    fs.mkdirSync(W.abs(`${PRODUCT.systemDir}/versions`), { recursive: true })
    fs.writeFileSync(W.abs(`${PRODUCT.systemDir}/versions/${id}`), 'old style')
    db().query('INSERT INTO file_versions (id, path, stored_as, size, sha256, user_id, reason, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, 'shared/r/old-style.md', `${PRODUCT.systemDir}/versions/${id}`, 9, '', W.choi.id, 'overwrite', nowIso())
    expect(restoreVersion(W.hub.ctx, id, W.owner.id).path).toBe('shared/r/old-style.md')
    expect(W.read('shared/r/old-style.md')).toBe('old style')
  })
  test('refused: no access to the original or the target, a pruned copy, unknown ids, odd stored paths', async () => {
    const own = `users/${W.park.id}/비밀.md`
    W.svc(W.park).write(own, 'P1')
    const pv = W.svc(W.park).remove(own)
    expect(await errorOf(() => restoreVersion(W.hub.ctx, pv.versionId!, W.admin.id))).toContain('개인 폴더')
    expect(await errorOf(() => restoreVersion(W.hub.ctx, pv.versionId!, W.admin.id, { to: 'shared/leak.md' }))).toContain('개인 폴더')
    expect(fs.existsSync(W.abs('shared/leak.md'))).toBe(false)
    expect(restoreVersion(W.hub.ctx, pv.versionId!, W.park.id).path).toBe(own) // the person themselves may
    W.svc(W.choi).write('shared/r/ro.md', 'ro')
    const rv = W.svc(W.choi).remove('shared/r/ro.md')
    expect(await errorOf(() => restoreVersion(W.hub.ctx, rv.versionId!, W.choi.id, { to: 'notice/ro.md' }))).toContain('되살릴 수 없어요')
    fs.rmSync(W.abs(getVersion(W.hub.ctx, rv.versionId!)!.storedAs))
    expect(await errorOf(() => restoreVersion(W.hub.ctx, rv.versionId!, W.admin.id))).toContain('정리돼서')
    expect(await errorOf(() => restoreVersion(W.hub.ctx, 'nope', W.admin.id))).toContain('찾을 수 없어요')
    const id = newId(16)
    db().query('INSERT INTO file_versions (id, path, stored_as, size, sha256, user_id, reason, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, 'shared/r/evil.md', '../data/secrets/anthropic-api-key', 1, '', W.choi.id, 'overwrite', nowIso())
    expect(await errorOf(() => restoreVersion(W.hub.ctx, id, W.owner.id))).toContain('정리돼서')
  })
})

describe('pruneVersions', () => {
  test('removes copies and rows older than the limit, and empty trash folders', () => {
    W.svc(W.choi).write('shared/p/old.md', 'old')
    const t = W.svc(W.choi).remove('shared/p/old.md')
    W.svc(W.choi).write('shared/p/keep.md', 'k1')
    W.svc(W.choi).write('shared/p/keep.md', 'k2', { overwrite: true })
    db().query('UPDATE file_versions SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 100 * 86_400_000).toISOString(), t.versionId)
    const before = db().query('SELECT COUNT(*) AS n FROM file_versions').get() as any
    expect(pruneVersions(W.hub.ctx, 90)).toBe(1)
    expect((db().query('SELECT COUNT(*) AS n FROM file_versions').get() as any).n).toBe(before.n - 1)
    expect(fs.existsSync(W.abs(t.storedAs!))).toBe(false)
    expect(fs.existsSync(path.dirname(W.abs(t.storedAs!)))).toBe(false)
    expect(rowsOf('shared/p/keep.md').length).toBe(1)
  })
})

describe('/admin/versions', () => {
  const app = () => createApp(W.hub.ctx, [(a, ctx) => {
    const web = makeWeb(ctx)
    a.use('/admin/*', sessionMiddleware(ctx))
    a.use('/admin/*', pageGuard(web, { admin: true }))
    mountVersions(a, web)
  }])
  const html = { accept: 'text/html' }
  test('admins see the list with 복원 buttons; members cannot', async () => {
    W.svc(W.choi).write('shared/web/표.md', '하나')
    W.svc(W.choi).write('shared/web/표.md', '둘', { overwrite: true })
    const a = W.hub.session(W.admin.id)
    const r = await app().request('/admin/versions?path=shared/web', { headers: { ...html, cookie: a.cookie } })
    expect(r.status).toBe(200)
    const body = await r.text()
    expect(body).toContain('이전 버전')
    expect(body).toContain('shared/web/표.md')
    expect(body).toContain('복원')
    const m = W.hub.session(W.choi.id)
    expect((await app().request('/admin/versions', { headers: { ...html, cookie: m.cookie } })).status).toBe(403)
  })
  test('restore needs the form token, then restores and writes an audit row', async () => {
    const v = rowsOf('shared/web/표.md')[0]
    const a = W.hub.session(W.admin.id)
    const post = (csrf: string) => app().request(`/admin/versions/${v.id}/restore`, {
      method: 'POST', headers: { ...html, cookie: a.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, q: 'shared/web' }),
    })
    expect((await post('wrong')).status).toBe(403)
    expect(W.read('shared/web/표.md')).toBe('둘')
    const r = await post(a.csrf)
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/admin/versions?path=shared%2Fweb')
    expect(W.read('shared/web/표.md')).toBe('하나')
    const row = db().query("SELECT * FROM audit WHERE action = 'file.restore' ORDER BY id DESC").get() as any
    expect(row).toMatchObject({ actor: W.admin.id, target: 'shared/web/표.md' })
    expect(JSON.parse(row.detail)).toMatchObject({ version: v.id, original: 'shared/web/표.md', reason: 'overwrite' })
    expect(row.detail).not.toContain('하나')
  })
})
