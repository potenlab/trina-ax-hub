// Looks at the built site in a real browser: console errors, CSP violations, failed requests, horizontal overflow at
// 360 / 768 / 1280 px in light and dark, the language switch, the theme toggle, the mobile menu, the copy button and
// every internal link. Saves screenshots. Run:   bun run build && node scripts/verify.mjs
//
// Uses the pinned Playwright dev dependency; install Chromium with bunx playwright install chromium.
// PLAYWRIGHT_PATH can point at another installed copy.
// Other options: SHOTS_DIR (where screenshots go), ALL_SHOTS=1 (every page x viewport x theme), PORT, EXISTING_SERVER=1.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const playwrightPath =
  process.env.PLAYWRIGHT_PATH || 'playwright'
const { chromium } = createRequire(import.meta.url)(playwrightPath)

const port = Number(process.env.PORT || 19592)
const base = `http://localhost:${port}`
const shots = process.env.SHOTS_DIR || join(here, '..', '.shots')
mkdirSync(shots, { recursive: true })

const server = process.env.EXISTING_SERVER === '1' ? null : spawn('bun', [join(here, 'serve-dist.ts')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1200))

const pages = [
  { id: 'en-home', path: '/' },
  { id: 'ko-home', path: '/ko/' },
  { id: 'en-security', path: '/security' },
  { id: 'ko-security', path: '/ko/security' },
  { id: 'en-guide', path: '/guide' },
  { id: 'ko-guide', path: '/ko/guide' },
  { id: 'en-first-week', path: '/guide/first-week' },
  { id: 'ko-first-week', path: '/ko/guide/first-week' },
  { id: 'en-blog', path: '/blog' },
  { id: 'en-blog-post', path: '/blog/share-claude-skills-with-your-team' },
  { id: 'en-guide-use-skills', path: '/guide/use-skills' }, // ends with the "From the blog" block
  { id: '404', path: '/no-such-page', status: 404 },
]
const viewports = [
  { w: 360, h: 800 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
]
const themes = ['light', 'dark']
// A few screenshots are always saved; ALL_SHOTS=1 saves them all.
const keep = (id, w, theme) =>
  process.env.ALL_SHOTS === '1' ||
  ((id === 'en-home' || id === 'ko-home') && (w === 1280 || w === 360)) ||
  ((id.startsWith('en-blog') || id === 'en-guide-use-skills') && (w === 1280 || w === 360)) ||
  ((id === 'en-security' || id === 'ko-security') && w === 1280 && theme === 'light')

const problems = []
const saved = []
const note = (where, msg) => problems.push(`${where}: ${msg}`)

const browser = await chromium.launch()
try {
  for (const pg of pages) {
    for (const vp of viewports) {
      for (const theme of themes) {
        const where = `${pg.id} ${vp.w}px ${theme}`
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: theme, deviceScaleFactor: 1 })
        const page = await ctx.newPage()
        page.on('console', (m) => {
          if (!['error', 'warning'].includes(m.type())) return
          // Chrome logs the 404 document itself as a console error; that is the point of the 404 page.
          if (pg.status === 404 && m.text().includes('status of 404')) return
          note(where, `console ${m.type()}: ${m.text()}`)
        })
        page.on('pageerror', (e) => note(where, `page error: ${e.message}`))
        page.on('requestfailed', (r) => note(where, `request failed: ${r.url()} ${r.failure()?.errorText}`))
        page.on('response', (r) => {
          const u = new URL(r.url())
          if (u.origin !== base) note(where, `third-party request: ${r.url()}`)
          else if (r.status() >= 400 && !(pg.status && r.url() === base + pg.path)) note(where, `HTTP ${r.status()}: ${r.url()}`)
        })
        await page.addInitScript(() => {
          document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`))
        })
        const res = await page.goto(base + pg.path, { waitUntil: 'networkidle' })
        if (res.status() !== (pg.status || 200)) note(where, `status ${res.status()}`)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(1300) // let the one-off hero animation finish

        const m = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth
          const offenders = []
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el)
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            if (r.right > vw + 1 || r.left < -1) {
              // Ignore things clipped by an ancestor with overflow hidden/clip (decorative glows, masks).
              let p = el.parentElement, clipped = false
              while (p && p !== document.body) {
                const o = getComputedStyle(p)
                if (/(hidden|clip|auto|scroll)/.test(o.overflowX)) { clipped = true; break }
                p = p.parentElement
              }
              if (!clipped) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} [${Math.round(r.left)},${Math.round(r.right)}]`)
            }
          }
          return {
            scrollW: document.documentElement.scrollWidth,
            bodyScrollW: document.body.scrollWidth,
            vw,
            offenders: offenders.slice(0, 6),
            h1: document.querySelectorAll('h1').length,
            main: document.querySelectorAll('main').length,
            nav: document.querySelectorAll('header nav, nav').length,
            footer: document.querySelectorAll('footer').length,
            lang: document.documentElement.lang,
            dark: getComputedStyle(document.body).backgroundColor,
            geist: document.fonts.check('16px Geist'),
            pretendard: [...document.fonts].filter((f) => f.family.includes('Pretendard') && f.status === 'loaded').map((f) => f.family),
            title: document.title,
          }
        })
        if (m.scrollW > m.vw || m.bodyScrollW > m.vw) note(where, `horizontal overflow: scrollWidth ${m.scrollW}/${m.bodyScrollW} > ${m.vw}`)
        if (m.offenders.length) note(where, `elements past the viewport: ${m.offenders.join('; ')}`)
        if (m.h1 !== 1) note(where, `${m.h1} h1 elements`)
        if (m.main !== 1) note(where, `${m.main} main elements`)
        if (!m.geist) note(where, 'Geist not loaded')
        const wantKo = pg.id.startsWith('ko') || pg.id === '404'
        if (pg.id.startsWith('ko') && m.lang !== 'ko') note(where, `html lang is ${m.lang}`)
        if (pg.id.startsWith('en') && m.lang !== 'en') note(where, `html lang is ${m.lang}`)
        if (pg.id.startsWith('ko') && m.pretendard.length === 0) note(where, 'Pretendard not loaded on a Korean page')
        if (pg.id.startsWith('en') && m.pretendard.length > 0) note(where, 'Pretendard loaded on an English page')
        void wantKo

        if (keep(pg.id, vp.w, theme)) {
          const file = join(shots, `${pg.id}-${vp.w}-${theme}.png`)
          await page.screenshot({ path: file, fullPage: true })
          saved.push(file)
        }
        await ctx.close()
      }
    }
  }

  // ---- behaviour ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => note('behaviour', `page error: ${e.message}`))
    await page.goto(base + '/', { waitUntil: 'networkidle' })

    // theme toggle: system light -> dark -> light, and it is remembered
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const light = await bg()
    await page.click('[data-theme-toggle]')
    const dark = await bg()
    if (light === dark) note('theme', 'toggle did not change the background')
    await page.reload({ waitUntil: 'networkidle' })
    if ((await bg()) !== dark) note('theme', 'choice not remembered after reload')
    await page.click('[data-theme-toggle]')
    if ((await bg()) !== light) note('theme', 'second click did not return to light')

    // the hero demo plays to the end by itself, can be paused and replayed
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    await page.locator('[data-demo]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(1500)
    if ((await page.getAttribute('[data-demo]', 'data-play')) !== 'playing') note('demo', 'not playing once in view')
    await page.click('[data-demo-toggle]')
    if ((await page.getAttribute('[data-demo]', 'data-play')) !== 'paused') note('demo', 'pause did not pause')
    await page.click('[data-demo-toggle]')
    await page.waitForTimeout(13000)
    if ((await page.getAttribute('[data-demo]', 'data-play')) !== 'done') note('demo', 'did not reach the end')
    const hidden = await page.$$eval('[data-demo] [data-t]:not([data-off])', (els) => els.filter((e) => getComputedStyle(e).display === 'none').length)
    if (hidden) note('demo', `${hidden} parts still hidden at the end`)

    // Team showcase: keyboard jump, all examples readable, optional motion.
    await page.locator('.team-jumps a[href="#team-finance"]').focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.activeElement?.id === 'team-finance-title')
    if (await page.evaluate(() => document.activeElement?.id) !== 'team-finance-title') note('teams', 'jump did not focus the team heading')
    if (await page.locator('.team-example:visible').count() !== 18) note('teams', 'not all 18 examples are readable')
    await page.locator('[data-team-motion]').focus()
    await page.keyboard.press('Space')
    if (await page.getAttribute('[data-team-showcase]', 'data-motion') !== 'off') note('teams', 'pause did not stop scroll effects')
    if (await page.getAttribute('[data-team-motion]', 'aria-pressed') !== 'true') note('teams', 'pause state not exposed')
    await page.keyboard.press('Space')
    if (await page.getAttribute('[data-team-showcase]', 'data-motion') !== 'on') note('teams', 'resume did not restore scroll effects')

    // copy button (the commands on the security page, for the IT lead)
    await page.goto(base + '/security', { waitUntil: 'networkidle' })
    await page.click('.copy-btn')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    if (!clip.includes('git clone https://github.com/trina-app/trina-ax') || !clip.includes('bun run dev')) note('copy', `clipboard has: ${JSON.stringify(clip)}`)

    // language switch, both ways, on both pages
    for (const [from, linkTo] of [['/', '/ko/'], ['/ko/', '/'], ['/security', '/ko/security'], ['/ko/security', '/security'], ['/guide', '/ko/guide'], ['/ko/guide/first-week', '/guide/first-week']]) {
      await page.goto(base + from, { waitUntil: 'networkidle' })
      const href = await page.getAttribute('.lang-link', 'href')
      if (href !== linkTo) note('lang switch', `${from} links to ${href}, expected ${linkTo}`)
    }

    // hreflang + canonical
    for (const [p, canon] of [['/', 'https://ax.trina.app/'], ['/ko/', 'https://ax.trina.app/ko/'], ['/security', 'https://ax.trina.app/security'], ['/ko/security', 'https://ax.trina.app/ko/security']]) {
      await page.goto(base + p, { waitUntil: 'domcontentloaded' })
      const c = await page.getAttribute('link[rel=canonical]', 'href')
      if (c !== canon) note('canonical', `${p}: ${c}`)
      const alts = await page.$$eval('link[rel=alternate][hreflang]', (els) => els.map((e) => `${e.getAttribute('hreflang')}=${e.getAttribute('href')}`))
      if (alts.length !== 3 || !alts.some((a) => a.startsWith('x-default=')) ) note('hreflang', `${p}: ${alts.join(', ')}`)
    }
    // The blog is English only: the page itself and x-default.
    for (const p of ['/blog', '/blog/share-claude-skills-with-your-team']) {
      await page.goto(base + p, { waitUntil: 'domcontentloaded' })
      const self = 'https://ax.trina.app' + p
      const c = await page.getAttribute('link[rel=canonical]', 'href')
      if (c !== self) note('canonical', `${p}: ${c}`)
      const alts = await page.$$eval('link[rel=alternate][hreflang]', (els) => els.map((e) => `${e.getAttribute('hreflang')}=${e.getAttribute('href')}`))
      if (alts.join(' ') !== `en=${self} x-default=${self}`) note('hreflang', `${p}: ${alts.join(', ')}`)
    }
    await ctx.close()

    // mobile menu
    const m = await browser.newContext({ viewport: { width: 360, height: 800 } })
    const mp = await m.newPage()
    await mp.goto(base + '/', { waitUntil: 'networkidle' })
    if (await mp.isVisible('.mobile-menu')) note('menu', 'open before click')
    await mp.click('[data-menu-toggle]')
    if (!(await mp.isVisible('.mobile-menu'))) note('menu', 'did not open')
    await mp.screenshot({ path: join(shots, 'en-home-360-menu-open.png') })
    saved.push(join(shots, 'en-home-360-menu-open.png'))
    await mp.keyboard.press('Escape')
    if (await mp.isVisible('.mobile-menu')) note('menu', 'Escape did not close it')
    await m.close()

    // reduced motion: the demo does not play by itself; it shows its finished screen, with nothing animating
    const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
    const rp = await rm.newPage()
    await rp.goto(base + '/', { waitUntil: 'networkidle' })
    await rp.waitForTimeout(600)
    if ((await rp.getAttribute('[data-demo]', 'data-play')) !== 'done') note('reduced motion', 'the demo is not showing its finished screen')
    const rmHidden = await rp.$$eval('[data-demo] [data-t]:not([data-off])', (els) => els.filter((e) => getComputedStyle(e).display === 'none').length)
    if (rmHidden) note('reduced motion', `${rmHidden} demo parts hidden`)
    const anim = await rp.$$eval('[data-demo] *', (els) => els.map((e) => getComputedStyle(e).animationName).filter((a) => a !== 'none'))
    if (anim.length) note('reduced motion', `demo still animates: ${anim.join(',')}`)
    await rp.locator('#roles').scrollIntoViewIfNeeded()
    if (await rp.getAttribute('[data-team-showcase]', 'data-motion') !== 'off') note('reduced motion', 'team scroll effects are on')
    if (await rp.isVisible('[data-team-motion]')) note('reduced motion', 'unnecessary motion control is visible')
    if (await rp.locator('.team-example:visible').count() !== 18) note('reduced motion', 'team examples are hidden')
    const teamAnimations = await rp.$$eval('.team-example', els => els.filter(e => getComputedStyle(e).animationName !== 'none').length)
    if (teamAnimations) note('reduced motion', 'team examples still animate')
    await rm.close()

    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
    const np = await nojs.newPage()
    for (const path of ['/', '/ko/']) {
      await np.goto(base + path)
      if (await np.locator('.team-example:visible').count() !== 18) note('no JavaScript', `${path}: team examples are hidden`)
      if (await np.isVisible('[data-team-motion]')) note('no JavaScript', `${path}: inert motion control is visible`)
    }
    await nojs.close()

    // internal links
    const lk = await browser.newContext()
    const lp = await lk.newPage()
    const seen = new Set()
    for (const p of ['/', '/ko/', '/security', '/ko/security', '/guide', '/ko/guide', '/guide/first-week', '/ko/guide/first-week', '/blog', '/blog/share-claude-skills-with-your-team', '/guide/use-skills']) {
      await lp.goto(base + p, { waitUntil: 'domcontentloaded' })
      const hrefs = await lp.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')))
      const ids = await lp.$$eval('[id]', (els) => els.map((e) => e.id))
      for (const h of hrefs) {
        if (!h || h.startsWith('mailto:') || /^https?:/.test(h)) continue
        const [path, hash] = h.split('#')
        const target = path || p
        const key = `${target}#${hash ?? ''}`
        if (seen.has(key + '@' + p)) continue
        seen.add(key + '@' + p)
        const r = await lp.request.get(base + target, { maxRedirects: 5 })
        if (r.status() !== 200) note('links', `${p} -> ${h}: HTTP ${r.status()}`)
        if (hash && target === p && !ids.includes(hash)) note('links', `${p} -> #${hash}: no element with that id`)
        if (hash && target !== p) {
          const html = await r.text()
          if (!html.includes(`id="${hash}"`)) note('links', `${p} -> ${h}: no element with that id on the target`)
        }
      }
    }
    await lk.close()
  }
} finally {
  await browser.close()
  server?.kill()
}

console.log(`screenshots (${saved.length}):`)
for (const s of saved) console.log('  ' + s)
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log('\nverify: no console errors, no CSP violations, no third-party requests, no overflow at 360/768/1280 in light and dark; behaviour and links OK')
