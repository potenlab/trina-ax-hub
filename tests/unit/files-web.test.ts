// 회사 파일 (/files): what each person sees, hidden = missing on every route, download headers, the forms (new folder,
// rename, move, delete) and CSRF, session-only access, navigation, and the admin folders page.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import { makeWorld, type World } from './files-world'
import { get, post, follow, type Sess } from './web-lib'
import { formUpload, listed, mask, notices } from './files-upload-lib'
import { tinyPdf } from './files-fixtures'
import { restoreVersion } from '../../src/files/versions'
import { contentDisposition } from '../../src/web/files'
import { PRODUCT } from '../../src/product'

let W: World
let owner: Sess, admin: Sess, park: Sess, choi: Sess, han: Sess
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])

beforeAll(async () => {
  W = await makeWorld()
  owner = W.hub.session(W.owner.id); admin = W.hub.session(W.admin.id)
  park = W.hub.session(W.park.id); choi = W.hub.session(W.choi.id); han = W.hub.session(W.han.id)
  fs.writeFileSync(W.abs('shared/pic.png'), PNG)
  fs.writeFileSync(W.abs('shared/fake.png'), 'this is not an image <script>alert(1)</script>')
  fs.writeFileSync(W.abs('shared/doc.pdf'), tinyPdf('hello pdf'))
  fs.writeFileSync(W.abs('shared/fake.pdf'), '<html><script>alert(1)</script></html>')
  fs.writeFileSync(W.abs('shared/page.html'), '<html><script>alert(1)</script></html>')
  fs.writeFileSync(W.abs('shared/vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
})
afterAll(async () => { await W?.hub.stop() })

const page = async (path: string, s: Sess | null) => { const r = await get(W.hub, path, s); return { r, status: r.status, text: await r.text() } }
/** POST a form and read the message it leaves on the next page. */
async function mutate(path: string, s: Sess, fields: Record<string, string>) {
  const r = await post(W.hub, path, s, fields)
  const loc = r.headers.get('location')
  const next = await page('/files', s) // the flash is shown by whichever files page comes next
  return { status: r.status, location: loc, flash: notices(next.text) }
}

describe('what each person sees', () => {
  test('top level: exactly their folders; the system folder and others\' personal folders never show', async () => {
    const top = async (s: Sess) => listed((await page('/files', s)).text).sort()
    // users/ is shown as 개인 폴더
    expect(await top(choi)).toEqual(['notice/', 'shared/', 'skills/', '개인 폴더/'].sort())
    expect(await top(park)).toEqual(['notice/', 'sales/', 'shared/', 'skills/', '개인 폴더/'].sort())
    expect(await top(han)).toEqual(['finance/', 'notice/', 'shared/', 'skills/', '개인 폴더/'].sort())
    for (const s of [admin, owner]) expect(await top(s)).toEqual(['finance/', 'notice/', 'sales/', 'shared/', 'skills/', '개인 폴더/'].sort())
    expect((await page('/files', owner)).text).not.toContain(PRODUCT.systemDir)
  })

  test('a folder lists its files with size, modified time and, once changed through the hub, who', async () => {
    const hello = await page('/files?path=shared', choi)
    expect(hello.status).toBe(200)
    expect(listed(hello.text)).toEqual(['sub/', 'doc.pdf', 'fake.pdf', 'fake.png', 'hello.md', 'page.html', 'pic.png', 'vector.svg'].sort((a, b) => (a.endsWith('/') === b.endsWith('/') ? a.localeCompare(b) : a.endsWith('/') ? -1 : 1)))
    expect(hello.text).not.toContain('hr/')
    expect(hello.text).toContain('회사 파일')
    // changed through the hub: the name is shown; a file copied onto the machine has none
    const up = await formUpload(W.hub, park, 'shared', [{ name: 'by-park.txt', data: 'x' }])
    expect(up.status).toBe(200)
    const after = (await page('/files?path=shared', choi)).text
    const row = after.split('<tr>').find((r) => r.includes('by-park.txt'))!
    expect(row).toContain('park')
    const copied = after.split('<tr>').find((r) => r.includes('hello.md'))!
    expect(copied).not.toContain('park')
    // an MCP write is recorded too
    W.svc(W.han).write('shared/by-han.md', 'x')
    expect((await page('/files?path=shared', choi)).text.split('<tr>').find((r) => r.includes('by-han.md'))!).toContain('han')
    // a file changed behind the hub's back later shows nobody
    await Bun.sleep(30)
    fs.writeFileSync(W.abs('shared/by-han.md'), 'changed on disk')
    const t = new Date(Date.now() + 10_000)
    fs.utimesSync(W.abs('shared/by-han.md'), t, t)
    expect((await page('/files?path=shared', choi)).text.split('<tr>').find((r) => r.includes('by-han.md'))!).not.toContain('>han<')
  })

  test('a hidden folder looks exactly like one that does not exist (the list, the manage page, the download)', async () => {
    const pairs: [Sess, string, string][] = [
      [choi, 'sales', 'nosuch'], [choi, 'finance', 'nosuch'], [han, 'sales', 'nosuch'],
      [choi, 'shared/hr', 'shared/hx'], [choi, 'shared/hr/salaries.md', 'shared/hx/salaries.md'], [choi, 'shared/HR', 'shared/hy'],
      [choi, 'sales/plan.md', 'nosuch/plan.md'], [choi, 'skills/sales-pack', 'skills/sales-packz'],
      [choi, `users/${W.park.id}`, `users/${W.park.id}x`], [W.hub.session(W.owner.id), `users/${W.park.id}/diary.md`, `users/${W.park.id}x/diary.md`],
      [admin, `users/${W.park.id}`, `users/${W.park.id}x`],
    ]
    for (const [s, hid, miss] of pairs) {
      for (const route of ['/files?path=', '/files/item?path=', '/files/download?path='] as const) {
        const h = await page(route + encodeURIComponent(hid), s), m = await page(route + encodeURIComponent(miss), s)
        expect({ route, hid, status: h.status }).toEqual({ route, hid, status: 404 })
        expect(m.status).toBe(404)
        expect(mask(h.text, hid)).toBe(mask(m.text, miss))
        expect(h.text).not.toContain('CANARY')
      }
    }
    // admins do see them
    expect((await page('/files?path=shared/hr', admin)).status).toBe(200)
    expect(listed((await page('/files?path=shared/hr', admin)).text)).toEqual(['salaries.md'])
  })

  test('a hidden folder never appears in a list, and its name is not guessable from the move targets', async () => {
    const shared = (await page('/files?path=shared', choi)).text
    expect(shared).not.toContain('shared%2Fhr')
    expect(shared).not.toContain('salaries')
    W.hub.write('shared/note.txt', 'n')
    const item = (await page('/files/item?path=shared/note.txt', choi)).text
    expect(item).not.toContain('value="shared/hr"')
    expect(item).not.toContain('value="sales"')
    expect(item).toContain('value="shared/sub"')
    expect(item).not.toContain('value="notice"') // read-only: not a place to move to
    const adminItem = (await page('/files/item?path=shared/note.txt', admin)).text
    expect(adminItem).toContain('value="shared/hr"')
    expect(adminItem).not.toContain(`value="users/${W.park.id}"`)
  })

  test('a person\'s own folder: made on first visit, listed with a friendly name, private from everyone else', async () => {
    const own = `users/${W.choi.id}`
    expect(fs.existsSync(W.abs(own))).toBe(false)
    const first = await page('/files?path=' + encodeURIComponent(own), choi)
    expect(first.status).toBe(200)
    expect(fs.existsSync(W.abs(own))).toBe(true)
    expect(first.text).toContain('내 폴더')
    // park's folder and files
    const parkOwn = await page(`/files?path=${encodeURIComponent(`users/${W.park.id}`)}`, park)
    expect(listed(parkOwn.text)).toEqual(['diary.md'])
    const users = await page('/files?path=users', park)
    expect(listed(users.text)).toEqual(['내 폴더/'])
    expect(users.text).toContain('내 폴더')
    expect(listed((await page('/files?path=users', owner)).text)).toEqual([])
    // somebody else cannot make it, open it or download from it
    expect((await page(`/files?path=${encodeURIComponent(`users/${W.han.id}`)}`, choi)).status).toBe(404)
    expect(fs.existsSync(W.abs(`users/${W.han.id}`))).toBe(false)
    // the personal folder cannot be renamed or deleted from the page
    const r = await mutate('/files/delete', choi, { path: own })
    expect(r.flash.join(' ')).toContain('바꾸거나 지울 수 없어요')
    expect(fs.existsSync(W.abs(own))).toBe(true)
  })

  test('a file path in ?path= goes to its folder; nonsense paths are 404, never a 500', async () => {
    const r = await get(W.hub, '/files?path=shared/hello.md', choi)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/files?path=shared')
    for (const bad of ['../etc', '/etc', 'shared/../sales', 'a\\b', 'x'.repeat(2000), 'CON', 'shared/%00x']) {
      const x = await page('/files?path=' + encodeURIComponent(bad), choi)
      expect({ bad: bad.slice(0, 20), status: x.status }).toEqual({ bad: bad.slice(0, 20), status: 404 })
    }
  })

  test('read-only folders show a note and no upload or new-folder forms; writable ones show both', async () => {
    const ro = (await page('/files?path=notice', choi)).text
    expect(ro).toContain('읽기만 할 수 있어요')
    expect(ro).not.toContain('action="/files/upload"')
    expect(ro).not.toContain('action="/files/folder"')
    expect(ro).not.toContain('/files/item?') // no 관리 links
    const rw = (await page('/files?path=shared', choi)).text
    expect(rw).toContain('action="/files/upload"')
    expect(rw).toContain('enctype="multipart/form-data"')
    expect(rw).toContain('action="/files/folder"')
    expect(rw).toContain('type="file"')
    // a phone: the file input is a plain multiple file input (no capture, no accept filter that hides documents)
    expect(rw).toMatch(/<input[^>]*type="file"[^>]*multiple/)
    expect(rw).not.toMatch(/<input[^>]*type="file"[^>]*accept=/)
    expect(rw).toContain('name="_csrf"')
    // members have nothing to upload at the top level, admins do
    expect((await page('/files', choi)).text).not.toContain('action="/files/upload"')
    expect((await page('/files', admin)).text).toContain('action="/files/upload"')
  })
})

describe('download', () => {
  test('headers: attachment, octet-stream, nosniff, no-store, sandbox CSP, the right length', async () => {
    const r = await get(W.hub, '/files/download?path=shared/hello.md', choi)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/octet-stream')
    expect(r.headers.get('content-disposition')).toStartWith('attachment;')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('content-security-policy')).toContain('sandbox')
    expect(r.headers.get('content-length')).toBe(String(fs.statSync(W.abs('shared/hello.md')).size))
    expect(await r.text()).toBe(fs.readFileSync(W.abs('shared/hello.md'), 'utf8'))
  })

  test('HTML, SVG and anything with a script in it are saved, never shown; only a verified image or PDF opens', async () => {
    const kind = async (p: string, q = '') => {
      const r = await get(W.hub, `/files/download?path=${encodeURIComponent(p)}${q}`, choi)
      await r.arrayBuffer()
      return { type: r.headers.get('content-type'), disp: (r.headers.get('content-disposition') ?? '').split(';')[0], nosniff: r.headers.get('x-content-type-options') }
    }
    expect(await kind('shared/page.html')).toEqual({ type: 'application/octet-stream', disp: 'attachment', nosniff: 'nosniff' })
    expect(await kind('shared/vector.svg')).toEqual({ type: 'application/octet-stream', disp: 'attachment', nosniff: 'nosniff' })
    expect(await kind('shared/fake.png')).toEqual({ type: 'application/octet-stream', disp: 'attachment', nosniff: 'nosniff' })
    expect(await kind('shared/fake.pdf')).toEqual({ type: 'application/octet-stream', disp: 'attachment', nosniff: 'nosniff' })
    expect(await kind('shared/pic.png')).toEqual({ type: 'image/png', disp: 'inline', nosniff: 'nosniff' })
    expect(await kind('shared/doc.pdf')).toEqual({ type: 'application/pdf', disp: 'inline', nosniff: 'nosniff' })
    expect(await kind('shared/pic.png', '&dl=1')).toMatchObject({ disp: 'attachment' })
    expect(await kind('shared/doc.pdf', '&dl=1')).toMatchObject({ type: 'application/octet-stream', disp: 'attachment' })
    const png = await get(W.hub, '/files/download?path=shared/pic.png', choi)
    expect(png.headers.get('content-security-policy')).toContain('sandbox')
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(PNG)
  })

  test('Korean file names: Content-Disposition carries the real name (filename*) and an ASCII fallback', async () => {
    const name = '2026년 3분기 보고서 (최종).txt'
    W.hub.write(`shared/${name}`, '본문')
    const r = await get(W.hub, `/files/download?path=${encodeURIComponent('shared/' + name)}`, choi)
    expect(r.status).toBe(200)
    const cd = r.headers.get('content-disposition')!
    expect(cd).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/)
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(cd)![1]!)).toBe(name)
    expect(await r.text()).toBe('본문')
    // names that would break a header or mislead a browser
    for (const n of ['a"b.txt', 'a;b.txt', "it's (1).txt", '100%.txt', '한글.PDF', '이름만', 'a\u00e9.txt']) {
      const h = contentDisposition(n, 'attachment')
      expect(h).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%._~-]+$/)
      expect(h.split('filename="')[1]!.split('"')[0]).not.toMatch(/["\\%;]/)
      expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(h)![1]!)).toBe(n)
    }
    expect(contentDisposition('보고서.xlsx', 'attachment')).toStartWith('attachment; filename="_.xlsx"')
  })

  test('a folder goes to its list; links, hard links and unreadable things are plain 404s', async () => {
    const dir = await get(W.hub, '/files/download?path=shared/sub', choi)
    expect(dir.status).toBe(302)
    expect(dir.headers.get('location')).toBe('/files?path=shared%2Fsub')
    fs.symlinkSync(W.abs('finance/budget.md'), W.abs('shared/ln-file.md'))
    fs.symlinkSync(W.abs('finance'), W.abs('shared/ln-dir'))
    fs.linkSync(W.abs('finance/budget.md'), W.abs('shared/hard.md'))
    for (const p of ['shared/ln-file.md', 'shared/ln-dir/budget.md', 'shared/hard.md']) {
      const r = await page('/files/download?path=' + encodeURIComponent(p), choi)
      expect({ p, status: r.status }).toEqual({ p, status: 404 })
      expect(r.text).not.toContain('CANARY-FIN')
    }
    expect((await page('/files?path=shared/ln-dir', choi)).status).toBe(404)
    expect(listed((await page('/files?path=shared', choi)).text)).not.toContain('ln-file.md')
    expect(listed((await page('/files?path=shared', choi)).text)).not.toContain('hard.md')
    fs.rmSync(W.abs('shared/ln-file.md')); fs.rmSync(W.abs('shared/ln-dir')); fs.rmSync(W.abs('shared/hard.md'))
  })

  test('HEAD answers the headers only', async () => {
    const r = await fetch(W.hub.url + '/files/download?path=shared/hello.md', { method: 'HEAD', headers: { cookie: choi.cookie } })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-length')).toBe(String(fs.statSync(W.abs('shared/hello.md')).size))
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await r.arrayBuffer()).byteLength).toBe(0)
  })

  test('a download is recorded like a file tool call, from "웹"', async () => {
    const before = (W.hub.ctx.db.query("SELECT COUNT(*) AS n FROM tool_events WHERE tool = 'web:download'").get() as any).n
    await (await get(W.hub, '/files/download?path=shared/hello.md', park)).arrayBuffer()
    const rows = W.hub.ctx.db.query("SELECT * FROM tool_events WHERE tool = 'web:download' ORDER BY id DESC").all() as any[]
    expect(rows.length).toBe(before + 1)
    expect(rows[0]).toMatchObject({ user_id: W.park.id, token_id: null, ok: 1 })
    expect(rows[0].summary).toContain('웹')
    expect(rows[0].summary).toContain('shared/hello.md')
    // a refused download is not recorded as a success
    await get(W.hub, '/files/download?path=sales/plan.md', choi)
    expect((W.hub.ctx.db.query("SELECT COUNT(*) AS n FROM tool_events WHERE tool = 'web:download'").get() as any).n).toBe(before + 1)
  })
})

