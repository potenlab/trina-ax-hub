/** @jsxImportSource hono/jsx */
// Admin dashboard: this month at a glance, whether everything works (Anthropic, phone chat), who is not set up yet,
// and what is left to set up.
import type { App, C } from '../../http/app'
import type { Ctx } from '../../context'
import { listUsers } from '../../auth/users'
import { listTokens } from '../../auth/tokens'
import { usageReport, skillReport, activeDays } from '../../usage/report'
import { listBudgets } from '../../usage/budgets'
import { relayHealth, upstreamProblem, type UpstreamError } from '../../relay/health'
import { hubFor } from '../../hub/service'
import { fmtAgo, fmtDateTime, fmtKrw, fmtNum, fmtUsd, monthStart } from '../../ui/format'
import { type Web, type Flash, Shell, Stat, Empty, render, takeFlashes, PERIOD_LABEL } from '../kit'
import { BudgetMeter, budgetRatio, nextMonthStart, activeDevices } from '../me'
import { companyName, effectiveUrls, krwPerUsd } from '../settings'

const BILLING = /credit|balance|billing|payment|quota|plan/i

/** What an upstream refusal means for the admin, in plain Korean. `severe` = nothing works until someone acts. */
export function upstreamAdvice(e: UpstreamError): { title: string; advice: string; severe: boolean } {
  const refused = { title: 'Anthropic이 회사 키를 거절했어요 (잔액 부족 등).', advice: 'Anthropic 콘솔(console.anthropic.com)에서 결제·키를 확인해 주세요.', severe: true }
  if (e.status === 0) return { title: '허브가 Anthropic에 연결하지 못했어요.', advice: '허브 컴퓨터의 인터넷 연결을 확인해 주세요.', severe: true }
  if (e.status === 401) return { title: 'Anthropic이 회사 키를 받지 않아요 (키가 틀렸거나 지워졌어요).', advice: "Anthropic 콘솔에서 새 키를 만들어 '설정 › Anthropic API 키'에 넣어 주세요.", severe: true }
  if (e.status === 429) return { title: 'Anthropic 사용 한도에 걸렸어요.', advice: '보통 잠시 뒤 풀려요. 자주 생기면 Anthropic 콘솔에서 사용 한도(rate limit)를 확인해 주세요.', severe: false }
  if (e.status >= 500) return { title: 'Anthropic 쪽에 잠시 문제가 있어요 (과부하 등).', advice: '보통 잠시 뒤 풀려요. 계속되면 status.anthropic.com을 확인해 주세요.', severe: false }
  if (e.status === 400 && !BILLING.test(e.message) && !BILLING.test(e.type)) {
    return { title: 'Anthropic이 요청을 거절했어요.', advice: '한 사람의 요청 문제일 수 있어요. 계속되면 아래 내용을 관리 업체에 알려 주세요.', severe: false }
  }
  return refused
}

function UpstreamAlert(p: { e: UpstreamError; lastOkAt: string | null }) {
  const a = upstreamAdvice(p.e)
  return (
    <div class={'card alert' + (a.severe ? '' : ' warnish')} role="alert">
      <h2>{a.title}</h2>
      <p style="margin:0">{a.advice} {a.severe ? '그동안 직원들의 Claude가 답하지 못해요.' : ''}</p>
      <dl class="kv small">
        <dt>언제</dt><dd>{fmtDateTime(p.e.at)} ({fmtAgo(p.e.at)})</dd>
        <dt>응답</dt><dd>{p.e.status || '연결 안 됨'}{p.e.type ? ` · ${p.e.type}` : ''}</dd>
        {p.e.message ? <><dt>내용</dt><dd>{p.e.message}</dd></> : null}
        <dt>마지막 성공</dt><dd>{p.lastOkAt ? `${fmtDateTime(p.lastOkAt)} (${fmtAgo(p.lastOkAt)})` : '없음'}</dd>
      </dl>
      <div class="actions" style="margin-top:12px"><a class="btn small" href="/admin/settings#key">API 키 설정·연결 확인</a></div>
    </div>
  )
}

const MAX_NAMES = 12

