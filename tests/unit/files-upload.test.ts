// POST /files/upload: who may upload where, names and paths, links, overwrite and earlier versions, limits, streaming
// to disk, CSRF, and what is recorded.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { makeWorld, type World } from './files-world'
import { get, type Sess } from './web-lib'
import { formUpload, sendUpload, fields, streamUpload, lazyMultipart, multipart, notices, MB, type Part } from './files-upload-lib'
import { receiveUpload, UPLOAD_BODY_MAX, UPLOAD_FILE_MAX, UPLOAD_REQUEST_MAX, UploadRefused } from '../../src/files/upload'
import { restoreVersion } from '../../src/files/versions'
import { PRODUCT } from '../../src/product'

let W: World
let admin: Sess, park: Sess, choi: Sess, han: Sess
beforeAll(async () => {
  W = await makeWorld()
  admin = W.hub.session(W.admin.id); park = W.hub.session(W.park.id); choi = W.hub.session(W.choi.id); han = W.hub.session(W.han.id)
  // a staging folder left by a crash a week ago
  fs.mkdirSync(W.abs(`${PRODUCT.systemDir}/uploads/stale-crash`), { recursive: true })
  fs.writeFileSync(W.abs(`${PRODUCT.systemDir}/uploads/stale-crash/1`), 'left over')
  const old = new Date(Date.now() - 7 * 86_400_000)
  fs.utimesSync(W.abs(`${PRODUCT.systemDir}/uploads/stale-crash`), old, old)
})
afterAll(async () => { await W?.hub.stop() })

/** Every file and folder under the team folder (staging aside), to see that a refused upload changed nothing. */
function tree(dir = W.root, rel = ''): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (r === `${PRODUCT.systemDir}/uploads`) continue
    out.push(r + (e.isDirectory() ? '/' : e.isSymbolicLink() ? '@' : ''))
    if (e.isDirectory()) out.push(...tree(path.join(dir, e.name), r))
  }
  return out
}
const staging = () => { try { return fs.readdirSync(W.abs(`${PRODUCT.systemDir}/uploads`)) } catch { return [] } }
/** wait until the hub has dropped its staging folders (it does so when a request ends, however it ends) */
async function stagingEmpty() { for (let i = 0; i < 60 && staging().length; i++) await Bun.sleep(50); return staging() }
const versions = (rel: string) => W.hub.ctx.db.query('SELECT * FROM file_versions WHERE path = ? ORDER BY created_at, rowid').all(rel) as any[]
const json = async (r: Response) => (await r.json()) as { ok: boolean; dir: string; items: { name: string; status: string; kind?: string; message?: string; path?: string; size?: number; versionId?: string | null }[]; error?: { message: string } }
const text = (s: string) => new TextEncoder().encode(s)

