// Text extraction for read_file / search_files. Fixtures are generated (files-fixtures.ts); a case is skipped when
// its converter is not installed.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decodeText, extractText, imageMime } from '../../src/files/extract'
import { isolation, runConverter, sandboxProfile } from '../../src/files/isolate'
import { hwpText, hwpxText } from '../../src/files/hwp'
import { hwpDoc, hwpxDoc, pandoc, pandocDoc, pdftotext, tinyPdf, xlsxBook } from './files-fixtures'
import { makeWorld, type World } from './files-world'

const tools = { pandoc, pdftotext }

describe('extractText', () => {
  test('docx / pptx / odt through pandoc', async () => {
    if (!pandoc) { console.log('pandoc missing: skipped'); return }
    for (const f of ['docx', 'pptx', 'odt'] as const) {
      const t = await extractText(`a.${f}`, pandocDoc(f, '# 계약서\n\n계약 금액은 1,200만 원입니다.\n'), tools)
      expect(t, f).toContain('계약 금액은 1,200만 원입니다')
    }
  })
  test('xlsx / ods through SheetJS, every sheet', async () => {
    for (const f of ['xlsx', 'ods'] as const) {
      const t = await extractText(`a.${f}`, xlsxBook([['월', '매출'], ['1월', 3500000], ['2월', 4200000]], f), tools)
      expect(t).toContain('# sheet: 매출')
      expect(t).toContain('1월\t3500000')
      expect(t).toContain('두 번째 시트')
    }
  })
  test('pdf through pdftotext', async () => {
    if (!pdftotext) { console.log('pdftotext missing: skipped'); return }
    expect(await extractText('a.pdf', tinyPdf('Annual leave is 17 days'), tools)).toContain('Annual leave is 17 days')
    await expect(extractText('bad.pdf', new Uint8Array(Buffer.from('not a pdf')), tools)).rejects.toThrow('could not convert')
  })
  test('hwp / hwpx in process', async () => {
    expect(hwpText(hwpDoc('진료 안내'))).toBe('진료 안내')
    expect(hwpxText(hwpxDoc('고객 &amp; 보호자'))).toBe('고객 & 보호자')
    expect(await extractText('공지.HWP', hwpDoc('hwp 본문'), tools)).toBe('hwp 본문')
    expect(await extractText('공지.hwpx', hwpxDoc('hwpx 본문'), tools)).toBe('hwpx 본문')
    expect(() => hwpText(new Uint8Array([1, 2, 3]))).toThrow(/could not read/)
  })
  test('missing converters give a clear error', async () => {
    await expect(extractText('a.docx', new Uint8Array([1]), { pandoc: null, pdftotext: null })).rejects.toThrow('pandoc is not installed')
    await expect(extractText('a.pdf', new Uint8Array([1]), { pandoc: null, pdftotext: null })).rejects.toThrow('pdftotext is not installed')
  })
  test('plain text: UTF-8 with BOM, EUC-KR fallback, binaries refused', async () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])).text).toBe('A')
    expect(decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]))).toEqual({ text: '한글', encoding: 'euc-kr' })
    expect(decodeText(new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('메모 A', 'utf16le')])))).toEqual({ text: '메모 A', encoding: 'utf-16' })
    expect(await extractText('n.txt', new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ab', 'utf16le')])), tools)).toBe('ab')
    await expect(extractText('a.bin', new Uint8Array([0x41, 0, 0x42]), tools)).rejects.toThrow('binary')
  })
  test('image types come from the bytes', () => {
    expect(imageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(imageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(imageMime(new Uint8Array(Buffer.from('GIF89a')))).toBe('image/gif')
    expect(imageMime(new Uint8Array(Buffer.from('RIFF0000WEBPVP8 ')))).toBe('image/webp')
    expect(imageMime(new Uint8Array(Buffer.from('<svg>')))).toBeNull()
  })
})

describe('converter limits', () => {
  test('a stuck converter is killed at the time limit', async () => {
    const r = await runConverter('/bin/sleep', ['10'], new Uint8Array(), { timeoutMs: 200 })
    expect(r.killed).toBe('timeout')
  })
  test('output past the cap is cut off', async () => {
    const r = await runConverter('/bin/cat', [], new Uint8Array(200_000).fill(65), { maxStdout: 1000 })
    expect(r.killed).toBe('output')
  })
  test('converters get a minimal environment and an empty working folder', async () => {
    process.env.ANTHROPIC_TEST_LEAK = 'must-not-reach-converters'
    try {
      // shell builtins only: the sandbox lets the converter run nothing else
      const r = await runConverter('/bin/bash', ['-c', 'pwd; export -p; echo *'], new Uint8Array())
      const out = r.stdout.toString()
      expect(out).toContain('trina-ax-convert-')
      expect(out).toContain('PATH="/usr/bin:/bin"')
      expect(out).not.toContain('must-not-reach-converters')
      expect(out.trim().endsWith('*')).toBe(true) // the work folder is empty
    } finally { delete process.env.ANTHROPIC_TEST_LEAK }
  })
})

