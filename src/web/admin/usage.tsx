/** @jsxImportSource hono/jsx */
// Usage: date range presets, group by person/day/model/group/source, totals, skills and tools, CSV export.
import type { App, C } from '../../http/app'
import { usageReport, skillReport, toolReport, usageCsv, type GroupBy } from '../../usage/report'
import { audit } from '../../audit'
import { fmtNum, fmtTokens, fmtUsd, monthStart, dayStart } from '../../ui/format'
import { type Web, type Flash, Shell, Stat, Empty, render, takeFlashes } from '../kit'
import { dayLabel, nextMonthStart } from '../me'

export type RangeKey = 'month' | 'last' | '7d' | 'custom'
export interface Range { key: RangeKey; from: Date; to: Date }

const RANGES: { key: Exclude<RangeKey, 'custom'>; label: string }[] = [
  { key: 'month', label: '이번 달' }, { key: 'last', label: '지난달' }, { key: '7d', label: '최근 7일' },
]
const GROUPS: { key: GroupBy; label: string; head: string }[] = [
  { key: 'user', label: '사람별', head: '사람' }, { key: 'day', label: '날짜별', head: '날짜' }, { key: 'model', label: '모델별', head: '모델' },
  { key: 'group', label: '그룹별', head: '그룹' }, { key: 'source', label: '어디서', head: '어디서' },
]

/** 'YYYY-MM-DD' as a server-local midnight, or null */
function localDate(v: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getDate() === Number(m[3]) ? d : null
}

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** The range asked for in the query string (to is exclusive). Unknown or bad input → this month. */
export function parseRange(q: { range?: string; from?: string; to?: string }, now = new Date()): Range {
  switch (q.range) {
    case 'last': return { key: 'last', from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: monthStart(now) }
    case '7d': return { key: '7d', from: addDays(dayStart(now), -6), to: addDays(dayStart(now), 1) }
    case 'custom': {
      const from = localDate(q.from), last = localDate(q.to)
      if (from && last && from <= last && last.getTime() - from.getTime() <= 400 * 86_400_000) return { key: 'custom', from, to: addDays(last, 1) }
      break
    }
  }
  return { key: 'month', from: monthStart(now), to: nextMonthStart(now) }
}

const rangeText = (r: Range) => {
  const f = (d: Date) => `${d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '년 ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일`
  return `${f(r.from)} – ${f(addDays(r.to, -1))}`
}

const rangeQuery = (r: Range) => (r.key === 'custom' ? `range=custom&from=${ymd(r.from)}&to=${ymd(addDays(r.to, -1))}` : `range=${r.key}`)