describe('a simple upload', () => {
  test('several files at once: created, byte for byte, with a record of who and from where', async () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 251)
    const r = await formUpload(W.hub, park, 'shared', [{ name: 'a.txt', data: '첫째 파일' }, { name: 'b.bin', data: big }, { name: 'c.md', data: '# c' }])
    expect(r.status).toBe(200)
    const j = await json(r)
    expect(j.ok).toBe(true)
    expect(j.items.map((i) => [i.name, i.status, i.path])).toEqual([['a.txt', 'created', 'shared/a.txt'], ['b.bin', 'created', 'shared/b.bin'], ['c.md', 'created', 'shared/c.md']])
    expect(W.read('shared/a.txt')).toBe('첫째 파일')
    expect(new Uint8Array(fs.readFileSync(W.abs('shared/b.bin')))).toEqual(big)
    expect(fs.statSync(W.abs('shared/a.txt')).mode & 0o777).toBe(0o600)
    // the first upload also swept the staging folder a crash had left
    expect(staging()).not.toContain('stale-crash')
    expect(await stagingEmpty()).toEqual([])
    // recorded like a file tool event: who, which file, from 웹
    const ev = W.hub.ctx.db.query("SELECT * FROM tool_events WHERE tool = 'web:upload' ORDER BY id DESC LIMIT 3").all() as any[]
    expect(ev.map((e) => e.summary.replace(/ -> .*/, '')).sort()).toEqual(['웹 · shared/a.txt', '웹 · shared/b.bin', '웹 · shared/c.md'])
    expect(ev.every((e) => e.user_id === W.park.id && e.token_id === null && e.ok === 1)).toBe(true)
    // and in the audit log, without contents
    const a = W.hub.ctx.db.query("SELECT * FROM audit WHERE action = 'file.upload' ORDER BY id DESC").get() as any
    expect(a).toMatchObject({ actor: W.park.id, target: 'shared' })
    expect(JSON.parse(a.detail)).toMatchObject({ via: 'web', files: 3, replaced: 0, failed: 0, paths: ['shared/a.txt', 'shared/b.bin', 'shared/c.md'] })
    expect(a.detail).not.toContain('첫째 파일')
    // who changed it last
    expect(W.hub.ctx.db.query("SELECT user_id, source FROM file_changes WHERE path = 'shared/a.txt'").get()).toEqual({ user_id: W.park.id, source: 'web' })
  })

  test('the form without scripts: a redirect back to the folder with a message', async () => {
    const r = await formUpload(W.hub, choi, 'shared', [{ name: '폼.txt', data: 'x' }], { json: false })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/files?path=shared')
    expect(notices(await (await get(W.hub, '/files?path=shared', choi)).text())).toContain('1개를 올렸어요.')
    // failures are listed with the reason
    const again = await formUpload(W.hub, choi, 'shared', [{ name: '폼.txt', data: 'y' }, { name: 'CON.txt', data: 'z' }], { json: false })
    expect(again.status).toBe(303)
    const msgs = notices(await (await get(W.hub, '/files?path=shared', choi)).text())
    expect(msgs.some((m) => m.startsWith('폼.txt: 같은 이름이 이미 있어요') && m.includes('새 파일로 바꿔요'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('CON.txt:') && m.includes('윈도우'))).toBe(true)
    expect(W.read('shared/폼.txt')).toBe('x')
  })

  test('folders: a dropped folder keeps its structure, by file name or by relpath', async () => {
    const r = await sendUpload(W.hub, park, [
      ...fields(park, 'shared'),
      { name: 'relpath', value: '영업/2026/표.txt' }, { filename: '표.txt', data: 'via relpath' },
      { filename: '기획/초안/메모.md', data: 'via file name' },
    ])
    const j = await json(r)
    expect(j.items.map((i) => i.path)).toEqual(['shared/영업/2026/표.txt', 'shared/기획/초안/메모.md'])
    expect(W.read('shared/영업/2026/표.txt')).toBe('via relpath')
    expect(W.read('shared/기획/초안/메모.md')).toBe('via file name')
    // a folder tree below a hidden folder is still hidden
    const hid = await json(await sendUpload(W.hub, choi, [...fields(choi, 'shared'), { name: 'relpath', value: 'hr/x.txt' }, { filename: 'x.txt', data: 'x' }]))
    expect(hid.items[0]).toMatchObject({ status: 'error', kind: 'hidden' })
    expect(fs.existsSync(W.abs('shared/hr/x.txt'))).toBe(false)
  })

  test('Korean names: composed or decomposed, they land as one NFC name, and the same name again is the same file', async () => {
    const nfd = '한글 보고서.txt'.normalize('NFD'), nfc = nfd.normalize('NFC')
    expect(nfd).not.toBe(nfc)
    const j = await json(await sendUpload(W.hub, choi, [...fields(choi, 'shared'), { filename: nfd, data: '첫 번째' }]))
    expect(j.items[0]).toMatchObject({ status: 'created', path: `shared/${nfc}`, name: nfc })
    const names = fs.readdirSync(W.abs('shared')).filter((n) => n.normalize('NFC') === nfc)
    expect(names).toEqual([nfc])
    const again = await json(await sendUpload(W.hub, choi, [...fields(choi, 'shared', [{ name: 'overwrite', value: '1' }]), { filename: nfc, data: '두 번째' }]))
    expect(again.items[0]!.status).toBe('replaced')
    expect(fs.readdirSync(W.abs('shared')).filter((n) => n.normalize('NFC') === nfc).length).toBe(1)
    // and it comes back with its name
    const dl = await get(W.hub, `/files/download?path=${encodeURIComponent('shared/' + nfc)}`, choi)
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(dl.headers.get('content-disposition')!)![1]!)).toBe(nfc)
    expect(await dl.text()).toBe('두 번째')
    // long Korean names up to the limit (255 bytes) work, one byte more is refused
    const ok = '가'.repeat(83) + '.txt' // 249 + 4 = 253 bytes
    const tooLong = '가'.repeat(85) + '.txt'
    const r = await json(await sendUpload(W.hub, choi, [...fields(choi, 'shared'), { filename: ok, data: '1' }, { filename: tooLong, data: '1' }]))
    expect(r.items.map((i) => i.status)).toEqual(['created', 'error'])
    expect(r.items[1]!.message).toContain('너무 길어요')
  })

  test('an empty file, a file with no name chosen, and no files at all', async () => {
    const e = await json(await sendUpload(W.hub, choi, [...fields(choi, 'shared'), { filename: 'empty.txt', data: '' }]))
    expect(e.items[0]).toMatchObject({ status: 'created', size: 0 })
    expect(fs.statSync(W.abs('shared/empty.txt')).size).toBe(0)
    const none = await json(await sendUpload(W.hub, choi, [...fields(choi, 'shared'), { filename: '', data: '' }]))
    expect(none).toMatchObject({ ok: true, items: [] })
    const nothing = await sendUpload(W.hub, choi, fields(choi, 'shared'), { json: false })
    expect(nothing.status).toBe(303)
    expect(notices(await (await get(W.hub, '/files?path=shared', choi)).text())).toContain('올린 파일이 없어요.')
    const notMultipart = await fetch(W.hub.url + '/files/upload', { method: 'POST', headers: { cookie: choi.cookie, accept: 'application/json', 'content-type': 'application/json' }, body: '{}' })
    expect(notMultipart.status).toBe(400)
    expect((await json(notMultipart)).error!.message).toContain('올릴 파일이 없어요')
  })
})

