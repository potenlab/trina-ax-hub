import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import en from '../src/content/en'
import { BLOG, POSTS, blogCard, blogPath, longDate } from '../src/content/blog-en'
import { EN_GUIDES } from '../src/content/guides-en'
import { GUIDES, guidePath } from '../src/content/guides'
import { organization } from '../src/seo'
import { LINKS, SITE_URL } from '../src/site'
import { PAGE_FILES, attrs, built, decode, dist, jsonLd, root, visibleText } from './helpers'

const TRADEMARK = 'Claude is a trademark of Anthropic. Trina AX is made by Trina Inc. and is not affiliated with Anthropic.'
const posts = POSTS.map(p => ({ p, path: blogPath(p.slug), url: SITE_URL + blogPath(p.slug), html: built(PAGE_FILES[blogPath(p.slug)]) }))
const markdown = (slug: string) => readFileSync(join(root, 'src/blog', `${slug}.en.md`), 'utf8')
/** The rendered post text: from its H1 to the trademark notice, without the date line or the Sources list. */
const text = (html: string) => html.slice(html.indexOf('<div class="blog-text">'), html.indexOf('<section class="blog-sources"'))
const sourceList = (html: string) => html.slice(html.indexOf('<section class="blog-sources"'), html.indexOf('</section>', html.indexOf('<section class="blog-sources"')))
/** Words in order: typographic quotes, line breaks and Markdown marks do not count. */
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? []
/** The date line under a post's breadcrumb: published, "Updated" only when the text changed later, and the author. */
const dateLine = (published: string, modified: string, author: string) =>
  `${BLOG.name} · ${longDate(published)}${modified !== published ? ` · Updated ${longDate(modified)}` : ''} · ${author}`
const ours = (u: string) => u === LINKS.github || u.startsWith(LINKS.github + '/') || u === 'https://trina.app' || u.startsWith('https://trina.app/') || u.startsWith(SITE_URL + '/')

test('the blog and every post are English pages that point at themselves: canonical, hreflang en and x-default, no Korean twin', () => {
  for (const path of [BLOG.path, ...posts.map(x => x.path)]) {
    const html = built(PAGE_FILES[path]), self = SITE_URL + path
    expect(html).toContain('<html lang="en"')
    expect(html).toContain(`<link rel="canonical" href="${self}">`)
    expect(html).toContain(`<link rel="alternate" hreflang="en" href="${self}">`)
    expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${self}">`)
    expect(html).not.toContain('<link rel="alternate" hreflang="ko"')
    expect(html).not.toContain('og:locale:alternate')
    expect(html).toContain(`<meta property="og:url" content="${self}">`)
    expect(html).toContain('<meta name="robots" content="index, follow')
  }
  expect(built(PAGE_FILES[BLOG.path])).toContain(`<meta property="og:image" content="${SITE_URL}${en.meta.ogImage}">`)
  expect(built(PAGE_FILES[BLOG.path])).toContain('<meta property="og:type" content="website">')
  for (const { html } of posts) expect(html).toContain('<meta property="og:type" content="article">')
})

test('blog titles fit search results and descriptions are real sentences', () => {
  const pages: [string, string, string][] = [[BLOG.path, BLOG.title, BLOG.description], ...posts.map(({ p, path }): [string, string, string] => [path, `${p.title} | ${en.brand}`, p.description])]
  for (const [path, title, description] of pages) {
    expect(title.length).toBeLessThanOrEqual(60)
    expect(description.length).toBeGreaterThan(50)
    expect(description.length).toBeLessThanOrEqual(210)
    const html = decode(built(PAGE_FILES[path]))
    expect(html).toContain(`<title>${title}</title>`)
    expect(html).toContain(`<meta property="og:title" content="${title}">`)
    expect(html).toContain(`<meta name="description" content="${description}">`)
  }
  // Post descriptions fit a search result without being cut.
  for (const { p } of posts) expect(p.description.length).toBeLessThanOrEqual(160)
  // /blog: a small "Blog" label, then the heading that says what the blog is about.
  const index = built(PAGE_FILES[BLOG.path])
  expect(index.match(/<h1\b[\s\S]*?<\/h1>/g)!.map(h => visibleText(h))).toEqual([BLOG.h1])
  expect(visibleText(index)).toContain(`${BLOG.name} ${BLOG.h1}`)
})

