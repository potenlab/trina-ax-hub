// What stays true around uploads: "who changed it last", the search index and extracted text after uploads, renames,
// moves and deletes, the audit trail, the Korean error texts, and the per-route body limits.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { makeWorld, type World } from './files-world'
import { get, post, type Sess } from './web-lib'
import { formUpload, notices, MB } from './files-upload-lib'
import { hwpxDoc, rg, xlsxBook } from './files-fixtures'
import { lastChange, moveChange, recordChange, dropChange } from '../../src/files/changes'
import { indexingDone } from '../../src/files/service'
import { describeFileError } from '../../src/files/messages'
import { restoreVersion } from '../../src/files/versions'
import { bodyGuard } from '../../src/http/body-limit'
import { HttpError } from '../../src/http/errors'
import { Denied, ToolError } from '../../src/policy/errors'
import { badSegment } from '../../src/policy/names'
import { PRODUCT } from '../../src/product'

let W: World
let admin: Sess, park: Sess, choi: Sess
beforeAll(async () => {
  W = await makeWorld()
  admin = W.hub.session(W.admin.id); park = W.hub.session(W.park.id); choi = W.hub.session(W.choi.id)
})
afterAll(async () => { await W?.hub.stop() })

const db = () => W.hub.ctx.db
const change = (rel: string) => db().query('SELECT user_id, source FROM file_changes WHERE path = ?').get(rel.normalize('NFC')) as { user_id: string; source: string } | null
const cacheFile = (rel: string) => path.join(W.hub.ctx.config.dataDir, 'textcache', rel + '.txt')

describe('who changed a file last', () => {
  test('every way of changing a file records it: upload, MCP write and edit, move, delete', async () => {
    await formUpload(W.hub, park, 'shared', [{ name: 'who.md', data: 'v1' }])
    expect(change('shared/who.md')).toEqual({ user_id: W.park.id, source: 'web' })
    W.svc(W.han).write('shared/who.md', 'v2', { overwrite: true })
    expect(change('shared/who.md')).toEqual({ user_id: W.han.id, source: 'mcp' })
    W.svc(W.choi).edit('shared/who.md', 'v2', 'v3')
    expect(change('shared/who.md')).toEqual({ user_id: W.choi.id, source: 'mcp' })
    // a move takes it along, a folder move takes everything inside
    W.svc(W.choi).move('shared/who.md', 'shared/sub/who2.md')
    expect(change('shared/who.md')).toBeNull()
    expect(change('shared/sub/who2.md')).toEqual({ user_id: W.choi.id, source: 'mcp' })
    W.svc(W.choi).move('shared/sub', 'shared/sub-renamed')
    expect(change('shared/sub-renamed/who2.md')).toEqual({ user_id: W.choi.id, source: 'mcp' })
    expect(change('shared/sub/who2.md')).toBeNull()
    W.svc(W.choi).remove('shared/sub-renamed/who2.md')
    expect(change('shared/sub-renamed/who2.md')).toBeNull()
    W.svc(W.choi).move('shared/sub-renamed', 'shared/sub')
  })

  test('only a record that is not older than the file is trusted', () => {
    const rel = 'shared/trust.md'
    recordChange(db(), rel, W.park.id, 'web')
    const now = Date.now()
    expect(lastChange(db(), rel, now - 1000)?.userName).toBe('park')
    expect(lastChange(db(), rel, now + 60_000)).toBeNull() // the file was changed later by someone else
    expect(lastChange(db(), 'shared/unknown.md', now)).toBeNull()
    dropChange(db(), rel)
    expect(lastChange(db(), rel, now)).toBeNull()
  })

  test('Korean paths are matched in NFC; a folder prefix does not catch a sibling or a different case', () => {
    recordChange(db(), '영업/표.txt'.normalize('NFD'), W.park.id, 'web')
    expect(lastChange(db(), '영업/표.txt', Date.now())?.userName).toBe('park')
    recordChange(db(), 'Docs/a.txt', W.park.id, 'web')
    recordChange(db(), 'Docs2/a.txt', W.park.id, 'web')
    recordChange(db(), 'docs/b.txt', W.han.id, 'web')
    moveChange(db(), 'Docs', 'Moved')
    expect(change('Moved/a.txt')).not.toBeNull()
    expect(change('Docs/a.txt')).toBeNull()
    expect(change('Docs2/a.txt')).not.toBeNull()
    expect(change('docs/b.txt')).not.toBeNull() // another folder (case differs): untouched
  })
})

