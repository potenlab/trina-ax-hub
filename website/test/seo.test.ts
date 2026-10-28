import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from '../src/content/en'
import ko from '../src/content/ko'
import { PAGES, SINGLE_PAGES, faqPage, homeJsonLd, llmsTxt, oneLine, sitemapXml } from '../src/seo'
import { ROUTES } from '../src/site'
import { PAGE_FILES, attrs, built, decode, jsonLd, root } from './helpers'

describe('titles and descriptions', () => {
  const pages: [string, string, string][] = [
    ['en home', en.meta.title, en.meta.description],
    ['ko home', ko.meta.title, ko.meta.description],
    ['en security', en.secPage.title, en.secPage.description],
    ['ko security', ko.secPage.title, ko.secPage.description],
    ['en guide', en.guide.title, en.guide.description],
    ['ko guide', ko.guide.title, ko.guide.description],
    ['en first week', en.firstWeek.title, en.firstWeek.description],
    ['ko first week', ko.firstWeek.title, ko.firstWeek.description],
  ]
  test.each(pages)('%s: title <= 60 characters, description is a real sentence that is not absurdly long', (_, title, description) => {
    expect(title.length).toBeLessThanOrEqual(60)
    // The launch copy deck's English description is 201 characters; search results cut it, the page keeps it.
    expect(description.length).toBeGreaterThan(50)
    expect(description.length).toBeLessThanOrEqual(210)
  })
  test('titles are unique across the pages', () => {
    const titles = pages.map(([, t]) => t)
    expect(new Set(titles).size).toBe(pages.length)
  })
  test('the built pages carry them', () => {
    expect(decode(built('index.html'))).toContain(`<title>${en.meta.title}</title>`)
    expect(decode(built('ko/index.html'))).toContain(`<title>${ko.meta.title}</title>`)
  })
})

describe('languages: canonical and hreflang', () => {
  const pairs: [string, string, string][] = [
    ['/', 'https://ax.trina.app/', 'https://ax.trina.app/ko/'],
    ['/security', 'https://ax.trina.app/security', 'https://ax.trina.app/ko/security'],
    ['/guide', 'https://ax.trina.app/guide', 'https://ax.trina.app/ko/guide'],
    ['/guide/first-week', 'https://ax.trina.app/guide/first-week', 'https://ax.trina.app/ko/guide/first-week'],
  ]
  test.each(pairs)('%s and its Korean twin point at each other, x-default is English, canonical is itself', (path, enUrl, koUrl) => {
    for (const [file, self] of [[PAGE_FILES[path], enUrl], [PAGE_FILES[koUrl.replace('https://ax.trina.app', '')], koUrl]] as const) {
      const html = built(file)
      expect(html).toContain(`<link rel="canonical" href="${self}">`)
      expect(html).toContain(`<link rel="alternate" hreflang="en" href="${enUrl}">`)
      expect(html).toContain(`<link rel="alternate" hreflang="ko" href="${koUrl}">`)
      expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${enUrl}">`)
    }
  })
  test('html lang matches the page', () => {
    expect(built('index.html')).toMatch(/<html lang="en"/)
    expect(built('ko/index.html')).toMatch(/<html lang="ko"/)
    expect(built('security.html')).toMatch(/<html lang="en"/)
    expect(built('ko/security.html')).toMatch(/<html lang="ko"/)
  })
  test('the language switch links to the twin page', () => {
    expect(built('index.html')).toMatch(/class="lang-link" href="\/ko\/"/)
    expect(built('ko/index.html')).toMatch(/class="lang-link" href="\/"/)
    expect(built('security.html')).toMatch(/class="lang-link" href="\/ko\/security"/)
    expect(built('ko/security.html')).toMatch(/class="lang-link" href="\/security"/)
    expect(built('guide.html')).toMatch(/class="lang-link" href="\/ko\/guide"/)
    expect(built('ko/guide/first-week.html')).toMatch(/class="lang-link" href="\/guide\/first-week"/)
  })
  test('404 is noindex and has no alternates', () => {
    const html = built('404.html')
    expect(html).toContain('content="noindex, follow"')
    expect(html).not.toContain('hreflang="x-default"')
    expect(html).not.toContain('rel="canonical"')
  })
})

