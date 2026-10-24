/** @jsxImportSource hono/jsx */
// The personal page: connect a PC (enroll code + install command), my PCs, my usage this month, my budgets, my skills.
import type { App, C } from '../http/app'
import { listTokens, revokeToken, type TokenRow } from '../auth/tokens'
import { makeEnrollCode } from '../auth/enroll'
import { getUser } from '../auth/users'
import { audit } from '../audit'
import { usageReport, type UsageRow } from '../usage/report'
import { checkBudgets, type Budget } from '../usage/budgets'
import { skillsFor, type Skill } from '../skills/catalog'
import { fmtAgo, fmtDate, fmtNum, fmtTokens, fmtUsd, monthStart } from '../ui/format'
import { Csrf } from '../ui/layout'
import { type Web, type Flash, Shell, Stat, Empty, Bar, ButtonForm, EnrollResult, render, takeFlashes, act, say, PERIOD_LABEL } from './kit'
import { effectiveUrls } from './settings'

export const nextMonthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 1)

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
/** 'YYYY-MM-DD' (server-local day) → '10월 3일 (금)' */
export function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  if (!y || !m || !d) return key
  return `${m}월 ${d}일 (${WEEKDAY[new Date(y, m - 1, d).getDay()]})`
}

/** Devices (PC tokens) still connected */
export const activeDevices = (rows: TokenRow[]) => rows.filter((t) => !t.revoked_at)

/** Used / limit with a bar for each limit a budget has. */
export function BudgetMeter(p: { b: Budget }) {
  const { b } = p
  return (
    <div class="meter">
      {b.limitUsd > 0 ? (<>
        <Bar ratio={b.usedUsd / b.limitUsd} />
        <span class="small">{fmtUsd(b.usedUsd)} / {fmtUsd(b.limitUsd)}</span>
      </>) : null}
      {b.limitTokens !== null ? (<>
        <Bar ratio={b.usedTokens / b.limitTokens} />
        <span class="small">{fmtTokens(b.usedTokens)} / {fmtTokens(b.limitTokens)} 토큰</span>
      </>) : null}
    </div>
  )
}

export const budgetRatio = (b: Budget) => Math.max(b.limitUsd > 0 ? b.usedUsd / b.limitUsd : 0, b.limitTokens ? b.usedTokens / b.limitTokens : 0)

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * This month's usage per day: one small column per day of the month (cost, or requests when nothing cost money),
 * hover/focus shows the day's numbers, and the same numbers as a table one tap away.
 */
export function DayChart(p: { rows: UsageRow[]; now?: Date }) {
  const now = p.now ?? new Date()
  const byCost = p.rows.some((r) => r.costUsd > 0)
  const value = (r: UsageRow) => (byCost ? r.costUsd : r.requests)
  const byDay = new Map(p.rows.map((r) => [r.key, r]))
  const max = Math.max(...p.rows.map(value), 0)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const days = Array.from({ length: last }, (_, i) => new Date(now.getFullYear(), now.getMonth(), i + 1))
  return (
    <div class="card">
      <p class="muted small" style="margin:0">{byCost ? '하루 비용' : '하루 요청 수'} · 막대를 누르면 그날 숫자가 보여요</p>
      <div class="daychart" role="img" aria-label={`${now.getMonth() + 1}월 날짜별 ${byCost ? '비용' : '요청'}`}>
        {days.map((d) => {
          const key = dayKey(d)
          const r = byDay.get(key)
          const future = d > now
          const tip = r ? `${fmtUsd(r.costUsd)} · ${fmtNum(r.requests)}회 — ${dayLabel(key)}` : `${future ? '' : '사용 없음 — '}${dayLabel(key)}`
          const pct = r && max > 0 ? Math.max(3, Math.round((value(r) / max) * 100)) : 0
          return (
            <div class={'d' + (future ? ' future' : '')} tabindex={future ? undefined : 0} data-tip={tip} aria-label={tip}>
              {pct ? <i style={`height:${pct}%`} /> : null}
            </div>
          )
        })}
      </div>
      <div class="daxis"><span>1일</span><span>{Math.ceil(last / 2)}일</span><span>{last}일</span></div>
      <details style="margin-top:12px">
        <summary class="small">날짜별 표로 보기</summary>
        <div class="tablewrap" style="margin:8px 0 0"><table>
          <thead><tr><th>날짜</th><th class="num">요청</th><th class="num">비용</th></tr></thead>
          <tbody>{[...p.rows].reverse().map((r) => (
            <tr><td>{dayLabel(r.key)}</td><td class="num">{fmtNum(r.requests)}</td><td class="num">{fmtUsd(r.costUsd)}</td></tr>
          ))}</tbody>
        </table></div>
      </details>
    </div>
  )
}

