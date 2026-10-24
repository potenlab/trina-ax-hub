// Converters (pandoc, pdftotext) parse files people put in the team folder, so they never run with the hub's full
// rights (ported from Team AX server/src/tools/isolate.ts):
// - macOS: a sandbox-exec profile: no network, no fork or exec of anything but the converter itself, writes only into
//   an empty work folder, no reading of file contents under /Users, /Volumes, the temp folders, the home folder, the
//   team folder or the hub's data folder (the company API key lives there); only the work folder is readable there.
// - Linux: bubblewrap (bwrap) when installed: read-only system folders, private /tmp, no network, only the work
//   folder bound in. Without bwrap the converter runs directly with its own safe flags (pandoc --sandbox).
// - Always: input on stdin, a minimal environment, cwd = the empty work folder, a time limit and an output cap.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { which } from '../config'
import { PRODUCT } from '../product'

export type IsolationKind = 'sandbox-exec' | 'bwrap' | 'none'

let detected: IsolationKind | null = null
/** Which isolation this machine offers. */
export function isolation(): IsolationKind {
  if (detected) return detected
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) detected = 'sandbox-exec'
  else if (process.platform === 'linux' && which('bwrap')) detected = 'bwrap'
  else detected = 'none'
  return detected
}

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
const sq = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'

/** The macOS sandbox profile for one run (exported for tests). */
export function sandboxProfile(o: { cmd: string; workDir: string; denyRead: string[] }): string {
  const deny = [...new Set(['/Users', '/Volumes', '/private/tmp', '/private/var/folders', '/private/var/root', '/Library/Keychains',
    os.homedir(), ...o.denyRead].map(real))]
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny process-fork)',
    '(deny process-exec)',
    `(allow process-exec (literal ${sq(real(o.cmd))}))`,
    '(deny signal (target others))',
    '(deny process-info* (target others))',
    '(deny file-write*)',
    `(allow file-write* (subpath ${sq(real(o.workDir))}) (literal "/dev/null"))`,
    `(deny file-read-data ${deny.map((d) => `(subpath ${sq(d)})`).join(' ')})`,
    `(allow file-read-data (subpath ${sq(real(o.workDir))}))`,
    // the listing of the converter's own folder: some runtimes look next to the executable
    `(allow file-read-data (literal ${sq(path.dirname(real(o.cmd)))}))`,
  ].join('\n')
}

function bwrapArgs(o: { cmd: string; workDir: string }): string[] {
  const a = ['--die-with-parent', '--unshare-all', '--new-session', '--clearenv']
  for (const d of ['/usr', '/bin', '/lib', '/lib64', '/lib32', '/etc/alternatives', '/etc/fonts', '/usr/share'])
    if (fs.existsSync(d)) a.push('--ro-bind', d, d)
  a.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', o.workDir, o.workDir)
  const dir = path.dirname(o.cmd)
  if (!['/usr', '/bin'].some((d) => dir === d || dir.startsWith(d + '/'))) a.push('--ro-bind', dir, dir)
  a.push('--chdir', o.workDir)
  return a
}

export interface RunResult { code: number | null; stdout: Buffer; stderr: string; killed: null | 'timeout' | 'output' }

/**
 * Run a converter isolated with `input` on stdin. SIGKILL after the timeout or once stdout passes the cap.
 * `denyRead`: server folders whose contents must stay unreadable (the team folder, the data folder).
 */
export async function runConverter(cmd: string, args: string[], input: Uint8Array,
  o: { timeoutMs?: number; maxStdout?: number; denyRead?: string[] } = {}): Promise<RunResult> {
  const workDir = real(fs.mkdtempSync(path.join(os.tmpdir(), `${PRODUCT.id}-convert-`)))
  const bin = real(cmd)
  const env: Record<string, string> = { PATH: '/usr/bin:/bin', HOME: workDir, TMPDIR: workDir, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
  const kind = isolation()
  const argv = kind === 'sandbox-exec' ? ['/usr/bin/sandbox-exec', '-p', sandboxProfile({ cmd: bin, workDir, denyRead: o.denyRead ?? [] }), bin, ...args]
    : kind === 'bwrap' ? [which('bwrap')!, ...bwrapArgs({ cmd: bin, workDir }), ...Object.entries(env).flatMap(([k, v]) => ['--setenv', k, v]), bin, ...args]
      : [bin, ...args]
  const maxStdout = o.maxStdout ?? 32 * 1024 * 1024
  let killed: RunResult['killed'] = null
  try {
    const p = Bun.spawn(argv, { cwd: workDir, env, stdin: input, stdout: 'pipe', stderr: 'pipe' })
    const kill = (why: NonNullable<RunResult['killed']>) => { if (!killed) { killed = why; try { p.kill('SIGKILL') } catch {} } }
    const timer = setTimeout(() => kill('timeout'), o.timeoutMs ?? 30_000)
    const errP = new Response(p.stderr).text().catch(() => '')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for await (const chunk of p.stdout) {
        size += chunk.length
        if (size > maxStdout) { kill('output'); break }
        chunks.push(chunk)
      }
    } catch { /* closed by the kill */ }
    const code = await p.exited
    clearTimeout(timer)
    return { code: killed ? null : code, stdout: Buffer.concat(chunks), stderr: (await errP).slice(0, 4000), killed }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}
