// FileService: the permission matrix, every operation's happy and error paths, versions and trash, path attacks.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { errorOf, makeWorld, masked, type World } from './files-world'
import { FileService, READ_MAX_CHARS } from '../../src/files/service'
import { updateUser } from '../../src/auth/users'
import { PRODUCT } from '../../src/product'
import { sha256 } from '../../src/files/store'

let W: World
beforeAll(async () => { W = await makeWorld() })
afterAll(async () => { await W?.hub.stop() })

const names = (r: { entries: { path: string; type: string }[] }) => r.entries.map((e) => e.path + (e.type === 'folder' ? '/' : ''))
const versions = (rel: string) => W.hub.ctx.db.query('SELECT * FROM file_versions WHERE path = ? ORDER BY created_at, rowid').all(rel) as any[]

describe('permission matrix', () => {
  test('top level: each person sees exactly their folders; .trina never shows', () => {
    const top = (u: Parameters<World['svc']>[0]) => names(W.svc(u).list()).sort()
    expect(top(W.choi)).toEqual(['notice/', 'shared/', 'skills/', 'users/'])
    expect(top(W.park)).toEqual(['notice/', 'sales/', 'shared/', 'skills/', 'users/'])
    expect(top(W.han)).toEqual(['finance/', 'notice/', 'shared/', 'skills/', 'users/'])
    for (const u of [W.admin, W.owner]) expect(top(u)).toEqual(['finance/', 'notice/', 'sales/', 'shared/', 'skills/', 'users/'])
    expect(fs.existsSync(W.abs(PRODUCT.systemDir))).toBe(true)
  })

  test('group-only folder: members of the group read and write, others get "not found"', async () => {
    expect((await W.svc(W.park).read('sales/plan.md')).kind).toBe('text')
    expect(W.svc(W.park).write('sales/new.md', 'x').created).toBe(true)
    for (const u of [W.choi, W.han]) {
      const hidden = await errorOf(() => W.svc(u).read('sales/plan.md'))
      const missing = await errorOf(() => W.svc(u).read('nosuch/plan.md'))
      expect(hidden).toContain('not found or no access')
      expect(masked(hidden, 'sales/plan.md')).toBe(masked(missing, 'nosuch/plan.md'))
      expect(masked(await errorOf(() => W.svc(u).list('sales')), 'sales')).toBe(masked(await errorOf(() => W.svc(u).list('nosuch')), 'nosuch'))
    }
  })

  test("users/<id>/ is private to that person, even from the owner and admins", async () => {
    const own = `users/${W.park.id}/diary.md`
    expect(((await W.svc(W.park).read(own)) as any).lines[0]).toContain('CANARY-PARK')
    for (const u of [W.owner, W.admin, W.choi]) {
      const e = await errorOf(() => W.svc(u).read(own))
      expect(e).toContain('not found or no access')
      expect(masked(e, own)).toBe(masked(await errorOf(() => W.svc(u).read(`users/${W.park.id}x/diary.md`)), `users/${W.park.id}x/diary.md`))
      expect(names(W.svc(u).list('users'))).not.toContain(`users/${W.park.id}/`)
      expect(await errorOf(() => W.svc(u).write(`users/${W.park.id}/x.md`, 'x'))).toContain('not found or no access')
    }
    expect(names(W.svc(W.park).list('users'))).toEqual([`users/${W.park.id}/`])
  })

  test('a hidden folder below a writable one answers every operation like a missing one', async () => {
    const s = W.svc(W.choi)
    const pairs: [string, string][] = [['shared/hr', 'shared/hx'], ['shared/hr/salaries.md', 'shared/hx/salaries.md'], ['shared/HR/salaries.md', 'shared/hy/salaries.md']]
    for (const [hid, miss] of pairs) {
      const ops: [string, (p: string) => unknown][] = [
        ['read', (p) => s.read(p)], ['list', (p) => s.list(p)],
        ['edit', (p) => s.edit(p, 'a', 'b')], ['delete', (p) => s.remove(p)],
        ['move from', (p) => s.move(p, 'shared/moved.md')],
      ]
      for (const [op, fn] of ops) {
        const h = await errorOf(() => fn(hid)), m = await errorOf(() => fn(miss))
        expect({ op, h: masked(h, hid) }).toEqual({ op, h: masked(m, miss) })
        expect(h ?? '').not.toContain('salaries.md ')
      }
    }
    // admins see it
    expect(((await W.svc(W.admin).read('shared/hr/salaries.md')) as any).lines[0]).toContain('CANARY-HR')
  })

  test('a hidden folder below a read-only one: writes there are refused as "read-only", like a missing name', async () => {
    const s = W.svc(W.choi)
    const h = await errorOf(() => s.write('skills/sales-pack/x.md', 'x'))
    const m = await errorOf(() => s.write('skills/sales-packz/x.md', 'x'))
    expect(h).toContain('read-only folder')
    expect(masked(h, 'skills/sales-pack')).toBe(masked(m, 'skills/sales-packz'))
    expect(masked(await errorOf(() => s.makeFolder('skills/sales-pack')), 'skills/sales-pack')).toBe(masked(await errorOf(() => s.makeFolder('skills/sales-packz')), 'skills/sales-packz'))
  })

  test('look-alike names of a hidden folder are refused like the hidden one', async () => {
    const s = W.svc(W.choi)
    for (const probe of ['shared/HR/x.md', 'shared/ｈｒ/x.md', 'shared/Hr/new.md']) {
      const e = await errorOf(() => s.write(probe, 'x'))
      expect(e).not.toBeNull()
      expect(e).not.toContain("'hr'")
    }
  })

  test('read-only folder: reads work, changes are refused', async () => {
    const s = W.svc(W.choi)
    expect((await s.read('notice/rules.md')).kind).toBe('text')
    expect(await errorOf(() => s.write('notice/rules.md', 'x', { overwrite: true }))).toContain('read-only')
    expect(await errorOf(() => s.write('notice/new.md', 'x'))).toContain('read-only folder')
    expect(await errorOf(() => s.edit('notice/rules.md', '사내', '회사'))).toContain('read-only')
    expect(await errorOf(() => s.remove('notice/rules.md'))).toContain('read-only')
    expect(await errorOf(() => s.move('notice/rules.md', 'shared/rules.md'))).toContain('read-only')
    expect(W.svc(W.choi).list('notice').readOnly).toBe(true)
    expect(W.svc(W.admin).list('notice').readOnly).toBe(false)
  })

  test('a person disabled in the middle loses access on the next service', async () => {
    const tmp = await W.hub.user('tmpuser')
    expect(FileService.forUser(W.hub.ctx, tmp.id).list().entries.length).toBeGreaterThan(0)
    updateUser(W.hub.ctx.db, tmp.id, { status: 'disabled' })
    expect(() => FileService.forUser(W.hub.ctx, tmp.id)).toThrow('disabled')
  })
})