describe('structured data', () => {
  for (const [name, t, file] of [['en', en, 'index.html'], ['ko', ko, 'ko/index.html']] as const) {
    test(`${name}: FAQPage is exactly the visible FAQ`, () => {
      const html = built(file)
      const visible = [...html.matchAll(/<details>\s*<summary>([\s\S]*?)<svg[\s\S]*?<\/summary>\s*<p class="answer">([\s\S]*?)<\/p>\s*<\/details>/g)].map((m) => [decode(m[1]), decode(m[2])])
      expect(visible.length).toBe(t.faq.items.length)
      const faq = jsonLd(html)['@graph'].find((n: any) => n['@type'] === 'FAQPage')
      expect(faq.mainEntity.length).toBe(visible.length)
      faq.mainEntity.forEach((q: any, i: number) => {
        expect(q.name).toBe(visible[i][0])
        expect(q.acceptedAnswer.text).toBe(visible[i][1])
      })
      expect(faqPage(t).mainEntity.map((q) => q.name)).toEqual(t.faq.items.map((i) => i.q))
    })

    test(`${name}: graph has Organization, WebSite, SoftwareApplication, SoftwareSourceCode, FAQPage and no offers or prices`, () => {
      const g = jsonLd(built(file))
      expect(g['@context']).toBe('https://schema.org')
      expect(g['@graph'].map((n: any) => n['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication', 'SoftwareSourceCode', 'FAQPage'])
      expect(g['@graph'][0].name).toBe('Trina Inc.')
      expect(g['@graph'][0].sameAs).toContain('https://github.com/trina-app/trina-ax')
      expect(g['@graph'][2].license).toBe('https://www.gnu.org/licenses/agpl-3.0.html')
      expect(g['@graph'][3].license).toBe('https://www.gnu.org/licenses/agpl-3.0.html')
      expect(g['@graph'][2].applicationCategory).toBe('BusinessApplication')
      expect(g['@graph'][2].inLanguage).toBe(name)
      const raw = JSON.stringify(g)
      expect(raw).not.toMatch(/"offers?"|"price|priceCurrency|UnitPriceSpecification/i)
      expect(JSON.stringify(homeJsonLd(t))).toBe(JSON.stringify(homeJsonLd(t))) // pure
    })
  }
})

describe('crawling', () => {
  test('sitemap lists both languages of every page with hreflang alternates, and not 404', () => {
    const xml = sitemapXml()
    for (const p of PAGES) {
      expect(xml).toContain(`<loc>https://ax.trina.app${ROUTES[p.route].en}</loc>`)
      expect(xml).toContain(`<loc>https://ax.trina.app${ROUTES[p.route].ko}</loc>`)
    }
    for (const p of SINGLE_PAGES) expect(xml).toContain(`<loc>https://ax.trina.app${p.path}</loc>`)
    expect(SINGLE_PAGES.map((p) => p.path)).toEqual(['/terms', '/privacy', '/refund'])
    expect((xml.match(/<url>/g) ?? []).length).toBe(PAGES.length * 2 + SINGLE_PAGES.length)
    expect(xml).toContain('hreflang="x-default"')
    expect(xml).not.toContain('404')
    expect(built('sitemap.xml')).toBe(xml)
  })

  test('robots.txt allows AI search bots and names the sitemap', () => {
    const robots = readFileSync(join(root, 'public/robots.txt'), 'utf8')
    for (const bot of ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended']) {
      expect(robots).toContain(`User-agent: ${bot}`)
    }
    expect(robots).not.toMatch(/Disallow: \/\s*$/m)
    expect(robots).toContain('Sitemap: https://ax.trina.app/sitemap.xml')
  })

  test('llms.txt is English, built from the copy, and points at the Korean site', () => {
    const txt = llmsTxt(en, ko)
    expect(built('llms.txt')).toBe(txt)
    expect(txt).toContain('# Trina AX')
    expect(txt).toContain('https://github.com/trina-app/trina-ax')
    expect(txt).toContain('AGPL-3.0')
    expect(txt).not.toMatch(/Apache/)
    expect(txt).toContain('https://ax.trina.app/security')
    expect(txt).toContain('https://ax.trina.app/guide')
    expect(txt).toContain('https://ax.trina.app/ko/')
    for (const f of en.features.items) expect(txt).toContain(f.title)
    for (const q of en.faq.items) expect(txt).toContain(q.a)
    expect(txt).not.toMatch(/undefined|\{|\[object/)
  })

  test('every page has one og:image of 1200x630 and the files exist', () => {
    for (const [file, img] of [['index.html', 'og.png'], ['ko/index.html', 'og-ko.png'], ['security.html', 'og.png'], ['ko/security.html', 'og-ko.png'], ['guide.html', 'og.png'], ['ko/guide/first-week.html', 'og-ko.png']]) {
      const html = built(file)
      expect(html).toContain(`<meta property="og:image" content="https://ax.trina.app/${img}">`)
      expect(html).toContain('og:image:width" content="1200"')
      const png = readFileSync(join(root, 'public', img))
      expect(png.readUInt32BE(16)).toBe(1200)
      expect(png.readUInt32BE(20)).toBe(630)
    }
  })

  test('the security link in the home pages goes to the same-language security page', () => {
    expect(attrs(built('index.html'), 'href')).toContain('/security')
    expect(attrs(built('ko/index.html'), 'href')).toContain('/ko/security')
  })
})

describe('copy shape', () => {
  const shape = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v
  test('Korean has exactly the keys, list lengths and types of English', () => {
    expect(shape(ko)).toEqual(shape(en))
  })
  test('English and Korean have the same number of FAQ items, questions, cards, roles and paths', () => {
    expect(ko.faq.items.length).toBe(8)
    expect(en.faq.items.length).toBe(8)
    expect(ko.security.qa.length).toBe(6)
    expect(ko.secPage.promises.length).toBe(5)
    expect(ko.features.items.length).toBe(6)
    expect(ko.roles.items.map((r) => r.id)).toEqual(['ceo', 'sales', 'finance', 'people'])
    expect(ko.start.paths.map((p) => p.id)).toEqual(['hosted', 'self'])
    for (const p of ko.start.paths) expect(p.steps.length).toBe(3)
    expect(ko.same.people.length).toBe(2)
  })
  test('oneLine drops heading line breaks', () => {
    expect(oneLine(en.same.title)).toBe('Same question, different answers')
  })
})