describe('permissions', () => {
  test('write permission is required: a read-only folder refuses, a writable one accepts', async () => {
    const before = tree()
    for (const dir of ['notice', 'skills', 'skills/company', '']) {
      const r = await sendUpload(W.hub, choi, [...fields(choi, dir), { filename: 'nope.txt', data: 'x' }])
      const j = await json(r)
      expect({ dir, status: r.status, kind: j.items[0]!.kind }).toEqual({ dir, status: dir === '' ? 404 : 403, kind: dir === '' ? 'hidden' : 'read_only' })
    }
    expect(tree()).toEqual(before)
    // the same file where they may write
    expect((await json(await sendUpload(W.hub, choi, [...fields(choi, 'shared'), { filename: 'yes.txt', data: 'x' }]))).items[0]!.status).toBe('created')
    // group folders: only the group
    expect((await json(await sendUpload(W.hub, park, [...fields(park, 'sales'), { filename: 'plan2.md', data: 'x' }]))).items[0]!.status).toBe('created')
    for (const s of [choi, han]) {
      const j = await json(await sendUpload(W.hub, s, [...fields(s, 'sales'), { filename: 'plan3.md', data: 'x' }]))
      expect(j.items[0]).toMatchObject({ status: 'error', kind: 'hidden' })
    }
    expect(fs.existsSync(W.abs('sales/plan3.md'))).toBe(false)
    // an admin may write at the top level; the personal folders of others stay closed to everyone
    expect((await json(await sendUpload(W.hub, admin, [...fields(admin, ''), { filename: 'top.txt', data: 'x' }]))).items[0]!.status).toBe('created')
    const priv = await json(await sendUpload(W.hub, admin, [...fields(admin, `users/${W.park.id}`), { filename: 'x.txt', data: 'x' }]))
    expect(priv.items[0]).toMatchObject({ status: 'error', kind: 'hidden' })
    expect(fs.existsSync(W.abs(`users/${W.park.id}/x.txt`))).toBe(false)
  })

  test('a hidden folder answers an upload exactly like one that does not exist', async () => {
    const before = tree()
    const pairs: [Sess, string, string][] = [[choi, 'sales', 'nosuch'], [han, 'sales', 'nosuch'], [choi, 'finance', 'nosuch'], [choi, `users/${W.park.id}`, `users/${W.park.id}x`], [admin, `users/${W.park.id}`, `users/${W.park.id}x`], [choi, 'skills/sales-pack', 'skills/sales-packz']]
    for (const [s, hid, miss] of pairs) {
      const ask = async (dir: string) => { const r = await sendUpload(W.hub, s, [...fields(s, dir), { filename: 'probe.txt', data: 'x' }]); return { status: r.status, body: (await r.text()).split(dir).join('<D>') } }
      const h = await ask(hid), m = await ask(miss)
      expect({ hid, ...h }).toEqual({ hid, ...m })
      expect(h.status).not.toBe(200)
    }
    // a hidden folder below a writable one: refused, and the text says nothing a missing name would not
    const j = await json(await sendUpload(W.hub, choi, [...fields(choi, 'shared/hr'), { filename: 'probe.txt', data: 'x' }]))
    expect(j.items[0]).toMatchObject({ status: 'error', kind: 'hidden', message: '찾을 수 없거나 권한이 없는 곳이에요.' })
    expect(JSON.stringify(j)).not.toContain('salaries')
    expect(tree()).toEqual(before)
  })

  test('the rules are checked again when the file is placed: a folder closed while the bytes came in gets nothing', async () => {
    const svc = W.svc(W.park)
    const staged = path.join(W.root, PRODUCT.systemDir, 'uploads-test-staged')
    fs.writeFileSync(staged, 'late', { mode: 0o600 })
    const plan = svc.planUpload('sales/late.md', false)
    expect(plan.exists).toBe(false)
    const { setRule } = await import('../../src/policy/rules-admin')
    setRule(W.hub.ctx.db, 'sales', 'group', W.sales.id, 'read')
    W.hub.ctx.rulesChanged()
    try {
      expect(() => svc.commitUpload('sales/late.md', { abs: staged, size: 4, sha256: '' }, { overwrite: false })).toThrow()
      expect(fs.existsSync(W.abs('sales/late.md'))).toBe(false)
    } finally {
      setRule(W.hub.ctx.db, 'sales', 'group', W.sales.id, 'write')
      W.hub.ctx.rulesChanged()
      fs.rmSync(staged, { force: true })
    }
  })
})

