// Rollup parity: budgets and reports read from usage_daily (+ raw rows for partial days) must give exactly what a
// brute-force sum over the raw rows gives, in whatever time zone the process runs (TZ). Used in-process by
// usage.test.ts and run as `TZ=<zone> bun tests/unit/usage-parity.ts` for zones with DST and odd offsets.
import { openDb } from '../../src/db'
import { spend } from '../../src/usage/budgets'
import { usageReport, activeDays, type GroupBy } from '../../src/usage/report'
import { localDay } from '../../src/usage/rollup'

/** a small deterministic random generator (the check must be repeatable) */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

export interface ParityResult { zone: string; rows: number; checks: number; mismatches: string[] }

export function parityCheck(seed = 7): ParityResult {
  const db = openDb(':memory:')
  const rand = rng(seed)
  const users = ['ua', 'ub', 'uc', 'ud']
  for (const u of users) db.query("INSERT INTO users (id, username, name, role, created_at, updated_at) VALUES (?, ?, ?, 'member', 'x', 'x')").run(u, u, u)
  db.query("UPDATE users SET status = 'disabled' WHERE id = 'ud'").run()
  db.query("INSERT INTO groups (id, name, created_at) VALUES ('g1', '영업', 'x'), ('g2', '개발', 'x')").run()
  db.query("INSERT INTO group_members (group_id, user_id) VALUES ('g1', 'ua'), ('g1', 'ub'), ('g2', 'ub'), ('g2', 'uc')").run()

  // spans around the 2026 DST changes in America / Europe / Australia, and the days around now
  const spans: [number, number][] = [
    [new Date(2026, 2, 5).getTime(), new Date(2026, 3, 10).getTime()],
    [new Date(2026, 9, 1).getTime(), new Date(2026, 10, 10).getTime()],
    [Date.now() - 40 * 86400_000, Date.now()],
  ]
  const instants: number[] = []
  for (let i = 0; i < 2500; i++) { const [a, b] = spans[i % spans.length]!; instants.push(a + rand() * (b - a)) }
  // right at and right before local midnights
  for (const [a, b] of spans) for (let t = a; t < b; t += 86400_000 * 3) { const m = new Date(t); m.setHours(0, 0, 0, 0); instants.push(m.getTime(), m.getTime() - 1) }

  interface R { user: string; source: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; at: string }
  const raw: R[] = []
  const ins = db.query('INSERT INTO usage (id, user_id, source, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, status, started_at) VALUES (?,?,?,?,?,?,?,?,?,200,?)')
  instants.forEach((t, i) => {
    const r: R = { user: users[Math.floor(rand() * users.length)]!, source: rand() < 0.2 ? 'hub' : 'pc', model: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'][Math.floor(rand() * 3)]!,
      input: Math.floor(rand() * 5000), output: Math.floor(rand() * 2000), cacheRead: Math.floor(rand() * 90000), cacheWrite: Math.floor(rand() * 3000), cost: Math.round(rand() * 1e6) / 1e6, at: new Date(t).toISOString() }
    raw.push(r)
    ins.run('r' + i, r.user, r.source, r.model, r.input, r.output, r.cacheRead, r.cacheWrite, r.cost, r.at)
  })

  const mismatches: string[] = []
  let checks = 0
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const groupsOf: Record<string, string[]> = { ua: ['g1'], ub: ['g1', 'g2'], uc: ['g2'], ud: [] }
  const ranges: [Date, Date][] = []
  for (const [a, b] of spans) {
    // whole days, a month, and arbitrary instants
    const d = new Date(a); d.setHours(0, 0, 0, 0)
    ranges.push([d, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 10)])
    ranges.push([new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 1)])
    for (let k = 0; k < 6; k++) { const x = a + rand() * (b - a), y = x + rand() * 20 * 86400_000; ranges.push([new Date(x), new Date(y)]) }
    const x = a + rand() * (b - a); ranges.push([new Date(x), new Date(x + 3600_000)]) // within one day
  }
  for (const [from, to] of ranges) {
    const inRange = raw.filter((r) => r.at >= from.toISOString() && r.at < to.toISOString())
    const key: Record<GroupBy, (r: R) => string[]> = {
      user: (r) => [r.user], day: (r) => [localDay(new Date(r.at))], model: (r) => [r.model], source: (r) => [r.source], group: (r) => groupsOf[r.user]!,
    }
    for (const by of ['user', 'day', 'model', 'source', 'group'] as GroupBy[]) {
      for (const userId of [undefined, 'ub']) {
        const want = new Map<string, { requests: number; input: number; output: number; cache: number; cost: number }>()
        for (const r of inRange) {
          if (userId && r.user !== userId) continue
          for (const k of key[by](r)) {
            const w = want.get(k) ?? { requests: 0, input: 0, output: 0, cache: 0, cost: 0 }
            w.requests++; w.input += r.input; w.output += r.output; w.cache += r.cacheRead + r.cacheWrite; w.cost += r.cost
            want.set(k, w)
          }
        }
        const got = usageReport(db, { from, to, groupBy: by, userId })
        checks++
        const label = `${by}${userId ? '/' + userId : ''} ${from.toISOString()}..${to.toISOString()}`
        if (got.rows.length !== want.size) mismatches.push(`${label}: ${got.rows.length} rows, want ${want.size}`)
        for (const row of got.rows) {
          const w = want.get(row.key)
          if (!w || w.requests !== row.requests || w.input !== row.inputTokens || w.output !== row.outputTokens || w.cache !== row.cacheTokens || !near(w.cost, row.costUsd))
            mismatches.push(`${label} ${row.key}: got ${JSON.stringify(row)} want ${JSON.stringify(w)}`)
        }
      }
    }
    for (const [t, id, members] of [['team', null, users], ['user', 'uc', ['uc']], ['group', 'g1', ['ua', 'ub']]] as const) {
      const mine = inRange.filter((r) => (members as readonly string[]).includes(r.user))
      const got = spend(db, t, id, from, to)
      checks++
      const tokens = mine.reduce((n, r) => n + r.input + r.output + r.cacheWrite, 0)
      if (got.requests !== mine.length || got.tokens !== tokens || !near(got.usd, mine.reduce((n, r) => n + r.cost, 0)))
        mismatches.push(`spend ${t} ${from.toISOString()}..${to.toISOString()}: got ${JSON.stringify(got)} want ${mine.length} req, ${tokens} tokens`)
    }
    const ad = activeDays(db, from, to)
    checks++
    for (const u of users.filter((u) => u !== 'ud')) {
      const mine = inRange.filter((r) => r.user === u)
      const days = new Set(mine.map((r) => localDay(new Date(r.at)))).size
      const lastAt = mine.map((r) => r.at).sort().at(-1) ?? null
      const g = ad.find((a) => a.userId === u)
      if (!g || g.days !== days || g.lastAt !== lastAt) mismatches.push(`activeDays ${u}: got ${JSON.stringify(g)} want ${days} ${lastAt}`)
    }
    if (ad.some((a) => a.userId === 'ud')) mismatches.push('activeDays lists a disabled person')
  }
  db.close()
  return { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, rows: raw.length, checks, mismatches: mismatches.slice(0, 20) }
}

if (import.meta.main) console.log(JSON.stringify(parityCheck()))
