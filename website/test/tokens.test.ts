import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, '../src/styles/tokens.css'), 'utf8')

/** The declarations inside the block that starts with this selector. */
function block(selector: string): string {
  const i = css.indexOf(selector + ' {')
  expect(i, `${selector} not found`).toBeGreaterThan(-1)
  const open = css.indexOf('{', i)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close).replace(/\s+/g, ' ').trim()
}

test('the three dark blocks (system, toggle, always-dark sections) are identical', () => {
  const system = block(':root:not([data-theme="light"])')
  const toggle = block(':root[data-theme="dark"]')
  const zone = block('.zone-dark').split(' --cta:')[0] // the zone also redefines the call-to-action variables
  expect(system.length).toBeGreaterThan(500)
  expect(toggle).toBe(system)
  expect(zone).toBe(system)
})

test('every colour variable of the light theme has a dark value', () => {
  const names = (b: string) => new Set([...b.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]))
  const light = names(block(':root'))
  const dark = names(block(':root[data-theme="dark"]'))
  // layout and type variables only exist in the light block
  const layout = new Set(['--radius', '--radius-lg', '--radius-sm', '--max', '--gutter', '--font-sans', '--font-sans-ko', '--font-mono', '--cta', '--cta-fg', '--cta-hover'])
  for (const n of light) if (!layout.has(n)) expect(dark.has(n), `${n} has no dark value`).toBe(true)
})
