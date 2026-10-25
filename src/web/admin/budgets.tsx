/** @jsxImportSource hono/jsx */
// Budgets: per company / group / person, per day or month, in dollars and/or tokens, block or warn.
import type { App, C } from '../../http/app'
import { listBudgets, createBudget, deleteBudget, type SubjectType, type Period } from '../../usage/budgets'
import { listGroups, listUsers } from '../../auth/users'
import { audit } from '../../audit'
import { fmtTokens, fmtUsd } from '../../ui/format'
import { Csrf } from '../../ui/layout'
import { type Web, type Flash, Shell, Empty, ButtonForm, render, takeFlashes, act, say, fail, field, PERIOD_LABEL } from '../kit'
import { BudgetMeter, budgetRatio } from '../me'

const SUBJECT_KIND: Record<SubjectType, string> = { team: '회사 전체', group: '그룹', user: '사람' }

/** '' → null, else a non-negative number (commas allowed) */
function amount(v: string, what: string): number | null {
  const t = v.replace(/[,\s$]/g, '')
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) fail(`${what}는 0 이상의 숫자로 적어 주세요.`)
  return n
}

function BudgetsPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { db } = p.web.ctx
  const s = p.c.get('session')!
  const budgets = listBudgets(db)
  const groups = listGroups(db)
  const people = listUsers(db).filter((u) => u.status === 'active')
  return (
    <Shell c={p.c} title="예산" active="/admin/budgets" flashes={p.flashes}>
      <h1>예산</h1>
      <p class="lead">AI 사용 한도를 정해요. 넘으면 멈추거나(막기), 막지 않고 표시만 해요(표시만). 하루 한도는 매일 0시, 한 달 한도는 매달 1일에 다시 시작해요.</p>

      {budgets.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>대상</th><th>기간</th><th>쓴 만큼 / 한도</th><th class="hide-sm">넘으면</th><th></th></tr></thead>
          <tbody>{budgets.map((b) => (
            <tr>
              <td><b>{b.subjectName}</b>{b.subjectType === 'team' ? null : <div class="muted small">{SUBJECT_KIND[b.subjectType]}</div>}</td>
              <td>{PERIOD_LABEL[b.period]}</td>
              <td><BudgetMeter b={b} />{budgetRatio(b) >= 1 ? <span class="badge bad">넘음</span> : budgetRatio(b) >= 0.8 ? <span class="badge warn">80% 넘음</span> : null}</td>
              <td class="hide-sm">{b.action === 'block' ? <span class="badge bad">막기</span> : <span class="badge warn">표시만</span>}</td>
              <td class="right"><ButtonForm action={`/admin/budgets/${b.id}/delete`} csrf={s.csrf} label="지우기" danger
                confirm={`${b.subjectName}의 ${PERIOD_LABEL[b.period]} 예산을 지울까요?`} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title="아직 예산이 없어요">한도가 없으면 누구나 제한 없이 쓸 수 있어요. 먼저 회사 전체 한 달 예산부터 정해 보세요.</Empty>}

      <form method="post" action="/admin/budgets" class="card" id="add">
        <h2>예산 추가</h2>
        <Csrf token={s.csrf} />
        <div class="row">
          <div class="field"><label for="subject">대상</label>
            <select id="subject" name="subject">
              <option value="team">회사 전체</option>
              {groups.length ? <optgroup label="그룹">{groups.map((g) => <option value={`group:${g.id}`}>{g.name}</option>)}</optgroup> : null}
              <optgroup label="사람">{people.map((u) => <option value={`user:${u.id}`}>{u.name} ({u.username})</option>)}</optgroup>
            </select></div>
          <div class="field" style="max-width:140px"><label for="period">기간</label>
            <select id="period" name="period"><option value="month">한 달</option><option value="day">하루</option></select></div>
          <div class="field" style="max-width:190px"><label for="action">넘으면</label>
            <select id="action" name="action"><option value="block">막기 (Claude를 멈춰요)</option><option value="warn">표시만 (막지 않아요)</option></select></div>
        </div>
        <div class="row">
          <div class="field"><label for="usd">달러 한도 (USD)</label><input id="usd" name="usd" inputmode="decimal" placeholder="예: 50" /></div>
          <div class="field"><label for="tokens">토큰 한도 (선택)</label><input id="tokens" name="tokens" inputmode="numeric" placeholder="예: 5000000" /></div>
        </div>
        <p class="muted small">둘 중 하나는 적어 주세요. 둘 다 적으면 먼저 닿는 쪽이 한도예요. 그룹 예산은 그룹 사람들이 쓴 합계로 계산해요.</p>
        <p class="muted small">토큰은 입력 + 출력 + 캐시 저장 토큰을 더해 세요. 캐시에서 다시 읽은 토큰은 세지 않아요(값이 아주 싸서요). 보통은 달러 한도만 정하면 충분해요.</p>
        <button class="btn primary" type="submit">추가하기</button>
      </form>
    </Shell>
  )
}

export function mountBudgets(app: App, web: Web) {
  const { db } = web.ctx

  app.get('/admin/budgets', (c) => render(c, <BudgetsPage web={web} c={c} flashes={takeFlashes(web, c)} />))

  app.post('/admin/budgets', (c) => act(web, c, '/admin/budgets#add', (f, s) => {
    const subj = field(f, 'subject')
    const m = /^(group|user):(.+)$/.exec(subj)
    const subjectType: SubjectType = subj === 'team' ? 'team' : m ? (m[1] as SubjectType) : fail('대상을 골라 주세요.')
    const subjectId = subjectType === 'team' ? null : m![2]!
    const period = field(f, 'period') as Period
    if (period !== 'day' && period !== 'month') fail('기간을 골라 주세요.')
    const action = field(f, 'action') === 'warn' ? 'warn' : 'block'
    const usd = amount(field(f, 'usd'), '달러 한도')
    const tokens = amount(field(f, 'tokens'), '토큰 한도')
    const b = createBudget(db, { subjectType, subjectId, period, action, limitUsd: usd ?? 0, limitTokens: tokens === null || tokens === 0 ? null : Math.round(tokens) })
    audit(db, { actor: s.user.id, action: 'budget.create', target: b.id, detail: { subject: b.subjectName, period, limitUsd: b.limitUsd, limitTokens: b.limitTokens, action } })
    const what = [b.limitUsd > 0 ? fmtUsd(b.limitUsd) : '', b.limitTokens ? `${fmtTokens(b.limitTokens)} 토큰` : ''].filter(Boolean).join(' · ')
    say(web, s, 'ok', `${b.subjectName} ${PERIOD_LABEL[period]} 예산을 만들었어요 (${what}).`)
  }))

  app.post('/admin/budgets/:id/delete', (c) => act(web, c, '/admin/budgets', (_f, s) => {
    const id = c.req.param('id')
    const b = listBudgets(db).find((x) => x.id === id)
    if (!b) return say(web, s, 'bad', '이미 지운 예산이에요.')
    deleteBudget(db, id)
    audit(db, { actor: s.user.id, action: 'budget.delete', target: id, detail: { subject: b.subjectName, period: b.period } })
    say(web, s, 'ok', '예산을 지웠어요.')
  }))
}
