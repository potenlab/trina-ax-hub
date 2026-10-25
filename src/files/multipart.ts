// A streaming multipart/form-data reader (RFC 7578) for uploads. Request.formData() would hold the whole upload in
// memory; this reads the body piece by piece and hands out each part's data as it arrives, so the caller can write a
// file to disk while it is still coming in. Memory stays at one network chunk plus the length of the delimiter.
//
// Use: `await r.next()` gives the next part (the unread rest of the previous part is skipped); `await r.read()` gives
// its data piece by piece, then null; `await r.text()` reads a small field. Anything wrong with the body (no closing
// delimiter, a part header that never ends, too many bytes, no data for a long time) throws a MultipartError.

export type MultipartFault = 'malformed' | 'limit' | 'idle' | 'aborted'
export class MultipartError extends Error {
  constructor(readonly fault: MultipartFault, message: string) { super(message) }
}

export interface PartInfo {
  /** the form field name */
  name: string
  /** the file name the browser sent (may hold folder names: "영업/2026/표.xlsx"); null for an ordinary field */
  filename: string | null
  contentType: string | null
}

export interface MultipartOptions {
  /** most bytes read from the body in all, boundaries and headers included */
  maxBytes: number
  /** give up when nothing arrives for this long (default 60 s; 0 = never) */
  idleMs?: number
  /** longest header block of one part (default 16 KB) */
  maxHeaderBytes?: number
  /** the request's abort signal: the server does not end a body stream when the client goes away, it fires this */
  signal?: AbortSignal
}

/** The boundary of a `multipart/form-data` Content-Type, or null. */
export function boundaryOf(contentType: string | null | undefined): string | null {
  if (!contentType) return null
  const m = /^\s*multipart\/form-data\s*;(?:.*;)?\s*boundary\s*=\s*(?:"([^"]{1,70})"|([^\s;"]{1,70})(?=[\s;]|$))/i.exec(contentType)
  const b = m?.[1] ?? m?.[2]
  return b && /^[\x21-\x7e ]+$/.test(b) && !b.endsWith(' ') ? b : null
}

const CRLF2 = Buffer.from('\r\n\r\n')
const utf8 = new TextDecoder('utf-8')

