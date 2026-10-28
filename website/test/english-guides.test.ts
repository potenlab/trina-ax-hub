import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from '../src/content/en'
import { GUIDES, guidePath } from '../src/content/guides'
import { EN_GUIDES } from '../src/content/guides-en'
import { BROCHURES, PLANS, krwNote } from '../src/site'
import labels from './fixtures/product-en-labels.json'
import { PAGE_FILES, attrs, built, root, visibleText } from './helpers'

const guideText = (slug: string) => visibleText(built(`guide/${slug}.html`))

test('English covers all 19 Korean task guides with matching identity and evidence', () => {
  expect(EN_GUIDES).toHaveLength(19)
  expect(EN_GUIDES.map(g => g.slug)).toEqual(GUIDES.map(g => g.slug))
  for (const g of EN_GUIDES) {
    const ko = GUIDES.find(k => k.slug === g.slug)!
    expect([g.group, g.roleId, g.next]).toEqual([ko.group, ko.roleId, ko.next])
    expect(g.before.length).toBeGreaterThanOrEqual(2)
    expect(g.steps.length).toBe(ko.steps.length)
    expect(g.problems.length).toBe(ko.problems.length)
    expect(g.image).toBeUndefined() // Korean UI captures would contradict the English instructions.
    expect(g.sources).toContain('web/src/i18n/en.ts')
  }
})

test('every English guide is complete, linked from its hub, indexed and paired with its Korean twin', () => {
  const hub = attrs(built('guide.html'), 'href')
  const sitemap = built('sitemap.xml')
  const llms = built('llms.txt')
  for (const g of EN_GUIDES) {
    const path = guidePath(g.slug, 'en')
    const koPath = guidePath(g.slug, 'ko')
    const html = built(PAGE_FILES[path]), text = visibleText(html)
    expect(hub).toContain(path)
    expect(sitemap).toContain(`<loc>https://ax.trina.app${path}</loc>`)
    expect(llms).toContain(`[${g.title}](https://ax.trina.app${path})`)
    for (const heading of [g.title, 'Who this is for', 'Step by step', 'If you get stuck', 'Read next']) expect(text).toContain(heading)
    expect(html).toContain('<html lang="en"')
    expect(html).toContain(`rel="canonical" href="https://ax.trina.app${path}"`)
    expect(html).toContain(`class="lang-link" href="${koPath}"`)
    expect(attrs(html, 'href')).toContain(guidePath(g.next, 'en'))
    for (const twin of [html, built(PAGE_FILES[koPath])]) {
      expect(twin).toContain(`hreflang="en" href="https://ax.trina.app${path}"`)
      expect(twin).toContain(`hreflang="ko" href="https://ax.trina.app${koPath}"`)
    }
    const main = html.match(/<main\b[\s\S]*?<\/main>/)![0]
    expect(main).not.toMatch(/[가-힣]|Coming soon|준비 중|undefined/)
    expect(main).not.toContain('/images/guide/')
  }
  expect(visibleText(built('guide.html'))).not.toMatch(/Coming soon|being prepared|Korean PDF/)
})

test('English instructions use the product’s exact labels, pinned to the reviewed version', () => {
  for (const [slug, entries] of Object.entries(labels.guides)) {
    for (const [key, label] of Object.entries(entries)) expect(guideText(slug), `${slug}: ${key}`).toContain(label.replace('{version}', '3'))
  }
})

test('English role guides share the landing-page requests and results, with a reviewable skill handoff', () => {
  for (const g of EN_GUIDES.filter(g => g.roleId)) {
    const role = en.roles.items.find(r => r.id === g.roleId)!
    const html = built(`guide/${g.slug}.html`), text = visibleText(html)
    expect(attrs(html, 'data-copy')).toContain(role.q)
    expect(attrs(html, 'data-copy')).toContain(g.followUp!)
    expect(text).toContain(role.doc.file)
    expect(text).toContain('fictional example')
    expect(text).toContain('Suggest as skill')
    expect(text).toContain('reviews and registers it')
    expect(attrs(built('index.html'), 'href')).toContain(guidePath(g.slug, 'en'))
  }
})

test('English retains the corrected product boundaries', () => {
  const boundaries: Record<string, string[]> = {
    'folder-permissions': ['does not erase content already quoted', 'except other people’s personal folders'],
    invite: ['does not send invitation emails', 'Only the owner can invite someone as an admin', 'Each link works once'],
    'ai-connection': ['Only the owner can add a company connection', 'requires https', 'personal, assigned to a person, assigned to a group, then whole team'],
    'usage-limits': ['API key connections only', 'Use token limits for subscription connections', 'Warn only', 'Block'],
    backup: ['only the owner can back up', 'It leaves team files as they are', 'Incremental'],
    'restore-file': ['current content is kept as a new version'],
    'external-services': ['cannot upload to or edit Google Drive', 'computer'],
    schedules: ['Markdown report', 'does not run the AI immediately'],
    'review-skills': ['newly registered skill has no earlier version'],
    'use-cases/weekly-report': ['each run starts a new chat', 'Nobody can answer confirmation cards'],
    'use-cases/sales-quote': ['does not copy the original workbook’s formatting, formulas or print settings'],
    'use-cases/expense-summary': ['distinguish “missing” from “unknown”'],
    'use-cases/official-letter': ['reply is created as a Word document'],
  }
  for (const [slug, facts] of Object.entries(boundaries)) for (const fact of facts) expect(guideText(slug), slug).toContain(fact)
})

test('first-week checklist names exact actions and links to the detailed guides', () => {
  const html = built('guide/first-week.html'), text = visibleText(html)
  for (const slug of ['folder-permissions', 'ai-connection', 'team-files', 'invite', 'review-skills', 'backup']) {
    expect(attrs(html, 'href')).toContain(guidePath(slug, 'en'))
  }
  expect(text).toContain('The owner selects Back up now')
  expect(text).toContain('The owner adds a company key')
  expect(attrs(html, 'data-copy')).toContain(en.firstWeek.noticeText)
})

test('/en aliases render the same English pages and keep the established canonical URLs', () => {
  for (const [alias, canonical] of [
    ['en.html', 'index.html'], ['en/guide.html', 'guide.html'],
    ['en/guide/first-week.html', 'guide/first-week.html'],
    ...EN_GUIDES.map(g => [`en/guide/${g.slug}.html`, `guide/${g.slug}.html`]),
  ]) {
    // Logo mask IDs are unique per render; compare content and navigation instead.
    expect(visibleText(built(alias))).toBe(visibleText(built(canonical)))
    expect(built(alias).match(/<link rel="canonical"[^>]+>/)?.[0]).toBe(built(canonical).match(/<link rel="canonical"[^>]+>/)?.[0])
    expect(attrs(built(alias), 'href')).toEqual(attrs(built(canonical), 'href'))
  }
  expect(built('sitemap.xml')).not.toContain('<loc>https://ax.trina.app/en')
})

test('English brochure is five sheets with a real PDF and same-language download links', () => {
  const html = built('brochure.html')
  expect((html.match(/class="brochure-sheet/g) ?? []).length).toBe(5)
  for (const p of PLANS) expect(visibleText(html)).toContain(krwNote(p.usd, 'en'))
  const pdf = readFileSync(join(root, 'public', BROCHURES.en.pdf))
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.length).toBeGreaterThan(10000)
  for (const file of ['index.html', 'guide.html', 'brochure.html']) {
    expect(attrs(built(file), 'href')).toContain(BROCHURES.en.pdf)
    expect(attrs(built(file), 'href')).not.toContain(BROCHURES.ko.pdf)
  }
  expect(html).not.toContain('<form')
})