/** Skills grouped by pack */
export function SkillList(p: { skills: Skill[] }) {
  const packs = new Map<string, Skill[]>()
  for (const s of p.skills) packs.set(s.pack, [...(packs.get(s.pack) ?? []), s])
  return (
    <div class="card">
      {[...packs].map(([pack, xs]) => (<>
        <h3>{pack} <span class="muted small">{xs.length}개</span></h3>
        <div class="tablewrap" style="margin:0"><table>
          <tbody>{xs.map((s) => <tr><td style="width:30%"><b>{s.name}</b></td><td class="muted">{s.description}</td></tr>)}</tbody>
        </table></div>
      </>))}
    </div>
  )
}

export function DeviceTable(p: { devices: TokenRow[]; csrf: string; revokeBase: string; showRevoked?: boolean }) {
  return (
    <div class="tablewrap"><table>
      <thead><tr><th>PC 이름</th><th class="hide-sm">연결한 날</th><th>마지막 사용</th><th></th></tr></thead>
      <tbody>{p.devices.map((t) => (
        <tr>
          <td><b>{t.name}</b>{t.revoked_at ? <> <span class="badge bad">끊김</span></> : null}</td>
          <td class="hide-sm">{fmtDate(t.created_at)}</td>
          <td>{t.revoked_at ? <span class="muted">{fmtDate(t.revoked_at)}에 끊음</span> : t.last_used_at ? fmtAgo(t.last_used_at) : <span class="muted">아직 안 씀</span>}</td>
          <td class="right">{t.revoked_at ? null : <ButtonForm action={`${p.revokeBase}/${t.id}/revoke`} csrf={p.csrf} label="연결 끊기" danger
            confirm={`'${t.name}' 연결을 끊을까요? 그 PC의 Claude는 더 이상 회사 파일과 AI를 쓸 수 없어요.`} />}</td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}

function MePage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { ctx } = p.web
  const s = p.c.get('session')!
  const me = getUser(ctx.db, s.user.id)!
  const devices = activeDevices(listTokens(ctx.db, me.id))
  const now = new Date()
  const usage = usageReport(ctx.db, { from: monthStart(now), to: nextMonthStart(now), groupBy: 'day', userId: me.id })
  const budgets = checkBudgets(ctx.db, me.id, now)
  const skills = skillsFor(ctx.fx.root, ctx.rules(), s.user)
  const enroll = p.flashes.find((f): f is Extract<Flash, { kind: 'enroll' }> => f.kind === 'enroll' && f.userId === me.id)
  const urls = effectiveUrls(ctx)
  const tokens = usage.totals.inputTokens + usage.totals.outputTokens + usage.totals.cacheTokens
  return (
    <Shell c={p.c} title="내 PC" active="/me" flashes={p.flashes}>
      <div class="head">
        <div><h1>{me.name}님의 페이지</h1><p class="lead">내 PC를 회사 AI에 연결하고, 내 사용량과 스킬을 봐요.</p></div>
        <a class="btn small" href="/me/password">비밀번호 바꾸기</a>
      </div>

      <section id="connect">
        {enroll ? <EnrollResult c={p.c} ctx={ctx} code={enroll.code} expiresAt={enroll.expiresAt} /> : (
          <div class={'card' + (devices.length ? '' : ' oneshot')}>
            <h2>PC 연결하기</h2>
            <p>버튼을 누르면 연결 코드와 명령어 한 줄이 나와요. 그 명령을 내 PC의 터미널에 붙여 넣으면 Claude Code가 회사 파일·스킬·AI 예산과 연결돼요.</p>
            {urls.publicUrl ? null : <p class="muted small">아직 공개 주소가 없어서 회사 스킬은 설치되지 않을 수 있어요. 파일과 AI 사용은 돼요.</p>}
            <form method="post" action="/me/enroll"><Csrf token={s.csrf} /><button class="btn primary" type="submit">PC 연결 코드 만들기</button></form>
          </div>
        )}
      </section>

      <div class="sec"><h2>내 PC</h2><span class="muted small">{devices.length ? `${devices.length}대 연결됨` : ''}</span></div>
      {devices.length
        ? <DeviceTable devices={devices} csrf={s.csrf} revokeBase="/me/devices" />
        : <Empty title="아직 연결된 PC가 없어요">위의 'PC 연결 코드 만들기'를 눌러 시작해요. PC마다 한 번씩 하면 돼요.</Empty>}

      <div class="sec"><h2>이번 달 내 사용량</h2></div>
      <div class="grid">
        <Stat label="비용" value={fmtUsd(usage.totals.costUsd)} />
        <Stat label="요청" value={fmtNum(usage.totals.requests)} />
        <Stat label="토큰" value={fmtTokens(tokens)} />
      </div>
      {usage.rows.length ? <DayChart rows={usage.rows} now={now} /> : <Empty title="이번 달에는 아직 쓴 기록이 없어요">PC를 연결하고 Claude에게 일을 맡기면 여기에 쌓여요.</Empty>}

      {budgets.length ? (<>
        <div class="sec"><h2>내게 적용되는 예산</h2></div>
        <div class="tablewrap"><table>
          <thead><tr><th>예산</th><th>기간</th><th>쓴 만큼</th><th class="hide-sm">넘으면</th></tr></thead>
          <tbody>{budgets.map(({ budget: b, exceeded }) => (
            <tr><td><b>{b.subjectName}</b>{exceeded ? <> <span class={'badge ' + (b.action === 'block' ? 'bad' : 'warn')}>{b.action === 'block' ? '다 씀' : '넘음'}</span></> : null}</td>
              <td>{PERIOD_LABEL[b.period]}</td><td><BudgetMeter b={b} /></td>
              <td class="hide-sm">{b.action === 'block' ? '멈춤' : '알림만'}</td></tr>
          ))}</tbody>
        </table></div>
      </>) : null}

      <div class="sec"><h2>내 스킬</h2><span class="muted small">{skills.length ? `${skills.length}개 · PC의 Claude에 'company' 플러그인으로 설치돼요` : ''}</span></div>
      {skills.length ? <SkillList skills={skills} /> : <Empty title="아직 쓸 수 있는 스킬이 없어요">관리자가 팀 폴더의 skills/ 에 스킬을 넣으면 여기에 보여요.</Empty>}

      <div class="card" style="margin-top:28px">
        <h2>휴대폰에서도 써요</h2>
        <p>PC가 꺼져 있어도 휴대폰으로 회사 AI에게 일을 맡길 수 있어요. 이 주소를 휴대폰에서 열어 로그인하세요.</p>
        <a class="btn" href="/app">휴대폰 채팅 열기</a>
      </div>
    </Shell>
  )
}

export function mountMe(app: App, web: Web) {
  const { ctx } = web

  app.get('/me', (c) => render(c, <MePage web={web} c={c} flashes={takeFlashes(web, c)} />))

  app.post('/me/enroll', (c) => act(web, c, '/me#connect', (_f, s) => {
    const { code, expiresAt } = makeEnrollCode(ctx.db, s.user.id, s.user.id)
    audit(ctx.db, { actor: s.user.id, action: 'enroll.create', target: s.user.id })
    web.flash.push(s.idHash, { kind: 'enroll', code, expiresAt, userId: s.user.id, who: s.user.name })
  }))

  app.post('/me/devices/:id/revoke', (c) => act(web, c, '/me', (_f, s) => {
    const id = c.req.param('id')
    const name = listTokens(ctx.db, s.user.id).find((t) => t.id === id)?.name
    if (!name || !revokeToken(ctx.db, id, s.user.id)) return say(web, s, 'bad', '이미 끊었거나 없는 PC예요.')
    audit(ctx.db, { actor: s.user.id, action: 'device.revoke', target: s.user.id, detail: { device: name } })
    say(web, s, 'ok', `'${name}' 연결을 끊었어요.`)
  }))
}
