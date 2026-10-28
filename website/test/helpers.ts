import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const root = join(import.meta.dir, '..')
export const dist = join(root, 'dist')

/** Built pages, by the address they are served at. `bun run test` builds first. */
export const PAGE_FILES: Record<string, string> = {
  '/': 'index.html',
  '/ko/': 'ko/index.html',
  '/security': 'security.html',
  '/ko/security': 'ko/security.html',
  '/404': '404.html',
  '/terms': 'terms.html',
  '/privacy': 'privacy.html',
  '/refund': 'refund.html',
}

/** The English-only legal pages. */
export const LEGAL_FILES = ['terms.html', 'privacy.html', 'refund.html']

export function built(file: string): string {
  const p = join(dist, file)
  if (!existsSync(p)) throw new Error(`dist/${file} is missing: run \`bun run build\` first (\`bun run test\` does it for you)`)
  return readFileSync(p, 'utf8')
}

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' }
export const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => entities[m] ?? m)

/** The text a visitor can see: no scripts, styles, tags or attributes. Zero-width spaces (soft path breaks) are removed. */
export function visibleText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/​/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function jsonLd(html: string): any {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error('no JSON-LD')
  return JSON.parse(m[1])
}

/** Every attribute value of a name (href, src...) in the markup. */
export const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => decode(m[1]))
