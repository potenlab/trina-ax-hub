// Renders the social cards (public/og.png English, public/og-ko.png Korean, public/blog/<slug>.png per blog post, all
// 1200x630) and the PNG icons. Run: bun run og   (only the blog cards: bun run og --blog)
// The PNGs are committed, so the site build does not need this script or its tools.
//  - Cards: scripts/og.html screenshotted by headless Chrome (CHROME_PATH, or Google Chrome / Chromium in the usual
//    places), text from src/content, then palette-compressed with Pillow through uvx (skipped if uvx is missing).
//  - Icons: from public/favicon.svg with rsvg-convert (brew install librsvg); skipped with --no-icons.
import { $ } from 'bun'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BLOG, POSTS, blogCard } from '../src/content/blog-en'
import en from '../src/content/en'
import ko from '../src/content/ko'

const root = join(import.meta.dir, '..')
const pub = join(root, 'public')

const blogOnly = process.argv.includes('--blog')
const siteCards = [
  { out: 'og.png', lang: 'en', brand: en.brand, t1: en.hero.title, t2: en.hero.accent, chip: en.hero.pill },
  { out: 'og-ko.png', lang: 'ko', brand: ko.brand, t1: ko.hero.title, t2: ko.hero.accent, chip: ko.hero.pill },
]
// A post's card: its title and "Trina AX Blog", no other marks.
const blogCards = POSTS.map((p) => ({
  out: blogCard(p.slug).slice(1), lang: 'en', brand: `${en.brand} ${BLOG.name}`, t1: p.title, t2: '', chip: '', kind: 'post', url: `ax.trina.app${BLOG.path}`,
}))
const cards: { out: string; lang: string; brand: string; t1: string; t2: string; chip: string; kind?: string; url?: string }[] =
  blogOnly ? blogCards : [...siteCards, ...blogCards]

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((c) => c && existsSync(c))
if (!chrome) throw new Error('No Chrome found: set CHROME_PATH')

const profile = join(import.meta.dir, '.og-tmp')
for (const c of cards) {
  const out = join(pub, c.out)
  mkdirSync(dirname(out), { recursive: true })
  const q = new URLSearchParams({ lang: c.lang, brand: c.brand, t1: c.t1, t2: c.t2, chip: c.chip, kind: c.kind ?? '', url: c.url ?? '' })
  const url = `file://${join(import.meta.dir, 'og.html')}?${q}`
  await $`${chrome} --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=1 --user-data-dir=${profile} --window-size=1200,630 --virtual-time-budget=3000 --screenshot=${out} ${url}`.quiet()
  console.log('wrote', c.out)
}
rmSync(profile, { recursive: true, force: true })

// 256-colour palette with dithering: far smaller than the raw screenshot, no visible banding.
const quantize = `import sys
from PIL import Image
for p in sys.argv[1:]:
    Image.open(p).convert('RGB').quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(p, optimize=True)`
if (Bun.which('uvx')) await $`uvx --with pillow python -c ${quantize} ${cards.map((c) => join(pub, c.out))}`.quiet()
else console.log('uvx not found: social cards left uncompressed')

if (!blogOnly && !process.argv.includes('--no-icons') && Bun.which('rsvg-convert')) {
  const fav = join(pub, 'favicon.svg')
  for (const s of [16, 32]) await $`rsvg-convert -w ${s} -h ${s} ${fav} -o ${join(pub, `favicon-${s}.png`)}`
  for (const s of [192, 512]) await $`rsvg-convert -w ${s} -h ${s} ${fav} -o ${join(pub, `icon-${s}.png`)}`
  // iOS rounds the corners itself, so the touch icon is drawn full-bleed.
  const square = (await Bun.file(fav).text()).replace(' rx="7.2"', '').replace('scale(.78)', 'scale(.66)')
  const tmp = join(import.meta.dir, '.touch.svg')
  await Bun.write(tmp, square)
  await $`rsvg-convert -w 180 -h 180 ${tmp} -o ${join(pub, 'apple-touch-icon.png')}`
  await $`rm ${tmp}`
  console.log('wrote favicon-16/32.png, icon-192/512.png, apple-touch-icon.png')
}