test('every post is listed on /blog, in the sitemap and llms.txt, and every English footer links the blog', () => {
  const index = built(PAGE_FILES[BLOG.path]), sitemap = built('sitemap.xml'), llms = built('llms.txt')
  expect(sitemap).toContain(`<loc>${SITE_URL}${BLOG.path}</loc>`)
  expect(llms).toContain(`- [${BLOG.name}](${SITE_URL}${BLOG.path}): ${BLOG.description}`)
  for (const { p, path, url } of posts) {
    expect(attrs(index, 'href')).toContain(path)
    expect(visibleText(index)).toContain(`${longDate(p.published)} ${p.title} ${p.description}`)
    expect(sitemap).toContain(`<loc>${url}</loc>\n    <lastmod>${p.modified}</lastmod>\n    <xhtml:link rel="alternate" hreflang="en" href="${url}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${url}"/>\n  </url>`)
    expect(llms).toContain(`- [${p.title}](${url}): ${p.description}`)
  }
  for (const [path, file] of Object.entries(PAGE_FILES).filter(([path]) => !path.startsWith('/ko'))) {
    const html = built(file)
    expect(attrs(html.slice(html.indexOf('<footer')), 'href'), `${path} footer`).toContain(BLOG.path)
  }
})

test('each post is the fact-checked text as written: its words in order, one H1, the trademark notice last', () => {
  expect(readdirSync(join(root, 'src/blog')).sort()).toEqual(POSTS.map(p => `${p.slug}.en.md`).sort())
  for (const { p, html } of posts) {
    const md = markdown(p.slug)
    // Only the published part of the draft: no front matter, no fact-check log, no draft source notes.
    expect(md.startsWith(`# ${p.title}\n`)).toBe(true)
    expect(md.replace(/\s+/g, ' ').trim().endsWith(`*${TRADEMARK}*`)).toBe(true)
    expect(md).not.toMatch(/^---$|^status:|^recheck_before_publishing|Fact-check log|^## Sources/m)
    // The renderer changes no words (it only curls apostrophes). Link addresses and list numbers are not text on the page.
    const shown = visibleText(text(html))
    expect(words(shown)).toEqual(words(md.replace(/\]\([^)]*\)/g, ']').replace(/^\d+\. /gm, '')))
    expect([...html.matchAll(/<h1\b[\s\S]*?<\/h1>/g)].map(m => visibleText(m[0]))).toEqual([p.title])
    expect(shown.endsWith(TRADEMARK)).toBe(true)
    expect(p.published).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(longDate(p.published)).not.toBe('Invalid Date')
  }
})

