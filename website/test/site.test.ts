import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from '../src/content/en'
import ko from '../src/content/ko'
import { llmsTxt } from '../src/seo'
import { COMPANY, LEGAL, LINKS, PLANS, ROUTES, bookCall, usd, krw, KRW_REFERENCE, quoteRequest } from '../src/site'
import { LEGAL_FILES, PAGE_FILES, attrs, built, root, visibleText } from './helpers'

const files = Object.entries(PAGE_FILES)
const texts = files.map(([path, file]) => [path, visibleText(built(file))] as const)
const llms = ['llms.txt', llmsTxt(en, ko)] as const

describe('things the site must never say', () => {
  const everything: [string, string][] = [...texts.map(([p, t]): [string, string] => [p, t]), [llms[0], built('llms.txt')]]

  // Prices live in one place (PLANS in src/site.ts): any other money amount on a page is a mistake.
  test.each(everything)('%s: money amounts come from hosting plans and the dated KRW reference', (_, text) => {
    const allowed = new Set(PLANS.map((p) => usd(p.usd)))
    for (const m of text.matchAll(/\$\s?\d[\d,.]*/g)) expect(allowed.has(m[0]), `unexpected amount ${m[0]}`).toBe(true)
    for (const m of text.matchAll(/₩[\d,]+/g)) expect(new Set(PLANS.map(p => krw(p.usd))).has(m[0]), `unexpected KRW amount ${m[0]}`).toBe(true)
    expect(text).not.toMatch(/[€£¥]\s?\d/)
    expect(text).not.toMatch(/\d[\d,.]*\s?(원(?!본)|만\s?원|KRW|JPY|EUR|won)(?![a-z])/i)
  })

  test.each(everything)('%s: no YC, no star counter', (_, text) => {
    expect(text).not.toMatch(/\bYC\b|Y Combinator|ycombinator/i)
    expect(text).not.toMatch(/★|⭐|\bstars?\b|\bstarred\b|별 \d|\d+\s?별\b/i)
    expect(text).not.toMatch(/\bBacked by\b/i)
  })

  test.each(everything)('%s: no Drive product name', (_, text) => {
    expect(text).not.toMatch(/Trina Drive|트리나 ?Drive|drive\.trina\.app|trina-drive/i)
  })

  test('the Drive name is not in any attribute, JSON-LD or llms.txt either', () => {
    for (const [, file] of files) expect(built(file)).not.toMatch(/Trina Drive|트리나 ?Drive|drive\.trina\.app|trina-drive/i)
  })

  // The product is trina-app/trina-ax under AGPL-3.0 (2026-10-28). The old hub's Apache-2.0 / potenlab/trina-ax must not
  // come back on any page (this website's own source licence, in package.json, is a different thing).
  test.each(everything)('%s: the product licence is AGPL-3.0 and the repository is trina-app/trina-ax', (_, text) => {
    expect(text).not.toMatch(/Apache/i)
    expect(text).not.toMatch(/potenlab\/trina-ax/)
  })

  test('no customer names or invented numbers about adoption', () => {
    for (const [, t] of texts) {
      // (not a numbered clause like "8.2 Customers in Korea" on the legal pages)
      expect(t).not.toMatch(/(?<![\d.])\b\d+\+? (customers|companies|teams|users)\b/i)
      expect(t).not.toMatch(/\d+\s?(곳|개 회사|개사)\s?(이|가)?\s?(쓰|사용)/)
      expect(t).not.toMatch(/SOC ?2|ISO ?27001|ISMS/i)
    }
  })

  test('copy files contain no numbers next to money words either', () => {
    for (const f of ['en.ts', 'ko.ts']) {
      const src = readFileSync(join(root, 'src/content', f), 'utf8')
      expect(src).not.toMatch(/[$€£₩]\s?\d/)
    }
  })
})