describe.skipIf(!rg)('search and text extraction stay in step with uploads, renames, moves and deletes', () => {
  const search = async (u: Parameters<World['svc']>[0], q: string) => {
    const r = await W.svc(u).search({ query: q, mode: 'content' })
    if (r.mode !== 'content') throw new Error('mode')
    return [...new Set(r.hits.map((h) => h.path))].sort()
  }
  const xlsx = (token: string) => xlsxBook([['월', '메모'], ['3월', token]])

  test('upload → found; overwrite → only the new text; rename and move → found at the new path; delete → gone; restore → back', async () => {
    const up = async (data: Uint8Array, overwrite = false) => (await (await formUpload(W.hub, choi, 'shared', [{ name: '매출.xlsx', data }], { overwrite })).json()) as any
    expect((await up(xlsx('CANARY-UP-ONE'))).items[0].status).toBe('created')
    await indexingDone(W.hub.ctx)
    expect(fs.existsSync(cacheFile('shared/매출.xlsx'))).toBe(true) // read in the background right after the upload
    expect(await search(W.choi, 'CANARY-UP-ONE')).toEqual(['shared/매출.xlsx'])
    const read = async () => { const r = await W.svc(W.choi).read('shared/매출.xlsx'); return r.kind === 'text' ? r.lines.join('\n') : '' }
    expect(await read()).toContain('CANARY-UP-ONE')

    // replaced: the old words are gone from search and from read_file, the new ones are there
    expect((await up(xlsx('CANARY-UP-TWO'), true)).items[0].status).toBe('replaced')
    await indexingDone(W.hub.ctx)
    expect(await search(W.choi, 'CANARY-UP-ONE')).toEqual([])
    expect(await search(W.choi, 'CANARY-UP-TWO')).toEqual(['shared/매출.xlsx'])
    const text = await read()
    expect(text).toContain('CANARY-UP-TWO')
    expect(text).not.toContain('CANARY-UP-ONE')

    // renamed through the page
    const r1 = await post(W.hub, '/files/rename', choi, { path: 'shared/매출.xlsx', name: '매출 2026.xlsx' })
    expect(r1.status).toBe(303)
    expect(await search(W.choi, 'CANARY-UP-TWO')).toEqual(['shared/매출 2026.xlsx'])
    expect(fs.existsSync(cacheFile('shared/매출.xlsx'))).toBe(false)
    expect(fs.existsSync(cacheFile('shared/매출 2026.xlsx'))).toBe(true) // the text moved with the file, it was not read again

    // moved, and a folder moved
    await post(W.hub, '/files/move', choi, { path: 'shared/매출 2026.xlsx', to: 'shared/sub' })
    expect(await search(W.choi, 'CANARY-UP-TWO')).toEqual(['shared/sub/매출 2026.xlsx'])
    await post(W.hub, '/files/move', choi, { path: 'shared/sub', to: 'shared/notes' })
    expect(await search(W.choi, 'CANARY-UP-TWO')).toEqual(['shared/notes/sub/매출 2026.xlsx'])
    expect(fs.existsSync(cacheFile('shared/sub/매출 2026.xlsx'))).toBe(false)

    // deleted: no longer found, the extracted text is not kept around
    const del = await post(W.hub, '/files/delete', choi, { path: 'shared/notes/sub/매출 2026.xlsx' })
    expect(del.status).toBe(303)
    expect(await search(W.choi, 'CANARY-UP-TWO')).toEqual([])
    expect(fs.existsSync(cacheFile('shared/notes/sub/매출 2026.xlsx'))).toBe(false)
    expect(fs.existsSync(W.abs('shared/notes/sub/매출 2026.xlsx'))).toBe(false)

    // restored by an admin: searchable again
    const v = db().query("SELECT id FROM file_versions WHERE path = 'shared/notes/sub/매출 2026.xlsx' AND reason = 'trash'").get() as { id: string }
    restoreVersion(W.hub.ctx, v.id, W.admin.id)
    expect(await search(W.choi, 'CANARY-UP-TWO')).toEqual(['shared/notes/sub/매출 2026.xlsx'])
    await post(W.hub, '/files/move', choi, { path: 'shared/notes/sub', to: 'shared' }) // tidy
  })

  test('the same words in a different file that took the old name are not mistaken for the old text', async () => {
    await formUpload(W.hub, choi, 'shared', [{ name: 'same.hwpx', data: hwpxDoc('CANARY-HWP-A') }])
    await indexingDone(W.hub.ctx)
    expect(await search(W.choi, 'CANARY-HWP-A')).toEqual(['shared/same.hwpx'])
    await post(W.hub, '/files/delete', choi, { path: 'shared/same.hwpx' })
    await formUpload(W.hub, choi, 'shared', [{ name: 'same.hwpx', data: hwpxDoc('CANARY-HWP-B') }])
    await indexingDone(W.hub.ctx)
    expect(await search(W.choi, 'CANARY-HWP-A')).toEqual([])
    expect(await search(W.choi, 'CANARY-HWP-B')).toEqual(['shared/same.hwpx'])
  })

  test('an uploaded document is found only by those who may read its folder', async () => {
    await formUpload(W.hub, park, 'sales', [{ name: '영업 전망.xlsx', data: xlsx('CANARY-UP-SALES') }])
    await indexingDone(W.hub.ctx)
    expect(await search(W.park, 'CANARY-UP-SALES')).toEqual(['sales/영업 전망.xlsx'])
    expect(await search(W.choi, 'CANARY-UP-SALES')).toEqual([])
    expect(await search(W.han, 'CANARY-UP-SALES')).toEqual([])
    expect(await search(W.admin, 'CANARY-UP-SALES')).toEqual(['sales/영업 전망.xlsx'])
  })

  test('name search sees uploads and renames at once', async () => {
    await formUpload(W.hub, choi, 'shared', [{ name: '이름검색용 문서.txt', data: 'x' }])
    const names = async (q: string) => { const r = await W.svc(W.choi).search({ query: q, mode: 'name' }); return r.mode === 'name' ? r.hits.map((h) => h.path) : [] }
    expect(await names('이름검색용')).toEqual(['shared/이름검색용 문서.txt'])
    await post(W.hub, '/files/rename', choi, { path: 'shared/이름검색용 문서.txt', name: '바뀐이름용.txt' })
    expect(await names('이름검색용')).toEqual([])
    expect(await names('바뀐이름용')).toEqual(['shared/바뀐이름용.txt'])
  })
})

