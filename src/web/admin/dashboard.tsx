/** @jsxImportSource hono/jsx */
// Admin dashboard: this month at a glance and what is left to set up.
import type { App, C } from '../../http/app'
import { listUsers } from '../../auth/users'
import { listTokens } from '../../auth/tokens'
import { usageReport, skillReport, activeDays } from '../../usage/report'
import { listBudgets } from '../../usage/budgets'
import { fmtNum, fmtUsd, monthStart } from '../../ui/format'
import { type Web, type Flash, Shell, Stat, Empty, render, takeFlashes, PERIOD_LABEL } from '../kit'
import { BudgetMeter, budgetRatio, nextMonthStart, activeDevices } from '../me'
import { companyName, effectiveUrls } from '../settings'

function Dashboard(p: { web: Web; c: C; flashes: Flash[] }) {
  const { ctx } = p.web
  const db = ctx.db
  const now = new Date()
  const from = monthStart(now), to = nextMonthStart(now)
  const report = usageReport(db, { from, to, groupBy: 'user' })
  const adoption = activeDays(db, from, to)
  const activePeople = adoption.filter((a) => a.days > 0).length
  const devices = activeDevices(listTokens(db))
  const peopleWithPc = new Set(devices.map((d) => d.user_id)).size
  const skills = skillReport(db, from, to).slice(0, 5)
  const hot = listBudgets(db).filter((b) => budgetRatio(b) >= 0.8).sort((a, b) => budgetRatio(b) - budgetRatio(a))
  const keyHint = ctx.secrets.apiKeyHint()
  const urls = effectiveUrls(ctx)
  const people = listUsers(db)
  const todo = [
    { done: !!keyHint, label: '회사 API 키 넣기', why: '키가 있어야 직원들의 Claude가 답할 수 있어요.', href: '/admin/settings#key', go: '설정' },
    { done: !!urls.publicUrl, label: '공개 주소 정하기', why: '회사 스킬을 PC에 설치하고 밖에서도 쓰려면 https 주소가 필요해요.', href: '/admin/settings#urls', go: '설정' },
    { done: people.length > 1, label: '직원 추가하기', why: '직원마다 계정을 만들어 주세요.', href: '/admin/users', go: '사람' },
    { done: devices.length > 0, label: '첫 PC 연결하기', why: '내 PC부터 연결해 보세요.', href: '/me', go: '내 PC' },
  ]
  const month = `${now.getMonth() + 1}월`
  return (
    <Shell c={p.c} title="대시보드" active="/admin" flashes={p.flashes}>
      <h1>대시보드</h1>
      <p class="lead">{companyName(ctx)} · {month} 사용 현황</p>

      {todo.some((t) => !t.done) ? (
        <div class="card oneshot">
          <h2>시작하기</h2>
          <div class="tablewrap" style="margin:0"><table>
            <tbody>{todo.map((t) => (
              <tr>
                <td style="width:1%">{t.done ? <span class="badge good">완료</span> : <span class="badge warn">할 일</span>}</td>
                <td><b>{t.label}</b><div class="muted small">{t.why}</div></td>
                <td class="right">{t.done ? null : <a class="btn small" href={t.href}>{t.go}</a>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : null}

      <div class="grid">
        <Stat label={`${month} 비용`} value={fmtUsd(report.totals.costUsd)} />
        <Stat label={`${month} 요청`} value={fmtNum(report.totals.requests)} />
        <Stat label="이번 달 쓴 사람" value={`${activePeople} / ${adoption.length}명`} />
        <Stat label="연결된 PC" value={`${devices.length}대`} hint={`${peopleWithPc}명`} />
      </div>
      <div class="grid">
        <Stat label="회사 API 키" value={keyHint ? <span class="badge good">설정됨</span> : <span class="badge bad">없음</span>} hint={keyHint ?? <a href="/admin/settings#key">넣으러 가기</a>} />
        <Stat label="공개 주소" value={urls.publicUrl ? <span class="badge good">설정됨</span> : <span class="badge warn">없음</span>} hint={urls.publicUrl ?? '스킬 설치에 필요해요'} />
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