describe('path attacks', () => {
  test('.., absolute, ~, backslash, NUL, URLs, drive letters, the system folder and temp names are refused', async () => {
    const s = W.svc(W.owner)
    for (const p of ['../etc/passwd', 'shared/../finance/budget.md', '/etc/passwd', '~/secret', '~', 'shared\\hello.md', 'shared/hello.md\0.txt',
      'file:///etc/passwd', 'C:/Windows', `${PRODUCT.systemDir}/versions`, `shared/${PRODUCT.tmpPrefix}x`, 'shared/ｆｉｎａｎｃｅ', 'shared/a\u202eb.md']) {
      expect({ p, e: await errorOf(() => s.read(p)) }).not.toEqual({ p, e: null })
      expect({ p, e: await errorOf(() => s.write(p, 'x')) }).not.toEqual({ p, e: null })
    }
    expect(fs.existsSync('/etc/passwd.md')).toBe(false)
  })

  test('symbolic links inside the team folder are never followed or listed', async () => {
    fs.symlinkSync(W.abs('finance'), W.abs('shared/fin-link'))
    fs.symlinkSync(W.abs('finance/budget.md'), W.abs('shared/budget-link.md'))
    fs.symlinkSync('/etc', W.abs('shared/etc-link'))
    const s = W.svc(W.choi)
    expect(names(s.list('shared'))).not.toContain('shared/fin-link/')
    expect(names(s.list('shared')).some((n) => n.includes('link'))).toBe(false)
    for (const p of ['shared/fin-link/budget.md', 'shared/budget-link.md', 'shared/etc-link/hosts']) {
      const e = await errorOf(() => s.read(p))
      expect(e).not.toBeNull()
      expect(e).not.toContain('CANARY')
    }
    expect(await errorOf(() => s.write('shared/budget-link.md', 'pwned', { overwrite: true }))).not.toBeNull()
    expect(await errorOf(() => s.write('shared/fin-link/new.md', 'pwned'))).not.toBeNull()
    expect(await errorOf(() => s.remove('shared/budget-link.md'))).not.toBeNull()
    expect(W.read('finance/budget.md')).toContain('CANARY-FIN')
    expect(fs.existsSync(W.abs('finance/new.md'))).toBe(false)
    for (const l of ['shared/fin-link', 'shared/budget-link.md', 'shared/etc-link']) fs.unlinkSync(W.abs(l))
  })

  test('hard-linked files are refused', async () => {
    fs.linkSync(W.abs('finance/budget.md'), W.abs('shared/hard.md'))
    const s = W.svc(W.choi)
    expect(names(s.list('shared'))).not.toContain('shared/hard.md')
    expect(await errorOf(() => s.read('shared/hard.md'))).not.toBeNull()
    expect(await errorOf(() => s.write('shared/hard.md', 'x', { overwrite: true }))).not.toBeNull()
    fs.unlinkSync(W.abs('shared/hard.md'))
  })
})

