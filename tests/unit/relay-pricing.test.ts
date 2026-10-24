import { afterAll, describe, expect, test } from 'bun:test'
import { PriceTable, priceTable, tokenCounts, costOf, DEFAULT_PRICES, WEB_SEARCH_USD } from '../../src/relay/pricing'
import { setSetting } from '../../src/db'
import { testHub, type TestHub } from '../lib/hub'

const table = new PriceTable()
const M = 1_000_000
/** one million of each kind, so the cost is the sum of the five rates */
const million = { input_tokens: M, output_tokens: M, cache_read_input_tokens: M, cache_creation_input_tokens: 2 * M,
  cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: M } }
const sum = (input: number, output: number, w5: number, w1: number, read: number) => input + output + w5 + w1 + read

describe('pricing', () => {
  test('each family at its list price (input, output, 5m write, 1h write, read)', () => {
    const cases: [string, number][] = [
      ['claude-fable-5-1', sum(10, 50, 12.5, 20, 0.25)],
      ['claude-mythos-5-1', sum(10, 50, 12.5, 20, 0.25)],
      ['claude-fable-5', sum(10, 50, 12.5, 20, 1)],
      ['claude-mythos-5', sum(10, 50, 12.5, 20, 1)],
      ['claude-opus-5-5', sum(4, 20, 5, 8, 0.2)],
      ['claude-opus-5', sum(5, 25, 6.25, 10, 0.5)],
      ['claude-opus-4-8', sum(5, 25, 6.25, 10, 0.5)],
      ['claude-opus-4-7', sum(5, 25, 6.25, 10, 0.5)],
      ['claude-opus-4-6', sum(5, 25, 6.25, 10, 0.5)],
      ['claude-opus-4-5-20251101', sum(5, 25, 6.25, 10, 0.5)],
      ['claude-opus-4-1-20250805', sum(15, 75, 18.75, 30, 1.5)],
      ['claude-opus-4-20250514', sum(15, 75, 18.75, 30, 1.5)],
      ['claude-sonnet-5-5', sum(2, 10, 2.5, 4, 0.1)],
      ['claude-sonnet-5', sum(2, 10, 2.5, 4, 0.2)],
      ['claude-sonnet-4-6', sum(3, 15, 3.75, 6, 0.3)],
      ['claude-sonnet-4-5-20250929', sum(3, 15, 3.75, 6, 0.3)],
      ['claude-sonnet-4-20250514', sum(3, 15, 3.75, 6, 0.3)],
      ['claude-haiku-4-5-20251001', sum(1, 5, 1.25, 2, 0.1)],
      ['claude-haiku-4-5', sum(1, 5, 1.25, 2, 0.1)],
    ]
    for (const [model, usd] of cases) expect([model, table.costUsd(model, million)]).toEqual([model, expect.closeTo(usd, 9) as any])
  })

  test('Haiku 5.5: cheap up to 100,000 prompt tokens (cache reads and writes count), dearer above', () => {
    const at = (input: number, read = 0, write = 0) => table.costUsd('claude-haiku-5-5', { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: 1000 })
    expect(at(100_000)).toBeCloseTo((100_000 * 0.1 + 1000 * 0.5) / M, 12)
    expect(at(100_001)).toBeCloseTo((100_001 * 0.5 + 1000 * 2.5) / M, 12)
    // 20k fresh + 70k read + 10k written = 100k: still the low tier; one more cached token tips it over
    expect(at(20_000, 70_000, 10_000)).toBeCloseTo((20_000 * 0.1 + 70_000 * 0.01 + 10_000 * 0.125 + 1000 * 0.5) / M, 12)
    expect(at(20_000, 70_001, 10_000)).toBeCloseTo((20_000 * 0.5 + 70_001 * 0.05 + 10_000 * 0.625 + 1000 * 2.5) / M, 12)
    expect(table.costUsd('claude-haiku-5-5', million)).toBeCloseTo(sum(0.5, 2.5, 0.625, 1, 0.05), 9)
  })

  test('cache writes: the 5m/1h breakdown when present, else all 5-minute', () => {
    expect(tokenCounts({ cache_creation_input_tokens: 3000 })).toMatchObject({ cacheWrite5m: 3000, cacheWrite1h: 0 })
    expect(tokenCounts({ cache_creation_input_tokens: 3000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 } }))
      .toMatchObject({ cacheWrite5m: 1000, cacheWrite1h: 2000 })
    // a breakdown that explains only part of the total: the rest is priced as 5-minute writes
    expect(tokenCounts({ cache_creation_input_tokens: 3000, cache_creation: { ephemeral_1h_input_tokens: 500 } })).toMatchObject({ cacheWrite5m: 2500, cacheWrite1h: 500 })
    // breakdown without the total
    expect(tokenCounts({ cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 } })).toMatchObject({ cacheWrite5m: 10, cacheWrite1h: 20 })
    // nulls and junk count as zero
    expect(tokenCounts({ input_tokens: null, output_tokens: -5, cache_creation: null })).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearches: 0 })
    const oneHour = table.costUsd('claude-opus-5-5', { cache_creation_input_tokens: M, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: M } })
    expect(oneHour).toBeCloseTo(8, 9)
    expect(table.costUsd('claude-opus-5-5', { cache_creation_input_tokens: M })).toBeCloseTo(5, 9)
  })

  test('unknown models are priced as the most expensive entry', () => {
    const dearest = DEFAULT_PRICES.reduce((a, b) => (b.output > a.output ? b : a))
    for (const model of ['claude-opus-9', 'claude-3-5-haiku-20241022', 'claude-sonnet-5-5-preview', 'claude-x']) {
      expect(table.entryFor(model)).toBe(dearest)
    }
    expect(table.costUsd('claude-new-model', { input_tokens: M, output_tokens: M })).toBeCloseTo(15 + 75, 9)
  })

  test('fast mode doubles, US-only inference adds 10%, web searches cost $10 per 1,000', () => {
    const base = { input_tokens: M, output_tokens: M }
    expect(table.costUsd('claude-opus-5-5', { ...base, speed: 'fast' })).toBeCloseTo(8 + 40, 9)
    expect(table.costUsd('claude-opus-5', { ...base, speed: 'fast' })).toBeCloseTo(10 + 50, 9)
    expect(table.costUsd('claude-opus-5-5', { ...base, speed: 'standard' })).toBeCloseTo(4 + 20, 9)
    expect(table.costUsd('claude-sonnet-5-5', { ...base, inference_geo: 'us' })).toBeCloseTo((2 + 10) * 1.1, 9)
    expect(table.costUsd('claude-sonnet-5-5', { ...base, inference_geo: 'global' })).toBeCloseTo(2 + 10, 9)
    expect(table.costUsd('claude-sonnet-5-5', { server_tool_use: { web_search_requests: 3 } })).toBeCloseTo(3 * WEB_SEARCH_USD, 12)
  })

  test('overrides come first; invalid ones are ignored; the dearest still covers unknown models', () => {
    const t = new PriceTable([
      { match: '^claude-sonnet-5-5$', input: 1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 },
      { match: '([', input: 1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 },          // bad regex
      { match: '^claude-opus-5-5$', input: -1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 }, // negative
      { match: '^claude-haiku-5-5$', input: 1 },                                                             // incomplete
      'nonsense',
      { match: '^claude-pricey$', input: 100, output: 500, cacheWrite5m: 125, cacheWrite1h: 200, cacheRead: 10 },
    ])
    expect(t.costUsd('claude-sonnet-5-5', million)).toBeCloseTo(5, 9)
    expect(t.costUsd('claude-opus-5-5', million)).toBeCloseTo(sum(4, 20, 5, 8, 0.2), 9)
    expect(t.costUsd('claude-haiku-5-5', { input_tokens: M })).toBeCloseTo(0.5, 9) // default, long-prompt tier
    expect(t.entryFor('claude-unknown').match).toBe('^claude-pricey$')
    expect(new PriceTable({ not: 'an array' }).costUsd('claude-sonnet-5-5', million)).toBeCloseTo(sum(2, 10, 2.5, 4, 0.1), 9)
  })

  test('an override can carry its own long-prompt tier', () => {
    const t = new PriceTable([{ match: '^claude-tiered$', input: 1, output: 2, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, longPrompt: { above: 10, input: 3, output: 4, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 } }])
    expect(t.costUsd('claude-tiered', { input_tokens: 10, output_tokens: 1 })).toBeCloseTo((10 * 1 + 2) / M, 15)
    expect(t.costUsd('claude-tiered', { input_tokens: 11, output_tokens: 1 })).toBeCloseTo((11 * 3 + 4) / M, 15)
  })

  test('costOf matches the table', () => {
    expect(costOf(table.entryFor('claude-opus-5-5'), million)).toBe(table.costUsd('claude-opus-5-5', million))
  })
})

describe('pricing setting', async () => {
  const hub: TestHub = await testHub()
  afterAll(async () => { await hub.stop() })

  test('priceTable reads the `pricing` setting each time', () => {
    expect(priceTable(hub.ctx.db).costUsd('claude-sonnet-5-5', { input_tokens: M })).toBeCloseTo(2, 9)
    setSetting(hub.ctx.db, 'pricing', [{ match: 'sonnet', input: 1.5, output: 7.5, cacheWrite5m: 1.875, cacheWrite1h: 3, cacheRead: 0.15 }])
    expect(priceTable(hub.ctx.db).costUsd('claude-sonnet-5-5', { input_tokens: M })).toBeCloseTo(1.5, 9)
    setSetting(hub.ctx.db, 'pricing', 'garbage')
    expect(priceTable(hub.ctx.db).costUsd('claude-sonnet-5-5', { input_tokens: M })).toBeCloseTo(2, 9)
  })
})