describe('names and paths', () => {
  const bad: [string, string][] = [
    ['parent folder', '../evil.txt'], ['deep parent', 'a/../../evil.txt'], ['parent in the middle', 'sub/../../evil.txt'], ['dot segment', './x/../x.txt'],
    ['absolute', '/etc/passwd'], ['absolute below dir', '/shared/abs.txt'], ['home', '~/x.txt'], ['drive letter', 'C:\\Windows\\x.txt'], ['drive without slash', 'C:x.txt'],
    ['backslash', 'a\\b.txt'], ['backslash parent', '..\\evil.txt'], ['NUL', 'a\u0000b.txt'], ['NUL at the end', 'a.txt\u0000.png'],
    ['reserved CON', 'CON.txt'], ['reserved nul', 'nul'], ['reserved COM1', 'com1.log'], ['reserved in a folder', 'ok/LPT2.txt'], ['reserved with extension', 'AUX.tar.gz'],
    ['trailing dot', 'x.txt.'], ['trailing space', 'x.txt '], ['leading space', ' x.txt'], ['colon (stream)', 'x.txt:evil'], ['wildcard', 'a*b.txt'], ['pipe', 'a|b.txt'], ['question', 'a?.txt'], ['quote', 'a\\"b.txt'], ['angle', '<a>.txt'],
    ['server temp name', '.trina-tmp-abc'], ['short name', 'PROGRA~1'], ['fullwidth slash', 'a／b.txt'], ['bidi override', 'a\u202etxt.exe'], ['control char', 'a\u0007b.txt'], ['zero-width', 'a\u200bb.txt'],
    ['too long', 'a'.repeat(300) + '.txt'], ['deep', Array(70).fill('d').join('/') + '/x.txt'],
  ]
  test('every unsafe name is refused for that file, nothing is written, and a good file in the same request still goes in', async () => {
    const before = tree()
    const parts: Part[] = [...fields(choi, 'shared')]
    for (const [, name] of bad) parts.push({ filename: name, data: 'evil' })
    parts.push({ filename: 'fine.txt', data: 'fine' })
    const j = await json(await sendUpload(W.hub, choi, parts))
    expect(j.items.length).toBe(bad.length + 1)
    for (const [i, [why]] of bad.entries()) {
      expect({ why, status: j.items[i]!.status, kind: j.items[i]!.kind }).toEqual({ why, status: 'error', kind: expect.stringMatching(/^(name|unsafe)$/) as any })
      expect(j.items[i]!.message).toMatch(/[가-힣]/) // Korean, not an English policy message
      expect(j.items[i]!.message).not.toMatch(/\b(not allowed|reserved|characters)\b/)
    }
    expect(j.items.at(-1)).toMatchObject({ status: 'created', path: 'shared/fine.txt' })
    const after = tree()
    expect(after.filter((x) => !before.includes(x))).toEqual(['shared/fine.txt'])
    expect(fs.existsSync(path.join(W.root, 'evil.txt')) || fs.existsSync(path.join(W.root, '..', 'evil.txt')) || fs.existsSync('/etc/passwd.evil')).toBe(false)
    fs.rmSync(W.abs('shared/fine.txt'))
  })

  test('the folder field is checked the same way', async () => {
    const before = tree()
    for (const dir of ['../', 'shared/../sales', '/shared', '..', 'shared/..', 'C:\\', 'shared\\sub', 'a\u0000b', '~', 'shared/./../..']) {
      const r = await sendUpload(W.hub, choi, [...fields(choi, dir), { filename: 'x.txt', data: 'x' }])
      const j = await json(r)
      expect({ dir, status: j.items[0]?.status }).toEqual({ dir, status: 'error' })
      expect(r.status).toBeGreaterThanOrEqual(400)
    }
    // the folder in the URL instead of a field
    const viaUrl = await fetch(W.hub.url + '/files/upload?path=' + encodeURIComponent('../'), {
      method: 'POST', headers: { cookie: choi.cookie, accept: 'application/json', 'content-type': multipart([]).contentType.replace(/boundary=.*/, 'boundary=B') },
      body: multipart([{ name: '_csrf', value: choi.csrf }, { filename: 'x.txt', data: 'x' }], 'B').body as unknown as BodyInit,
    })
    expect((await json(viaUrl)).items[0]!.status).toBe('error')
    expect(tree()).toEqual(before)
  })

  test('links are never followed: a folder link, a file link as the target, a link in the middle of a path', async () => {
    const outside = path.join(W.hub.dir, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'target.txt'), 'untouched')
    fs.symlinkSync(outside, W.abs('shared/ln-out'))
    fs.symlinkSync(W.abs('finance'), W.abs('shared/ln-fin'))
    fs.symlinkSync(path.join(outside, 'target.txt'), W.abs('shared/ln-file.txt'))
    fs.symlinkSync(path.join(outside, 'nothing-yet.txt'), W.abs('shared/ln-dangling.txt'))
    fs.writeFileSync(W.abs('shared/real.txt'), 'real')
    fs.linkSync(W.abs('shared/real.txt'), W.abs('shared/hard.txt'))
    const before = tree()
    const finBefore = fs.readdirSync(W.abs('finance')).sort()
    const attempts: [string, string, boolean][] = [
      ['shared/ln-out', 'x.txt', false], ['shared/ln-fin', 'x.txt', false], ['shared', 'ln-out/x.txt', false], ['shared', 'ln-fin/new/x.txt', false],
      ['shared', 'ln-file.txt', true], ['shared', 'ln-file.txt', false], ['shared', 'ln-dangling.txt', true], ['shared', 'ln-dangling.txt', false],
      ['shared', 'hard.txt', true], ['shared', 'real.txt/inside.txt', false],
    ]
    for (const [dir, name, overwrite] of attempts) {
      const j = await json(await sendUpload(W.hub, choi, [...fields(choi, dir, overwrite ? [{ name: 'overwrite', value: '1' }] : []), { filename: name, data: 'ATTACK' }]))
      expect({ dir, name, overwrite, status: j.items[0]!.status }).toEqual({ dir, name, overwrite, status: 'error' })
    }
    expect(fs.readFileSync(path.join(outside, 'target.txt'), 'utf8')).toBe('untouched')
    expect(fs.readdirSync(outside).sort()).toEqual(['target.txt'])
    expect(fs.readdirSync(W.abs('finance')).sort()).toEqual(finBefore)
    expect(fs.readFileSync(W.abs('shared/real.txt'), 'utf8')).toBe('real')
    expect(fs.readFileSync(W.abs('shared/hard.txt'), 'utf8')).toBe('real')
    expect(tree()).toEqual(before)
    expect(versions('shared/hard.txt')).toEqual([])
    for (const n of ['ln-out', 'ln-fin', 'ln-file.txt', 'ln-dangling.txt', 'hard.txt']) fs.rmSync(W.abs('shared/' + n))
  })

  test('a link swapped in after the folder was checked is caught when the file is placed', async () => {
    const outside = path.join(W.hub.dir, 'outside2')
    fs.mkdirSync(outside)
    fs.mkdirSync(W.abs('shared/swap'))
    const svc = W.svc(W.choi)
    const staged = path.join(W.root, PRODUCT.systemDir, 'uploads-test-swap')
    fs.writeFileSync(staged, 'data', { mode: 0o600 })
    expect(svc.planUpload('shared/swap/x.txt', false).exists).toBe(false)
    fs.rmdirSync(W.abs('shared/swap'))
    fs.symlinkSync(outside, W.abs('shared/swap'))
    expect(() => svc.commitUpload('shared/swap/x.txt', { abs: staged, size: 4, sha256: '' }, { overwrite: false })).toThrow()
    expect(fs.readdirSync(outside)).toEqual([])
    fs.rmSync(W.abs('shared/swap')); fs.rmSync(staged, { force: true })
  })
})