describe('Korean copy rules (korean-landing-copy)', () => {
  const kpages = texts.filter(([p]) => p.startsWith('/ko'))
  const kfiles = Object.entries(PAGE_FILES).filter(([p]) => p.startsWith('/ko')).map(([, f]) => f)
  test('no machine-translation verbs or words the skill bans', () => {
    for (const [p, t] of kpages) {
      for (const bad of ['잽니다', '측정합니다', '제공합니다', '~을 통해', '를 통해', '을 통해', '하는 것이 가능합니다', '혁신적', '최적의', '스마트한', 'MCP', 'RBAC', '온프레미스']) {
        if (bad === 'MCP' && p === '/ko/guide/external-services') continue // exact UI label, explained on this task page
        expect(t.includes(bad), `${p} contains "${bad}"`).toBe(false)
      }
    }
  })
  test('Korean pages have no English section labels (eyebrows) and no uppercase English headings', () => {
    for (const f of kfiles) {
      const html = built(f)
      expect(html).not.toContain('class="eyebrow"')
      for (const m of html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)) {
        const text = m[1].replace(/<[^>]+>/g, '')
        if (/[가-힣]/.test(text)) continue
        // an all-English heading on a Korean page: only the product words are allowed
        expect(/^(Claude|GitHub|Trina AX)/.test(text.trim()), `English-only heading on a Korean page: ${text}`).toBe(true)
      }
    }
  })
  test('Korean titles (h1/h2) end like noun phrases, not like sentences', () => {
    for (const f of kfiles) {
      for (const m of built(f).matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)) {
        const text = m[1].replace(/<br\/?>/g, ' ').replace(/<[^>]+>/g, '').trim()
        expect(text, `title ends like a sentence: ${text}`).not.toMatch(/(해요|세요|예요|이에요|어요|아요|돼요|합니다|입니다)[.!?]?$/)
      }
    }
  })
})

