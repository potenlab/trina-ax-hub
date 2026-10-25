/** @jsxImportSource hono/jsx */
// The personal page: connect a PC (enroll code + install command), my PCs, my usage this month, my budgets, my skills.
import type { App, C } from '../http/app'
import type { Database } from 'bun:sqlite'
import { approveToken, listTokens, revokeToken, type TokenRow } from '../auth/tokens'
import { makeEnrollCode } from '../auth/enroll'
import { getUser, listUsers } from '../auth/users'
import { audit } from '../audit'
import { usageReport, type UsageRow } from '../usage/report'
import { checkBudgets, type Budget } from '../usage/budgets'
import { skillsFor, type Skill } from '../skills/catalog'
import { fmtAgo, fmtDate, fmtDateTime, fmtKrw, fmtNum, fmtTokens, fmtUsd, monthStart } from '../ui/format'
import { Csrf, CopyBlock } from '../ui/layout'
import { modelAccessFor, MODEL_ACCESS_LABEL } from '../auth/access-mode'
import { listConnectors, revokeConnectors } from '../oauth/routes'
import { type Web, type Flash, Shell, Stat, Empty, Bar, ButtonForm, EnrollResult, render, takeFlashes, act, say, requestOrigin, byName, PERIOD_LABEL } from './kit'
import { configuredHubUrl, effectiveUrls, krwPerUsd, needsReconnect } from './settings'

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

export interface DeviceView {
  /** the person these devices belong to */
  personId: string
  /** names of the people who made enroll codes (created_by) */
  names: Map<string, string>
  /** the address PCs get now (configuredHubUrl), to mark PCs set up with an older one */
  currentHub: string | null
}

/** Who set the PC up when it was not the person ("관리자 김대표님이"), else null. */
export function setupBy(t: TokenRow, v: Pick<DeviceView, 'personId' | 'names'>): string | null {
  if (!t.created_by || t.created_by === t.user_id || t.created_by === v.personId) return null
  const n = v.names.get(t.created_by)
  return n ? `관리자 ${byName(n)}` : '관리자가'
}

export const unapproved = (t: TokenRow) => !t.revoked_at && !t.approved_at

export function DeviceTable(p: { devices: TokenRow[]; csrf: string; revokeBase: string; view: DeviceView }) {
  return (
    <div class="tablewrap"><table>
      <thead><tr><th>PC 이름</th><th class="hide-sm">연결한 날</th><th class="nowrap">마지막 사용</th><th></th></tr></thead>
      <tbody>{p.devices.map((t) => {
        const by = setupBy(t, p.view)
        const stale = !t.revoked_at && needsReconnect(t.hub_url, p.view.currentHub)
        return (
          <tr>
            <td>
              <div class="devname"><b>{t.name}</b>
                {t.revoked_at ? <span class="badge bad">끊김</span> : null}
                {unapproved(t) ? <span class="badge warn">본인 승인 전</span> : null}
                {stale ? <span class="badge warn">다시 연결 필요</span> : null}
              </div>
              {by ? <div class="devnote">{by} 연결함</div> : null}
              {stale ? <div class="devnote">예전 주소 {t.hub_url}로 연결돼 있어요</div> : null}
            </td>
            <td class="hide-sm">{fmtDate(t.created_at)}</td>
            <td class="nowrap">{t.revoked_at ? <span class="muted">{fmtDate(t.revoked_at)}에 끊음</span> : t.last_used_at ? fmtAgo(t.last_used_at) : <span class="muted">아직 안 씀</span>}</td>
            <td class="right">{t.revoked_at ? null : <ButtonForm action={`${p.revokeBase}/${t.id}/revoke`} csrf={p.csrf} label="연결 끊기" danger
              confirm={`'${t.name}' 연결을 끊을까요? 그 PC의 Claude는 더 이상 회사 파일과 AI를 쓸 수 없어요.`} />}</td>
          </tr>
        )
      })}</tbody>
    </table></div>
  )
}

/** Names of everyone (for "who set this PC up"). */
export const peopleNames = (db: Database) => new Map(listUsers(db).map((u) => [u.id, u.name] as [string, string]))

/** Tokens that count toward a token budget (input + output + cache writes; cache reads are left out). */
export function budgetTokensUsed(db: Database, userId: string, from: Date, to: Date): number {
  const r = db.query('SELECT COALESCE(SUM(input_tokens + output_tokens + cache_write), 0) AS n FROM usage WHERE user_id = ? AND started_at >= ? AND started_at < ?')
    .get(userId, from.toISOString(), to.toISOString()) as { n: number }
  return r.n
}

