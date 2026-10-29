// The English blog at /blog. Each post's text is src/blog/<slug>.en.md, copied unchanged from the blog-ops draft once it
// is fact-checked (from its H1 to the trademark notice; no front matter, no fact-check notes). This file holds what the
// pages add around the text: the dates, the description, the sources it cites as [1], [2]... and the guides that link
// back to it. Each post has a 1200x630 card at public/blog/<slug>.png (bun run og).
// English only for now: no Korean twin, so hreflang is the page itself plus x-default.
import en from './en'
import { guidePath } from './guides'
import { EN_GUIDES } from './guides-en'
import { LINKS, ROUTES, abs } from '../site'

export const BLOG = {
  path: '/blog',
  name: 'Blog',
  title: 'Trina AX Blog: using Claude across a whole team',
  h1: 'Using Claude across a whole team',
  description: 'Articles from Trina Inc., the makers of Trina AX, on using Claude across a whole team.',
  /** The heading of the block on an English guide that lists the posts about it. */
  fromBlog: 'From the blog',
} as const

/** One document a source points at. Its URL is shown as written, without https://. */
export type SourceDoc = { title: string; url: string }
export type Post = {
  slug: string
  /** The text's own H1. */
  title: string
  description: string
  /** The day it first went live, in Korea (KST). */
  published: string
  /** The day the text last changed on the site (KST, the day that change is deployed). The sitemap uses it; the page
   * shows "Updated" when it differs from published. */
  modified: string
  /** The day the sources were read before publishing. */
  read: string
  /** [1] is the first entry. A source may name more than one document. */
  sources: SourceDoc[][]
  /** English guide slugs whose pages link to this post under "From the blog". */
  relatedGuides: string[]
}

export const blogPath = (slug: string) => `${BLOG.path}/${slug}`
/** The post's social card (1200x630 PNG). */
export const blogCard = (slug: string) => `${BLOG.path}/${slug}.png`

const guide = (slug: string): SourceDoc => ({ title: EN_GUIDES.find(g => g.slug === slug)!.title, url: abs(guidePath(slug, 'en')) })
const code = (file: string): SourceDoc => ({ title: `trina-app/trina-ax: ${file}`, url: `${LINKS.github}/blob/main/${file}` })

export const POSTS: Post[] = [
  {
    slug: 'share-claude-skills-with-your-team',
    title: 'How to share Claude skills with your whole team',
    description: 'Three ways to share a Claude skill with your whole team (a repository, Claude Team or Enterprise, or a server run for your company) and when each one fits.',
    published: '2026-10-29',
    modified: '2026-10-30',
    read: '2026-10-29',
    relatedGuides: ['use-skills', 'review-skills'],
    sources: [
      [{ title: 'Extend Claude with skills', url: 'https://code.claude.com/docs/en/skills' }],
      [{ title: 'Use skills in Claude', url: 'https://support.claude.com/en/articles/12512180-use-skills-in-claude' }],
      [code('server/src/chat/skills.ts'), code('server/src/chat/prompt.ts'), code('tests/unit/skill-directories.test.ts')],
      [guide('review-skills')],
      [guide('use-skills')],
      [{ title: 'Trina AX for LLMs (llms.txt)', url: abs('/llms.txt') }, { title: en.meta.title, url: abs(ROUTES.home.en) }],
      [{ title: en.meta.title, url: abs(ROUTES.home.en) }],
      [{ title: en.secPage.title, url: abs(ROUTES.security.en) }],
      [{ title: 'trina-app/trina-ax', url: LINKS.github }, { title: 'Trina AX hosting plans', url: abs(`${ROUTES.home.en}#pricing`) }],
    ],
  },
]

/** "2026-10-29" -> "October 29, 2026", the same on every machine. */
export const longDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** Each [n] in the rendered text becomes a link to source n. A number without a source stops the build. */
export function linkSources(html: string, post: Post): string {
  return html.replace(/\[(\d+)\]/g, (_, n: string) => {
    if (!post.sources[Number(n) - 1]) throw new Error(`${post.slug}: [${n}] has no source`)
    return `<a class="cite" href="#source-${n}">[${n}]</a>`
  })
}
