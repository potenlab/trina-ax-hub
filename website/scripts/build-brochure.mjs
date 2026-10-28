// Reproducible from built HTML and local assets; no listening server or network fonts.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, copyFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
execFileSync('bun', ['run', 'build'], { cwd: root, stdio: 'inherit' })
const lang = process.argv[2] ?? 'ko'
if (!['en', 'ko'].includes(lang)) throw new Error('Usage: bun run brochure [en|ko]')
const origin = 'http://127.0.0.1:19900'
const output = join(root, `public/downloads/trina-ax-introduction-${lang}.pdf`)
await mkdir(dirname(output), { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' })
  const problems = []
  page.on('pageerror', e => problems.push(e.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { problems.push(`External request: ${url.origin}`); return route.abort() }
    let path = decodeURIComponent(url.pathname)
    if (!extname(path)) path += '.html'
    const file = resolve(root, 'dist', '.' + path)
    if (!file.startsWith(join(root, 'dist') + '/')) return route.abort()
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' }
    try { await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] || 'application/octet-stream' }) }
    catch { problems.push(`Missing asset: ${path}`); await route.abort() }
  })
  await page.goto(origin + (lang === 'ko' ? '/ko/brochure' : '/brochure'), { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  const count = await page.locator('.brochure-sheet').count()
  if (count !== 5) throw new Error(`Expected 5 sheets, got ${count}`)
  const overflow = await page.locator('.brochure-sheet').evaluateAll(sheets => sheets.flatMap((sheet, i) => {
    const footer = sheet.querySelector('.brochure-folio').getBoundingClientRect()
    return [...sheet.children].some(el => el !== sheet.lastElementChild && el.getBoundingClientRect().bottom > footer.top) ? [i + 1] : []
  }))
  if (overflow.length) throw new Error(`Content crosses the footer on pages ${overflow.join(', ')}`)
  if (problems.length) throw new Error(problems.join('\n'))
  await page.pdf({ path: output, format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true })
  // Keep the current build ready to preview too; the next Astro build copies public automatically.
  await mkdir(join(root, 'dist/downloads'), { recursive: true })
  await copyFile(output, join(root, `dist/downloads/trina-ax-introduction-${lang}.pdf`))
  console.log(`Generated ${output} (${count} A4 pages)`)
} finally { await browser.close() }