describe('list_files', () => {
  test('depth, sizes, times, read-only marks', () => {
    const r = W.svc(W.choi).list('shared', 2)
    expect(names(r)).toContain('shared/sub/')
    expect(names(r)).toContain('shared/sub/deep.md')
    expect(names(r)).not.toContain('shared/hr/')
    const hello = r.entries.find((e) => e.path === 'shared/hello.md')!
    expect(hello.size).toBe(Buffer.byteLength('# 안녕하세요\n첫 줄\n둘째 줄\n'))
    expect(hello.mtime).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/)
    expect(W.svc(W.choi).list('shared', 1).entries.some((e) => e.path === 'shared/sub/deep.md')).toBe(false)
    expect(W.svc(W.choi).list('skills').entries.find((e) => e.path === 'skills/company')?.readOnly).toBe(true)
  })
  test('a file is not a folder', async () => {
    expect(await errorOf(() => W.svc(W.choi).list('shared/hello.md'))).toContain('read_file')
  })
})

describe('read_file', () => {
  test('lines, offset, limit and continuation', async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`)
    W.hub.write('shared/long.txt', lines.join('\n') + '\n')
    const s = W.svc(W.choi)
    const a = await s.read('shared/long.txt') as any
    expect(a.lines.length).toBe(2000)
    expect(a.totalLines).toBe(2500)
    expect(a.lines[0]).toBe('line 1')
    const b = await s.read('shared/long.txt', { offset: 2001 }) as any
    expect(b.lines.length).toBe(500)
    expect(b.lines[0]).toBe('line 2001')
    const c = await s.read('shared/long.txt', { offset: 10, limit: 3 }) as any
    expect(c.lines).toEqual(['line 10', 'line 11', 'line 12'])
    expect(await errorOf(() => s.read('shared/long.txt', { offset: 9999 }))).toContain('past the end')
  })
  test('byte cap, long lines, empty files, folders, binaries, EUC-KR', async () => {
    W.hub.write('shared/wide.txt', Array.from({ length: 300 }, () => 'x'.repeat(1500)).join('\n'))
    const s = W.svc(W.choi)
    const w = await s.read('shared/wide.txt') as any
    expect(w.cutAtChars).toBe(true)
    expect(w.lines.reduce((n: number, l: string) => n + l.length + 8, 0)).toBeLessThanOrEqual(READ_MAX_CHARS)
    W.hub.write('shared/oneline.txt', 'y'.repeat(5000))
    expect((await s.read('shared/oneline.txt') as any).lines[0]).toEndWith('(line cut)')
    W.hub.write('shared/empty.txt', '')
    expect((await s.read('shared/empty.txt') as any).totalLines).toBe(0)
    expect(await errorOf(() => s.read('shared/sub'))).toContain('folder')
    fs.writeFileSync(W.abs('shared/blob.bin'), Buffer.from([1, 2, 0, 3, 4]))
    expect(await errorOf(() => s.read('shared/blob.bin'))).toContain('binary')
    fs.writeFileSync(W.abs('shared/euckr.csv'), Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x31, 0x0a])) // "한글,1"
    const k = await s.read('shared/euckr.csv') as any
    expect(k.lines[0]).toBe('한글,1')
    expect(k.encoding).toBe('euc-kr')
  })
  test('images come back as image data (checked by content, not by name)', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    fs.writeFileSync(W.abs('shared/dot.png'), png)
    const r = await W.svc(W.choi).read('shared/dot.png')
    expect(r.kind).toBe('image')
    if (r.kind === 'image') { expect(r.mimeType).toBe('image/png'); expect(Buffer.from(r.data, 'base64').equals(png)).toBe(true) }
    fs.writeFileSync(W.abs('shared/fake.jpg'), 'not really a jpeg')
    expect(await errorOf(() => W.svc(W.choi).read('shared/fake.jpg'))).toContain('not a valid')
    fs.writeFileSync(W.abs('shared/huge.png'), Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]))
    expect(await errorOf(() => W.svc(W.choi).read('shared/huge.png'))).toContain('too large')
  })
})

describe('write_file', () => {
  test('creates files and missing folders; refuses to overwrite without the flag', async () => {
    const s = W.svc(W.choi)
    const r = s.write('shared/2026/q4/report.md', '# 보고서\n')
    expect(r).toMatchObject({ path: 'shared/2026/q4/report.md', created: true, versionId: null })
    expect(W.read('shared/2026/q4/report.md')).toBe('# 보고서\n')
    const e = await errorOf(() => s.write('shared/2026/q4/report.md', 'other'))
    expect(e).toContain('already exists')
    expect(e).toContain('overwrite')
    expect(W.read('shared/2026/q4/report.md')).toBe('# 보고서\n')
  })
  test('overwrite keeps the old bytes as a version; the same content is no change', () => {
    const s = W.svc(W.choi)
    s.write('shared/ver.md', 'v1')
    const r = s.write('shared/ver.md', 'v2', { overwrite: true })
    expect(r.changed).toBe(true)
    const v = versions('shared/ver.md')
    expect(v.length).toBe(1)
    expect(v[0]).toMatchObject({ reason: 'overwrite', size: 2, sha256: sha256('v1'), user_id: W.choi.id, stored_as: `${PRODUCT.systemDir}/versions/${v[0].id}-ver.md` })
    expect(fs.readFileSync(W.abs(v[0].stored_as), 'utf8')).toBe('v1')
    expect(W.read('shared/ver.md')).toBe('v2')
    expect(s.write('shared/ver.md', 'v2', { overwrite: true }).changed).toBe(false)
    expect(versions('shared/ver.md').length).toBe(1)
  })
  test('binary formats, folders and oversized content are refused; no temp files are left', async () => {
    const s = W.svc(W.choi)
    expect(await errorOf(() => s.write('shared/x.docx', 'x'))).toContain('cannot be written as text')
    expect(await errorOf(() => s.write('shared/sub', 'x', { overwrite: true }))).toContain('folder')
    expect(await errorOf(() => s.write('shared/big.txt', 'x'.repeat(20 * 1024 * 1024 + 1)))).toContain('too large')
    expect(fs.existsSync(W.abs('shared/big.txt'))).toBe(false)
    const all: string[] = []
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name)); else all.push(e.name) } }
    walk(W.root)
    expect(all.filter((n) => n.startsWith(PRODUCT.tmpPrefix))).toEqual([])
  })
  test('a name that differs from a visible sibling only by case or width is refused', async () => {
    const e = await errorOf(() => W.svc(W.choi).write('shared/Hello.md', 'x'))
    if (W.hub.ctx.fx.caseInsensitive) expect(e).toContain('already exists') // the same file on a case-insensitive disk
    else expect(e).toContain('almost the same name')
  })
})

describe('edit_file', () => {
  test('replaces exactly one match and keeps a version', () => {
    W.hub.write('shared/edit.md', '제목: 초안\n담당: 미정\n')
    const r = W.svc(W.choi).edit('shared/edit.md', '초안', '최종')
    expect(r.replacements).toBe(1)
    expect(W.read('shared/edit.md')).toBe('제목: 최종\n담당: 미정\n')
    const v = versions('shared/edit.md')
    expect(v.length).toBe(1)
    expect(fs.readFileSync(W.abs(v[0].stored_as), 'utf8')).toContain('초안')
  })
  test('uniqueness, replace_all, no match, same strings, $ patterns stay literal', async () => {
    W.hub.write('shared/multi.md', 'a-x a-x a-x')
    const s = W.svc(W.choi)
    expect(await errorOf(() => s.edit('shared/multi.md', 'a-x', 'b'))).toContain('occurs 3 times')
    expect(s.edit('shared/multi.md', 'a-x', '$&$1', true).replacements).toBe(3)
    expect(W.read('shared/multi.md')).toBe('$&$1 $&$1 $&$1')
    expect(await errorOf(() => s.edit('shared/multi.md', 'zzz', 'y'))).toContain('not found')
    expect(await errorOf(() => s.edit('shared/multi.md', 'same', 'same'))).toContain('the same')
    expect(await errorOf(() => s.edit('shared/multi.md', '', 'y'))).toContain('must not be empty')
  })
  test('Windows line endings, non-UTF-8 and binary files', async () => {
    W.hub.write('shared/crlf.txt', 'one\r\ntwo\r\nthree\r\n')
    W.svc(W.choi).edit('shared/crlf.txt', 'one\ntwo', 'ONE\nTWO')
    expect(W.read('shared/crlf.txt')).toBe('ONE\r\nTWO\r\nthree\r\n')
    fs.writeFileSync(W.abs('shared/euckr.txt'), Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]))
    expect(await errorOf(() => W.svc(W.choi).edit('shared/euckr.txt', 'a', 'b'))).toContain('not UTF-8')
    fs.writeFileSync(W.abs('shared/utf16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('abc', 'utf16le')]))
    expect(((await W.svc(W.choi).read('shared/utf16.txt')) as any).lines).toEqual(['abc'])
    expect(await errorOf(() => W.svc(W.choi).edit('shared/utf16.txt', 'abc', 'x'))).toContain('not UTF-8')
    expect(await errorOf(() => W.svc(W.choi).edit('shared/dot.png', 'a', 'b'))).toContain('cannot be edited')
  })
  test('a missing file answers like a hidden one', async () => {
    const s = W.svc(W.choi)
    expect(masked(await errorOf(() => s.edit('shared/nope.md', 'a', 'b')), 'shared/nope.md')).toBe(masked(await errorOf(() => s.edit('shared/hr/salaries.md', 'a', 'b')), 'shared/hr/salaries.md'))
  })
})

describe('make_folder', () => {
  test('creates nested folders; existing is fine; a file there is not', async () => {
    const s = W.svc(W.choi)
    expect(s.makeFolder('shared/a/b/c')).toEqual({ path: 'shared/a/b/c', created: true })
    expect(fs.statSync(W.abs('shared/a/b/c')).isDirectory()).toBe(true)
    expect(s.makeFolder('shared/a/b/c').created).toBe(false)
    expect(await errorOf(() => s.makeFolder('shared/hello.md'))).toContain('is a file')
    expect(await errorOf(() => s.makeFolder('notice/x'))).toContain('read-only')
  })
})

describe('move_file', () => {
  test('rename and move into a new folder', () => {
    const s = W.svc(W.choi)
    s.write('shared/m1.md', 'm1')
    expect(s.move('shared/m1.md', 'shared/moved/m1-renamed.md')).toMatchObject({ from: 'shared/m1.md', to: 'shared/moved/m1-renamed.md', type: 'file' })
    expect(W.read('shared/moved/m1-renamed.md')).toBe('m1')
    expect(fs.existsSync(W.abs('shared/m1.md'))).toBe(false)
  })
  test('needs write access on both sides', async () => {
    const s = W.svc(W.park)
    s.write('shared/m2.md', 'm2')
    expect(await errorOf(() => s.move('shared/m2.md', 'notice/m2.md'))).toContain('read-only')
    expect(await errorOf(() => s.move('notice/rules.md', 'shared/rules.md'))).toContain('read-only')
    expect(await errorOf(() => s.move('shared/m2.md', 'finance/m2.md'))).toContain('not found or no access')
    expect(s.move('shared/m2.md', 'sales/m2.md').to).toBe('sales/m2.md')
    expect(await errorOf(() => W.svc(W.choi).move('shared/hello.md', 'sales/hello.md'))).toContain('not found or no access')
  })
  test('existing target: refused unless overwrite, which keeps a version', async () => {
    const s = W.svc(W.choi)
    s.write('shared/src.md', 'new content')
    s.write('shared/dst.md', 'old content')
    expect(await errorOf(() => s.move('shared/src.md', 'shared/dst.md'))).toContain('already exists')
    expect(await errorOf(() => s.move('shared/src.md', 'shared/sub'))).toContain('existing folder')
    const r = s.move('shared/src.md', 'shared/dst.md', { overwrite: true })
    expect(r.replacedVersionId).not.toBeNull()
    expect(W.read('shared/dst.md')).toBe('new content')
    const v = versions('shared/dst.md')
    expect(v.map((x) => x.reason)).toEqual(['move'])
    expect(fs.readFileSync(W.abs(v[0].stored_as), 'utf8')).toBe('old content')
  })
  test('folders: moved whole, not into themselves, not when they hold permission rules, protected folders stay', async () => {
    const s = W.svc(W.choi)
    s.write('shared/proj/a.md', 'a')
    s.write('shared/proj/inner/b.md', 'b')
    expect(await errorOf(() => s.move('shared/proj', 'shared/proj/inner/x'))).toContain('into itself')
    expect(s.move('shared/proj', 'shared/archive/proj').type).toBe('folder')
    expect(W.read('shared/archive/proj/inner/b.md')).toBe('b')
    expect(await errorOf(() => W.svc(W.admin).move('sales', 'shared/sales'))).toContain('permissions')
    expect(await errorOf(() => W.svc(W.admin).move('shared', 'shared2'))).toContain('permissions')
    expect(await errorOf(() => W.svc(W.park).move(`users/${W.park.id}`, 'shared/park'))).toContain('cannot be moved')
    expect(await errorOf(() => W.svc(W.owner).move('users', 'shared/users'))).not.toBeNull()
  })
  test('personal folder <-> team folder', () => {
    const s = W.svc(W.park)
    s.write(`users/${W.park.id}/draft.md`, 'draft')
    s.move(`users/${W.park.id}/draft.md`, 'shared/park-draft.md')
    expect(W.read('shared/park-draft.md')).toBe('draft')
  })
  test('case-only rename', () => {
    const s = W.svc(W.choi)
    s.write('shared/case.md', 'c')
    const r = s.move('shared/case.md', 'shared/CASE.md')
    expect(r.to).toBe('shared/CASE.md')
    expect(fs.readdirSync(W.abs('shared'))).toContain('CASE.md')
    expect(fs.readdirSync(W.abs('shared'))).not.toContain('case.md')
  })
})

describe('delete_file', () => {
  test('a file goes to .trina/trash/<day>/ with a version row; nothing is unlinked', () => {
    const s = W.svc(W.choi)
    s.write('shared/trash-me.md', 'bye')
    const r = s.remove('shared/trash-me.md')
    expect(r.type).toBe('file')
    expect(fs.existsSync(W.abs('shared/trash-me.md'))).toBe(false)
    expect(r.storedAs).toMatch(new RegExp(`^\\${PRODUCT.systemDir}/trash/\\d{4}-\\d\\d-\\d\\d/[a-z0-9]+/trash-me\\.md$`))
    expect(fs.readFileSync(W.abs(r.storedAs!), 'utf8')).toBe('bye')
    const v = versions('shared/trash-me.md')
    expect(v.length).toBe(1)
    expect(v[0]).toMatchObject({ reason: 'trash', size: 3, sha256: '', stored_as: r.storedAs, user_id: W.choi.id }) // a rename: not read, not hashed
    expect(names(W.svc(W.owner).list())).not.toContain(`${PRODUCT.systemDir}/`)
  })
  test('folders only when empty; protected and rule folders stay', async () => {
    const s = W.svc(W.choi)
    s.makeFolder('shared/empty-dir')
    fs.writeFileSync(W.abs('shared/empty-dir/.DS_Store'), 'junk')
    expect(s.remove('shared/empty-dir').type).toBe('folder')
    expect(fs.existsSync(W.abs('shared/empty-dir'))).toBe(false)
    expect(await errorOf(() => s.remove('shared/sub'))).toContain('not empty')
    expect(await errorOf(() => s.remove('users'))).not.toBeNull()
    expect(await errorOf(() => W.svc(W.park).remove(`users/${W.park.id}`))).toContain('cannot be deleted')
    expect(await errorOf(() => W.svc(W.admin).remove('sales'))).toContain('not empty')
  })
  test('a folder that only looks empty (it holds a hidden folder) is "not empty", nothing more', async () => {
    W.svc(W.admin).makeFolder('shared/looks-empty/secret')
    const { setRule } = await import('../../src/policy/rules-admin')
    setRule(W.hub.ctx.db, 'shared/looks-empty/secret', 'everyone', null, 'none')
    W.hub.ctx.rulesChanged()
    expect(W.svc(W.choi).list('shared/looks-empty').entries).toEqual([])
    const e = await errorOf(() => W.svc(W.choi).remove('shared/looks-empty'))
    expect(e).toContain('not empty')
    expect(e).not.toContain('secret')
    expect(e).not.toContain('permission')
  })
  test('a rule folder can be removed (when empty) by an admin only', async () => {
    W.svc(W.admin).makeFolder('shared/team-x')
    const { setRule } = await import('../../src/policy/rules-admin')
    setRule(W.hub.ctx.db, 'shared/team-x', 'everyone', null, 'write')
    W.hub.ctx.rulesChanged()
    expect(await errorOf(() => W.svc(W.choi).remove('shared/team-x'))).toContain('only an admin')
    expect(W.svc(W.admin).remove('shared/team-x').type).toBe('folder')
  })
})

describe('read_skill', () => {
  test('SKILL.md, the file list and a skill_events row', () => {
    const r = W.svc(W.choi).readSkill('quote')
    expect(r.path).toBe('skills/company/quote')
    expect(r.text).toContain('템플릿을 읽고 채운다')
    expect(r.files).toEqual(['skills/company/quote/template.md'])
    const ev = W.hub.ctx.db.query("SELECT * FROM skill_events WHERE user_id = ? AND source = 'mcp'").all(W.choi.id) as any[]
    expect(ev.map((e) => e.skill)).toEqual(['quote'])
    expect(W.svc(W.choi).readSkill('company:quote').name).toBe('quote')
    expect(W.svc(W.choi).readSkill('skills/company/quote').name).toBe('quote')
  })
  test('a skill in a folder the person cannot read does not exist for them', async () => {
    expect(W.svc(W.park).readSkill('pitch').description).toContain('영업 제안서')
    const e = await errorOf(() => W.svc(W.choi).readSkill('pitch'))
    expect(e).toContain("no skill called 'pitch'")
    expect(e).toContain('quote')
    expect(e).not.toContain('CANARY-PITCH')
  })
})
