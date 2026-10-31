import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDES, guidePath } from '../src/content/guides'
import { BLOG, POSTS, blogPath } from '../src/content/blog-en'

export const root = join(import.meta.dir, '..')
export const dist = join(root, 'dist')

/** Built pages, by the address they are served at. `bun run test` builds first. */
export const PAGE_FILES: Record<string, string> = {
  '/': 'index.html',
  '/en': 'en.html',
  '/en/guide': 'en/guide.html',
  '/en/guide/first-week': 'en/guide/first-week.html',
  '/brochure': 'brochure.html',
  '/ko/': 'ko/index.html',
  '/ko/brochure': 'ko/brochure.html',
  '/security': 'security.html',
  '/ko/security': 'ko/security.html',
  '/guide': 'guide.html',
  '/ko/guide': 'ko/guide.html',
  '/guide/first-week': 'guide/first-week.html',
  '/ko/guide/first-week': 'ko/guide/first-week.html',
  '/404': '404.html',
  '/terms': 'terms.html',
  '/privacy': 'privacy.html',
  '/refund': 'refund.html',
  ...Object.fromEntries(GUIDES.flatMap(g => [
    [guidePath(g.slug), `ko/guide/${g.slug}.html`],
    [guidePath(g.slug, 'en'), `guide/${g.slug}.html`],
    [`/en/guide/${g.slug}`, `en/guide/${g.slug}.html`],
  ])),
  [BLOG.path]: 'blog.html',
  ...Object.fromEntries(POSTS.map(p => [blogPath(p.slug), `blog/${p.slug}.html`])),
}

/** The English-only legal pages. */
export const LEGAL_FILES = ['terms.html', 'privacy.html', 'refund.html']

/** Blog posts. Besides our own addresses they link the outside sources they cite (test/blog.test.ts checks those). */
export const BLOG_POST_FILES = POSTS.map(p => `blog/${p.slug}.html`)

/** A dollar amount ending in a digit, so a full stop or comma after it is not part of it ("$260." is "$260"). */
export const MONEY = /\$\s?\d+(?:[.,]\d+)*/g

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
