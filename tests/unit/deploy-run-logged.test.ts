// deploy/macos/run-logged.ts: the log writer launchd runs the hub through. It must follow newsyslog's rename,
// rotate by itself for --agent installs, keep lines whole, and pass SIGTERM to the hub.
import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LogFile, parseArgs, parseSize } from '../../deploy/macos/run-logged'

const SCRIPT = path.resolve(import.meta.dir, '../../deploy/macos/run-logged.ts')
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trina-runlogged-')))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
const file = () => path.join(dir, `t${++n}.log`)
const read = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }

async function until(cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await Bun.sleep(25) }
}

describe('LogFile', () => {
  test('follows a rename (newsyslog) and writes to the new file', () => {
    const f = file()
    const log = new LogFile(f)
    log.write('first\n')
    fs.renameSync(f, f + '.0')
    log.write('second\n')
    log.close()
    expect(read(f + '.0')).toBe('first\n')
    expect(read(f)).toBe('second\n')
    expect((fs.statSync(f).mode & 0o777).toString(8)).toBe('600')
  })

  test('recreates the file when it was deleted', () => {
    const f = file()
    const log = new LogFile(f)
    log.write('a\n')
    fs.rmSync(f)
    log.write('b\n')
    log.close()
    expect(read(f)).toBe('b\n')
  })

  test('rotates by size and keeps only `keep` old files', () => {
    const f = file()
    const log = new LogFile(f, { maxBytes: 10, keep: 2 })
    for (let i = 0; i < 6; i++) log.write(`line-${i}\n`) // 7 bytes each: one line per file
    log.close()
    expect(read(f)).toBe('line-5\n')
    expect(read(f + '.0')).toBe('line-4\n')
    expect(read(f + '.1')).toBe('line-3\n')
    expect(fs.existsSync(f + '.2')).toBe(false)
  })

  test('appends to an existing log', () => {
    const f = file()
    fs.writeFileSync(f, 'old\n')
    const log = new LogFile(f)
    log.write('new\n')
    log.close()
    expect(read(f)).toBe('old\nnew\n')
  })
})

describe('arguments', () => {
  test('parse', () => {
    expect(parseSize('10M')).toBe(10 * 1024 * 1024)
    expect(parseSize('512k')).toBe(512 * 1024)
    expect(parseSize('x')).toBeNull()
    expect(parseArgs(['/l', '--', 'bun', 'a.ts'])).toEqual({ file: '/l', rotation: null, cmd: ['bun', 'a.ts'] })
    expect(parseArgs(['/l', '--max-size', '1M', '--keep', '3', '--', 'x'])).toEqual({ file: '/l', rotation: { maxBytes: 1024 * 1024, keep: 3 }, cmd: ['x'] })
    expect(parseArgs(['/l', 'x'])).toBeNull()
    expect(parseArgs(['/l', '--'])).toBeNull()
    expect(parseArgs(['--', 'x'])).toBeNull()
    expect(parseArgs(['/l', '--keep', '0', '--', 'x'])).toBeNull()
    expect(parseArgs(['/l', '--bogus', '--', 'x'])).toBeNull()
  })

  test('usage error exits 2', () => {
    const r = Bun.spawnSync(['bun', SCRIPT, 'only-a-file'], { stderr: 'pipe' })
    expect(r.exitCode).toBe(2)
    expect(r.stderr.toString()).toContain('사용법')
  })
})

describe('running a command', () => {
  test('stdout and stderr in whole lines; SIGTERM reaches the command; exit code passes through', async () => {
    const f = file()
    const child = `trap 'echo got-term; exit 3' TERM; echo out-line; echo err-line >&2; printf 'no-newline'; while true; do sleep 0.05; done`
    const p = Bun.spawn(['bun', SCRIPT, f, '--', 'bash', '-c', child], { stdout: 'ignore', stderr: 'ignore' })
    await until(() => read(f).includes('out-line') && read(f).includes('err-line'))
    p.kill('SIGTERM')
    expect(await p.exited).toBe(3)
    const text = read(f)
    expect(text).toContain('got-term\n')
    expect(text).toContain('no-newline') // the unfinished line is still written, with a newline added
    for (const line of text.trimEnd().split('\n')) expect(['out-line', 'err-line', 'got-term', 'no-newlinegot-term', 'no-newline']).toContain(line)
  })

  test('keeps writing into hub.log after newsyslog renames it', async () => {
    const f = file()
    const child = `i=0; while true; do echo "tick-$i"; i=$((i+1)); sleep 0.05; done`
    const p = Bun.spawn(['bun', SCRIPT, f, '--', 'bash', '-c', child], { stdout: 'ignore', stderr: 'ignore' })
    await until(() => read(f).includes('tick-2'))
    fs.renameSync(f, f + '.0')
    await until(() => read(f).includes('tick-'))
    p.kill('SIGTERM')
    await p.exited
    const before = read(f + '.0').trim().split('\n'), after = read(f).trim().split('\n')
    const num = (l: string) => Number(l.replace('tick-', ''))
    expect(num(after[0]!)).toBeGreaterThan(num(before[before.length - 1]!))
  })

  test('a command that cannot start is logged, not a crash loop of silence', async () => {
    const f = file()
    const r = Bun.spawnSync(['bun', SCRIPT, f, '--', path.join(dir, 'no-such-program')], { stderr: 'pipe' })
    expect(r.exitCode).toBe(127)
    expect(read(f)).toContain('could not start')
  })
})
