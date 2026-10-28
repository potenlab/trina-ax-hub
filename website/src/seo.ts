// Search and AI-search plumbing, built from the same copy the pages show (src/content), so the FAQ in the structured data
// is the visible FAQ and the sitemap lists exactly the pages that exist. Pure functions; pages and endpoints call them at
// build time. The pricing section shows the hosting plans (PLANS in src/site.ts); the structured data has no offers.
import { GUIDES, guidePath } from './content/guides'
import { EN_GUIDES } from './content/guides-en'
import type { Copy } from './content/en'
import { BROCHURES, KRW_REFERENCE, CONTACT_EMAIL, LEGAL, LEGAL_UPDATED, LINKS, PLANS, ROUTES, SITE_URL, abs, usd, type Lang, type RouteId } from './site'

/** Indexable pages. Each exists in both languages and lists the other as an alternate. 404 is left out. */
export const PAGES: { route: RouteId; lastmod: string }[] = [
  { route: 'home', lastmod: '2026-10-29' },
  { route: 'security', lastmod: '2026-10-28' },
  { route: 'guide', lastmod: '2026-10-29' },
  { route: 'firstWeek', lastmod: '2026-10-29' },
]

/** Additional canonical paths. Legal pages and brochures have no alternates; translated guides do. */
export const SINGLE_PAGES: { path: string; lastmod: string; alternates?: Record<Lang, string> }[] = [
  ...Object.values(LEGAL).map(d => ({ path: d.path, lastmod: LEGAL_UPDATED })),
  ...Object.values(BROCHURES).map(b => ({ path: b.page, lastmod: KRW_REFERENCE.date })),
  ...GUIDES.flatMap(g => (['en', 'ko'] as const).map(lang => ({
    path: guidePath(g.slug, lang), lastmod: '2026-10-29',
    alternates: { en: guidePath(g.slug, 'en'), ko: guidePath(g.slug, 'ko') },
  }))),
]

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
  for (const p of single) {
    const alt = p.alternates ? [...LANGS, 'x-default'].map(lang => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${abs(p.alternates![lang === 'ko' ? 'ko' : 'en'])}"/>`).join('\n') + '\n' : ''
    urls.push(`  <url>\n    <loc>${abs(p.path)}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n${alt}  </url>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
}

const ORG_ID = `${SITE_URL}/#org`
const SITE_ID = `${SITE_URL}/#website`
const APP_ID = `${SITE_URL}/#app`
const LICENSE = 'https://www.gnu.org/licenses/agpl-3.0.html'

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

/** Home -> page (-> page), for the security and guide pages. */
export function breadcrumbJsonLd(t: Copy, crumbs: { name: string; route: RouteId }[]) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Trina AX', item: abs(ROUTES.home[t.lang]) },
          ...crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 2, name: c.name, item: abs(ROUTES[c.route][t.lang]) })),
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
    "Trina AX is made by Trina Inc. (주식회사 트리나). The AI (Claude Code, and optionally Codex) runs on the company's own server: an office Mac mini or Linux server the company runs, or a server of the company's own on AWS in Seoul that Trina hosts. Employees sign in to the Trina AX app on the web, desktop or phone; every file tool checks the permissions of the person who asks. Each person can connect their own Claude plan, or the company uses one API key with monthly limits per person. The software is free and open source (AGPL-3.0-only); Trina hosting is a monthly plan by the number of people, setup included. Claude usage is billed by Anthropic, not by Trina. Trina AX is not affiliated with Anthropic.",
    '',
    '## What it does',
    '',
    ...en.features.items.map((i) => `- ${i.title}: ${i.body}`),
    '',
    '## Examples by role',
    '',
    ...en.roles.items.map((r) => `- ${r.role}: "${r.q}" -> ${r.doc.file}`),
    '',
    '## How to start',
    '',
    ...en.start.paths.flatMap((p) => [
      `### ${p.name} (${p.price.replace('{from}', usd(PLANS[0].usd))})`,
      '',
      p.caption,
      '',
      ...p.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.body}`),
      '',
    ]),
    '## Security: questions buyers ask',
    '',
    ...en.security.qa.flatMap((x) => [`### ${x.q}`, '', x.a, '']),
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
    `- [Home](${abs('/')}): product, examples, pricing and FAQ`,
    `- [Security](${abs(ROUTES.security.en)}): ${en.secPage.description}`,
    `- [Guide](${abs(ROUTES.guide.en)}): ${en.guide.description}`,
    `- [The first week](${abs(ROUTES.firstWeek.en)}): ${en.firstWeek.description}`,
    ...EN_GUIDES.map(g => `- [${g.title}](${abs(guidePath(g.slug, 'en'))}): ${g.description}`),
    `- [Brochure (English PDF)](${abs(BROCHURES.en.pdf)}): five-page product introduction`,
    `- [Source code on GitHub](${LINKS.github}): AGPL-3.0-only`,
    `- [Permission model](${LINKS.permissions}): who sees what and how the AI is kept to it (Korean)`,
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