function UsagePage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { db } = p.web.ctx
  const q = p.c.req.query()
  const r = parseRange(q)
  const by = (GROUPS.find((g) => g.key === q.by) ?? GROUPS[0]!).key
  const report = usageReport(db, { from: r.from, to: r.to, groupBy: by })
  const skills = skillReport(db, r.from, r.to)
  const tools = toolReport(db, r.from, r.to)
  const t = report.totals
  const head = GROUPS.find((g) => g.key === by)!.head
  return (
    <Shell c={p.c} title="사용량" active="/admin/usage" flashes={p.flashes}>
      <div class="head">
        <div><h1>사용량</h1><p class="lead">{rangeText(r)}</p></div>
        <a class="btn" href={`/admin/usage.csv?${rangeQuery(r)}`} download>CSV 내려받기</a>
      </div>

      <div class="range">
        {RANGES.map((x) => <a class={'btn small' + (r.key === x.key ? ' on' : '')} href={`/admin/usage?range=${x.key}&by=${by}`}>{x.label}</a>)}
      </div>
      <form method="get" action="/admin/usage" class="card" style="padding:12px 16px">
        <input type="hidden" name="range" value="custom" />
        <input type="hidden" name="by" value={by} />
        <div class="row">
          <div class="field" style="margin:0"><label for="from">시작일</label><input id="from" type="date" name="from" value={ymd(r.from)} /></div>
          <div class="field" style="margin:0"><label for="to">종료일</label><input id="to" type="date" name="to" value={ymd(addDays(r.to, -1))} /></div>
          <div><button class="btn" type="submit">기간 보기</button></div>
        </div>
      </form>

      <div class="grid">
        <Stat label="비용" value={fmtUsd(t.costUsd)} />
        <Stat label="요청" value={fmtNum(t.requests)} />
        <Stat label="입력 · 출력 토큰" value={`${fmtTokens(t.inputTokens)} · ${fmtTokens(t.outputTokens)}`} />
        <Stat label="캐시 토큰" value={fmtTokens(t.cacheTokens)} />
      </div>

      <div class="range">
        {GROUPS.map((g) => <a class={'btn small' + (by === g.key ? ' on' : '')} href={`/admin/usage?${rangeQuery(r)}&by=${g.key}`}>{g.label}</a>)}
      </div>
      {report.rows.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>{head}</th><th class="num">요청</th><th class="num hide-sm">입력</th><th class="num hide-sm">출력</th><th class="num hide-sm">캐시</th><th class="num">비용</th></tr></thead>
          <tbody>{report.rows.map((x) => (
            <tr><td>{by === 'day' ? dayLabel(x.key) : x.label}</td><td class="num">{fmtNum(x.requests)}</td>
              <td class="num hide-sm">{fmtTokens(x.inputTokens)}</td><td class="num hide-sm">{fmtTokens(x.outputTokens)}</td><td class="num hide-sm">{fmtTokens(x.cacheTokens)}</td>
              <td class="num">{fmtUsd(x.costUsd)}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title="이 기간에는 사용 기록이 없어요">다른 기간을 골라 보세요.</Empty>}
      {by === 'group' && report.rows.length ? <p class="muted small">여러 그룹에 속한 사람의 사용량은 각 그룹에 모두 더해져요. 그룹이 없는 사람은 빠져요.</p> : null}

      <div class="sec"><h2>스킬</h2><span class="muted small">Claude가 회사 스킬을 쓴 횟수</span></div>
      {skills.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>스킬</th><th class="num">횟수</th><th class="num">쓴 사람</th></tr></thead>
          <tbody>{skills.map((x) => <tr><td>{x.label}</td><td class="num">{fmtNum(x.count)}</td><td class="num">{fmtNum(x.people)}명</td></tr>)}</tbody>
        </table></div>
      ) : <Empty title="이 기간에 쓴 스킬이 없어요" />}

      <div class="sec"><h2>회사 파일 도구</h2><span class="muted small">Claude가 회사 폴더를 읽고 쓴 횟수</span></div>
      {tools.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>도구</th><th class="num">횟수</th><th class="num">쓴 사람</th></tr></thead>
          <tbody>{tools.map((x) => <tr><td><code>{x.label}</code></td><td class="num">{fmtNum(x.count)}</td><td class="num">{fmtNum(x.people)}명</td></tr>)}</tbody>
        </table></div>
      ) : <Empty title="이 기간에 쓴 도구가 없어요" />}
    </Shell>
  )
}

export function mountUsage(app: App, web: Web) {
  const { db } = web.ctx

  app.get('/admin/usage', (c) => render(c, <UsagePage web={web} c={c} flashes={takeFlashes(web, c)} />))

  app.get('/admin/usage.csv', (c) => {
    const r = parseRange(c.req.query())
    const s = c.get('session')!
    audit(db, { actor: s.user.id, action: 'usage.export', detail: { from: ymd(r.from), to: ymd(addDays(r.to, -1)) } })
    return c.body(usageCsv(db, r.from, r.to), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="trina-usage-${ymd(r.from)}_${ymd(addDays(r.to, -1))}.csv"`,
      'cache-control': 'no-store',
    })
  })
}
