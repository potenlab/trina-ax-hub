import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BROCHURE, CONTACT_EMAIL, KRW_REFERENCE, PLANS, krw, krwNote, quoteRequest } from '../src/site'
import { attrs, built, root, visibleText } from './helpers'

test('KRW reference has a real date, positive rate and public source; rounds to whole thousands', () => {
  expect(KRW_REFERENCE.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(new Date(KRW_REFERENCE.date).toISOString().slice(0, 10)).toBe(KRW_REFERENCE.date)
  expect(KRW_REFERENCE.rate).toBeGreaterThan(0)
  expect(new URL(KRW_REFERENCE.source).protocol).toBe('https:')
  for (const p of PLANS) {
    const amount = Number(krw(p.usd).replace(/[₩,]/g, ''))
    expect(amount % 1000).toBe(0)
    expect(Math.abs(amount - p.usd * KRW_REFERENCE.rate)).toBeLessThanOrEqual(500)
  }
})
for (const [file, lang] of [['ko/index.html', 'ko'], ['index.html', 'en']] as const) {
  test(`${file}: dated reference, quote email and ungated brochure`, () => {
    const html = built(file), text = visibleText(html), hrefs = attrs(html, 'href')
    for (const p of PLANS) expect(text).toContain(krwNote(p.usd, lang))
    expect(text.split(KRW_REFERENCE.date).length - 1).toBe(1)
    expect(hrefs).toContain(quoteRequest(lang))
    expect(text).toContain(CONTACT_EMAIL)
    expect(hrefs.filter(h => h === BROCHURE.pdf).length).toBe(2)
    expect(html).not.toContain('<form')
  })
}
test('five-sheet Korean brochure comes from HTML, has working PDF and plan prices', () => {
  const html = built('ko/brochure.html')
  expect((html.match(/class="brochure-sheet/g) ?? []).length).toBe(5)
  for (const p of PLANS) expect(visibleText(html)).toContain(krwNote(p.usd, 'ko'))
  expect(existsSync(join(root, 'public', BROCHURE.pdf))).toBe(true)
  expect(readFileSync(join(root, 'public', BROCHURE.pdf)).subarray(0, 5).toString()).toBe('%PDF-')
  expect(html).not.toContain('<form')
})
