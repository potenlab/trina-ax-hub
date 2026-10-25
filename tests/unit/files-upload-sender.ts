// Runs in its own process so the test can measure the hub's memory alone: sends one big streamed upload and prints the
// answer as JSON. Usage: bun files-upload-sender.ts <hub url> <cookie> <csrf> <dir> <files> <MB each>
import { lazyMultipart, MB } from './files-upload-lib'

const [url, cookie, csrf, dir, count, mb] = process.argv.slice(2) as [string, string, string, string, string, string]
const files = Array.from({ length: Number(count) }, (_, i) => ({ filename: `big-${i}.bin`, size: Number(mb) * MB }))
const m = lazyMultipart([{ name: '_csrf', value: csrf }, { name: 'dir', value: dir }], files, { pace: 2 })
const r = await fetch(url + '/files/upload', {
  method: 'POST', body: m.stream, duplex: 'half', redirect: 'manual',
  headers: { 'content-type': m.contentType, 'content-length': String(m.length), accept: 'application/json', cookie },
} as RequestInit)
console.log(JSON.stringify({ status: r.status, body: await r.text() }))
