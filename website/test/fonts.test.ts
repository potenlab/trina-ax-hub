import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dist } from './helpers'

const root = join(import.meta.dir, '..')
const core = new Set(readFileSync(join(root, 'src/assets/fonts/pretendard-core-chars.txt'), 'utf8'))

test('every Hangul syllable the copy uses is in the small Pretendard file', () => {
  const missing = new Set<string>()
  for (const dir of ['src/content', 'src/components']) {
    for (const f of readdirSync(join(root, dir))) {
      for (const ch of readFileSync(join(root, dir, f), 'utf8')) if (/[가-힣ㄱ-ㅣ]/.test(ch) && !core.has(ch)) missing.add(ch)
    }
  }
  expect([...missing].join(''), 'run scripts/build-pretendard.py again (see its header)').toBe('')
})

test('fonts are self-hosted and small: Latin Geist, Korean core file under 80 KB', () => {
  const fonts = join(root, 'src/assets/fonts')
  expect(statSync(join(fonts, 'Pretendard-ko-core.woff2')).size).toBeLessThan(80 * 1024)
  expect(statSync(join(fonts, 'Geist-Variable.woff2')).size).toBeLessThan(40 * 1024)
  expect(existsSync(join(root, 'public/fonts/OFL-Geist.txt'))).toBe(true)
  expect(existsSync(join(root, 'public/fonts/OFL-Pretendard.txt'))).toBe(true)
})

test('the built CSS names no remote font and no remote URL', () => {
  const dir = join(dist, '_astro')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
    const css = readFileSync(join(dir, f), 'utf8')
    expect(css).not.toMatch(/https?:\/\//)
    expect(css).not.toMatch(/@import/)
  }
})
