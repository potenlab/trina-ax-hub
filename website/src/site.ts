// Links, prices and facts used across the site. Change them here, not in the pages.

export type Lang = 'en' | 'ko'

export const SITE_URL = 'https://ax.trina.app'
export const CONTACT_EMAIL = 'contact@trina.app'

/**
 * The company as every footer shows it (전자상거래법 §10: name, CEO, address, phone, email, business registration
 * number, hosting provider), in the same order as trina.app. No mail-order registration number (통신판매업 신고):
 * not filed; Payple advised leaving it blank (~/Desktop/Trina/제출_페이플/README.md). Add it here once there is one.
 */
export const COMPANY = {
  ceo: { en: 'Daehyeon Nam (남대현)', ko: '남대현' },
  bizNo: '414-81-10138',
  address: { en: '27-8 Obong-ro, Sannae-myeon, Gyeongju-si, Gyeongsangbuk-do, Republic of Korea', ko: '경상북도 경주시 산내면 오봉로 27-8' },
  phone: { en: '+82 70-8064-3349', ko: '070-8064-3349' },
  hosting: 'Cloudflare, Inc.',
} as const

export const LINKS = {
  // The product repository (public since 2026-10-28, AGPL-3.0-only). This website's own code lives elsewhere.
  github: 'https://github.com/trina-app/trina-ax',
  // How permissions work (Korean) and the permission function itself.
  permissions: 'https://github.com/trina-app/trina-ax/blob/main/docs/PERMISSIONS.md',
  policyCode: 'https://github.com/trina-app/trina-ax/tree/main/server/src/policy',
  // English install notes are docs/INSTALL.md; the Korean README's "실행하기" table lists the Mac, office and Linux guides.
  install: {
    en: 'https://github.com/trina-app/trina-ax/blob/main/docs/INSTALL.md',
    ko: 'https://github.com/trina-app/trina-ax/blob/main/README.ko.md#%EC%8B%A4%ED%96%89%ED%95%98%EA%B8%B0',
  } satisfies Record<Lang, string>,
  company: 'https://trina.app',
}

/**
 * Trina hosting plans, the only prices on the site. Each plan is one company's own AWS server in Seoul (Amazon Lightsail,
 * ap-northeast-2), sized for its number of people; the price is that server plus Trina running it (updates, backups,
 * monitoring, help). Lightsail Seoul list prices, 2026-10-27, per month (disk, IPv4 address and 4-6 TB transfer
 * included): 4 GB $24, 8 GB $44, 16 GB $84, so the server is about 60% of each price. Set on 2026-10-28 a little above
 * managed OpenClaw hosts at the same size (xCloud, Agent37, GetClaw: $20-100), which run on cheaper clouds.
 * Prices are in US dollars, before tax, billed monthly by the reseller (Merchant of Record).
 */
export const PLANS = [
  { id: 'starter', usd: 39, people: 5, vcpu: 2, memoryGb: 4, storageGb: 80, server: 'Lightsail 4 GB' },
  { id: 'team', usd: 69, people: 15, vcpu: 2, memoryGb: 8, storageGb: 160, server: 'Lightsail 8 GB' },
  { id: 'business', usd: 129, people: 40, vcpu: 4, memoryGb: 16, storageGb: 320, server: 'Lightsail 16 GB' },
] as const
export type PlanId = (typeof PLANS)[number]['id']
export const usd = (n: number) => `$${n}`

/** Public daily reference, fetched once. USD remains the billing currency. */
export const KRW_REFERENCE = {
  rate: 1326.806219,
  date: '2026-10-28',
  source: 'https://open.er-api.com/v6/latest/USD',
  provider: 'ExchangeRate-API',
} as const
export const krw = (dollars: number) => `₩${(Math.round(dollars * KRW_REFERENCE.rate / 1000) * 1000).toLocaleString('en-US')}`
export const krwNote = (dollars: number, lang: Lang) => lang === 'ko'
  ? `약 ${krw(dollars)} · VAT 별도`
  : `Approx. ${krw(dollars)} · excl. VAT`
export const priceWithReference = (dollars: number, lang: Lang) => `${usd(dollars)} (${krwNote(dollars, lang)})`
export const quoteRequest = (lang: Lang) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(lang === 'ko' ? '견적서 요청' : 'Trina AX quote request')}`
export const BROCHURE = { page: '/ko/brochure', pdf: '/downloads/trina-ax-introduction-ko.pdf' } as const
export const BROCHURES = {
  ko: BROCHURE,
  en: { page: '/brochure', pdf: '/downloads/trina-ax-introduction-en.pdf' },
} as const

/** The resellers that run the online checkout (Merchant of Record). The legal pages name them and their buyer terms. */
export const RESELLERS = [
  { name: 'Polar', entity: 'Polar Software, Inc.', buyerTerms: 'https://polar.sh/legal/checkout-buyer-terms' },
  { name: 'Creem', entity: 'Armitage Labs OÜ', buyerTerms: 'https://www.creem.io/buyer-terms' },
] as const

/**
 * The legal pages: English only (they are what the resellers review), at /terms, /privacy and /refund. The text is
 * src/legal/<id>.en.md (draft, lawyer review pending); both languages' footers link here.
 */
export const LEGAL = {
  terms: { path: '/terms', title: 'Terms of Service', description: 'The terms for Trina AX hosting by Trina Inc.: plans, billing, cancellation, data and responsibilities.' },
  privacy: { path: '/privacy', title: 'Privacy Policy', description: 'What personal information Trina Inc. collects for Trina AX hosting and this website, why, where it is kept and your rights.' },
  refund: { path: '/refund', title: 'Refund Policy', description: 'When and how Trina AX hosting payments are refunded, and how to cancel.' },
} as const
export type LegalId = keyof typeof LEGAL
export const LEGAL_UPDATED = '2026-10-28'

/** "Book a call" and every "도입 문의" button: a mail to Trina with the product in the subject. */
export const bookCall = (lang: Lang) =>
  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(lang === 'ko' ? '트리나 AX 도입 문의' : 'Trina AX')}`

/** The pages that exist in both languages. Canonical paths: no trailing slash, except the language home. */
export const ROUTES = {
  home: { en: '/', ko: '/ko/' },
  security: { en: '/security', ko: '/ko/security' },
  guide: { en: '/guide', ko: '/ko/guide' },
  firstWeek: { en: '/guide/first-week', ko: '/ko/guide/first-week' },
} satisfies Record<string, Record<Lang, string>>
export type RouteId = keyof typeof ROUTES

export const LOCALES: Record<Lang, { html: string; og: string; name: string }> = {
  en: { html: 'en', og: 'en_US', name: 'English' },
  ko: { html: 'ko', og: 'ko_KR', name: '한국어' },
}

export const abs = (path: string) => new URL(path, SITE_URL).href