describe('overwrite keeps the old version', () => {
  test('without the box a name that exists is skipped; with it the old file is kept as an earlier version', async () => {
    const put = async (data: string, overwrite = false, s = choi) => (await json(await sendUpload(W.hub, s, [...fields(s, 'shared', overwrite ? [{ name: 'overwrite', value: '1' }] : []), { filename: 'ow.txt', data }]))).items[0]!
    expect(await put('v1')).toMatchObject({ status: 'created' })
    expect(await put('v2')).toMatchObject({ status: 'error', kind: 'exists' })
    expect(W.read('shared/ow.txt')).toBe('v1')
    expect(versions('shared/ow.txt')).toEqual([])
    const r2 = await put('v2', true, park)
    expect(r2).toMatchObject({ status: 'replaced', path: 'shared/ow.txt' })
    expect(W.read('shared/ow.txt')).toBe('v2')
    const v = versions('shared/ow.txt')
    expect(v.length).toBe(1)
    expect(v[0]).toMatchObject({ reason: 'overwrite', user_id: W.park.id, id: r2.versionId, size: 2 })
    expect(fs.readFileSync(W.abs(v[0].stored_as), 'utf8')).toBe('v1')
    // the same content again changes nothing and keeps no new version
    expect(await put('v2', true)).toMatchObject({ status: 'unchanged' })
    expect(versions('shared/ow.txt').length).toBe(1)
    // a third one keeps the second
    expect(await put('v3', true)).toMatchObject({ status: 'replaced' })
    const v3 = versions('shared/ow.txt')
    expect(v3.map((x) => fs.readFileSync(W.abs(x.stored_as), 'utf8'))).toEqual(['v1', 'v2'])
    // an admin can bring v1 back from the earlier versions
    expect(restoreVersion(W.hub.ctx, v3[0].id, W.admin.id).path).toBe('shared/ow.txt')
    expect(W.read('shared/ow.txt')).toBe('v1')
    expect(versions('shared/ow.txt').length).toBe(3) // v3 was kept before v1 came back
    // the audit row of the replacing upload counts it
    await put('v4', true)
    const a = W.hub.ctx.db.query("SELECT detail FROM audit WHERE action = 'file.upload' ORDER BY id DESC LIMIT 1").get() as any
    expect(JSON.parse(a.detail)).toMatchObject({ files: 1, replaced: 1 })
  })

  test('a folder or a read-only file in the way is not replaced', async () => {
    fs.mkdirSync(W.abs('shared/adir'))
    const j = await json(await sendUpload(W.hub, choi, [...fields(choi, 'shared', [{ name: 'overwrite', value: '1' }]), { filename: 'adir', data: 'x' }]))
    expect(j.items[0]).toMatchObject({ status: 'error', kind: 'is_folder' })
    expect(fs.statSync(W.abs('shared/adir')).isDirectory()).toBe(true)
    const ro = await json(await sendUpload(W.hub, choi, [...fields(choi, 'notice', [{ name: 'overwrite', value: '1' }]), { filename: 'rules.md', data: 'x' }]))
    expect(ro.items[0]).toMatchObject({ status: 'error', kind: 'read_only' })
    expect(W.read('notice/rules.md')).toBe('사내 규정\n')
    // a file kept as a version for an overwritten big file is a link, not a copy (the hub does not stall)
  })

  test('a big file (over the copy limit) is kept by a hard link, and the new one takes its place', async () => {
    const size1 = 33 * MB, size2 = 34 * MB
    const a = await streamUpload(W.hub, choi, lazyMultipart(fields(choi, 'shared'), [{ filename: 'big-ow.bin', size: size1 }]))
    expect((await json(a)).items[0]!.status).toBe('created')
    const b = await streamUpload(W.hub, choi, lazyMultipart(fields(choi, 'shared', [{ name: 'overwrite', value: '1' }]), [{ filename: 'big-ow.bin', size: size2 }]))
    expect((await json(b)).items[0]!.status).toBe('replaced')
    expect(fs.statSync(W.abs('shared/big-ow.bin')).size).toBe(size2)
    const v = versions('shared/big-ow.bin')
    expect(v.length).toBe(1)
    expect(v[0]).toMatchObject({ reason: 'overwrite', size: size1 })
    expect(fs.statSync(W.abs(v[0].stored_as)).size).toBe(size1)
    fs.rmSync(W.abs('shared/big-ow.bin')); fs.rmSync(W.abs(v[0].stored_as))
  })
})