describe.skipIf(isolation() === 'none')('converter sandbox', () => {
  let dir: string
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trina-sandbox-')))
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'CANARY-SANDBOX')
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('cannot read the team folder or server data', async () => {
    const r = await runConverter('/bin/cat', [path.join(dir, 'secret.txt')], new Uint8Array(), { denyRead: [dir] })
    expect(r.code).not.toBe(0)
    expect(r.stdout.toString()).not.toContain('CANARY')
  })
  test('cannot write outside its work folder or start other programs', async () => {
    const r = await runConverter('/bin/bash', ['-c', `echo x > ${path.join(dir, 'pwned')}; /bin/cat ${path.join(dir, 'secret.txt')}`], new Uint8Array(), { denyRead: [dir] })
    expect(fs.existsSync(path.join(dir, 'pwned'))).toBe(false)
    expect(r.stdout.toString()).not.toContain('CANARY')
  })
  test('has no network', async () => {
    const srv = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reached') })
    try {
      const r = await runConverter('/usr/bin/curl', ['-s', '-m', '3', `http://127.0.0.1:${srv.port}/`], new Uint8Array(), { timeoutMs: 8000 })
      expect(r.stdout.toString()).not.toContain('reached')
    } finally { srv.stop(true) }
  })
  test('the macOS profile', () => {
    const p = sandboxProfile({ cmd: '/bin/cat', workDir: dir, denyRead: ['/srv/team'] })
    expect(p).toContain('(deny network*)')
    expect(p).toContain('(deny process-exec)')
    expect(p).toContain('(subpath "/srv/team")')
  })
})

describe('read_file converts documents in the team folder', () => {
  let W: World
  beforeAll(async () => { W = await makeWorld() })
  afterAll(async () => { await W?.hub.stop() })

  test('docx, xlsx, pdf, hwp and hwpx come back as numbered text', async () => {
    const files: [string, Uint8Array | null, string][] = [
      ['shared/계약서.docx', pandoc ? pandocDoc('docx', '# 계약서\n\n계약 기간은 2년입니다.\n') : null, '계약 기간은 2년입니다'],
      ['shared/매출.xlsx', xlsxBook([['월', '매출'], ['3월', 777]]), '3월\t777'],
      ['shared/handbook.pdf', pdftotext ? tinyPdf('Remote work twice a week') : null, 'Remote work twice a week'],
      ['shared/공문.hwp', hwpDoc('공문 본문입니다'), '공문 본문입니다'],
      ['shared/양식.hwpx', hwpxDoc('양식 본문입니다'), '양식 본문입니다'],
    ]
    for (const [rel, bytes, want] of files) {
      if (!bytes) { console.log(`${rel}: converter missing, skipped`); continue }
      fs.writeFileSync(W.abs(rel), bytes)
      const r = await W.svc(W.choi).read(rel)
      expect(r.kind).toBe('text')
      if (r.kind === 'text') { expect(r.converted).toBe(true); expect(r.lines.join('\n'), rel).toContain(want) }
      // a second read uses the cached text and gives the same answer
      const again = await W.svc(W.choi).read(rel)
      if (again.kind === 'text' && r.kind === 'text') expect(again.lines).toEqual(r.lines)
    }
  })
  test('a changed document is extracted again', async () => {
    fs.writeFileSync(W.abs('shared/v.hwpx'), hwpxDoc('첫 번째 판'))
    expect(((await W.svc(W.choi).read('shared/v.hwpx')) as any).lines[0]).toBe('첫 번째 판')
    fs.writeFileSync(W.abs('shared/v.hwpx'), hwpxDoc('두 번째 판'))
    const later = new Date(Date.now() + 5000)
    fs.utimesSync(W.abs('shared/v.hwpx'), later, later)
    expect(((await W.svc(W.choi).read('shared/v.hwpx')) as any).lines[0]).toBe('두 번째 판')
  })
})