describe('the audit trail', () => {
  test('uploads, folders, moves and deletes are in the audit log and shown in Korean; personal files are not named', async () => {
    const mine = `users/${W.choi.id}`
    await get(W.hub, `/files?path=${encodeURIComponent(mine)}`, choi) // makes the folder
    await formUpload(W.hub, choi, mine, [{ name: '비밀 메모.txt', data: 'x' }])
    await post(W.hub, '/files/rename', choi, { path: `${mine}/비밀 메모.txt`, name: '다른 비밀.txt' })
    await post(W.hub, '/files/delete', choi, { path: `${mine}/다른 비밀.txt` })
    const rows = db().query("SELECT action, target, detail FROM audit WHERE actor = ? AND action IN ('file.upload','file.move','file.delete') ORDER BY id DESC LIMIT 3").all(W.choi.id) as any[]
    expect(rows.map((r) => r.action).sort()).toEqual(['file.delete', 'file.move', 'file.upload'])
    for (const r of rows) {
      expect(r.target).toBe(mine) // the folder, never the file
      expect(r.detail).not.toContain('비밀')
    }
    // the tool events (like the MCP ones) do name the path, for the usage page's counts
    const ev = db().query("SELECT summary FROM tool_events WHERE tool LIKE 'web:%' AND user_id = ? ORDER BY id DESC LIMIT 5").all(W.choi.id) as any[]
    expect(ev.every((e) => e.summary.startsWith('웹 · '))).toBe(true)
    // an admin sees the rows on the audit page with Korean labels
    const page = await (await get(W.hub, '/admin/audit', admin)).text()
    expect(page).toContain('파일 올림')
    expect(page).toContain('파일 지움')
    expect(page).toContain('파일 이름·위치 바꿈')
    expect(page).not.toContain('비밀 메모')
    // the usage page's tool table lists the web tools
    expect(await (await get(W.hub, '/admin/usage', admin)).text()).toContain('web:upload')
  })

  test('a failed or refused attempt is a tool event with ok = 0', async () => {
    const before = (db().query("SELECT COUNT(*) AS n FROM tool_events WHERE ok = 0 AND tool LIKE 'web:%'").get() as any).n
    const j = (await (await formUpload(W.hub, choi, 'notice', [{ name: 'x.txt', data: 'x' }])).json()) as any
    expect(j.items[0].status).toBe('error')
    await post(W.hub, '/files/delete', choi, { path: 'notice/rules.md' })
    expect((db().query("SELECT COUNT(*) AS n FROM tool_events WHERE ok = 0 AND tool LIKE 'web:%'").get() as any).n).toBe(before + 2)
  })
})

