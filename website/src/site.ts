// Links, prices and facts used across the site. Change them here, not in the pages.

export type Lang = 'en' | 'ko'

export const SITE_URL = 'https://ax.trina.app'
export const CONTACT_EMAIL = 'contact@trina.app'

export const LINKS = {
  // The repository is the product. It must be public (and Apache-2.0) before this site goes live.
  github: 'https://github.com/potenlab/trina-ax',
  securityMd: 'https://github.com/potenlab/trina-ax/blob/main/SECURITY.md',
  // English install notes are the README; the full operator guide (Mac mini install, tunnel, backups) is Korean only.
  install: {
    en: 'https://github.com/potenlab/trina-ax#readme',
    ko: 'https://github.com/potenlab/trina-ax/blob/main/docs/OPERATOR.md',
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
} satisfies Record<string, Record<Lang, string>>
export type RouteId = keyof typeof ROUTES

export const LOCALES: Record<Lang, { html: string; og: string; name: string }> = {
  en: { html: 'en', og: 'en_US', name: 'English' },
  ko: { html: 'ko', og: 'ko_KR', name: '한국어' },
}

export const abs = (path: string) => new URL(path, SITE_URL).href