describe('limits', () => {
  test('the numbers: 50 MB a file, 200 MB a request', () => {
    expect(UPLOAD_FILE_MAX).toBe(50 * MB)
    expect(UPLOAD_REQUEST_MAX).toBe(200 * MB)
    expect(UPLOAD_BODY_MAX).toBeGreaterThan(UPLOAD_REQUEST_MAX)
    expect(UPLOAD_BODY_MAX).toBeLessThanOrEqual(UPLOAD_REQUEST_MAX + 4 * MB)
  })

  test('a file over 50 MB is refused (others in the request are kept), and no part of it stays anywhere', async () => {
    const before = tree()
    const m = lazyMultipart(fields(choi, 'shared'), [{ filename: 'ok-small.bin', size: 1000 }, { filename: 'too-big.bin', size: 50 * MB + 1 }, { filename: 'ok-after.bin', size: 2000 }])
    const r = await streamUpload(W.hub, choi, m)
    const j = await json(r)
    expect(r.status).toBe(200)
    expect(j.items.map((i) => [i.name, i.status, i.kind])).toEqual([['ok-small.bin', 'created', undefined], ['too-big.bin', 'error', 'too_large'], ['ok-after.bin', 'created', undefined]])
    expect(j.items[1]!.message).toContain('50MB')
    expect(fs.existsSync(W.abs('shared/too-big.bin'))).toBe(false)
    expect(await stagingEmpty()).toEqual([])
    expect(tree().filter((x) => !before.includes(x))).toEqual(['shared/ok-after.bin', 'shared/ok-small.bin'])
    // exactly 50 MB is fine
    const exact = await json(await streamUpload(W.hub, choi, lazyMultipart(fields(choi, 'shared'), [{ filename: 'exactly-50.bin', size: 50 * MB }])))
    expect(exact.items[0]).toMatchObject({ status: 'created', size: 50 * MB })
    fs.rmSync(W.abs('shared/exactly-50.bin')); fs.rmSync(W.abs('shared/ok-small.bin')); fs.rmSync(W.abs('shared/ok-after.bin'))
  })

  test('a request over 200 MB is refused whole (declared length: at once; no length: when it passes 200 MB); nothing is kept', async () => {
    const before = tree()
    // declared: five files of 41 MB
    const five = lazyMultipart(fields(choi, 'shared'), Array.from({ length: 5 }, (_, i) => ({ filename: `f${i}.bin`, size: 41 * MB })))
    expect(five.length).toBeGreaterThan(UPLOAD_BODY_MAX)
    const declared = await streamUpload(W.hub, choi, five).catch((e) => e)
    // the server may answer before the body is sent, in which case the client sees either the 413 or a reset connection
    if (declared instanceof Response) expect(declared.status).toBe(413)
    // not declared (chunked): five files of 41 MB, cut when the total passes the limit
    const chunked = lazyMultipart(fields(choi, 'shared'), Array.from({ length: 5 }, (_, i) => ({ filename: `g${i}.bin`, size: 41 * MB })))
    const r = await streamUpload(W.hub, choi, chunked, { chunked: true }).catch((e) => e)
    if (r instanceof Response) { expect(r.status).toBe(413); expect((await json(r)).error!.message).toContain('200MB') }
    expect(await stagingEmpty()).toEqual([])
    expect(tree()).toEqual(before)
  })

  test('too many files in one request, and a stalled or broken request, leave nothing behind', async () => {
    const before = tree()
    const many = await sendUpload(W.hub, choi, [...fields(choi, 'shared'), ...Array.from({ length: 1001 }, (_, i) => ({ filename: `m${i}.txt`, data: 'x' }))])
    expect(many.status).toBe(413)
    expect(tree()).toEqual(before)
    // the connection breaks in the middle of a file
    const ctl = new AbortController()
    const head = multipart([...fields(choi, 'shared'), { filename: 'half.bin', data: 'x'.repeat(300) }], 'B').body
    const cut = head.slice(0, head.length - 30) // in the file's bytes, before the closing delimiter
    const stalled = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(cut) }, pull() { return new Promise(() => {}) } })
    const p = fetch(W.hub.url + '/files/upload', { method: 'POST', body: stalled, signal: ctl.signal, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=B', accept: 'application/json', cookie: choi.cookie, 'content-length': String(head.length) } } as RequestInit).catch(() => null)
    await Bun.sleep(300)
    expect(staging().length).toBe(1) // received so far, waiting for the rest
    ctl.abort()
    await p
    expect(await stagingEmpty()).toEqual([])
    expect(tree()).toEqual(before)
    expect(fs.existsSync(W.abs('shared/half.bin'))).toBe(false)
  })

  test('uploads in flight are capped per person (3) and the slots come back', async () => {
    const ctls: AbortController[] = []
    const open = () => {
      const ctl = new AbortController(); ctls.push(ctl)
      const head = multipart([...fields(choi, 'shared'), { filename: 'slow.bin', data: 'x' }], 'B').body.slice(0, 200)
      const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(head) }, pull() { return new Promise(() => {}) } })
      return fetch(W.hub.url + '/files/upload', { method: 'POST', body, signal: ctl.signal, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=B', cookie: choi.cookie, accept: 'application/json', 'content-length': '100000' } } as RequestInit).catch(() => null)
    }
    const running = [open(), open(), open()]
    await Bun.sleep(300)
    const fourth = await sendUpload(W.hub, choi, [...fields(choi, 'shared'), { filename: 'fourth.txt', data: 'x' }])
    expect(fourth.status).toBe(429)
    expect((await json(fourth)).error!.message).toContain('올리던 것이 끝난 뒤에')
    // somebody else is not held up
    expect((await json(await sendUpload(W.hub, park, [...fields(park, 'shared'), { filename: 'park-ok.txt', data: 'x' }]))).items[0]!.status).toBe('created')
    ctls.forEach((c) => c.abort())
    await Promise.all(running)
    let again = 429
    for (let i = 0; i < 40 && again === 429; i++) { again = (await sendUpload(W.hub, choi, [...fields(choi, 'shared'), { filename: 'fourth.txt', data: 'x' }])).status; if (again === 429) await Bun.sleep(50) }
    expect(again).toBe(200)
    expect(await stagingEmpty()).toEqual([])
  })

  test('receiveUpload: nothing arriving for too long stops with "idle" and cleans up', async () => {
    const head = multipart([...fields(choi, 'shared'), { filename: 'idle.bin', data: 'x' }], 'B').body.slice(0, 250)
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(head) }, pull() { return new Promise(() => {}) } })
    const err = await receiveUpload(W.svc(W.choi), { stream, boundary: 'B', csrfOk: () => true, limits: { idleMs: 120 } }).catch((e) => e)
    expect(err).toBeInstanceOf(UploadRefused)
    expect(err).toMatchObject({ status: 408, code: 'idle' })
    expect(await stagingEmpty()).toEqual([])
  })
})