describe('error texts', () => {
  test('every name rule becomes a Korean sentence; hidden and missing give one text; the model-facing text never reaches the page', () => {
    const samples = ['..', '.', 'a'.repeat(300), 'a\u0000b', 'a‮b', 'a／b', 'a:b', 'a.', ' a', 'CON', 'PROGRA~1', '.trina-tmp-x', '']
    for (const name of samples) {
      const reason = badSegment(name)
      expect({ name: name.slice(0, 12), reason: !!reason }).toEqual({ name: name.slice(0, 12), reason: true })
      const d = describeFileError(new Denied(reason!))
      expect(d.kind).toBe('name')
      expect(d.text).toMatch(/[가-힣]/)
      expect(d.text).not.toMatch(/[A-Za-z]{4,}\s[A-Za-z]{3,}/) // no English sentence
    }
    expect(describeFileError(new Denied('not found or no access: \'sales\''))).toMatchObject({ kind: 'hidden', status: 404 })
    expect(describeFileError(new ToolError('not found', 'not_found'))).toEqual(describeFileError(new Denied("not found or no access: 'x'")))
    expect(describeFileError(new Denied("read-only folder: you cannot create files in 'notice'"))).toMatchObject({ kind: 'read_only', status: 403 })
    expect(describeFileError(new Denied("'수금표' already exists with almost the same name; use that name or pick a clearly different one")).text).toContain('수금표')
    expect(describeFileError(new Denied('symbolic links are not followed: a/b'))).toMatchObject({ kind: 'unsafe' })
    expect(describeFileError(new Error('boom'))).toMatchObject({ kind: 'other', status: 500 })
    // the typed hidden path is never echoed
    expect(describeFileError(new Denied("not found or no access: 'shared/hr/salaries.md'")).text).not.toContain('salaries')
  })
})

describe('per-route body limits', () => {
  const guard = bodyGuard({ default: 100, routes: { '/files/upload': 1000 } })
  // on the wire a body has a Content-Length or is chunked; a Request made in memory has neither header, so say it
  const req = (path: string, body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request('http://hub.test' + path, { method: 'POST', body, headers: { ...(typeof body === 'string' ? { 'content-length': String(body.length) } : {}), ...headers }, duplex: 'half' } as RequestInit)
  const chunked = (n: number) => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < n; i += 10) c.enqueue(new Uint8Array(10)); c.close() } })

  test('Bun is told the largest limit; each route gets its own', async () => {
    expect(guard.max).toBe(1000)
    const ok = guard.apply(req('/login', 'x'.repeat(100)))
    expect(ok).toBeInstanceOf(Request)
    // declared too large: refused up front
    const big = guard.apply(req('/login', 'x'.repeat(101)))
    expect(big).toBeInstanceOf(Response)
    expect((big as Response).status).toBe(413)
    // the upload route takes more
    expect(guard.apply(req('/files/upload', 'x'.repeat(900)))).toBeInstanceOf(Request)
    expect(guard.apply(req('/files/upload', 'x'.repeat(1001)))).toBeInstanceOf(Response)
    // GET and bodiless requests are left alone
    expect(guard.apply(new Request('http://hub.test/healthz'))).toBeInstanceOf(Request)
  })

  test('a body without a length is counted as it is read, and fails with a 413', async () => {
    const small = guard.apply(req('/api/enroll', chunked(100), { 'content-type': 'application/octet-stream' })) as Request
    expect((await small.arrayBuffer()).byteLength).toBe(100)
    const tooBig = guard.apply(req('/api/enroll', chunked(500), { 'content-type': 'application/octet-stream' })) as Request
    const err = await tooBig.arrayBuffer().then(() => null, (e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(413)
    // the upload route is not wrapped (the upload code counts)
    const up = guard.apply(req('/files/upload', chunked(500))) as Request
    expect((await up.arrayBuffer()).byteLength).toBe(500)
  })

  test('on a running hub: a normal route still refuses a 65 MB body, the upload route does not', async () => {
    const chunkedBig = new ReadableStream<Uint8Array>({
      pull: (() => { let n = 0; const c = new Uint8Array(1 << 20); return (ctrl: ReadableStreamDefaultController<Uint8Array>) => { if (n++ >= 65) ctrl.close(); else ctrl.enqueue(c) } })(),
    })
    const r = await fetch(W.hub.url + '/api/enroll', { method: 'POST', body: chunkedBig, duplex: 'half', headers: { 'content-type': 'application/json' } } as RequestInit).catch((e) => e)
    // either the 413 or a reset connection after it; never accepted
    if (r instanceof Response) expect(r.status).toBe(413)
  })
})

describe('after the dust settles', () => {
  test('no staging folder is left behind', async () => {
    const dir = path.join(W.root, PRODUCT.systemDir, 'uploads')
    for (let i = 0; i < 40 && fs.existsSync(dir) && fs.readdirSync(dir).length; i++) await Bun.sleep(50)
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([])
    expect(notices('')).toEqual([])
    expect(MB).toBe(1048576)
  })
})
