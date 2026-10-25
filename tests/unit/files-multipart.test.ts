// The streaming multipart reader: parts and fields, boundaries cut anywhere by the network, binary data that looks like
// a boundary, header parameters (Korean names), and every way a body can be wrong.
import { describe, expect, test } from 'bun:test'
import { boundaryOf, MultipartError, MultipartReader } from '../../src/files/multipart'
import { multipart, type Part } from './files-upload-lib'

/** The body as a stream cut into pieces of `size` bytes (or random sizes). */
function pieces(body: Uint8Array, size: number | 'random'): ReadableStream<Uint8Array> {
  let pos = 0
  return new ReadableStream({
    pull(ctrl) {
      if (pos >= body.length) return ctrl.close()
      const n = size === 'random' ? 1 + Math.floor(Math.random() * 40) : size
      ctrl.enqueue(body.slice(pos, pos + n))
      pos += n
    },
  })
}

interface Got { name: string; filename: string | null; data: Uint8Array }
async function readAll(rd: MultipartReader): Promise<Got[]> {
  const out: Got[] = []
  for (let p = await rd.next(); p; p = await rd.next()) {
    const chunks: Uint8Array[] = []
    for (let c = await rd.read(); c; c = await rd.read()) chunks.push(c)
    out.push({ name: p.name, filename: p.filename, data: Buffer.concat(chunks) })
  }
  return out
}

const sample: Part[] = [
  { name: '_csrf', value: 'abc123' },
  { name: 'dir', value: '영업/2026' },
  { filename: '보고서.txt', data: '안녕하세요\r\n두 번째 줄' },
  { filename: 'empty.bin', data: '' },
  { filename: 'bin.dat', data: new Uint8Array([0, 1, 2, 13, 10, 45, 45, 255, 254, 13, 10, 13, 10]) },
]

