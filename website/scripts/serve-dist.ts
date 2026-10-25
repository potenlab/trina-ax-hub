// Serves dist/ the way Cloudflare Workers Assets will: html_handling "auto-trailing-slash", not_found_handling
// "404-page", and the response headers from public/_headers (so the CSP is really enforced when you look at the site).
//   bun run build && bun run preview            # http://localhost:4322
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'

const dist = join(import.meta.dir, '..', 'dist')

type Rule = { pattern: string; headers: Record<string, string> }

/** Parses the _headers file format: a path pattern line, then indented "Name: value" lines. */
export function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = []
  let cur: Rule | null = null
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    if (/^\s/.test(raw)) {
      const i = raw.indexOf(':')
      if (cur && i > 0) cur.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim()
    } else {
      cur = { pattern: raw.trim(), headers: {} }
      rules.push(cur)
    }
  }
  return rules
}

const matches = (pattern: string, path: string) =>
  pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path

const isFile = (p: string) => existsSync(p) && statSync(p).isFile()

/** Maps a request path to a file (or a redirect), like Workers Assets does. */
export function resolveAsset(pathname: string): { file?: string; redirect?: string } {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const base = join(dist, safe)
  if (safe.endsWith('/')) {
    if (isFile(join(base, 'index.html'))) return { file: join(base, 'index.html') }
    if (safe !== '/' && isFile(join(dist, safe.slice(0, -1) + '.html'))) return { redirect: safe.slice(0, -1) }
    return {}
  }
  if (isFile(base)) return { file: base }
  if (isFile(base + '.html')) return { file: base + '.html' }
  if (isFile(join(base, 'index.html'))) return { redirect: safe + '/' }
  return {}
}

export function serveDist(port: number) {
  const rules = parseHeaders(readFileSync(join(dist, '_headers'), 'utf8'))
  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url)
      const r = resolveAsset(url.pathname)
      const headers = new Headers()
      for (const rule of rules) if (matches(rule.pattern, url.pathname)) for (const [k, v] of Object.entries(rule.headers)) headers.set(k, v)
      if (r.redirect) {
        headers.set('Location', r.redirect + url.search)
        return new Response(null, { status: 308, headers })
      }
      const file = r.file ?? join(dist, '404.html')
      const body = Bun.file(file)
      if (!r.file) headers.set('Content-Type', 'text/html; charset=utf-8')
      else if (!headers.has('Content-Type')) headers.set('Content-Type', body.type)
      return new Response(body, { status: r.file ? 200 : 404, headers })
    },
  })
}

if (import.meta.main) {
  const server = serveDist(Number(process.env.PORT ?? 4322))
  console.log(`dist/ on http://localhost:${server.port}`)
}