describe('contact and links', () => {
  test('every "book a call" button mails Trina with the right subject', () => {
    for (const [file, lang, subject] of [['index.html', 'en', 'Trina%20AX'], ['ko/index.html', 'ko', encodeURIComponent('트리나 AX 도입 문의')]] as const) {
      const hrefs = attrs(built(file), 'href').filter((h) => h.startsWith('mailto:contact@trina.app?subject='))
      expect(hrefs.length).toBeGreaterThanOrEqual(6) // nav, mobile menu, hero, "two ways to start", pricing, final CTA
      for (const h of hrefs) expect([bookCall(lang), quoteRequest(lang)]).toContain(h)
      expect(bookCall(lang)).toBe(`mailto:contact@trina.app?subject=${subject}`)
    }
  })

  test('the only outside addresses are the product repository and trina.app', () => {
    // The legal pages also link the resellers' buyer terms and the Korean complaint bodies; they are checked below.
    for (const [, file] of files.filter(([, f]) => !LEGAL_FILES.includes(f))) {
      const html = built(file)
      for (const u of [...attrs(html, 'href'), ...attrs(html, 'src')]) {
        if (!/^https?:\/\//.test(u)) continue
        const ok =
          u === KRW_REFERENCE.source || u === LINKS.github || u.startsWith(LINKS.github + '/') || u === 'https://trina.app' || u.startsWith('https://trina.app/') || u.startsWith('https://ax.trina.app/')
        expect(ok, `unexpected outside address ${u} in ${file}`).toBe(true)
      }
    }
  })

  test('GitHub, install guide, and the terms, privacy and refund links', () => {
    expect(LINKS.github).toBe('https://github.com/trina-app/trina-ax')
    for (const u of [LINKS.permissions, LINKS.policyCode, LINKS.install.en, LINKS.install.ko]) expect(u.startsWith(LINKS.github + '/')).toBe(true)
    const home = attrs(built('index.html'), 'href')
    expect(home).toContain(LINKS.github)
    expect(home).toContain(LINKS.install.en)
    expect(attrs(built('ko/index.html'), 'href')).toContain(LINKS.install.ko)
    for (const f of ['index.html', 'ko/index.html', 'security.html', 'ko/security.html', ...LEGAL_FILES]) {
      for (const d of Object.values(LEGAL)) expect(attrs(built(f), 'href'), `${f} -> ${d.path}`).toContain(d.path)
    }
  })

  test('every footer shows the company: name, CEO, registration number, address, phone, email, hosting provider', () => {
    for (const [path, file] of files) {
      const lang = path.startsWith('/ko') ? 'ko' : 'en'
      const html = built(file)
      const footer = visibleText(html.slice(html.indexOf('<footer')))
      for (const v of ['Trina Inc.', COMPANY.ceo[lang], COMPANY.bizNo, COMPANY.address[lang], COMPANY.phone[lang], 'contact@trina.app', COMPANY.hosting]) {
        expect(footer, `${path} footer lacks ${v}`).toContain(v)
      }
    }
  })

  test('the security page (the one for the IT lead) has the commands to try it, with a copy button', () => {
    for (const f of ['security.html', 'ko/security.html']) {
      const html = built(f)
      expect(html).toContain('data-copy="git clone https://github.com/trina-app/trina-ax\ncd trina-ax &amp;&amp; bun install &amp;&amp; bun run build:native &amp;&amp; bun run dev"')
    }
  })

  test('home links the guide, the first-week page and the security page in its own language', () => {
    for (const [file, lang] of [['index.html', 'en'], ['ko/index.html', 'ko']] as const) {
      const hrefs = attrs(built(file), 'href')
      for (const r of [ROUTES.guide[lang], ROUTES.firstWeek[lang], ROUTES.security[lang]]) expect(hrefs, `${file} -> ${r}`).toContain(r)
    }
  })
})

describe('how it is used: the demo works without JavaScript and can be paused', () => {
  for (const [file, t] of [['index.html', en], ['ko/index.html', ko]] as const) {
    const html = built(file)
    const demo = html.slice(html.indexOf('data-demo'), html.indexOf('</figure>', html.indexOf('data-demo')))

    test(`${file}: the demo's finished screen is in the HTML (search engines, AI crawlers and no-JS visitors read it)`, () => {
      const text = visibleText(demo)
      for (const s of [t.demo.app.q, t.demo.app.confirm.title, t.demo.app.answer, t.demo.app.file, t.demo.caption]) expect(text).toContain(s)
      expect(demo).toContain(`aria-label="${t.demo.label}"`)
    })

    test(`${file}: one wait per step of the demo, and a pause / replay button (WCAG 2.2.2)`, () => {
      const timeline = demo.match(/data-timeline="([\d,]+)"/)![1].split(',')
      const last = Math.max(...[...demo.matchAll(/data-t="(\d+)"/g)].map((m) => Number(m[1])))
      expect(timeline.length).toBe(last + 1)
      expect(demo).toMatch(/<button class="demo-btn" type="button" data-demo-toggle>/)
      expect(t.demo.caption.length).toBeGreaterThan(10) // it says the data is made up
    })


  }
})

describe('content security policy (the page must work with script-src and style-src self only)', () => {
  const headers = readFileSync(join(root, 'public/_headers'), 'utf8')
  const csp = headers.match(/Content-Security-Policy: (.*)/)![1]

  test('policy is first-party only, plus Cloudflare Web Analytics', () => {
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("style-src 'self'")
    // The only other origins: the cookieless beacon Cloudflare injects for the trina.app zone's Web Analytics.
    const others = [...csp.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]).sort()
    expect(others).toEqual(['https://cloudflareinsights.com', 'https://static.cloudflareinsights.com'])
    expect(csp).toMatch(/script-src 'self' https:\/\/static\.cloudflareinsights\.com;/)
    expect(csp).toMatch(/connect-src 'self' https:\/\/cloudflareinsights\.com;/)
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/)
  })

  test.each(files)('%s: no inline style attributes, no inline scripts other than JSON-LD, no inline <style>', (_, file) => {
    const html = built(file)
    expect(html).not.toMatch(/\sstyle="/)
    expect(html).not.toMatch(/<style[\s>]/)
    for (const m of html.matchAll(/<script([^>]*)>/g)) {
      const a = m[1]
      expect(a.includes('src=') || a.includes('application/ld+json'), `inline script: <script${a}>`).toBe(true)
    }
    expect(html).not.toMatch(/\son[a-z]+="/) // no inline event handlers
  })

  test('wrangler.toml matches the deployment brief', () => {
    const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8')
    expect(toml).toContain('name = "trina-ax-site"')
    expect(toml).toContain('compatibility_date = "2026-10-01"')
    expect(toml).toContain('directory = "./dist"')
    expect(toml).toContain('not_found_handling = "404-page"')
  })

  test('package.json is Apache-2.0 and builds to dist', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.license).toBe('Apache-2.0')
    expect(pkg.scripts.build).toBe('astro build')
  })
})