describe('MultipartReader', () => {
  for (const size of [1, 2, 3, 7, 64, 100_000, 'random'] as const) {
    test(`reads every part whatever the network chunk size (${size})`, async () => {
      const m = multipart(sample)
      const got = await readAll(new MultipartReader(pieces(m.body, size), m.boundary, { maxBytes: 1 << 20 }))
      expect(got.map((g) => [g.name, g.filename])).toEqual([['_csrf', null], ['dir', null], ['files', '보고서.txt'], ['files', 'empty.bin'], ['files', 'bin.dat']])
      expect(Buffer.from(got[0]!.data).toString()).toBe('abc123')
      expect(Buffer.from(got[1]!.data).toString()).toBe('영업/2026')
      expect(Buffer.from(got[2]!.data).toString()).toBe('안녕하세요\r\n두 번째 줄')
      expect(got[3]!.data.length).toBe(0)
      expect([...got[4]!.data]).toEqual([0, 1, 2, 13, 10, 45, 45, 255, 254, 13, 10, 13, 10])
    })
  }

  test('data that contains the boundary text without the line break in front is data', async () => {
    const b = 'XYZ'
    const tricky = `--${b} not a delimiter\r\n--XYx and\r\n-${b}\r\n--XY`
    const m = multipart([{ filename: 'a.txt', data: tricky }, { filename: 'b.txt', data: 'after' }], b)
    for (const size of [1, 5, 1000] as const) {
      const got = await readAll(new MultipartReader(pieces(m.body, size), b, { maxBytes: 1 << 20 }))
      expect(Buffer.from(got[0]!.data).toString()).toBe(tricky)
      expect(Buffer.from(got[1]!.data).toString()).toBe('after')
    }
  })

  test('a preamble before the first boundary and an epilogue after the last are ignored', async () => {
    const m = multipart([{ name: 'a', value: '1' }], 'B')
    const body = Buffer.concat([Buffer.from('this is a preamble\r\nmore\r\n'), m.body, Buffer.from('epilogue text\r\n')])
    const got = await readAll(new MultipartReader(pieces(body, 9), 'B', { maxBytes: 1 << 20 }))
    expect(got.map((g) => g.name)).toEqual(['a'])
  })

  test('the unread rest of a part is skipped by next()', async () => {
    const m = multipart([{ filename: 'big.bin', data: 'x'.repeat(5000) }, { name: 'after', value: 'ok' }], 'B')
    const rd = new MultipartReader(pieces(m.body, 100), 'B', { maxBytes: 1 << 20 })
    expect((await rd.next())!.filename).toBe('big.bin')
    await rd.read() // one piece only
    const second = await rd.next()
    expect(second!.name).toBe('after')
    expect(await rd.text()).toBe('ok')
    expect(await rd.next()).toBeNull()
  })

  test('header parameters: quoted, RFC 5987 filename*, escaped quotes, a semicolon inside a name', async () => {
    const mk = (disp: string) => Buffer.from(`--B\r\nContent-Disposition: ${disp}\r\n\r\nx\r\n--B--\r\n`)
    const one = async (disp: string) => (await new MultipartReader(pieces(mk(disp), 5), 'B', { maxBytes: 9999 }).next())!
    expect(await one(`form-data; name="files"; filename="a b.txt"`)).toMatchObject({ name: 'files', filename: 'a b.txt' })
    expect(await one(`form-data; name="files"; filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C.txt`)).toMatchObject({ filename: '보고서.txt' })
    expect(await one(`form-data; name="files"; filename="x.txt"; filename*=UTF-8''%EA%B0%80.txt`)).toMatchObject({ filename: '가.txt' })
    expect(await one(`form-data; name="files"; filename="a\\"b.txt"`)).toMatchObject({ filename: 'a"b.txt' })
    expect(await one(`form-data; name="f"; filename="x; name=\\"evil\\".txt"`)).toMatchObject({ name: 'f', filename: 'x; name="evil".txt' })
    expect(await one(`form-data; name="field"`)).toMatchObject({ name: 'field', filename: null })
    expect(await one(`form-data; name="files"; filename=""`)).toMatchObject({ filename: '' })
  })

  test('boundaryOf', () => {
    expect(boundaryOf('multipart/form-data; boundary=----abc')).toBe('----abc')
    expect(boundaryOf('multipart/form-data; charset=utf-8; boundary="a b-c"')).toBe('a b-c')
    expect(boundaryOf('multipart/form-data')).toBeNull()
    expect(boundaryOf('application/json; boundary=x')).toBeNull()
    expect(boundaryOf('multipart/form-data; boundary=')).toBeNull()
    expect(boundaryOf(null)).toBeNull()
    expect(boundaryOf('multipart/form-data; boundary=' + 'a'.repeat(71))).toBeNull()
  })

  const fault = async (body: Uint8Array | string, o: { maxBytes?: number; idleMs?: number; stream?: ReadableStream<Uint8Array> } = {}) => {
    const b = typeof body === 'string' ? Buffer.from(body) : body
    try { await readAll(new MultipartReader(o.stream ?? pieces(b, 16), 'B', { maxBytes: o.maxBytes ?? 1 << 20, idleMs: o.idleMs })); return null } catch (e) {
      expect(e).toBeInstanceOf(MultipartError)
      return (e as MultipartError).fault
    }
  }

  test('bodies that are wrong fail with a MultipartError', async () => {
    // no closing delimiter
    expect(await fault('--B\r\nContent-Disposition: form-data; name="a"\r\n\r\nvalue\r\n')).toBe('malformed')
    expect(await fault('--B\r\nContent-Disposition: form-data; name="a"\r\n\r\nvalue')).toBe('malformed')
    // an empty body, text that is not multipart
    expect(await fault('')).toBe('malformed')
    expect(await fault('hello world, I am not multipart')).toBe('malformed')
    // a part that is not form-data, one without a name, a header without a colon
    expect(await fault('--B\r\nContent-Disposition: attachment; name="a"\r\n\r\nx\r\n--B--\r\n')).toBe('malformed')
    expect(await fault('--B\r\nContent-Disposition: form-data\r\n\r\nx\r\n--B--\r\n')).toBe('malformed')
    expect(await fault('--B\r\nnot a header\r\n\r\nx\r\n--B--\r\n')).toBe('malformed')
    // junk right after the boundary
    expect(await fault('--Bjunk\r\nContent-Disposition: form-data; name="a"\r\n\r\nx\r\n--B--\r\n')).toBe('malformed')
    // a part header block that never ends
    expect(await fault('--B\r\nContent-Disposition: form-data; name="a"; ' + 'x'.repeat(40_000))).toBe('malformed')
  })

  test('more bytes than allowed fails with "limit" (and stops reading)', async () => {
    const m = multipart([{ filename: 'a', data: 'x'.repeat(100_000) }], 'B')
    expect(await fault(m.body, { maxBytes: 50_000 })).toBe('limit')
    expect(await fault(m.body, { maxBytes: m.body.length })).toBeNull()
    expect(await fault(m.body, { maxBytes: m.body.length - 1 })).toBe('limit')
  })

  test('a client that stops sending fails with "idle"; a connection that breaks fails with "aborted"', async () => {
    const head = Buffer.from('--B\r\nContent-Disposition: form-data; name="files"; filename="a"\r\n\r\npartial')
    const stalled = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(head) }, pull() { return new Promise(() => {}) } })
    expect(await fault('', { stream: stalled, idleMs: 80 })).toBe('idle')
    const broken = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(head) }, pull(c) { c.error(new Error('socket closed')) } })
    expect(await fault('', { stream: broken, idleMs: 0 })).toBe('aborted')
  })

  test('memory: a 300 MB body is read in pieces without being held', async () => {
    const chunk = new Uint8Array(1 << 20).fill(0x61)
    const head = Buffer.from('--B\r\nContent-Disposition: form-data; name="files"; filename="big"\r\n\r\n')
    const tail = Buffer.from('\r\n--B--\r\n')
    let sent = 0
    const total = 300
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent === 0) ctrl.enqueue(head)
        else if (sent <= total) ctrl.enqueue(chunk)
        else { ctrl.enqueue(tail); ctrl.close() }
        sent++
      },
    })
    const rd = new MultipartReader(stream, 'B', { maxBytes: 400 << 20 })
    const before = process.memoryUsage().rss
    let peak = before
    let n = 0
    expect((await rd.next())!.filename).toBe('big')
    for (let c = await rd.read(); c; c = await rd.read()) { n += c.length; peak = Math.max(peak, process.memoryUsage().rss) }
    expect(n).toBe(total * (1 << 20))
    expect(await rd.next()).toBeNull()
    expect(peak - before).toBeLessThan(100 << 20)
  })
})
