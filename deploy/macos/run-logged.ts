// Runs one command and appends its output (stdout + stderr, whole lines) to a log file. launchd starts the hub and
// the tunnel through this instead of StandardOutPath, because launchd keeps writing into the file it opened: after
// newsyslog renames hub.log to hub.log.0 the hub would never write to the new hub.log. Here every write first checks
// that the path still names the file we have open, and reopens it when it does not.
//
//   bun run-logged.ts <log file> [--max-size 10M --keep 5] -- <command> [args…]
//
// --max-size makes this rotate the file itself (hub.log → hub.log.0 → … → hub.log.<keep-1>) for installs without
// a newsyslog config (the --agent install, which has no sudo). SIGTERM and SIGINT are passed to the command and we
// exit when it does, so launchd's stop and restart reach the hub itself. SIGHUP is ignored (only reopens the file).
import fs from 'node:fs'
import os from 'node:os'

export interface Rotation { maxBytes: number; keep: number }

/** An append-only log file that follows renames (newsyslog) and can rotate itself by size. */
export class LogFile {
  private fd = -1
  private ino = -1
  private size = 0

  constructor(readonly file: string, readonly rotation: Rotation | null = null) { this.open() }

  private open() {
    this.fd = fs.openSync(this.file, 'a', 0o600)
    const st = fs.fstatSync(this.fd)
    this.ino = st.ino
    this.size = st.size
  }

  private reopenIfMoved() {
    let ino = -1
    try { ino = fs.statSync(this.file).ino } catch {}
    if (ino === this.ino) return
    try { fs.closeSync(this.fd) } catch {}
    this.open()
  }

  private rotate() {
    const { keep } = this.rotation!
    try { fs.closeSync(this.fd) } catch {}
    for (let i = keep - 1; i >= 1; i--) {
      try { fs.renameSync(`${this.file}.${i - 1}`, `${this.file}.${i}`) } catch {}
    }
    try { fs.renameSync(this.file, `${this.file}.0`) } catch {}
    this.open()
  }

  write(data: Uint8Array | string) {
    const buf = typeof data === 'string' ? Buffer.from(data) : data
    if (!buf.length) return
    try {
      this.reopenIfMoved()
      if (this.rotation && this.size > 0 && this.size + buf.length > this.rotation.maxBytes) this.rotate()
      fs.writeSync(this.fd, buf)
      this.size += buf.length
    } catch {
      // disk full or the folder is gone: drop the line rather than take the hub down with us
    }
  }

  close() { try { fs.closeSync(this.fd) } catch {} }
}

/** "10M" / "512K" / "1048576" → bytes */
export function parseSize(v: string): number | null {
  const m = /^(\d+)([KMG]?)B?$/i.exec(v.trim())
  if (!m) return null
  const mult = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2]!.toUpperCase() as '' | 'K' | 'M' | 'G']
  return Number(m[1]) * mult
}

export function parseArgs(argv: string[]): { file: string; rotation: Rotation | null; cmd: string[] } | null {
  const sep = argv.indexOf('--')
  if (sep < 1 || sep === argv.length - 1) return null
  const [file, ...opts] = argv.slice(0, sep)
  let maxBytes: number | null = null, keep = 5
  for (let i = 0; i < opts.length; i++) {
    if (opts[i] === '--max-size') { maxBytes = parseSize(opts[++i] ?? ''); if (!maxBytes) return null }
    else if (opts[i] === '--keep') { keep = Number(opts[++i]); if (!Number.isInteger(keep) || keep < 1 || keep > 100) return null }
    else return null
  }
  return { file: file!, rotation: maxBytes ? { maxBytes, keep } : null, cmd: argv.slice(sep + 1) }
}

/** Pass a stream to the log in whole lines, so stdout and stderr never interleave inside a line. */
async function pump(stream: ReadableStream<Uint8Array>, log: LogFile) {
  let rest: Buffer = Buffer.alloc(0)
  for await (const chunk of stream) {
    const buf = rest.length ? Buffer.concat([rest, chunk]) : Buffer.from(chunk)
    const nl = buf.lastIndexOf(0x0a)
    if (nl < 0) { rest = buf; continue }
    log.write(buf.subarray(0, nl + 1))
    rest = Buffer.from(buf.subarray(nl + 1))
    if (rest.length > 1024 * 1024) { log.write(Buffer.concat([rest, Buffer.from('\n')])); rest = Buffer.alloc(0) }
  }
  if (rest.length) log.write(Buffer.concat([rest, Buffer.from('\n')]))
}

export async function runLogged(argv: string[]): Promise<number> {
  const a = parseArgs(argv)
  if (!a) {
    console.error('사용법: bun run-logged.ts <로그 파일> [--max-size 10M --keep 5] -- <명령> [인자…]')
    return 2
  }
  const log = new LogFile(a.file, a.rotation)
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn(a.cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: process.env })
  } catch (e) {
    log.write(`${JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'could not start', cmd: a.cmd[0], err: String((e as Error)?.message ?? e) })}\n`)
    log.close()
    return 127
  }
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { try { child.kill(sig) } catch {} })
  process.on('SIGHUP', () => {})
  await Promise.all([pump(child.stdout as ReadableStream<Uint8Array>, log), pump(child.stderr as ReadableStream<Uint8Array>, log)])
  const code = await child.exited
  log.close()
  if (child.signalCode) return 128 + ((os.constants.signals as Record<string, number>)[child.signalCode] ?? 1)
  return code ?? 1
}

if (import.meta.main) process.exit(await runLogged(process.argv.slice(2)))
