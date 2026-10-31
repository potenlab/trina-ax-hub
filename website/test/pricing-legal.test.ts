// The hosting plans and the legal pages: what the payment resellers (Polar, Creem) look for in a review, and that the
// numbers on the page are the ones in PLANS.
import { describe, expect, test } from 'bun:test'
import en from '../src/content/en'
import ko from '../src/content/ko'
import { CONTACT_EMAIL, FREE_PLAN, LEGAL, LEGAL_UPDATED, LINKS, PLANS, RESELLERS, usd } from '../src/site'
import { LEGAL_FILES, attrs, built, visibleText } from './helpers'

describe('hosting plans', () => {
  for (const [file, t] of [['index.html', en], ['ko/index.html', ko]] as const) {
    const html = built(file)
    const section = html.slice(html.indexOf('id="pricing"'), html.indexOf('</section>', html.indexOf('id="pricing"')))
    const text = visibleText(section)

    test(`${file}: every plan shows its name, price, people and server`, () => {
      expect([...section.matchAll(/class="plan"/g)].length + [...section.matchAll(/class="plan plan-custom"/g)].length).toBe(PLANS.length + 1)
      for (const p of PLANS) {
        const card = visibleText(section.slice(section.indexOf(`data-plan="${p.id}"`), section.indexOf('</li>', section.indexOf(`data-plan="${p.id}"`))))
        expect(card).toContain(t.pricing.plans[p.id])
        expect(card).toContain(usd(p.usd))
        expect(card).toContain(t.pricing.people.replace('{n}', String(p.people)))
        expect(card).toContain(String(p.memoryGb))
        expect(card).toContain(String(p.storageGb))
      }
    })

    test(`${file}: the Free card shows its limits from FREE_PLAN, links to sign-up and is not featured`, () => {
      const start = section.indexOf('data-plan="free"')
      const li = section.slice(section.lastIndexOf('<li', start), section.indexOf('</li>', start))
      const card = visibleText(li)
      expect(li).toContain('class="plan plan-free"')
      expect(card).toContain(t.pricing.free.name)
      expect(card).toContain(usd(FREE_PLAN.usd))
      expect(card).toContain(t.pricing.people.replace('{n}', String(FREE_PLAN.people)))
      for (const n of [FREE_PLAN.vcpu, FREE_PLAN.memoryGb, FREE_PLAN.storageGb]) expect(card).toContain(String(n))
      expect(attrs(li, 'href')).toEqual([LINKS.signup])
      expect(li).toContain('btn-secondary')
      expect(li).not.toContain('btn-primary')
      expect(text).toContain(t.pricing.free.note)
      expect(t.faq.items.some((i) => i.a.includes(`${FREE_PLAN.memoryGb}GB`) || i.a.includes(`${FREE_PLAN.memoryGb} GB`))).toBe(true)
    })

    test(`${file}: the heading and the table start from the cheapest plan`, () => {
      expect(Math.min(...PLANS.map((p) => p.usd))).toBe(PLANS[0].usd)
      expect(text).toContain(usd(PLANS[0].usd))
      expect(section).not.toMatch(/\{(from|n|cpu|mem|disk)\}/)
    })

    test(`${file}: billing terms next to the prices (renewal, cancellation, refund, reseller) and links to terms and refunds`, () => {
      expect(text).toContain(t.pricing.fine)
      for (const r of RESELLERS) expect(t.pricing.fine).toContain(r.name)
      expect(t.pricing.fine).toMatch(t.lang === 'en' ? /renews every month until you cancel/ : /해지할 때까지 매달 자동으로 결제돼요/)
      expect(t.pricing.fine).toMatch(t.lang === 'en' ? /14 days/ : /14일/)
      const hrefs = attrs(section, 'href')
      expect(hrefs).toContain(LEGAL.terms.path)
      expect(hrefs).toContain(LEGAL.refund.path)
    })
  }

  test('PLANS: ascending prices and sizes, people within what the server holds', () => {
    for (let i = 1; i < PLANS.length; i++) {
      expect(PLANS[i].usd).toBeGreaterThan(PLANS[i - 1].usd)
      expect(PLANS[i].people).toBeGreaterThan(PLANS[i - 1].people)
      expect(PLANS[i].memoryGb).toBeGreaterThan(PLANS[i - 1].memoryGb)
    }
    // the larger-company card starts where the biggest plan ends
    expect(en.pricing.custom.people).toContain(String(PLANS.at(-1)!.people))
    expect(ko.pricing.custom.people).toContain(String(PLANS.at(-1)!.people))
  })
})

describe('legal pages', () => {
  for (const [id, d] of Object.entries(LEGAL)) {
    const file = `${id}.html`
    const html = built(file)
    const text = visibleText(html)

    test(`${d.path}: English, indexed, canonical, title, date and the company`, () => {
      expect(html).toMatch(/<html lang="en"/)
      expect(html).toContain(`<link rel="canonical" href="https://ax.trina.app${d.path}">`)
      expect(html).toContain('content="index, follow')
      expect(html).not.toContain('rel="alternate" hreflang=')
      expect(html).toContain(`<h1>${d.title}</h1>`)
      expect(html).toContain(`<time datetime="${LEGAL_UPDATED}">`)
      expect(text).toContain('Trina Inc.')
      expect(text).toContain(CONTACT_EMAIL)
    })

    test(`${d.path}: a real document, no placeholders, no personal data`, () => {
      const body = html.slice(html.indexOf('<article class="prose">'), html.indexOf('</article>'))
      expect(visibleText(body).length).toBeGreaterThan(1500)
      expect(body).not.toMatch(/TODO|TBD|\[\[|\{\{|lorem/i)
      expect(body).not.toMatch(/\d{6}-[1-4]\d{6}/) // resident registration numbers
      expect(body).not.toMatch(/171211-0015476/) // corporate registration number: not needed here
    })
  }

  test('the resellers are named with their buyer terms', () => {
    const terms = built('terms.html')
    for (const r of RESELLERS) {
      expect(terms).toContain(r.entity)
      expect(attrs(terms, 'href')).toContain(r.buyerTerms)
    }
  })

  test('hosting facts the pages must state: AWS in Seoul, Cloudflare, cancellation and the 14-day refund', () => {
    const all = LEGAL_FILES.map((f) => visibleText(built(f))).join(' ')
    expect(all).toMatch(/Amazon Web Services/)
    expect(all).toMatch(/Seoul/)
    expect(all).toMatch(/Cloudflare/)
    expect(visibleText(built('refund.html'))).toMatch(/14 days/)
    expect(visibleText(built('terms.html'))).toMatch(/cancel/i)
  })
})
