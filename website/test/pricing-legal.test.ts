// The hosting plans and the legal pages: what the payment reseller (Polar) looks for in a review, and that the
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

    test(`${file}: every plan shows its name, price, people, AI answers and storage, and no server size`, () => {
      expect([...section.matchAll(/class="plan"/g)].length + [...section.matchAll(/class="plan plan-custom"/g)].length).toBe(PLANS.length + 1)
      for (const p of PLANS) {
        const card = visibleText(section.slice(section.indexOf(`data-plan="${p.id}"`), section.indexOf('</li>', section.indexOf(`data-plan="${p.id}"`))))
        expect(card).toContain(t.pricing.plans[p.id])
        expect(card).toContain(usd(p.usd))
        expect(card).toContain(t.pricing.people.replace('{n}', String(p.people)))
        expect(card).toContain(t.pricing.answers.replace('{answers}', String(p.running)))
        expect(card).toContain(t.pricing.storage.replace('{disk}', String(p.storageGb)))
        expect(card).toContain(t.pricing.privateServer)
        expect(card).not.toMatch(/vCPU|memory|메모리|AWS|Lightsail/)
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
      expect(section).not.toMatch(/\{(from|n|answers|cpu|mem|disk)\}/)
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

  test('PLANS: ascending prices and limits', () => {
    for (let i = 1; i < PLANS.length; i++) {
      expect(PLANS[i].usd).toBeGreaterThan(PLANS[i - 1].usd)
      expect(PLANS[i].people).toBeGreaterThan(PLANS[i - 1].people)
      expect(PLANS[i].running).toBeGreaterThan(PLANS[i - 1].running)
      expect(PLANS[i].storageGb).toBeGreaterThan(PLANS[i - 1].storageGb)
    }
    // the larger-company card starts where the biggest plan ends
    expect(en.pricing.custom.people).toContain(String(PLANS.at(-1)!.people))
    expect(ko.pricing.custom.people).toContain(String(PLANS.at(-1)!.people))
  })
})

describe('hosted copy', () => {
  test('the marketing pages keep Seoul and do not sell an AWS server', () => {
    for (const file of ['index.html', 'ko/index.html', 'security.html', 'ko/security.html', 'brochure.html', 'ko/brochure.html', 'llms.txt']) {
      const text = file.endsWith('.txt') ? built(file) : visibleText(built(file))
      expect(text, file).toMatch(/Seoul|서울/)
      expect(text, file).not.toMatch(/AWS server|on AWS in Seoul|AWS 서울|Lightsail/)
    }
  })

  test('both FAQs say how CPU and memory work without a number', () => {
    expect(en.faq.items.find((i) => i.q === 'How much CPU and memory do I get?')?.a).toContain('install Trina AX on your own server')
    expect(ko.faq.items.find((i) => i.q === 'CPU와 메모리는 얼마나 되나요?')?.a).toContain('회사 서버에 직접 설치')
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

  test('only Polar sells; only the merchant can refund, so the refund path goes through us', () => {
    const all = LEGAL_FILES.map((f) => visibleText(built(f))).join(' ')
    expect(all).not.toMatch(/Creem|Armitage|Estonia|as shown at checkout/)
    const refund = visibleText(built('refund.html'))
    expect(refund).not.toMatch(/customer portal/)
    expect(refund).toContain('email support@trina.app with your order number')
  })

  test('the terms keep the free plan open to change: no promise of forever, 30 days notice', () => {
    const terms = visibleText(built('terms.html'))
    expect(terms).toContain('We can change or end the free plan. We tell you at least 30 days before.')
    const pages = LEGAL_FILES.map((f) => visibleText(built(f))).join(' ')
    expect(pages).not.toMatch(/free forever|always free|no time limit/i)
  })

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