/** A device someone else set up for me: approve it (so it may open my folder) or disconnect it. */
function ApproveNotice(p: { devices: TokenRow[]; view: DeviceView; csrf: string }) {
  return (<>{p.devices.map((t) => (
    <div class="notice warn" role="status">
      <b>'{t.name}' PC를 승인해 주세요.</b> {setupBy(t, p.view) ?? '다른 사람이'} 연결한 PC예요.
      <div>승인하기 전에는 이 PC에서 내 개인 폴더(내 폴더)를 열 수 없어요. 회사 파일과 AI는 지금도 돼요.</div>
      <div class="actions">
        <ButtonForm action={`/me/devices/${t.id}/approve`} csrf={p.csrf} label="이 PC를 내 PC로 승인" primary small={false} />
        <span class="small">내 PC가 아니면 아래에서 '연결 끊기'를 눌러 주세요.</span>
      </div>
    </div>
  ))}</>)
}

/** PCs set up with an older hub address: they need the install command again. */
function ReconnectNotice(p: { devices: TokenRow[]; csrf: string; codeShown: boolean; hubUrl: string }) {
  return (
    <div class="notice warn" role="status">
      <b>주소가 바뀌어서 이 PC는 다시 연결해야 해요: {p.devices.map((t) => `'${t.name}'`).join(', ')}</b>
      <div>지금 주소는 {p.hubUrl} 이에요. 그 PC의 터미널에서 설치 명령을 한 번 더 실행하면 돼요.</div>
      {p.codeShown
        ? <div>위에 나온 명령을 그 PC에서 실행해 주세요.</div>
        : <div class="actions"><ButtonForm action="/me/enroll" csrf={p.csrf} label="다시 연결할 명령 만들기" small={false} /></div>}
    </div>
  )
}

/** The person's own Claude apps (web, desktop, phone) with the hub as a custom connector (OAuth, src/oauth). */
function ClaudeAppsCard(p: { web: Web; csrf: string; apps: { clientId: string; app: string; since: string; lastRefresh: string }[] }) {
  const urls = effectiveUrls(p.web.ctx)
  return (
    <div class="card" style="margin-top:28px" id="claude-apps">
      <h2>Claude 앱에서 쓰기 (웹·데스크톱·휴대폰)</h2>
      {urls.publicUrl ? (<>
        <p>본인 Claude 구독의 Claude 앱에 회사 허브를 커넥터로 추가하면, 휴대폰에서도 회사 파일과 스킬을 써요.</p>
        <CopyBlock id="me-connector" text={`${urls.publicUrl}/mcp`} />
        <ol class="small">
          <li>Claude 앱(또는 claude.ai) › 설정 › 커넥터로 가요. 회사가 Claude Team이면 목록에 회사 커넥터가 있어요. '연결'을 눌러요.</li>
          <li>목록에 없으면 '커스텀 커넥터 추가'에 위 주소를 넣어요.</li>
          <li>허브 로그인 화면이 열리면 이 아이디로 로그인하고 '허용'을 눌러요.</li>
        </ol>
      </>) : <p class="muted">관리자가 공개 주소(https)를 넣으면 Claude 앱에서도 쓸 수 있어요.</p>}
      {p.apps.length ? (<>
        <h3>연결된 Claude 앱</h3>
        <div class="tablewrap"><table>
          <thead><tr><th>앱</th><th>연결한 날</th><th></th></tr></thead>
          <tbody>{p.apps.map((a) => (
            <tr><td>{a.app}</td><td>{fmtDateTime(a.since)}</td>
              <td><form method="post" action={`/me/connectors/${encodeURIComponent(a.clientId)}/revoke`} class="inline"><Csrf token={p.csrf} /><button class="btn small danger" type="submit">연결 끊기</button></form></td></tr>
          ))}</tbody>
        </table></div>
      </>) : null}
    </div>
  )
}

