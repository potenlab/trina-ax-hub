import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import ko from '../src/content/ko'
import { GUIDES, guidePath } from '../src/content/guides'
import { PAGE_FILES, attrs, built, dist, visibleText } from './helpers'

test('every local page link and fragment resolves, including guides, screenshots and PDF', () => {
  for (const [path, file] of Object.entries(PAGE_FILES)) {
    const html = built(file)
    const ids = attrs(html, 'id')
    expect(new Set(ids).size, `duplicate ids on ${path}`).toBe(ids.length)
    for (const href of attrs(html, 'href')) {
      if (!href.startsWith('/') && !href.startsWith('#')) continue
      const url = new URL(href, `https://ax.trina.app${path}`)
      const target = PAGE_FILES[url.pathname]
      if (target) {
        expect(existsSync(join(dist, target)), `${path} → ${href}`).toBe(true)
        if (url.hash) expect(attrs(built(target), 'id'), `${path} → ${href}`).toContain(decodeURIComponent(url.hash.slice(1)))
      } else {
        expect(existsSync(join(dist, decodeURIComponent(url.pathname))), `${path} → ${href}`).toBe(true)
      }
    }
  }
})

test('every published Korean guide is in the hub and sitemap, with an available next article', () => {
  const hub = attrs(built('ko/guide.html'), 'href')
  const sitemap = built('sitemap.xml')
  expect(GUIDES.length).toBeGreaterThanOrEqual(16)
  expect(new Set(GUIDES.map(g => g.slug)).size).toBe(GUIDES.length)
  for (const g of GUIDES) {
    const path = guidePath(g.slug)
    expect(hub).toContain(path)
    expect(sitemap).toContain(`<loc>https://ax.trina.app${path}</loc>`)
    const html = built(PAGE_FILES[path]), text = visibleText(html)
    for (const heading of [g.title, '이 글을 읽을 분', '따라 할 순서', '막힐 때 확인할 점', '다음에 읽을 것']) expect(text).toContain(heading)
    expect(GUIDES.some(next => next.slug === g.next)).toBe(true)
    expect(attrs(html, 'href')).toContain(guidePath(g.next))
    expect(html).toContain(`hreflang="en" href="https://ax.trina.app${guidePath(g.slug, 'en')}"`)
    expect(text).not.toContain('준비 중')
    if (g.image) expect(existsSync(join(dist, `images/guide/${g.image.name}.webp`))).toBe(true)
  }
})

test('all four role guides retain their request and result, with copyable follow-up and skill handoff', () => {
  const cases = GUIDES.filter(g => g.roleId)
  expect(cases.length).toBe(4)
  for (const g of cases) {
    const role = ko.roles.items.find(r => r.id === g.roleId)!
    const html = built(`ko/guide/${g.slug}.html`), text = visibleText(html)
    expect(attrs(html, 'data-copy')).toContain(role.q)
    expect(attrs(html, 'data-copy')).toContain(g.followUp!)
    expect(text).toContain(role.doc.file)
    expect(text).toContain('가상 결과')
    expect(text).toContain('스킬로 제안')
    expect(text).toContain('담당자가 검토해 등록하면')
    expect(attrs(built('ko/index.html'), 'href')).toContain(guidePath(g.slug))
  }
})

test('guide instructions retain verified product boundaries', () => {
  expect(visibleText(built('ko/guide/ai-connection.html'))).toContain('회사 연결 추가는 팀장만')
  expect(visibleText(built('ko/guide/invite.html'))).toContain('앱에서 초대 메일을 보내지는 않아요')
  expect(visibleText(built('ko/guide/usage-limits.html'))).toContain('API 키 연결만 정가로 추정')
  expect(visibleText(built('ko/guide/backup.html'))).toContain('팀 파일은 버전 기록이나 휴지통에서 따로')
  expect(visibleText(built('ko/guide/external-services.html'))).toContain('Drive에 올리거나 수정하는 기능은 없어요')
  expect(visibleText(built('ko/guide/use-cases/sales-quote.html'))).toContain('서식·수식·인쇄 설정을 그대로 복제하지 않아요')
  expect(visibleText(built('ko/guide/use-cases/official-letter.html'))).toContain('회신 결과는 Word로')
})

test('site HTML never leaks test runtime details, credentials, or forbidden product names', () => {
  for (const file of Object.values(PAGE_FILES)) {
    const html = built(file)
    expect(html).not.toMatch(/개발 모드: OS 격리 없음|localhost:19590|QA_OWNER_PASSWORD|sk-ant-(?:api|oat)\d+-[A-Za-z\d_-]{10,}/)
    expect(html).not.toMatch(/\d{6}-[1-4]\d{6}/)
    expect(html).not.toMatch(/<iframe\b|<embed\b/)
    for (const src of attrs(html, 'src')) expect(src).not.toMatch(/^https?:\/\//)
  }
})