describe('streaming to disk', () => {
  test('a ~200 MB upload (four files) is accepted and needs a small fraction of its size in memory', async () => {
    const before = tree()
    const base = process.memoryUsage().rss
    let peak = base
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 5)
    const sender = path.join(import.meta.dir, 'files-upload-sender.ts')
    const proc = Bun.spawn([process.execPath, sender, W.hub.url, choi.cookie, choi.csrf, 'shared', '4', '49'], { stdout: 'pipe', stderr: 'pipe' })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    clearInterval(timer)
    const res = JSON.parse(out) as { status: number; body: string }
    expect(res.status).toBe(200)
    const j = JSON.parse(res.body) as { items: { status: string; size: number }[]; bytes: number }
    expect(j.items.map((i) => i.status)).toEqual(['created', 'created', 'created', 'created'])
    expect(j.bytes).toBe(4 * 49 * MB)
    for (let i = 0; i < 4; i++) expect(fs.statSync(W.abs(`shared/big-${i}.bin`)).size).toBe(49 * MB)
    // the body was 196 MB, sent at network speed; held whole it would have added at least that much (it adds about 25 MB)
    expect(peak - base).toBeLessThan(80 * MB)
    expect(await stagingEmpty()).toEqual([])
    for (let i = 0; i < 4; i++) fs.rmSync(W.abs(`shared/big-${i}.bin`))
    expect(tree()).toEqual(before)
  })

  test('a file is written to a staging folder while it comes in, and appears in the team folder only when the request is complete', async () => {
    const head = multipart([...fields(choi, 'shared'), { filename: 'inflight.bin', data: 'x'.repeat(100) }], 'B').body
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let step = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (step++ === 0) c.enqueue(head.slice(0, head.length - 20)) // the file's bytes are in, the closing boundary is not
        else { await gate; c.enqueue(head.slice(head.length - 20)); c.close() }
      },
    })
    const p = fetch(W.hub.url + '/files/upload', { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=B', cookie: choi.cookie, accept: 'application/json', 'content-length': String(head.length) } } as RequestInit)
    await Bun.sleep(300)
    const staged = staging()
    expect(staged.length).toBe(1)
    const stagedFiles = fs.readdirSync(W.abs(`${PRODUCT.systemDir}/uploads/${staged[0]}`))
    expect(stagedFiles.length).toBe(1)
    expect(fs.existsSync(W.abs('shared/inflight.bin'))).toBe(false)
    expect(listedNames()).not.toContain('inflight.bin')
    release()
    const j = await json(await p)
    expect(j.items[0]).toMatchObject({ status: 'created', size: 100 })
    expect(W.read('shared/inflight.bin')).toBe('x'.repeat(100))
    fs.rmSync(W.abs('shared/inflight.bin'))
  })
  const listedNames = () => fs.readdirSync(W.abs('shared'))
})