/** Where the phone opens the hub's own chat (runs on the hub with the company key), and whether it works outside. */
function PhoneCard(p: { c: C; web: Web }) {
  // hub chat needs the company key and Claude Code on the hub; without them the Claude app card above is the way
  if (!p.web.ctx.secrets.getApiKey() || !p.web.ctx.config.claudeBin) return null
  const urls = effectiveUrls(p.web.ctx, requestOrigin(p.c))
  let host = ''
  try { host = new URL(urls.hubUrl).hostname } catch {}
  const insideOnly = urls.kind === 'local' && /^(localhost|127\.|\[?::1\]?$|0\.0\.0\.0)/i.test(host)
  return (
    <div class="card" style="margin-top:28px">
      <h2>휴대폰에서도 써요</h2>
      <p>PC가 꺼져 있어도 휴대폰으로 회사 AI에게 일을 맡길 수 있어요.</p>
      {insideOnly
        ? <p>관리자가 '설정 › 접속 주소'에 주소를 넣으면 휴대폰에서도 열 수 있어요.</p>
        : <p>휴대폰에서 <b style="word-break:break-all">{urls.hubUrl}/app</b> 을 열고 같은 아이디로 로그인하세요.</p>}
      {!insideOnly && !urls.publicUrl ? <p class="muted small">지금은 사무실 와이파이에서만 열려요.</p> : null}
      <a class="btn" href="/app">채팅 열기</a>
    </div>
  )
}

