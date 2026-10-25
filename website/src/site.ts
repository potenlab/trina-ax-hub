// Links and facts used across the site. Change them here, not in the pages.

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
  // Both answered 200 on 2026-10-25. They are Korean pages.
  privacy: 'https://trina.app/ko/privacy',
  terms: 'https://trina.app/ko/terms',
}

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