describe('CSRF on upload', () => {
  test('a missing or wrong token is refused before any file is read; nothing is written', async () => {
    const before = tree()
    const file: Part = { filename: 'csrf.txt', data: 'x' }
    const attempts: [string, Part[], Record<string, string>][] = [
      ['no token', [{ name: 'dir', value: 'shared' }, file], {}],
      ['wrong token', [{ name: '_csrf', value: 'nope' }, { name: 'dir', value: 'shared' }, file], {}],
      ['another person\'s token', [{ name: '_csrf', value: park.csrf }, { name: 'dir', value: 'shared' }, file], {}],
      ['token after the file', [{ name: 'dir', value: 'shared' }, file, { name: '_csrf', value: choi.csrf }], {}],
      ['wrong header only', [{ name: 'dir', value: 'shared' }, file], { 'x-csrf-token': 'nope' }],
      ['another person\'s header', [{ name: 'dir', value: 'shared' }, file], { 'x-csrf-token': park.csrf }],
    ]
    for (const [why, parts, headers] of attempts) {
      const r = await sendUpload(W.hub, choi, parts, { headers })
      expect({ why, status: r.status }).toEqual({ why, status: 403 })
      expect((await json(r)).error!.message).toContain('보안 확인')
    }
    // the page form gets the error page
    const form = await sendUpload(W.hub, choi, [{ name: 'dir', value: 'shared' }, file], { json: false })
    expect(form.status).toBe(403)
    expect(await form.text()).toContain('보안 확인')
    expect(await stagingEmpty()).toEqual([])
    expect(tree()).toEqual(before)
    // a token in the header is as good as one in the form (scripts send both)
    const ok = await sendUpload(W.hub, choi, [{ name: 'dir', value: 'shared' }, file], { headers: { 'x-csrf-token': choi.csrf } })
    expect(ok.status).toBe(200)
    fs.rmSync(W.abs('shared/csrf.txt'))
    // no folder: refused as such
    const nodir = await sendUpload(W.hub, choi, [{ name: '_csrf', value: choi.csrf }, file])
    expect(nodir.status).toBe(400)
  })

  test('a refused upload is still read to its end, so the connection stays usable for the next request', async () => {
    for (const [why, fieldsOf, status] of [
      ['bad token', [{ name: '_csrf', value: 'bad' }, { name: 'dir', value: 'shared' }], 403],
      ['read-only folder', fields(choi, 'notice'), 403],
      ['hidden folder', fields(choi, 'sales'), 404],
    ] as [string, Part[] & { name: string; value: string }[], number][]) {
      const m = lazyMultipart(fieldsOf, [{ filename: 'refused.bin', size: 12 * MB }])
      const r = await streamUpload(W.hub, choi, m)
      expect({ why, status: r.status }).toEqual({ why, status })
      await r.arrayBuffer()
      for (let i = 0; i < 3; i++) {
        const next = await fetch(W.hub.url + '/healthz', { signal: AbortSignal.timeout(4000) })
        expect(next.status).toBe(200)
      }
    }
    expect(fs.existsSync(W.abs('notice/refused.bin'))).toBe(false)
  })

  test('with no session cookie nothing is read or written (a cross-site post carries none)', async () => {
    const before = tree()
    const r = await sendUpload(W.hub, null, [...fields(choi, 'shared'), { filename: 'anon.txt', data: 'x' }])
    expect(r.status).toBe(401)
    const page = await sendUpload(W.hub, null, [...fields(choi, 'shared'), { filename: 'anon.txt', data: 'x' }], { json: false })
    expect(page.status).toBe(303)
    expect(page.headers.get('location')).toBe('/login')
    expect(tree()).toEqual(before)
  })
})