test('every [n] in a post links to its source, every source is cited, and the list gives title, public URL and read date', () => {
  for (const { p, html } of posts) {
    const body = text(html)
    const links = [...body.matchAll(/<a class="cite" href="#source-(\d+)">\[(\d+)\]<\/a>/g)]
    for (const m of links) expect(m[1]).toBe(m[2])
    expect(visibleText(body.replace(/<a class="cite" href="#source-\d+">\[\d+\]<\/a>/g, ''))).not.toMatch(/\[\d+\]/)
    expect([...new Set(links.map(m => Number(m[1])))].sort((a, b) => a - b)).toEqual(p.sources.map((_, i) => i + 1))
    p.sources.forEach((docs, i) => {
      const li = html.match(new RegExp(`<li id="source-${i + 1}">([\\s\\S]*?)</li>`))?.[1] ?? ''
      const want = `[${i + 1}] ${docs.map(d => `${d.title} · ${d.url.replace(/^https:\/\//, '')}`).join('; ')} · read ${p.read}`
      expect(visibleText(li).replace(/ ;/g, ';')).toBe(want)
      expect(attrs(li, 'href')).toEqual(docs.map(d => d.url))
    })
  }
})

test('a post links outside our own sites only to the sources it cites, from its Sources list', () => {
  for (const { p, html } of posts) {
    const cited = new Set(p.sources.flat().map(d => d.url))
    for (const u of [...attrs(html, 'href'), ...attrs(html, 'src')]) {
      if (/^https?:\/\//.test(u) && !ours(u)) expect(cited.has(u), `${u} is not one of the post's sources`).toBe(true)
    }
    expect(attrs(html.replace(sourceList(html), ''), 'href').filter(u => /^https?:\/\//.test(u) && !ours(u))).toEqual([])
  }
})

test('links in a post go to pages that exist, including a guide and the pricing section', () => {
  for (const { html } of posts) {
    const body = attrs(text(html), 'href')
    expect(body.some(h => h.startsWith(`${SITE_URL}/guide/`))).toBe(true)
    expect(body).toContain(`${SITE_URL}/#pricing`)
    // Absolute links to this site; relative links and fragments are checked for every page in guides.test.ts.
    for (const href of attrs(html, 'href').filter(h => h.startsWith(SITE_URL + '/'))) {
      const url = new URL(href), target = PAGE_FILES[url.pathname]
      expect(target ? existsSync(join(dist, target)) : existsSync(join(dist, url.pathname)), href).toBe(true)
      if (url.hash) expect(attrs(built(target!), 'id'), href).toContain(url.hash.slice(1))
    }
  }
})

test('JSON-LD: a BlogPosting that matches the visible post, by the site’s Organization, with no offers', () => {
  for (const { p, html, url } of posts) {
    const graph = jsonLd(html)['@graph']
    expect(graph.map((n: any) => n['@type'])).toEqual(['Organization', 'BlogPosting', 'BreadcrumbList'])
    const [org, post, crumbs] = graph
    expect(org).toEqual(organization())
    expect(post.headline).toBe(visibleText(html.match(/<h1\b[\s\S]*?<\/h1>/)![0]))
    expect(post.description).toBe(p.description)
    const times = [...html.matchAll(/<time datetime="([^"]+)">/g)].map(m => m[1])
    expect(post.datePublished).toBe(p.published)
    expect(post.dateModified).toBe(p.modified)
    expect(times).toEqual(p.modified === p.published ? [p.published] : [p.published, p.modified])
    expect(visibleText(html)).toContain(dateLine(post.datePublished, post.dateModified, org.name))
    expect(post.image).toBe(SITE_URL + blogCard(p.slug))
    expect([post.inLanguage, post.url, post.mainEntityOfPage]).toEqual(['en', url, url])
    expect(post.author).toEqual({ '@id': org['@id'] })
    expect(post.publisher).toEqual({ '@id': org['@id'] })
    expect(crumbs.itemListElement.map((i: any) => i.item)).toEqual([`${SITE_URL}/`, SITE_URL + BLOG.path, url])
    expect(JSON.stringify(graph)).not.toMatch(/"offers?"|"price|priceCurrency|UnitPriceSpecification/i)
    // The questions in the text stay visible headings only: no FAQPage (the home page keeps the site's FAQ schema).
    expect(html).not.toContain('FAQPage')
  }
})

test('article dates: published and modified times on posts only, and "Updated" only when the text changed later', () => {
  for (const { p, html } of posts) {
    expect(p.modified >= p.published).toBe(true)
    expect(p.modified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(html).toContain(`<meta property="article:published_time" content="${p.published}">`)
    expect(html).toContain(`<meta property="article:modified_time" content="${p.modified}">`)
    expect(visibleText(html).includes('Updated ')).toBe(p.modified !== p.published)
  }
  for (const [path, file] of Object.entries(PAGE_FILES).filter(([path]) => !posts.some(x => x.path === path))) {
    expect(built(file), path).not.toContain('property="article:')
  }
})

test('each post has its own 1200x630 card, and the page’s social tags point at it', () => {
  for (const { p, html } of posts) {
    const png = readFileSync(join(root, 'public', blogCard(p.slug)))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
    expect(existsSync(join(dist, blogCard(p.slug)))).toBe(true)
    const card = SITE_URL + blogCard(p.slug)
    expect(html).toContain(`<meta property="og:image" content="${card}">`)
    expect(html).toContain(`<meta name="twitter:image" content="${card}">`)
    expect(decode(html)).toContain(`<meta property="og:image:alt" content="${p.title}">`)
    expect(decode(html)).toContain(`<meta name="twitter:image:alt" content="${p.title}">`)
    expect(html.match(/<meta property="og:image" /g)).toHaveLength(1)
  }
})

test('the English guides a post names link to it under "From the blog"; other guides and Korean guides do not', () => {
  for (const { p } of posts) {
    expect(p.relatedGuides.length).toBeGreaterThan(0)
    for (const slug of p.relatedGuides) expect(EN_GUIDES.map(g => g.slug)).toContain(slug)
  }
  for (const g of EN_GUIDES) {
    const html = built(PAGE_FILES[guidePath(g.slug, 'en')])
    const related = posts.filter(({ p }) => p.relatedGuides.includes(g.slug))
    const block = html.match(/<aside class="article-next article-blog"[\s\S]*?<\/aside>/)?.[0]
    if (!related.length) { expect(block, g.slug).toBeUndefined(); continue }
    expect(visibleText(block!)).toBe(`${BLOG.fromBlog} ${related.map(({ p }) => `${p.title} → ${p.description}`).join(' ')}`)
    expect(attrs(block!, 'href')).toEqual(related.map(x => x.path))
  }
  for (const g of GUIDES) expect(built(PAGE_FILES[guidePath(g.slug)])).not.toContain('article-blog')
  expect(built('index.html')).not.toContain('article-blog')
})