/** Names linking to each person, "외 N명" after a dozen. */
const NameList = (p: { people: { id: string; name: string }[] }) => (
  <div class="names">
    {p.people.slice(0, MAX_NAMES).map((u) => <a class="badge" href={`/admin/users/${u.id}`}>{u.name}</a>)}
    {p.people.length > MAX_NAMES ? <span class="muted small">외 {p.people.length - MAX_NAMES}명</span> : null}
  </div>
)

const lastUsageAt = (ctx: Ctx) => (ctx.db.query('SELECT MAX(started_at) AS at FROM usage').get() as { at: string | null }).at

function Dashboard(p: { web: Web; c: C; flashes: Flash[] }) {
  const { ctx } = p.web
  const db = ctx.db
  const now = new Date()
  const from = monthStart(now), to = nextMonthStart(now)
  const report = usageReport(db, { from, to, groupBy: 'user' })
  const adoption = activeDays(db, from, to)
  const activePeople = adoption.filter((a) => a.days > 0).length
  const devices = activeDevices(listTokens(db))
  const peopleWithPc = new Set(devices.map((d) => d.user_id))
  const skills = skillReport(db, from, to).slice(0, 5)
  const hot = listBudgets(db).filter((b) => budgetRatio(b) >= 0.8).sort((a, b) => budgetRatio(b) - budgetRatio(a))
  const keyHint = ctx.secrets.apiKeyHint()
  const urls = effectiveUrls(ctx)
  const people = listUsers(db)
  const active = people.filter((u) => u.status === 'active')
  const noPc = active.filter((u) => !peopleWithPc.has(u.id))
  const usedNow = new Set(adoption.filter((a) => a.days > 0).map((a) => a.userId))
  const unused = active.filter((u) => peopleWithPc.has(u.id) && !usedNow.has(u.id))
  const health = relayHealth(db)
  const problem = upstreamProblem(health)
  const lastUse = lastUsageAt(ctx)
  const claudeReady = !!ctx.config.claudeBin
  const jobs = hubFor(ctx).stats()
  const rate = krwPerUsd(ctx)
  const todo = [
    { done: !!keyHint, label: '회사 API 키 넣기', why: '키가 있어야 직원들의 Claude가 답할 수 있어요.', href: '/admin/settings#key', go: '설정' },
    { done: !!urls.publicUrl, label: '공개 주소 정하기', why: '직원 PC를 연결하기 전에 공개 주소부터 넣어 주세요. 회사 스킬 설치와 사무실 밖 사용에 https 주소가 필요해요.', href: '/admin/settings#urls', go: '설정' },
    { done: people.length > 1, label: '직원 추가하기', why: '직원마다 계정을 만들어 주세요.', href: '/admin/users', go: '사람' },
    { done: devices.length > 0, label: '첫 PC 연결하기', why: '내 PC부터 연결해 보세요.', href: '/me', go: '내 PC' },
  ]
  const month = `${now.getMonth() + 1}월`
  return (
    <Shell c={p.c} title="대시보드" active="/admin" flashes={p.flashes}>
      <h1>대시보드</h1>
      <p class="lead">{companyName(ctx)} · {month} 사용 현황</p>

      {problem ? <UpstreamAlert e={problem} lastOkAt={health.lastOkAt} /> : null}

      {todo.some((t) => !t.done) ? (
        <div class="card oneshot">
          <h2>시작하기</h2>
          <div class="tablewrap" style="margin:0"><table>
            <tbody>{todo.map((t) => (
              <tr>
                <td style="width:1%">{t.done ? <span class="badge good">완료</span> : <span class="badge warn">할 일</span>}</td>
                <td><b>{t.label}</b>{t.done ? null : <div class="muted small">{t.why}</div>}</td>
                <td class="right">{t.done ? null : <a class="btn small" href={t.href}>{t.go}</a>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : null}

      <div class="grid">
        <Stat label={`${month} 비용`} value={fmtUsd(report.totals.costUsd)} hint={report.totals.costUsd > 0 ? fmtKrw(report.totals.costUsd, rate) : undefined} />
        <Stat label={`${month} 요청`} value={fmtNum(report.totals.requests)} />
        <Stat label="이번 달 쓴 사람" value={`${activePeople} / ${adoption.length}명`} />
        <Stat label="연결된 PC" value={`${devices.length}대`} hint={`${peopleWithPc.size}명`} />
      </div>

      <div class="health">
        <div class="card">
          <h3>회사 AI 연결</h3>
          <p>{keyHint ? <span class="badge good">API 키 있음</span> : <span class="badge bad">API 키 없음</span>}{' '}
            {problem ? <span class="badge bad">문제 있음</span> : health.lastOkAt ? <span class="badge good">잘 되고 있어요</span> : null}</p>
          <p class="small">{lastUse ? <>마지막 사용 <b>{fmtAgo(lastUse)}</b></> : <span class="muted">아직 아무도 쓰지 않았어요</span>}</p>
          <p class="small muted">공개 주소: {urls.publicUrl ?? '없음 (스킬 설치에 필요해요)'}</p>
          {keyHint ? null : <a class="btn small" href="/admin/settings#key">키 넣으러 가기</a>}
        </div>
        <div class="card">
          <h3>휴대폰 채팅·예약 작업</h3>
          {claudeReady ? (<>
            <p><span class="badge good">쓸 수 있어요</span></p>
            <p class="small">지금 실행 중 <b>{jobs.running} / {jobs.limit}</b> · 기다리는 작업 <b>{jobs.queued}</b></p>
            <p class="small muted">오늘 끝난 작업 {jobs.doneToday} · 실패 {jobs.failedToday}</p>
          </>) : (<>
            <p><span class="badge bad">꺼져 있어요</span></p>
            <p class="small">허브 컴퓨터에 Claude Code가 없어서 휴대폰 채팅과 예약 작업이 돌지 않아요. 허브 컴퓨터에 Claude Code를 설치하고 허브를 다시 시작해 주세요.</p>
          </>)}
        </div>
        <div class="card">
          <h3>아직 안 쓰는 사람</h3>
          {noPc.length || unused.length ? (<>
            {noPc.length ? <><p class="small">PC를 연결하지 않았어요 ({noPc.length}명)</p><NameList people={noPc} /></> : null}
            {unused.length ? <><p class="small" style="margin-top:10px">PC는 있지만 이번 달에 안 썼어요 ({unused.length}명)</p><NameList people={unused} /></> : null}
          </>) : <p class="small muted">모두 PC를 연결하고 이번 달에 썼어요.</p>}
        </div>
      </div>

      {hot.length ? (<>
        <div class="sec"><h2>한도에 가까운 예산</h2><a class="small" href="/admin/budgets">예산 관리</a></div>
        <div class="tablewrap"><table>
          <thead><tr><th>대상</th><th>기간</th><th>쓴 만큼</th></tr></thead>
          <tbody>{hot.map((b) => (
            <tr><td><b>{b.subjectName}</b> {budgetRatio(b) >= 1 ? <span class="badge bad">넘음</span> : <span class="badge warn">80% 넘음</span>}</td>
              <td>{PERIOD_LABEL[b.period]}</td><td><BudgetMeter b={b} /></td></tr>
          ))}</tbody>
        </table></div>
      </>) : null}

      <div class="sec"><h2>많이 쓴 사람</h2><a class="small" href="/admin/usage">사용량 자세히</a></div>
      {report.rows.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>이름</th><th class="num">요청</th><th class="num">비용</th></tr></thead>
          <tbody>{report.rows.slice(0, 5).map((r) => <tr><td>{r.label}</td><td class="num">{fmtNum(r.requests)}</td><td class="num">{fmtUsd(r.costUsd)}</td></tr>)}</tbody>
        </table></div>
      ) : <Empty title="이번 달에는 아직 사용 기록이 없어요">직원들이 PC를 연결하고 Claude를 쓰면 여기에 보여요.</Empty>}

      <div class="sec"><h2>많이 쓴 스킬</h2><a class="small" href="/admin/skills">스킬 보기</a></div>
      {skills.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>스킬</th><th class="num">횟수</th><th class="num">쓴 사람</th></tr></thead>
          <tbody>{skills.map((s) => <tr><td>{s.label}</td><td class="num">{fmtNum(s.count)}</td><td class="num">{fmtNum(s.people)}명</td></tr>)}</tbody>
        </table></div>
      ) : <Empty title="이번 달에 쓴 스킬이 아직 없어요">팀 폴더의 skills/ 에 회사 스킬을 넣어 보세요.</Empty>}
    </Shell>
  )
}

export function mountDashboard(app: App, web: Web) {
  app.get('/admin', (c) => render(c, <Dashboard web={web} c={c} flashes={takeFlashes(web, c)} />))
}