describe('forms: new folder, rename, move, delete', () => {
  test('new folder: where the person may write; admins at the top level; a name is a name, not a path', async () => {
    let r = await mutate('/files/folder', choi, { dir: 'shared', name: '신규 폴더' })
    expect(r.status).toBe(303)
    expect(r.flash.join(' ')).toContain('만들었어요')
    expect(fs.statSync(W.abs('shared/신규 폴더')).isDirectory()).toBe(true)
    expect(listed((await page('/files?path=shared', choi)).text)).toContain('신규 폴더/')
    r = await mutate('/files/folder', choi, { dir: 'shared', name: '신규 폴더' })
    expect(r.flash.join(' ')).toContain('이미 있어요')
    for (const bad of ['a/b', 'a\\b', '..', '.', 'CON', 'x:y', '', '  ', 'end.', '.trina-tmp-x']) {
      r = await mutate('/files/folder', choi, { dir: 'shared', name: bad })
      expect({ bad, ok: r.flash.some((f) => f.includes('만들었어요')) }).toEqual({ bad, ok: false })
      expect(r.flash.length).toBeGreaterThan(0)
    }
    expect(fs.readdirSync(W.abs('shared')).filter((n) => /^(a|CON|x:y|end\.|\.)/.test(n))).toEqual([])
    // hidden/read-only/top level for a member
    for (const dir of ['', 'notice', 'sales', 'shared/hr', 'nosuch']) {
      r = await mutate('/files/folder', choi, { dir, name: '몰래' })
      expect({ dir, made: r.flash.some((f) => f.includes('만들었어요')) }).toEqual({ dir, made: false })
    }
    expect(fs.existsSync(W.abs('몰래')) || fs.existsSync(W.abs('notice/몰래')) || fs.existsSync(W.abs('shared/hr/몰래'))).toBe(false)
    // the answer for a hidden folder is the answer for a missing one
    const hid = await mutate('/files/folder', choi, { dir: 'sales', name: 'x' }), miss = await mutate('/files/folder', choi, { dir: 'nosuch', name: 'x' })
    expect(hid.flash).toEqual(miss.flash)
    r = await mutate('/files/folder', admin, { dir: '', name: '.trina' }) // the hub's own folder is not a name
    expect(r.flash.join(' ')).not.toContain('만들었어요')
    r = await mutate('/files/folder', admin, { dir: '', name: '영업팀' })
    expect(r.flash.join(' ')).toContain('만들었어요')
    expect(fs.statSync(W.abs('영업팀')).isDirectory()).toBe(true)
    // creating from the admin page goes back there
    const go = await post(W.hub, '/files/folder', admin, { dir: '', name: '재무팀', next: '/admin/folders' })
    expect(go.headers.get('location')).toBe('/admin/folders')
    expect(fs.existsSync(W.abs('재무팀'))).toBe(true)
    const evil = await post(W.hub, '/files/folder', admin, { dir: '', name: '인사팀', next: 'https://evil.example/' })
    expect(evil.headers.get('location')).toBe('/files')
    expect(audit('folder.create').length).toBeGreaterThanOrEqual(3)
  })

  const audit = (action: string) => W.hub.ctx.db.query('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action) as any[]

  test('rename: a Korean name stays NFC, the old name goes, the audit log and tool events say who', async () => {
    W.hub.write('shared/old name.txt', '내용')
    const nfd = '새 이름 한글.txt'.normalize('NFD')
    const r = await mutate('/files/rename', choi, { path: 'shared/old name.txt', name: nfd })
    expect(r.flash.join(' ')).toContain('바꿨어요')
    expect(fs.existsSync(W.abs('shared/old name.txt'))).toBe(false)
    expect(fs.readdirSync(W.abs('shared')).filter((n) => n.normalize('NFC') === '새 이름 한글.txt').map((n) => n === n.normalize('NFC'))).toEqual([true])
    const a = audit('file.move').at(-1)!
    expect(a.actor).toBe(W.choi.id)
    expect(JSON.parse(a.detail)).toMatchObject({ via: 'web' })
    expect(a.detail).not.toContain('내용')
    const ev = W.hub.ctx.db.query("SELECT * FROM tool_events WHERE tool = 'web:move' ORDER BY id DESC").get() as any
    expect(ev).toMatchObject({ user_id: W.choi.id, ok: 1 })
    expect(ev.summary).toContain('웹')
  })

  test('rename refuses: an existing name, a slash, an empty name, another file kind, a hidden or read-only file', async () => {
    W.hub.write('shared/r1.txt', '1'); W.hub.write('shared/r2.txt', '2')
    const flash = async (path: string, name: string, s = choi) => (await mutate('/files/rename', s, { path, name })).flash.join(' ')
    expect(await flash('shared/r1.txt', 'r2.txt')).toContain('같은 이름')
    expect(fs.readFileSync(W.abs('shared/r2.txt'), 'utf8')).toBe('2')
    expect(await flash('shared/r1.txt', 'sub/r1.txt')).toContain('/')
    expect(await flash('shared/r1.txt', '')).toContain('새 이름')
    expect(await flash('shared/r1.txt', 'r1.xlsx')).toContain('확장자')
    expect(await flash('shared/r1.txt', 'CON.txt')).toContain('윈도우')
    expect(fs.existsSync(W.abs('shared/r1.txt'))).toBe(true)
    // read-only notice/rules.md; hidden shared/hr/salaries.md == missing shared/hx/salaries.md
    expect(await flash('notice/rules.md', 'x.md')).toContain('읽기만')
    expect(await flash('shared/hr/salaries.md', 'x.md')).toBe(await flash('shared/hx/salaries.md', 'x.md'))
    expect(await flash('sales/plan.md', 'x.md')).toBe(await flash('nosuch/plan.md', 'x.md'))
    expect(fs.existsSync(W.abs('shared/hr/salaries.md'))).toBe(true)
    expect(fs.existsSync(W.abs('sales/x.md'))).toBe(false)
    // the manage form for them is not even offered
    expect((await page('/files/item?path=notice/rules.md', choi)).status).toBe(404)
    // a case-only / form-only rename of the same file works
    expect(await flash('shared/r1.txt', 'R1.txt')).toContain('바꿨어요')
  })

  test('move: only into folders the person may write; the file keeps its name; hidden targets are refused like missing ones', async () => {
    W.hub.write('shared/m1.txt', 'move me')
    let r = await mutate('/files/move', choi, { path: 'shared/m1.txt', to: 'shared/sub' })
    expect(r.flash.join(' ')).toContain('옮겼어요')
    expect(fs.readFileSync(W.abs('shared/sub/m1.txt'), 'utf8')).toBe('move me')
    expect(fs.existsSync(W.abs('shared/m1.txt'))).toBe(false)
    for (const to of ['notice', 'sales', 'shared/hr', 'skills/sales-pack']) {
      r = await mutate('/files/move', choi, { path: 'shared/sub/m1.txt', to })
      expect({ to, moved: fs.existsSync(W.abs(`${to}/m1.txt`)) }).toEqual({ to, moved: false })
      expect(fs.existsSync(W.abs('shared/sub/m1.txt'))).toBe(true)
    }
    const hid = (await mutate('/files/move', choi, { path: 'shared/sub/m1.txt', to: 'sales' })).flash
    const miss = (await mutate('/files/move', choi, { path: 'shared/sub/m1.txt', to: 'nosuch' })).flash
    expect(hid).toEqual(miss)
    // a hidden source is the same as a missing one
    expect((await mutate('/files/move', choi, { path: 'sales/plan.md', to: 'shared' })).flash).toEqual((await mutate('/files/move', choi, { path: 'nosuch/plan.md', to: 'shared' })).flash)
    expect(fs.existsSync(W.abs('sales/plan.md'))).toBe(true)
    // a name already there is not overwritten
    W.hub.write('shared/m1.txt', 'other')
    r = await mutate('/files/move', choi, { path: 'shared/m1.txt', to: 'shared/sub' })
    expect(r.flash.join(' ')).toContain('같은 이름')
    expect(fs.readFileSync(W.abs('shared/sub/m1.txt'), 'utf8')).toBe('move me')
    // folders move too, and not into themselves
    fs.mkdirSync(W.abs('shared/f1/inner'), { recursive: true })
    r = await mutate('/files/move', choi, { path: 'shared/f1', to: 'shared/f1/inner' })
    expect(r.flash.join(' ')).not.toContain('옮겼어요')
    expect(fs.existsSync(W.abs('shared/f1/inner'))).toBe(true)
    r = await mutate('/files/move', choi, { path: 'shared/f1', to: 'shared/sub' })
    expect(r.flash.join(' ')).toContain('옮겼어요')
    expect(fs.existsSync(W.abs('shared/sub/f1/inner'))).toBe(true)
  })

  test('delete goes to the trash with a version row and can be restored; nothing is erased', async () => {
    W.hub.write('shared/del-me.txt', '지워도 남아요')
    const r = await mutate('/files/delete', park, { path: 'shared/del-me.txt' })
    expect(r.flash.join(' ')).toContain('90일')
    expect(fs.existsSync(W.abs('shared/del-me.txt'))).toBe(false)
    const v = W.hub.ctx.db.query("SELECT * FROM file_versions WHERE path = 'shared/del-me.txt'").get() as any
    expect(v).toMatchObject({ reason: 'trash', user_id: W.park.id })
    expect(v.stored_as).toMatch(new RegExp(`^${PRODUCT.systemDir}/trash/\\d{4}-\\d{2}-\\d{2}/[^/]+/del-me\\.txt$`))
    expect(fs.readFileSync(W.abs(v.stored_as), 'utf8')).toBe('지워도 남아요')
    expect(audit('file.delete').at(-1)).toMatchObject({ actor: W.park.id, target: 'shared/del-me.txt' })
    // an admin restores it
    expect(restoreVersion(W.hub.ctx, v.id, W.admin.id).path).toBe('shared/del-me.txt')
    expect(fs.readFileSync(W.abs('shared/del-me.txt'), 'utf8')).toBe('지워도 남아요')
    // the same as through MCP: the old file in the trash is still there
    expect(fs.existsSync(W.abs(v.stored_as))).toBe(true)
  })

  test('delete refuses: hidden = missing, read-only, a folder with files, the personal folder root', async () => {
    const flash = async (path: string, s = choi) => (await mutate('/files/delete', s, { path })).flash.join(' ')
    expect(await flash('sales/plan.md')).toBe(await flash('nosuch/plan.md'))
    expect(await flash('shared/hr/salaries.md')).toBe(await flash('shared/hx/salaries.md'))
    expect(fs.existsSync(W.abs('sales/plan.md'))).toBe(true)
    expect(await flash('notice/rules.md')).toContain('읽기만')
    expect(fs.existsSync(W.abs('notice/rules.md'))).toBe(true)
    expect(await flash('shared/sub')).toContain('비어 있지 않아요')
    expect(fs.existsSync(W.abs('shared/sub/deep.md'))).toBe(true)
    fs.mkdirSync(W.abs('shared/empty-dir'))
    expect(await flash('shared/empty-dir')).toContain('지웠어요')
    expect(fs.existsSync(W.abs('shared/empty-dir'))).toBe(false)
    expect(await flash('')).not.toContain('지웠어요') // no path at all
    expect(await flash('users')).not.toContain('지웠어요')
  })
})

describe('CSRF and session-only access', () => {
  const routes: [string, Record<string, string>][] = [
    ['/files/folder', { dir: 'shared', name: 'csrf-folder' }],
    ['/files/rename', { path: 'shared/hello.md', name: 'csrf-renamed.md' }],
    ['/files/move', { path: 'shared/hello.md', to: 'shared/sub' }],
    ['/files/delete', { path: 'shared/hello.md' }],
  ]

  test('every form route refuses a missing or wrong _csrf with 403 and changes nothing', async () => {
    for (const [path, f] of routes) {
      for (const csrf of [false, 'wrong', park.csrf] as const) {
        const r = await post(W.hub, path, choi, f, { csrf })
        expect({ path, csrf: csrf === park.csrf ? 'another session' : csrf, status: r.status }).toEqual({ path, csrf: csrf === park.csrf ? 'another session' : csrf, status: 403 })
        expect(await r.text()).toContain('보안 확인')
      }
    }
    expect(fs.existsSync(W.abs('shared/csrf-folder'))).toBe(false)
    expect(fs.existsSync(W.abs('shared/hello.md'))).toBe(true)
    expect(fs.existsSync(W.abs('shared/csrf-renamed.md'))).toBe(false)
    expect(fs.existsSync(W.abs('shared/sub/hello.md'))).toBe(false)
  })

  test('no session: a page goes to the login page, a post too, and nothing changes', async () => {
    const g = await get(W.hub, '/files?path=shared', null)
    expect(g.status).toBe(302)
    expect(g.headers.get('location')).toStartWith('/login?next=')
    for (const [path, f] of [...routes, ['/files/upload', {}] as [string, Record<string, string>]]) {
      const r = await post(W.hub, path, null, f, { csrf: 'x' })
      expect({ path, status: r.status, loc: r.headers.get('location') }).toEqual({ path, status: 303, loc: '/login' })
    }
    for (const p of ['/files/item?path=shared/hello.md', '/files/download?path=shared/hello.md']) expect((await get(W.hub, p, null)).status).toBe(302)
    expect(fs.existsSync(W.abs('shared/hello.md'))).toBe(true)
  })

  test('device, hub and connector tokens are not logins: they open nothing under /files', async () => {
    const device = W.hub.token(W.choi.id, 'device'), hubTok = W.hub.token(W.choi.id, 'hub')
    for (const tok of [device, hubTok]) {
      const h = { authorization: `Bearer ${tok}`, 'x-api-key': tok }
      for (const p of ['/files', '/files?path=shared', '/files/download?path=shared/hello.md', '/files/item?path=shared/hello.md']) {
        const r = await fetch(W.hub.url + p, { headers: h, redirect: 'manual' })
        expect({ p, status: r.status }).toEqual({ p, status: 302 })
        expect(await r.text()).not.toContain('안녕하세요')
      }
      const j = await fetch(W.hub.url + '/files?path=shared', { headers: { ...h, accept: 'application/json' }, redirect: 'manual' })
      expect(j.status).toBe(401)
      const up = await fetch(W.hub.url + '/files/upload', { method: 'POST', headers: { ...h, accept: 'application/json', 'content-type': 'multipart/form-data; boundary=B' }, body: '--B--\r\n' })
      expect(up.status).toBe(401)
      const folder = await fetch(W.hub.url + '/files/folder', { method: 'POST', headers: h, body: new URLSearchParams({ dir: 'shared', name: 'viatoken', _csrf: 'x' }), redirect: 'manual' })
      expect(folder.status).toBe(303)
      expect(fs.existsSync(W.abs('shared/viatoken'))).toBe(false)
    }
  })

  test('every /files answer is no-store, errors and redirects included', async () => {
    const paths = ['/files', '/files?path=shared', '/files?path=sales', '/files/item?path=shared/hello.md', '/files/item?path=nosuch', '/files/download?path=shared/hello.md', '/files/download?path=nosuch', '/files?path=shared/hello.md']
    for (const p of paths) {
      const r = await get(W.hub, p, choi)
      await r.arrayBuffer()
      expect({ p, cc: r.headers.get('cache-control') }).toEqual({ p, cc: 'no-store' })
    }
    const out = await get(W.hub, '/files', null)
    expect(out.headers.get('cache-control')).toBe('no-store')
    const posted = await post(W.hub, '/files/folder', choi, { dir: 'shared', name: 'ns-test' })
    expect(posted.headers.get('cache-control')).toBe('no-store')
    const bad = await post(W.hub, '/files/folder', choi, { dir: 'shared', name: 'ns2' }, { csrf: false })
    expect(bad.headers.get('cache-control')).toBe('no-store')
  })
})

describe('navigation and the admin folders page', () => {
  test('"회사 파일" is in the personal and in the admin navigation, once', async () => {
    for (const [s, path] of [[choi, '/files'], [choi, '/me'], [admin, '/files'], [admin, '/admin'], [owner, '/admin/folders']] as [Sess, string][]) {
      const body = (await page(path, s)).text
      expect({ path, n: body.split('>회사 파일</a>').length - 1 }).toEqual({ path, n: 1 })
      expect(body).toContain('<a href="/files"')
    }
    // the current page is highlighted
    expect((await page('/files', choi)).text).toMatch(/<a href="\/files" class="on">회사 파일<\/a>/)
    expect((await page('/files', admin)).text).toMatch(/<a href="\/files" class="on">회사 파일<\/a>/)
  })

  test('the admin folders page points to /files and offers 새 폴더 instead of "copy onto the hub computer"', async () => {
    const p = (await page('/admin/folders', admin)).text
    expect(p).not.toContain('허브 컴퓨터의 팀 폴더')
    expect(p).toContain('href="/files"')
    expect(p).toContain('action="/files/folder"')
    expect(p).toContain('새 폴더')
    expect(p).toContain('name="next" value="/admin/folders"')
    expect(p).toContain('name="_csrf"')
    // folders in the tree open in 회사 파일
    expect(p).toContain('href="/files?path=shared"')
    expect(p).toContain('📁 shared')
    // the empty state, on a hub with no folders at all
    for (const n of fs.readdirSync(W.root)) if (n !== PRODUCT.systemDir) fs.renameSync(W.abs(n), W.abs(n).replace(/([^/]+)$/, '.moved-$1'))
    try {
      const empty = (await page('/admin/folders', admin)).text
      expect(empty).toContain('팀 폴더가 비어 있어요')
      expect(empty).toContain('href="/files"')
      expect(empty).toContain('action="/files/folder"')
      expect(empty).not.toContain('허브 컴퓨터')
    } finally {
      for (const n of fs.readdirSync(W.root)) if (n.startsWith('.moved-')) fs.renameSync(W.abs(n), W.abs(n.slice('.moved-'.length)))
    }
    // members still cannot use the admin page
    expect((await page('/admin/folders', choi)).status).toBe(403)
  })
})