function MePage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { ctx } = p.web
  const s = p.c.get('session')!
  const me = getUser(ctx.db, s.user.id)!
  const devices = activeDevices(listTokens(ctx.db, me.id))
  const now = new Date()
  const from = monthStart(now), to = nextMonthStart(now)
  const usage = usageReport(ctx.db, { from, to, groupBy: 'day', userId: me.id })
  const budgets = checkBudgets(ctx.db, me.id, now)
  const skills = skillsFor(ctx.fx.root, ctx.rules(), s.user)
  const enroll = p.flashes.find((f): f is Extract<Flash, { kind: 'enroll' }> => f.kind === 'enroll' && f.userId === me.id)
  const urls = effectiveUrls(ctx)
  const view: DeviceView = { personId: me.id, names: peopleNames(ctx.db), currentHub: configuredHubUrl(urls) }
  const toApprove = devices.filter(unapproved)
  const stale = devices.filter((t) => needsReconnect(t.hub_url, view.currentHub))
  const rate = krwPerUsd(ctx)
  const access = modelAccessFor(ctx.db, me.id)
  const apps = listConnectors(ctx, me.id)
  return (
    <Shell c={p.c} title="내 PC" active="/me" flashes={p.flashes}>
      <div class="head">
        <div><h1>{me.name}님의 페이지</h1><p class="lead">내 PC를 회사 AI에 연결하고, 내 사용량과 스킬을 봐요. <span class="badge">{MODEL_ACCESS_LABEL[access]}</span></p></div>
        <a class="btn small" href="/me/password">비밀번호 바꾸기</a>
      </div>

      <section id="connect">
        {enroll ? <EnrollResult c={p.c} ctx={ctx} code={enroll.code} expiresAt={enroll.expiresAt} /> : (
          <div class={'card' + (devices.length ? '' : ' oneshot')}>
            <h2>PC 연결하기</h2>
            {access === 'subscription'
              ? <p>버튼을 누르면 연결 코드와 명령어 한 줄이 나와요. 그 명령을 내 PC의 터미널에 붙여 넣으면 Claude Code가 회사 파일·스킬과 연결돼요. AI는 <b>본인 Claude 구독</b>으로 써요. 연결한 뒤 터미널에서 <code>claude</code>를 실행하고 <code>/login</code>으로 구독에 로그인하세요.</p>
              : <p>버튼을 누르면 연결 코드와 명령어 한 줄이 나와요. 그 명령을 내 PC의 터미널에 붙여 넣으면 Claude Code가 회사 파일·스킬과 연결되고, AI 사용료는 회사 계정으로 나가요.</p>}
            {urls.publicUrl ? null : <p class="muted small">아직 공개 주소가 없어서 회사 스킬은 설치되지 않아요. 파일과 AI는 바로 쓸 수 있어요.</p>}
            <form method="post" action="/me/enroll"><Csrf token={s.csrf} /><button class="btn primary" type="submit">PC 연결 코드 만들기</button></form>
          </div>
        )}
      </section>

      <div class="sec"><h2>내 PC</h2><span class="muted small">{devices.length ? `${devices.length}대 연결됨` : ''}</span></div>
      {toApprove.length ? <ApproveNotice devices={toApprove} view={view} csrf={s.csrf} /> : null}
      {stale.length ? <ReconnectNotice devices={stale} csrf={s.csrf} codeShown={!!enroll} hubUrl={view.currentHub!} /> : null}
      {devices.length
        ? <DeviceTable devices={devices} csrf={s.csrf} revokeBase="/me/devices" view={view} />
        : <Empty title="아직 연결된 PC가 없어요">위의 'PC 연결 코드 만들기'를 눌러 시작해요. PC마다 한 번씩 하면 돼요.</Empty>}

      <div class="sec"><h2>이번 달 내 사용량</h2></div>
      <div class="grid">
        <Stat label={access === 'subscription' ? '환산 비용' : '비용'} value={fmtUsd(usage.totals.costUsd)}
          hint={access === 'subscription' ? '구독 요금과 별개인 API 기준 어림값' : usage.totals.costUsd > 0 ? fmtKrw(usage.totals.costUsd, rate) : undefined} />
        <Stat label="요청" value={fmtNum(usage.totals.requests)} />
        <Stat label="토큰" value={fmtTokens(budgetTokensUsed(ctx.db, me.id, from, to))} hint="입력·출력·캐시 저장" />
      </div>
      {usage.rows.length ? <DayChart rows={usage.rows} now={now} /> : <Empty title="이번 달에는 아직 쓴 기록이 없어요">PC를 연결하고 Claude에게 일을 맡기면 여기에 쌓여요.</Empty>}

      {budgets.length ? (<>
        <div class="sec"><h2>내게 적용되는 예산</h2><span class="muted small">넘으면 멈추거나(막기), 막지 않고 표시만 해요(표시만)</span></div>
        <div class="tablewrap"><table>
          <thead><tr><th>예산</th><th>기간</th><th>쓴 만큼</th><th class="hide-sm">넘으면</th></tr></thead>
          <tbody>{budgets.map(({ budget: b, exceeded }) => (
            <tr><td><b>{b.subjectName}</b>{exceeded ? <> <span class={'badge ' + (b.action === 'block' ? 'bad' : 'warn')}>{b.action === 'block' ? '다 씀' : '넘음'}</span></> : null}</td>
              <td>{PERIOD_LABEL[b.period]}</td><td><BudgetMeter b={b} /></td>
              <td class="hide-sm">{b.action === 'block' ? '멈춤' : '표시만'}</td></tr>
          ))}</tbody>
        </table></div>
      </>) : null}

      <div class="sec"><h2>내 스킬</h2><span class="muted small">{skills.length ? `${skills.length}개 · ${urls.publicUrl ? "PC의 Claude에 'company' 플러그인으로 설치돼요" : '공개 주소가 생기면 PC에 자동으로 설치돼요.'}` : ''}</span></div>
      {skills.length ? <SkillList skills={skills} /> : <Empty title="아직 쓸 수 있는 스킬이 없어요">관리자가 팀 폴더의 skills/ 에 스킬을 넣으면 여기에 보여요.</Empty>}

      <ClaudeAppsCard web={p.web} csrf={s.csrf} apps={apps} />
      <PhoneCard c={p.c} web={p.web} />
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

  app.post('/me/devices/:id/approve', (c) => act(web, c, '/me', (_f, s) => {
    const id = c.req.param('id')
    const name = listTokens(ctx.db, s.user.id).find((t) => t.id === id)?.name
    if (!name || !approveToken(ctx.db, id, s.user.id)) return say(web, s, 'bad', '이미 승인했거나 없는 PC예요.')
    audit(ctx.db, { actor: s.user.id, action: 'device.approve', target: id, detail: { device: name } })
    say(web, s, 'ok', `'${name}'을(를) 내 PC로 승인했어요. 이제 이 PC에서 내 폴더도 열 수 있어요.`)
  }))

  app.post('/me/connectors/:client/revoke', (c) => act(web, c, '/me#claude-apps', (_f, s) => {
    const n = revokeConnectors(ctx, s.user.id, c.req.param('client'))
    if (!n) return say(web, s, 'bad', '이미 끊었거나 없는 연결이에요.')
    audit(ctx.db, { actor: s.user.id, action: 'connector.revoke', target: c.req.param('client') })
    say(web, s, 'ok', 'Claude 앱 연결을 끊었어요.')
  }))

  app.post('/me/devices/:id/revoke', (c) => act(web, c, '/me', (_f, s) => {
    const id = c.req.param('id')
    const name = listTokens(ctx.db, s.user.id).find((t) => t.id === id)?.name
    if (!name || !revokeToken(ctx.db, id, s.user.id)) return say(web, s, 'bad', '이미 끊었거나 없는 PC예요.')
    audit(ctx.db, { actor: s.user.id, action: 'device.revoke', target: s.user.id, detail: { device: name } })
    say(web, s, 'ok', `'${name}' 연결을 끊었어요.`)
  }))
}
