// Search and AI-search plumbing, built from the same copy the pages show (src/content), so the FAQ in the structured data
// is the visible FAQ and the sitemap lists exactly the pages that exist. Pure functions; pages and endpoints call them at
// build time. The pricing section shows the hosting plans (PLANS in src/site.ts); the structured data has no offers.
import type { Copy } from './content/en'
import { CONTACT_EMAIL, LEGAL, LEGAL_UPDATED, LINKS, PLANS, ROUTES, SITE_URL, abs, usd, type Lang, type RouteId } from './site'

/** Indexable pages. Each exists in both languages and lists the other as an alternate. 404 is left out. */
export const PAGES: { route: RouteId; lastmod: string }[] = [
  { route: 'home', lastmod: '2026-10-25' },
  { route: 'security', lastmod: '2026-10-25' },
]

/** English-only pages (the legal texts): listed without language alternates. */
export const SINGLE_PAGES: { path: string; lastmod: string }[] = Object.values(LEGAL).map((d) => ({ path: d.path, lastmod: LEGAL_UPDATED }))

const LANGS: Lang[] = ['en', 'ko']

export function sitemapXml(pages = PAGES, single = SINGLE_PAGES): string {
  const urls = pages.flatMap((p) =>
    LANGS.map((lang) => {
      const alt = [
        ...LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${abs(ROUTES[p.route][l])}"/>`),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(ROUTES[p.route].en)}"/>`,
      ].join('\n')
      return `  <url>\n    <loc>${abs(ROUTES[p.route][lang])}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n${alt}\n  </url>`
    }),
  )
  for (const p of single) urls.push(`  <url>\n    <loc>${abs(p.path)}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n  </url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
}

const ORG_ID = `${SITE_URL}/#org`
const SITE_ID = `${SITE_URL}/#website`
const APP_ID = `${SITE_URL}/#app`
const LICENSE = 'https://www.apache.org/licenses/LICENSE-2.0'

/** A heading or title with deliberate line breaks, as one line. */
export const oneLine = (s: string) => s.replace(/\n/g, ' ')

/** FAQ answers exactly as the page shows them. */
export function faqPage(t: Pick<Copy, 'faq' | 'lang'>) {
  return {
    '@type': 'FAQPage',
    '@id': `${abs(ROUTES.home[t.lang])}#faq`,
    inLanguage: t.lang,
    mainEntity: t.faq.items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  }
}

export const organization = () => ({
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'Trina Inc.',
  alternateName: '주식회사 트리나',
  url: LINKS.company,
  email: CONTACT_EMAIL,
  logo: { '@type': 'ImageObject', url: abs('/icon-512.png'), width: 512, height: 512 },
  sameAs: [LINKS.github],
})

export const website = (lang: Lang) => ({
  '@type': 'WebSite',
  '@id': SITE_ID,
  name: 'Trina AX',
  url: abs('/'),
  inLanguage: lang,
  publisher: { '@id': ORG_ID },
})

export function homeJsonLd(t: Copy) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization(),
      website(t.lang),
      {
        '@type': 'SoftwareApplication',
        '@id': APP_ID,
        name: 'Trina AX',
        url: abs(ROUTES.home[t.lang]),
        inLanguage: t.lang,
        description: t.meta.long,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'macOS, Linux',
        license: LICENSE,
        image: abs(t.meta.ogImage),
        featureList: t.features.items.map((i) => i.title),
        publisher: { '@id': ORG_ID },
      },
      {
        '@type': 'SoftwareSourceCode',
        name: 'Trina AX',
        codeRepository: LINKS.github,
        programmingLanguage: 'TypeScript',
        license: LICENSE,
        author: { '@id': ORG_ID },
        targetProduct: { '@id': APP_ID },
      },
      faqPage(t),
    ],
  }
}

/** Home -> page, for the security page. */
export function breadcrumbJsonLd(t: Copy) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Trina AX', item: abs(ROUTES.home[t.lang]) },
          { '@type': 'ListItem', position: 2, name: t.secPage.breadcrumb, item: abs(ROUTES.security[t.lang]) },
        ],
      },
    ],
  }
}

// ---------- /llms.txt (https://llmstxt.org), English ----------

export function llmsTxt(en: Copy, ko: Copy): string {
  return [
    '# Trina AX',
    '',
    `> ${en.meta.long}`,
    '',
    "Trina AX is made by Trina Inc. (주식회사 트리나). Claude runs as it does today (the desktop and phone apps, claude.ai, Claude Code, Cowork); the hub serves the company's files to each person's Claude with that person's folder permissions. It is free to self-host (Apache-2.0). Trina hosts it at your-company.trina.app on a server of the company's own (AWS, Seoul) for a monthly plan by the number of people, setup included. Claude usage is billed by Anthropic, not by Trina. Trina AX is not affiliated with Anthropic.",
    '',
    '## What it does',
    '',
    ...en.features.items.map((i) => `- ${i.title}: ${i.body}`),
    '',
    '## How it starts',
    '',
    ...en.how.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.body}`),
    `- ${en.how.note}`,
    '',
    '## Security: what we promise, and where it stops',
    '',
    ...en.security.promises.map((p) => `- ${p}`),
    `- ${en.security.limitsLabel}: ${en.security.limits}`,
    '',
    '## Trina hosting plans',
    '',
    ...PLANS.map((p) => `- ${en.pricing.plans[p.id]}: ${usd(p.usd)} a month, up to ${p.people} people, ${p.vcpu} vCPU, ${p.memoryGb} GB memory, ${p.storageGb} GB storage`),
    `- ${en.pricing.custom.name} (${en.pricing.custom.people.toLowerCase()}): ${en.pricing.custom.price.toLowerCase()}`,
    `- ${en.pricing.fine}`,
    '',
    '## Pages',
    '',
    `- [Home](${abs('/')}): product, pricing and FAQ`,
    `- [Security](${abs(ROUTES.security.en)}): ${en.secPage.description}`,
    `- [Source code on GitHub](${LINKS.github}): Apache-2.0`,
    `- [Security policy](${LINKS.securityMd}): how to report a vulnerability`,
    ...Object.values(LEGAL).map((d) => `- [${d.title}](${abs(d.path)}): ${d.description}`),
    `- [한국어 (Korean)](${abs(ROUTES.home.ko)}): the same site in Korean`,
    '',
    '## FAQ',
    '',
    ...en.faq.items.flatMap((i) => [`### ${i.q}`, '', i.a, '']),
    '## Contact',
    '',
    `- ${CONTACT_EMAIL} (calls, quotes, support); subject "Security: Trina AX" for vulnerabilities`,
    '',
  ].join('\n')
}
