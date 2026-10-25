// Helpers for the upload tests (not a test file itself): multipart bodies, built whole or streamed lazily.
import { post, html, type Sess } from './web-lib'
import type { TestHub } from '../lib/hub'

export const MB = 1024 * 1024
const enc = new TextEncoder()

export interface Field { name: string; value: string }
export interface FilePart { name?: string; filename: string; data: Uint8Array | string; contentType?: string }
export type Part = Field | FilePart

const isFile = (p: Part): p is FilePart => 'filename' in p

/** A multipart/form-data body held in memory (small uploads). */
export function multipart(parts: Part[], boundary = '----tx' + Math.random().toString(36).slice(2)): { body: Uint8Array; contentType: string; boundary: string } {
  const chunks: Uint8Array[] = []
  for (const p of parts) {
    if (isFile(p)) {
      chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name ?? 'files'}"; filename="${p.filename}"\r\nContent-Type: ${p.contentType ?? 'application/octet-stream'}\r\n\r\n`))
      chunks.push(typeof p.data === 'string' ? enc.encode(p.data) : p.data)
      chunks.push(enc.encode('\r\n'))
    } else chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`))
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`))
  const len = chunks.reduce((n, c) => n + c.length, 0)
  const body = new Uint8Array(len)
  let off = 0
  for (const c of chunks) { body.set(c, off); off += c.length }
  return { body, contentType: `multipart/form-data; boundary=${boundary}`, boundary }
}

/** The usual first fields of an upload form. */
export const fields = (sess: Sess, dir: string, extra: Field[] = []): Field[] => [{ name: '_csrf', value: sess.csrf }, { name: 'dir', value: dir }, ...extra]

/** POST /files/upload with a ready multipart body. JSON answer unless `json: false`. */
export function sendUpload(hub: TestHub, sess: Sess | null, parts: Part[], o: { json?: boolean; headers?: Record<string, string> } = {}) {
  const m = multipart(parts)
  return fetch(hub.url + '/files/upload', {
    method: 'POST', body: m.body as unknown as BodyInit, redirect: 'manual',
    headers: { 'content-type': m.contentType, ...(o.json === false ? html : { accept: 'application/json' }), ...(sess ? { cookie: sess.cookie } : {}), ...o.headers },
  })
}

/** Upload with FormData, the way a browser does. */
export function formUpload(hub: TestHub, sess: Sess, dir: string, files: { name: string; data: string | Uint8Array }[], o: { overwrite?: boolean; csrf?: string | false; json?: boolean } = {}) {
  const fd = new FormData()
  if (o.csrf !== false) fd.append('_csrf', o.csrf ?? sess.csrf)
  fd.append('dir', dir)
  if (o.overwrite) fd.append('overwrite', '1')
  for (const f of files) fd.append('files', new File([f.data as BlobPart], f.name))
  return fetch(hub.url + '/files/upload', { method: 'POST', body: fd, redirect: 'manual', headers: { cookie: sess.cookie, ...(o.json === false ? html : { accept: 'application/json' }) } })
}

/**
 * A multipart body made on the fly: `files` are generated chunk by chunk (never held whole), so a 200 MB request costs
 * the sender almost no memory. The length is known in advance so the request carries a Content-Length.
 */
export function lazyMultipart(prefixFields: Field[], files: { filename: string; size: number }[], o: { boundary?: string; chunk?: number; pace?: number } = {}) {
  const boundary = o.boundary ?? '----lazy' + Math.random().toString(36).slice(2)
  const chunk = o.chunk ?? 256 * 1024
  const pieces: (Uint8Array | { size: number })[] = []
  for (const f of prefixFields) pieces.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`))
  for (const f of files) {
    pieces.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`))
    pieces.push({ size: f.size })
    pieces.push(enc.encode('\r\n'))
  }
  pieces.push(enc.encode(`--${boundary}--\r\n`))
  const length = pieces.reduce((n, p) => n + ('size' in p ? p.size : p.length), 0)
  const block = new Uint8Array(chunk).fill(0x61)
  let i = 0, left = 0
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      for (;;) {
        // `pace` ms per chunk: a real client sends no faster than a network carries (256 KB / 2 ms is 1 Gbit/s)
        if (left > 0) { if (o.pace) await Bun.sleep(o.pace); const n = Math.min(left, chunk); left -= n; ctrl.enqueue(n === chunk ? block : block.subarray(0, n)); return }
        if (i >= pieces.length) { ctrl.close(); return }
        const p = pieces[i++]!
        if ('size' in p) { left = p.size; continue }
        ctrl.enqueue(p); return
      }
    },
  })
  return { stream, length, contentType: `multipart/form-data; boundary=${boundary}`, boundary }
}

export function streamUpload(hub: TestHub, sess: Sess, m: ReturnType<typeof lazyMultipart>, o: { chunked?: boolean; headers?: Record<string, string> } = {}) {
  return fetch(hub.url + '/files/upload', {
    method: 'POST', body: m.stream, redirect: 'manual', duplex: 'half',
    headers: { 'content-type': m.contentType, ...(o.chunked ? {} : { 'content-length': String(m.length) }), accept: 'application/json', cookie: sess.cookie, ...o.headers },
  } as RequestInit)
}

export { post }

// ---- reading pages ----
const unescape = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
/** The flash messages (the .notice boxes) of a page. */
export const notices = (page: string): string[] => [...page.matchAll(/<div class="notice[^"]*" role="status">([^<]*)<\/div>/g)].map((m) => unescape(m[1]!))
/** The names in the file list of a /files page, folders with a trailing "/". */
export function listed(page: string): string[] {
  const rows = page.split('<tr>').slice(1)
  return rows.map((r) => {
    const m = /<td class="name"[^>]*><a href="([^"]*)">(📁|📄) ([^<]*)<\/a>/.exec(r)
    return m ? unescape(m[3]!) + (m[2] === '📁' ? '/' : '') : ''
  }).filter(Boolean)
}
/** Plain text of a page body for comparing two answers (paths typed by the caller masked). */
export const mask = (page: string, ...typed: string[]) => typed.reduce((s, t) => s.split(t).join('<P>').split(encodeURIComponent(t)).join('<P>'), page)