/** The `;name=value` parameters of a header (quoted or not); `name*=UTF-8''...` (RFC 5987) replaces `name`. */
function params(header: string): Map<string, string> {
  const re = /;\s*([A-Za-z0-9*_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g
  const out = new Map<string, string>()
  const ext = new Map<string, string>()
  for (let m = re.exec(header); m; m = re.exec(header)) {
    const k = m[1]!.toLowerCase()
    const v = m[2] !== undefined ? m[2].replace(/\\(["\\])/g, '$1') : (m[3] ?? '').trim()
    if (k.endsWith('*')) {
      const e = /^([A-Za-z0-9-]+)'[^']*'(.*)$/.exec(v)
      if (e && /^utf-?8$/i.test(e[1]!)) { try { ext.set(k.slice(0, -1), decodeURIComponent(e[2]!)) } catch { /* a bad escape: ignore */ } }
    } else out.set(k, v)
  }
  for (const [k, v] of ext) out.set(k, v)
  return out
}

type ReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>
type State = 'body' | 'delim' | 'done'

export class MultipartReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>
  // a virtual CRLF in front, so that the first delimiter looks like all the others
  private buf: Buffer = Buffer.from('\r\n')
  private delim: Buffer
  private state: State = 'body'
  private eof = false
  private total = 0
  private opts: Required<Omit<MultipartOptions, 'signal'>> & { signal?: AbortSignal }

  constructor(stream: ReadableStream<Uint8Array>, boundary: string, o: MultipartOptions) {
    this.reader = stream.getReader()
    this.delim = Buffer.from(`\r\n--${boundary}`)
    this.opts = { idleMs: 60_000, maxHeaderBytes: 16 * 1024, ...o }
  }

  /** bytes read from the body so far */
  get bytesRead() { return this.total }

  /** Stop reading (the client is told nothing more; the connection is closed by the server). */
  cancel() {
    this.state = 'done'
    this.reader.cancel().catch(() => {})
  }

  private async more(): Promise<void> {
    if (this.eof) throw new MultipartError('malformed', 'the upload ended too early')
    let r: ReadResult
    try { r = await this.readChunk() } catch (e) {
      if (e instanceof MultipartError) throw e
      throw new MultipartError('aborted', 'the connection was closed during the upload')
    }
    if (r.done) { this.eof = true; throw new MultipartError('malformed', 'the upload ended too early') }
    this.total += r.value.byteLength
    if (this.total > this.opts.maxBytes) throw new MultipartError('limit', 'the upload is too large')
    const chunk = Buffer.from(r.value.buffer, r.value.byteOffset, r.value.byteLength)
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
  }

  private readChunk(): Promise<ReadResult> {
    const { idleMs, signal } = this.opts
    const gone = () => new MultipartError('aborted', 'the connection was closed during the upload')
    if (signal?.aborted) { this.cancel(); return Promise.reject(gone()) }
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
      const onAbort = () => { done(); this.cancel(); reject(gone()) }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (idleMs) timer = setTimeout(() => { done(); this.cancel(); reject(new MultipartError('idle', 'nothing arrived for too long')) }, idleMs)
      this.reader.read().then((v) => { done(); resolve(v) }, (e) => { done(); reject(e) })
    })
  }

  /**
   * The next piece of the current part's data, or null at its end.
   */
  async read(): Promise<Uint8Array | null> {
    if (this.state !== 'body') return null
    for (;;) {
      const i = this.buf.indexOf(this.delim)
      if (i >= 0) {
        const data = this.buf.subarray(0, i)
        this.buf = this.buf.subarray(i + this.delim.length)
        this.state = 'delim'
        return data.length ? data : null
      }
      // no delimiter yet: everything but a tail that could be its beginning is data
      const keep = this.delim.length - 1
      if (this.buf.length > keep) {
        const data = this.buf.subarray(0, this.buf.length - keep)
        this.buf = this.buf.subarray(this.buf.length - keep)
        return data
      }
      await this.more()
    }
  }

  /**
   * Read and throw away the rest of the body. A server must do this before it answers a request it has stopped reading
   * (a refused upload): Bun keeps waiting for the unread bytes and takes the client's next request on that connection
   * for part of them, so it hangs. The size is not counted here: the server's own body limit ends an endless one.
   */
  async drain(): Promise<void> {
    this.buf = Buffer.alloc(0)
    this.state = 'done'
    while (!this.eof) {
      let r: ReadResult
      try { r = await this.readChunk() } catch { return }
      if (r.done) this.eof = true
    }
  }

  /** Read and discard the rest of the current part. */
  async skip(): Promise<void> {
    while (this.state === 'body') await this.read()
  }

  /** The current part as text (a form field); at most `max` bytes. */
  async text(max = 8 * 1024): Promise<string> {
    const chunks: Uint8Array[] = []
    let n = 0
    for (let c = await this.read(); c; c = await this.read()) {
      n += c.length
      if (n > max) { await this.skip(); throw new MultipartError('malformed', 'a form field is too long') }
      chunks.push(c)
    }
    return utf8.decode(Buffer.concat(chunks))
  }

  /** The next part, or null after the closing delimiter. The unread rest of the previous part is skipped. */
  async next(): Promise<PartInfo | null> {
    await this.skip()
    if (this.state === 'done') return null
    while (this.buf.length < 2) await this.more()
    if (this.buf[0] === 0x2d && this.buf[1] === 0x2d) { // "--": the closing delimiter; an epilogue is ignored
      await this.drain()
      return null
    }
    let end: number
    for (;;) {
      end = this.buf.indexOf(CRLF2)
      if (end >= 0) break
      if (this.buf.length > this.opts.maxHeaderBytes) throw new MultipartError('malformed', 'the part headers are too long')
      await this.more()
    }
    // after the delimiter: optional blanks, a line break, then the header lines (none at all: "\r\n\r\n" directly)
    const lines = utf8.decode(this.buf.subarray(0, end)).split('\r\n')
    this.buf = this.buf.subarray(end + CRLF2.length)
    if (!/^[ \t]*$/.test(lines.shift() ?? '')) throw new MultipartError('malformed', 'bad text after a boundary')
    let disposition = '', contentType: string | null = null
    for (const line of lines) {
      const c = line.indexOf(':')
      if (c <= 0) throw new MultipartError('malformed', 'bad part header')
      const k = line.slice(0, c).trim().toLowerCase()
      const v = line.slice(c + 1).trim()
      if (k === 'content-disposition') disposition = v
      else if (k === 'content-type') contentType = v
    }
    if (!/^form-data\b/i.test(disposition)) throw new MultipartError('malformed', 'a part is not form-data')
    const p = params(disposition)
    const name = p.get('name')
    if (name === undefined) throw new MultipartError('malformed', 'a part has no name')
    this.state = 'body'
    return { name, filename: p.get('filename') ?? null, contentType }
  }
}

/** Read a request body to its end and discard it (see MultipartReader.drain). */
export async function drainBody(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<void> {
  await new MultipartReader(body, 'x', { maxBytes: Infinity, signal }).drain()
}
