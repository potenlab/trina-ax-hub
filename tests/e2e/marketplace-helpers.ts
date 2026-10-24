// Helpers for the real-Claude-Code e2e tests: a Cloudflare quick tunnel to the test hub, an egress guard, and a
// sandboxed environment for `claude` runs (temp HOME / CLAUDE_CONFIG_DIR, model relay pointed at the test hub).
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export const CLAUDE_BIN = path.join(os.homedir(), '.local/bin/claude')

export function findCloudflared(): string | null {
  for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', ...(process.env.PATH ?? '').split(':')]) {
    const p = path.join(d, 'cloudflared')
    try { fs.accessSync(p, fs.constants.X_OK); return p } catch {}
  }
  return null
}

export interface Tunnel { url: string; stop(): void }

/** `cloudflared tunnel --url` to a local port. Resolves once the https URL answers /healthz, or null (with a reason
 *  written to `why`) when it does not within `timeoutMs`. */
export async function quickTunnel(bin: string, port: number, timeoutMs: number, why: string[]): Promise<Tunnel | null> {
  const proc = Bun.spawn([bin, 'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdout: 'ignore', stderr: 'pipe' })
  const stop = () => { try { proc.kill() } catch {} }
  const deadline = Date.now() + timeoutMs
  const reader = proc.stderr.getReader()
  const dec = new TextDecoder()
  let log = ''
  let url: string | null = null
  const found = (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      log += dec.decode(value)
      if (log.length > 64_000) log = log.slice(-32_000)
      url ??= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log)?.[0] ?? null
    }
  })() // keeps draining stderr for the tunnel's lifetime (cloudflared dies on a closed pipe)
  void found
  while (!url && Date.now() < deadline) await Bun.sleep(200)
  if (!url) { stop(); why.push('cloudflared did not print a trycloudflare.com URL'); return null }
  // Wait until the name is published before anything asks the system resolver: a lookup made too early gets its
  // NXDOMAIN cached for minutes, and Claude Code / curl only use the system resolver. Cloudflare's authoritative
  // servers do not cache, so ask them (dig); public resolvers would cache an early miss just the same.
  const host = new URL(url).hostname
  let published = false
  while (!published && Date.now() < deadline) {
    published = await publishedAt(host)
    if (!published) await Bun.sleep(1000)
  }
  if (!published) { stop(); why.push(`${host} never appeared in DNS`); return null }
  await Bun.sleep(1000)
  while (Date.now() < deadline) {
    const ok = await fetch(url + '/healthz', { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false)
    if (ok) return { url, stop }
    await Bun.sleep(1000)
  }
  stop()
  why.push(`${url}/healthz did not answer through the tunnel`)
  return null
}

const AUTHORITATIVE = ['kevin.ns.cloudflare.com', 'marjory.ns.cloudflare.com'] // trycloudflare.com's name servers
let digBin: string | null | undefined
let dohFallbackAfter = 0

async function publishedAt(host: string): Promise<boolean> {
  if (digBin === undefined) digBin = ['/usr/bin/dig', '/opt/homebrew/bin/dig', '/usr/local/bin/dig'].find((p) => fs.existsSync(p)) ?? null
  if (digBin) {
    for (const ns of AUTHORITATIVE) {
      const p = Bun.spawn([digBin, '+short', '+time=2', '+tries=1', host, 'A', `@${ns}`], { stdout: 'pipe', stderr: 'ignore' })
      const out = await new Response(p.stdout).text()
      await p.exited
      if (/^\d+\.\d+\.\d+\.\d+$/m.test(out)) return true
    }
    return false
  }
  // no dig: give the tunnel time to publish before the first (cached) public lookup
  dohFallbackAfter ||= Date.now() + 10_000
  if (Date.now() < dohFallbackAfter) return false
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, { headers: { accept: 'application/dns-json' } })
    .then((r) => r.json()).catch(() => null) as { Answer?: unknown[] } | null
  return !!r?.Answer?.length
}

export interface EgressGuard { url: string; seen: string[]; blocked: string[]; stop(): void }

/** An HTTP CONNECT proxy that only lets `allow(host)` through. Every `claude` run uses it (HTTPS_PROXY), so Claude
 *  Code cannot reach api.anthropic.com or any other outside host during the tests; local addresses bypass it. */
export async function egressGuard(allow: (host: string) => boolean): Promise<EgressGuard> {
  const seen: string[] = []
  const blocked: string[] = []
  const socks = new Set<net.Socket>()
  const server = net.createServer((client) => {
    socks.add(client)
    client.on('close', () => socks.delete(client))
    client.on('error', () => client.destroy())
    let buf = Buffer.alloc(0)
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      const end = buf.indexOf('\r\n\r\n')
      if (end < 0) { if (buf.length > 16_384) client.destroy(); return }
      client.off('data', onData)
      const first = buf.subarray(0, end).toString('latin1').split('\r\n')[0]!
      const m = /^CONNECT \[?([^\]\s]+?)\]?:(\d+) HTTP\/1\.[01]$/i.exec(first)
      const target = m ? `${m[1]}:${m[2]}` : first.slice(0, 200)
      seen.push(target)
      if (!m || !allow(m[1]!)) {
        blocked.push(target)
        client.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n')
        return
      }
      const upstream = net.connect(Number(m[2]), m[1]!, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        const rest = buf.subarray(end + 4)
        if (rest.length) upstream.write(rest)
        client.pipe(upstream)
        upstream.pipe(client)
      })
      socks.add(upstream)
      upstream.on('close', () => { socks.delete(upstream); client.destroy() })
      upstream.on('error', () => client.destroy())
    }
    client.on('data', onData)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`, seen, blocked,
    stop() { for (const s of socks) s.destroy(); server.close() },
  }
}

/** Environment for a sandboxed `claude` run: nothing from this Mac's own login, settings or shell. */
export function sandboxEnv(o: { home: string; configDir: string; baseUrl: string; proxy: string; extraPath?: string[] }): Record<string, string> {
  return {
    HOME: o.home,
    CLAUDE_CONFIG_DIR: o.configDir,
    PATH: [...(o.extraPath ?? []), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    LANG: 'en_US.UTF-8',
    TERM: 'dumb',
    // model calls (there should be none) go to the test hub, never to Anthropic
    ANTHROPIC_BASE_URL: o.baseUrl,
    HTTPS_PROXY: o.proxy, https_proxy: o.proxy, HTTP_PROXY: o.proxy, http_proxy: o.proxy,
    NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
  }
}

export interface RunResult { code: number; stdout: string; stderr: string }

export async function run(cmd: string[], env: Record<string, string>, cwd: string, timeoutMs = 120_000): Promise<RunResult> {
  const p = Bun.spawn(cmd, { env, cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => p.kill(), timeoutMs)
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(timer)
  return { code, stdout, stderr }
}

/** Every file under `dir` (relative paths). */
export function walk(dir: string): string[] {
  const out: string[] = []
  const go = (d: string, rel: string) => {
    let es: fs.Dirent[] = []
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) go(path.join(d, e.name), r)
      else out.push(r)
    }
  }
  go(dir, '')
  return out
}
