/** @jsxImportSource hono/jsx */
// People: list with where each person is (초대함 → 가입함 → 연결함 → 사용 중), add by name + email (an invite link, shown
// once), bulk invite, edit, reissue a link / reset a password (a link; a temporary password only on request), make an
// enroll code, see/revoke their PCs.
import crypto from 'node:crypto'
import type { App, C } from '../../http/app'
import type { SessionAuth } from '../../auth/sessions'
import { createUser, getUser, listUsers, listGroups, setPassword, setUserGroups, updateUser, type Role, type User } from '../../auth/users'
import { clearPassword, createInvite, createInvitedUser, deriveUsername, emailOwner, normalizeEmail, openInvite, openInvites, validEmail } from '../../auth/invites'
import { listTokens, revokeToken } from '../../auth/tokens'
import { makeEnrollCode } from '../../auth/enroll'
import { audit } from '../../audit'
import { defaultModelAccess, userModelAccess, setUserModelAccess, MODEL_ACCESS_LABEL } from '../../auth/access-mode'
import { usageReport } from '../../usage/report'
import { connectionsByUser, connectionText, stageOf, usersWithActivity, STAGE_LABEL, type Stage } from '../people-status'
import { InviteOnce, BulkPreview, BulkResult, createBulk, mailBulk, inviteMessage, joinLink, parseBulk, planBulk } from '../invite-ui'
import { deliverInvite } from '../invite-mail'
import { listConnectors } from '../../oauth/routes'
import { fmtDateTime, fmtKrw, fmtNum, fmtUsd, monthStart } from '../../ui/format'
import { Csrf } from '../../ui/layout'
import {
  type Web, type Flash, type Form, Shell, Stat, Empty, ButtonForm, EnrollResult, render, takeFlashes, act, say, fail, field, fields,
  roleBadge, requestOrigin, sessionForm, CsrfError, csrfRefused, ROLE_LABEL,
} from '../kit'
import { DeviceTable, activeDevices, nextMonthStart, peopleNames, unapproved, type DeviceView } from '../me'
import { companyName, configuredHubUrl, effectiveUrls, krwPerUsd } from '../settings'

const TEMP_ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Easy-to-read temporary password: xxxx-xxxx-xxxx (≈ 59 bits). */
export function tempPassword(): string {
  const b = crypto.randomBytes(12)
  let s = ''
  for (let i = 0; i < 12; i++) s += TEMP_ALPHA[b[i]! % TEMP_ALPHA.length]
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

/** May `actor` change `target`? Only the owner manages the owner account. */
function mustManage(actor: SessionAuth, target: User) {
  if (target.role === 'owner' && actor.user.role !== 'owner') fail('소유자 계정은 소유자만 바꿀 수 있어요.', 403)
}

const loadTarget = (web: Web, c: C): User => getUser(web.ctx.db, c.req.param('id') ?? '') ?? fail('없는 사람이에요.', 404)

const GroupChecks = (p: { groups: { id: string; name: string }[]; checked: Set<string> }) => (
  p.groups.length ? (
    <div class="field"><label>그룹</label>
      <div class="checks">{p.groups.map((g) => <label><input type="checkbox" name="groups" value={g.id} checked={p.checked.has(g.id)} /> {g.name}</label>)}</div>
    </div>
  ) : <p class="muted small">그룹이 아직 없어요. <a href="/admin/groups">그룹 만들기</a></p>
)

function PasswordOnce(p: { c: C; web: Web; f: Extract<Flash, { kind: 'password' }> }) {
  const login = effectiveUrls(p.web.ctx, requestOrigin(p.c)).hubUrl + '/login'
  return (
    <div class="card oneshot">
      <h2>{p.f.who}님 임시 비밀번호</h2>
      <p><span class="secret">{p.f.password}</span></p>
      <dl class="kv">
        <dt>아이디</dt><dd><b>{p.f.username}</b></dd>
        <dt>로그인 주소</dt><dd><a href={login}>{login}</a></dd>
      </dl>
      <p class="muted small" style="margin-top:12px">이 화면을 벗어나면 다시 볼 수 없어요. 본인에게 직접 전해 주세요. 처음 로그인하면 새 비밀번호를 정하게 돼요.</p>
    </div>
  )
}

function StageCell(p: { stage: Stage; u: User; open: { kind: 'invite' | 'reset'; expiresAt: string } | undefined; conn: { pcs: number; apps: number } | undefined }) {
  const cls = p.stage === 'invited' ? ' warn' : p.stage === 'joined' ? '' : ' good'
  let note = ''
  if (p.stage === 'invited') note = p.open ? (p.open.kind === 'reset' ? '비밀번호를 다시 정하는 중' : `링크 ${fmtDateTime(p.open.expiresAt)}까지`) : '링크 기간이 지났어요'
  else if (p.stage === 'connected' || p.stage === 'active') note = connectionText(p.conn)
  return (<><span class={'badge' + cls}>{STAGE_LABEL[p.stage]}</span>{note ? <div class="muted small">{note}</div> : null}</>)
}

function UsersPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { ctx } = p.web
  const s = p.c.get('session')!
  const users = listUsers(ctx.db)
  const groups = listGroups(ctx.db)
  const conn = connectionsByUser(ctx.db)
  const now = new Date()
  const used = usersWithActivity(ctx.db, monthStart(now), nextMonthStart(now))
  const open = openInvites(ctx.db)
  const cost = new Map(usageReport(ctx.db, { from: monthStart(now), to: nextMonthStart(now), groupBy: 'user' }).rows.map((r) => [r.key, r.costUsd]))
  const bulk = p.flashes.find((f): f is Extract<Flash, { kind: 'bulk' }> => f.kind === 'bulk')
  return (
    <Shell c={p.c} title="사람" active="/admin/users" flashes={p.flashes}>
      <h1>사람</h1>
      <p class="lead">이름과 이메일로 사람을 추가하면 초대 링크가 만들어져요. 링크를 보내면 각자 비밀번호를 정하고 시작해요.</p>

      {bulk ? <BulkResult ctx={ctx} c={p.c} rows={bulk.rows} group={bulk.group} /> : null}

      <div class="tablewrap"><table>
        <thead><tr><th>이름</th><th>역할</th><th>상태</th><th class="hide-sm">그룹</th><th class="num hide-sm">이번 달</th><th></th></tr></thead>
        <tbody>{users.map((u) => (
          <tr>
            <td><a href={`/admin/users/${u.id}`}><b>{u.name}</b></a><div class="muted small" style="word-break:break-all">{u.email ?? u.username}</div></td>
            <td>{roleBadge(u.role)}{u.status === 'disabled' ? <> <span class="badge bad">꺼짐</span></> : null}</td>
            <td>{u.status === 'disabled' ? <span class="muted small">—</span> : <StageCell stage={stageOf(u, conn.get(u.id), used.has(u.id))} u={u} open={open.get(u.id)} conn={conn.get(u.id)} />}</td>
            <td class="hide-sm"><div class="chips">{u.groups.map((g) => <span class="badge">{g.name}</span>)}</div></td>
            <td class="num hide-sm">{fmtUsd(cost.get(u.id) ?? 0)}</td>
            <td class="right"><a class="btn small" href={`/admin/users/${u.id}`}>관리</a></td>
          </tr>
        ))}</tbody>
      </table></div>
      {users.length === 1 ? <Empty title="아직 직원이 없어요">아래에서 이름과 이메일을 넣어 추가하거나, 여러 명을 한꺼번에 붙여 넣어 주세요. 초대 링크가 나오면 본인에게 보내 주면 돼요.</Empty> : null}

      <form method="post" action="/admin/users" class="card" id="add">
        <h2>사람 추가</h2>
        <Csrf token={s.csrf} />
        <div class="row">
          <div class="field"><label for="name">이름</label><input id="name" name="name" required maxlength={40} placeholder="홍길동" autocomplete="off" /></div>
          <div class="field"><label for="email">이메일</label><input id="email" type="email" name="email" maxlength={120} placeholder="gildong@company.com" autocomplete="off" /></div>
          <div class="field" style="max-width:160px"><label for="role">역할</label>
            <select id="role" name="role"><option value="member">직원</option><option value="admin">관리자</option></select></div>
        </div>
        <GroupChecks groups={groups} checked={new Set()} />
        <p class="muted small">초대 링크가 만들어져요. 링크를 보내면 그 사람이 직접 비밀번호를 정하고 시작해요. 이메일 주소가 로그인 아이디가 돼요.</p>
        <details style="margin:0 0 12px"><summary class="small">고급</summary>
          <div class="field" style="margin-top:10px;max-width:360px"><label for="username">아이디 (선택)</label>
            <input id="username" name="username" autocapitalize="off" pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,31}" placeholder="비워 두면 이메일 앞부분으로 만들어요" />
            <span class="muted small">영문·숫자만 쓸 수 있어요. 이메일 대신 이 아이디로도 로그인할 수 있어요.</span></div>
          <label class="choice"><input type="checkbox" name="temp" value="1" />
            <span><b>임시 비밀번호로 만들기</b><br /><span class="muted small">초대 링크 대신 임시 비밀번호를 한 번 보여 줘요. 이때는 이메일을 비워 둬도 돼요.</span></span></label>
        </details>
        <button class="btn primary" type="submit">추가하고 초대 링크 만들기</button>
      </form>

      <form method="post" action="/admin/users/bulk/preview" class="card" id="bulk">
        <h2>여러 명 한꺼번에 초대하기</h2>
        <Csrf token={s.csrf} />
        <div class="field"><label for="bulk-text">한 줄에 한 명씩 (이름, 이메일)</label>
          <textarea id="bulk-text" name="text" rows={6} required placeholder={'홍길동, gildong@company.com\n김영희, younghee@company.com'}></textarea>
          <span class="muted small">쉼표나 탭으로 나눠요. 엑셀에서 이름·이메일 두 칸을 복사해 붙여 넣어도 돼요. 한 번에 300명까지.</span></div>
        {groups.length ? (
          <div class="field" style="max-width:260px"><label for="bulk-group">처음 넣을 그룹 (선택)</label>
            <select id="bulk-group" name="group"><option value="">그룹 없음</option>{groups.map((g) => <option value={g.id}>{g.name}</option>)}</select></div>
        ) : null}
        <button class="btn primary" type="submit">미리보기</button>
      </form>
    </Shell>
  )
}

function UserPage(p: { web: Web; c: C; flashes: Flash[]; user: User }) {
  const { ctx } = p.web
  const s = p.c.get('session')!
  const u = p.user
  const groups = listGroups(ctx.db)
  const devices = listTokens(ctx.db, u.id)
  const active = activeDevices(devices)
  const now = new Date()
  const usage = usageReport(ctx.db, { from: monthStart(now), to: nextMonthStart(now), groupBy: 'model', userId: u.id })
  const self = u.id === s.user.id
  const lockedRole = u.role === 'owner' || self
  const manageable = !(u.role === 'owner' && s.user.role !== 'owner')
  const pw = p.flashes.find((f): f is Extract<Flash, { kind: 'password' }> => f.kind === 'password' && f.userId === u.id)
  const inv = p.flashes.find((f): f is Extract<Flash, { kind: 'invite' }> => f.kind === 'invite' && f.userId === u.id)
  const open = openInvite(ctx.db, u.id)
  const conn = connectionsByUser(ctx.db).get(u.id)
  const stage = stageOf(u, conn, usersWithActivity(ctx.db, monthStart(now), nextMonthStart(now)).has(u.id))
  const apps = listConnectors(ctx, u.id)
  const enroll = p.flashes.find((f): f is Extract<Flash, { kind: 'enroll' }> => f.kind === 'enroll' && f.userId === u.id)
  const base = `/admin/users/${u.id}`
  const view: DeviceView = { personId: u.id, names: peopleNames(ctx.db), currentHub: configuredHubUrl(effectiveUrls(ctx)) }
  const waiting = active.filter(unapproved).length
  const rate = krwPerUsd(ctx)
  return (
    <Shell c={p.c} title={u.name} active="/admin/users" flashes={p.flashes}>
      <p class="small"><a href="/admin/users">← 사람 목록</a></p>
      <div class="head">
        <div><h1>{u.name} {roleBadge(u.role)} {u.status === 'disabled' ? <span class="badge bad">꺼짐</span> : null}</h1>
          <p class="lead">{u.email ? `${u.email} · ` : ''}아이디 {u.username} · <span class={'badge' + (stage === 'invited' ? ' warn' : stage === 'joined' ? '' : ' good')}>{STAGE_LABEL[stage]}</span>
            {stage === 'invited' ? (open ? (open.kind === 'reset' ? ' · 비밀번호를 다시 정하는 중이에요' : ' · 초대 링크를 아직 열지 않았어요') : ' · 링크 기간이 지났어요') : ''}</p></div>
      </div>
      {inv ? <InviteOnce ctx={ctx} c={p.c} token={inv.token} expiresAt={inv.expiresAt} who={u.name} reset={inv.reset} mailed={inv.mailed} /> : null}
      {pw ? <PasswordOnce c={p.c} web={p.web} f={pw} /> : null}
      {enroll ? <EnrollResult c={p.c} ctx={ctx} code={enroll.code} expiresAt={enroll.expiresAt} who={u.name} forOther={u.id !== s.user.id} /> : null}
      {!manageable ? <div class="notice warn">소유자 계정은 소유자만 바꿀 수 있어요.</div> : null}

      <div class="grid">
        <Stat label="이번 달 비용" value={fmtUsd(usage.totals.costUsd)} hint={usage.totals.costUsd > 0 ? fmtKrw(usage.totals.costUsd, rate) : undefined} />
        <Stat label="이번 달 요청" value={fmtNum(usage.totals.requests)} />
        <Stat label="연결된 PC" value={`${active.length}대`} />
        <Stat label="연결된 Claude 앱" value={`${apps.length}개`} />
      </div>

      {manageable ? (
        <form method="post" action={base} class="card">
          <h2>정보</h2>
          <Csrf token={s.csrf} />
          <div class="row">
            <div class="field"><label for="name">이름</label><input id="name" name="name" value={u.name} required maxlength={40} /></div>
            <div class="field"><label for="email">이메일 (로그인에도 써요)</label><input id="email" type="email" name="email" value={u.email ?? ''} maxlength={120} /></div>
          </div>
          <div class="row">
            <div class="field"><label for="role">역할</label>
              {lockedRole
                ? <input id="role" value={ROLE_LABEL[u.role]} disabled />
                : <select id="role" name="role">{(['member', 'admin'] as Role[]).map((r) => <option value={r} selected={u.role === r}>{ROLE_LABEL[r]}</option>)}</select>}
            </div>
            <div class="field"><label for="status">상태</label>
              {lockedRole
                ? <input id="status" value={u.status === 'active' ? '사용 중' : '꺼짐'} disabled />
                : <select id="status" name="status"><option value="active" selected={u.status === 'active'}>사용 중</option><option value="disabled" selected={u.status === 'disabled'}>꺼짐 (로그인·PC 모두 막기)</option></select>}
            </div>
          </div>
          {self ? <p class="muted small">내 역할과 상태는 여기서 바꿀 수 없어요.</p> : null}
          <div class="field" style="max-width:360px"><label for="access">Claude 사용 방식</label>
            <select id="access" name="access">
              <option value="" selected={userModelAccess(ctx.db, u.id) === null}>회사 기본값 따르기 ({MODEL_ACCESS_LABEL[defaultModelAccess(ctx.db)]})</option>
              <option value="subscription" selected={userModelAccess(ctx.db, u.id) === 'subscription'}>각자 Claude 구독</option>
              <option value="company_key" selected={userModelAccess(ctx.db, u.id) === 'company_key'}>회사 API 키</option>
            </select>
            <span class="muted small">바꾸면 그 사람 PC는 다시 연결해야 적용돼요.</span></div>
          <GroupChecks groups={groups} checked={new Set(u.groups.map((g) => g.id))} />
          <button class="btn primary" type="submit">저장</button>
        </form>
      ) : null}

      <div class="sec"><h2>PC</h2>
        {manageable && u.status === 'active' ? <ButtonForm action={`${base}/enroll`} csrf={s.csrf} label="PC 연결 코드 만들기" small={false} /> : null}
      </div>
      {waiting ? <p class="small muted">관리자가 연결한 PC는 {u.name}님이 '내 PC' 페이지에서 승인해야 그 PC로 개인 폴더를 열 수 있어요.</p> : null}
      {devices.length
        ? <DeviceTable devices={devices} csrf={s.csrf} revokeBase={`${base}/devices`} view={view} />
        : <Empty title="연결된 PC가 없어요">'PC 연결 코드 만들기'로 코드를 만들어 그 사람 PC에서 명령을 실행하면 돼요.</Empty>}

      {manageable && !self && u.status === 'active' ? (
        <div class="card danger" style="margin-top:28px">
          {u.mustChangePassword ? (<>
            <h2>초대 링크 다시 만들기</h2>
            <p class="muted">링크를 잃어버렸거나 기간이 지났을 때 써요. 새 링크가 나오고, 이전 링크는 바로 쓸 수 없게 돼요.</p>
            <ButtonForm action={`${base}/invite`} csrf={s.csrf} label="초대 링크 다시 만들기" small={false} primary />
          </>) : (<>
            <h2>비밀번호 초기화</h2>
            <p class="muted">비밀번호를 잊었을 때 써요. 새 링크가 나오고, 그 사람은 링크에서 새 비밀번호를 정해요. 지금 비밀번호와 로그인은 바로 막혀요. 연결된 PC는 그대로예요.</p>
            <ButtonForm action={`${base}/password`} csrf={s.csrf} label="초기화 링크 만들기" small={false} danger confirm={`${u.name}님의 비밀번호를 초기화할까요? 지금 비밀번호는 바로 쓸 수 없게 돼요.`} />
          </>)}
          <details style="margin-top:14px"><summary class="small">임시 비밀번호로 만들기</summary>
            <p class="muted small" style="margin-top:8px">링크를 보낼 수 없을 때만 써요. 임시 비밀번호를 한 번 보여 주고, 처음 로그인할 때 새 비밀번호를 정하게 돼요.</p>
            <ButtonForm action={`${base}/password`} csrf={s.csrf} label="임시 비밀번호로 만들기" small={false} hidden={{ temp: '1' }} confirm={`${u.name}님의 비밀번호를 임시 비밀번호로 바꿀까요?`} />
          </details>
        </div>
      ) : null}
    </Shell>
  )
}

function groupNames(web: Web, ids: string[]) {
  const all = new Map(listGroups(web.ctx.db).map((g) => [g.id, g.name]))
  return ids.map((id) => all.get(id)).filter((n): n is string => !!n)
}

/** Make the link for a person, tell the mailer (which does nothing yet) and leave the link for the next page. */
async function issueLink(web: Web, s: SessionAuth, c: C, u: User, kind: 'invite' | 'reset', detail: Record<string, unknown> = {}) {
  const inv = createInvite(web.ctx.db, u.id, kind, s.user.id)
  audit(web.ctx.db, { actor: s.user.id, action: 'invite.create', target: u.id, detail: { kind, ...detail } })
  let mailed = false
  if (u.email) {
    const company = companyName(web.ctx)
    const link = joinLink(web.ctx, c, inv.token)
    mailed = await deliverInvite(web.mailer, { to: u.email, name: u.name, company, link, message: inviteMessage({ company, name: u.name, link, reset: kind === 'reset' }), expiresAt: inv.expiresAt, kind })
  }
  web.flash.push(s.idHash, { kind: 'invite', token: inv.token, expiresAt: inv.expiresAt, userId: u.id, who: u.name, reset: kind === 'reset', mailed })
}

async function addUser(web: Web, s: SessionAuth, f: Form, c: C): Promise<string> {
  const db = web.ctx.db
  const role = field(f, 'role') === 'admin' ? 'admin' : 'member'
  const name = field(f, 'name').slice(0, 40)
  const groups = fields(f, 'groups')
  const emailIn = field(f, 'email')
  const temp = field(f, 'temp') === '1'
  const email = emailIn ? normalizeEmail(emailIn) : ''
  if (email && !validEmail(email)) fail('이메일 주소 모양이 이상해요.')
  if (email && emailOwner(db, email)) fail('이미 같은 이메일을 쓰는 사람이 있어요.', 409)
  if (!temp && !email) fail("이메일을 적어 주세요. 초대 링크는 이메일 주소를 로그인 아이디로 써요. (이메일 없이 만들려면 '고급'에서 임시 비밀번호를 골라요.)")
  const username = field(f, 'username') || (email ? deriveUsername(db, email) : fail('아이디를 적어 주세요.'))

  if (temp) {
    const password = tempPassword()
    const u = await createUser(db, { username, name, email: email || null, role, password, mustChangePassword: true })
    if (groups.length) setUserGroups(db, u.id, groups)
    web.ctx.rulesChanged()
    audit(db, { actor: s.user.id, action: 'user.create', target: u.id, detail: { username: u.username, role, groups: groupNames(web, groups), temp: true } })
    web.flash.push(s.idHash, { kind: 'password', password, userId: u.id, username: u.username, who: u.name })
    return `/admin/users/${u.id}`
  }

  const u = createInvitedUser(db, { username, name, email, role })
  if (groups.length) setUserGroups(db, u.id, groups)
  web.ctx.rulesChanged()
  audit(db, { actor: s.user.id, action: 'user.create', target: u.id, detail: { username: u.username, role, groups: groupNames(web, groups), invite: true } })
  await issueLink(web, s, c, u, 'invite')
  return `/admin/users/${u.id}`
}

export function mountUsers(app: App, web: Web) {
  const { ctx } = web
  const db = ctx.db

  app.get('/admin/users', (c) => render(c, <UsersPage web={web} c={c} flashes={takeFlashes(web, c)} />))
  app.post('/admin/users', (c) => act(web, c, '/admin/users#add', (f, s) => addUser(web, s, f, c)))

  // bulk invite (registered before the /admin/users/:id routes, which would take "bulk" for an id)
  const bulkInput = (f: Form) => {
    const text = field(f, 'text').slice(0, 200_000)
    const groupId = field(f, 'group')
    const group = groupId ? listGroups(db).find((g) => g.id === groupId) ?? null : null
    return { text, group, parsed: parseBulk(text) }
  }
  app.post('/admin/users/bulk/preview', async (c) => {
    let parsed
    try { parsed = await sessionForm(c) } catch (e) { if (e instanceof CsrfError) return csrfRefused(c); throw e }
    const { text, group, parsed: p } = bulkInput(parsed.form)
    const rows = planBulk(db, p.rows)
    return render(c, (
      <Shell c={c} title="초대 미리보기" active="/admin/users">
        <p class="small"><a href="/admin/users#bulk">← 사람 목록</a></p>
        <h1>초대 미리보기</h1>
        {rows.length
          ? <BulkPreview rows={rows} header={p.header} tooMany={p.tooMany} text={text} group={group?.id ?? ''} groupName={group?.name ?? null} csrf={parsed.session.csrf} />
          : <><Empty title="붙여 넣은 내용에서 사람을 찾지 못했어요">한 줄에 한 명씩 '이름, 이메일' 모양으로 적어 주세요.</Empty><a class="btn" href="/admin/users#bulk">다시 고치기</a></>}
      </Shell>
    ))
  })
  app.post('/admin/users/bulk', (c) => act(web, c, '/admin/users#bulk', async (f, s) => {
    const { group, parsed } = bulkInput(f)
    const plan = planBulk(db, parsed.rows)
    if (!plan.some((r) => r.status === 'new')) fail('만들 수 있는 사람이 없어요. 이름과 이메일을 확인해 주세요.')
    const rows = createBulk(web, s.user.id, plan, group?.id ?? null)
    await mailBulk(web, c, rows)
    web.flash.push(s.idHash, { kind: 'bulk', rows, group: group?.name ?? null })
    return '/admin/users'
  }))

  app.get('/admin/users/:id', (c) => {
    const u = getUser(db, c.req.param('id'))
    if (!u) return c.redirect('/admin/users')
    return render(c, <UserPage web={web} c={c} flashes={takeFlashes(web, c)} user={u} />)
  })

  app.post('/admin/users/:id', (c) => act(web, c, `/admin/users/${c.req.param('id')}`, (f, s) => {
    const u = loadTarget(web, c)
    mustManage(s, u)
    const self = u.id === s.user.id
    const role = field(f, 'role') as Role
    const status = field(f, 'status')
    const emailIn = field(f, 'email').slice(0, 120)
    const email = emailIn ? normalizeEmail(emailIn) : null
    const emailChanged = (email ?? '') !== normalizeEmail(u.email ?? '')
    // the address is the person's login: a changed one must look like an address and belong to nobody else
    if (emailChanged && email) {
      if (!validEmail(email)) fail('이메일 주소 모양이 이상해요.')
      if (emailOwner(db, email, u.id)) fail('이미 같은 이메일을 쓰는 사람이 있어요.', 409)
    }
    const patch: Parameters<typeof updateUser>[2] = { name: field(f, 'name').slice(0, 40), email: emailChanged ? email : u.email }
    if (!self && u.role !== 'owner') {
      if (role === 'member' || role === 'admin') patch.role = role
      if (status === 'active' || status === 'disabled') patch.status = status
    }
    const after = updateUser(db, u.id, patch)
    const access = field(f, 'access')
    const accessBefore = userModelAccess(db, u.id)
    const accessAfter = access === 'subscription' || access === 'company_key' ? access : null
    if (accessAfter !== accessBefore) setUserModelAccess(db, u.id, accessAfter)
    const groups = fields(f, 'groups')
    setUserGroups(db, u.id, groups)
    ctx.rulesChanged()
    const before = new Set(u.groups.map((g) => g.id))
    const changed: Record<string, unknown> = {}
    if (after.name !== u.name) changed.name = after.name
    if ((after.email ?? '') !== (u.email ?? '')) changed.email = after.email ? 'set' : 'removed'
    if (after.role !== u.role) changed.role = after.role
    if (after.status !== u.status) changed.status = after.status
    if (accessAfter !== accessBefore) changed.access = accessAfter ?? 'default'
    if (groups.length !== before.size || groups.some((g) => !before.has(g))) changed.groups = groupNames(web, groups)
    if (Object.keys(changed).length) audit(db, { actor: s.user.id, action: 'user.update', target: u.id, detail: changed })
    say(web, s, 'ok', after.status === 'disabled' && u.status !== 'disabled' ? `${after.name}님을 껐어요. 로그인과 연결된 PC가 모두 끊겼어요.` : '저장했어요.')
  }))

  // reset: a link by default (the old password stops working at once and the person's sessions end); a temporary
  // password only when the admin asks for one (temp=1)
  app.post('/admin/users/:id/password', (c) => act(web, c, `/admin/users/${c.req.param('id')}`, async (f, s) => {
    const u = loadTarget(web, c)
    mustManage(s, u)
    if (u.id === s.user.id) fail('내 비밀번호는 내 페이지의 \'비밀번호 바꾸기\'에서 바꿔요.')
    if (u.status !== 'active') fail('꺼진 계정이에요. 먼저 상태를 \'사용 중\'으로 바꿔 주세요.')
    if (field(f, 'temp') === '1') {
      const password = tempPassword()
      await setPassword(db, u.id, password, true)
      db.query('DELETE FROM sessions WHERE user_id = ?').run(u.id)
      db.query('UPDATE invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL').run(new Date().toISOString(), u.id)
      audit(db, { actor: s.user.id, action: 'user.password_reset', target: u.id, detail: { temp: true } })
      web.flash.push(s.idHash, { kind: 'password', password, userId: u.id, username: u.username, who: u.name })
      return
    }
    clearPassword(db, u.id)
    db.query('DELETE FROM sessions WHERE user_id = ?').run(u.id)
    audit(db, { actor: s.user.id, action: 'user.password_reset', target: u.id, detail: { link: true } })
    await issueLink(web, s, c, u, 'reset')
  }))

  // a new invite link for someone who has not joined yet (the earlier link stops working)
  app.post('/admin/users/:id/invite', (c) => act(web, c, `/admin/users/${c.req.param('id')}`, async (_f, s) => {
    const u = loadTarget(web, c)
    mustManage(s, u)
    if (u.status !== 'active') fail('꺼진 계정이에요. 먼저 상태를 \'사용 중\'으로 바꿔 주세요.')
    if (!u.mustChangePassword) fail('이미 가입한 사람이에요. 비밀번호를 잊었다면 \'비밀번호 초기화\'로 새 링크를 만들어 주세요.')
    await issueLink(web, s, c, u, 'invite', { reissue: true })
  }))

  app.post('/admin/users/:id/enroll', (c) => act(web, c, `/admin/users/${c.req.param('id')}`, (_f, s) => {
    const u = loadTarget(web, c)
    mustManage(s, u)
    if (u.status !== 'active') fail('꺼진 계정이에요. 먼저 상태를 \'사용 중\'으로 바꿔 주세요.')
    const { code, expiresAt } = makeEnrollCode(db, u.id, s.user.id)
    audit(db, { actor: s.user.id, action: 'enroll.create', target: u.id })
    web.flash.push(s.idHash, { kind: 'enroll', code, expiresAt, userId: u.id, who: u.name })
  }))

  app.post('/admin/users/:id/devices/:tid/revoke', (c) => act(web, c, `/admin/users/${c.req.param('id')}`, (_f, s) => {
    const u = loadTarget(web, c)
    mustManage(s, u)
    const tid = c.req.param('tid')
    const name = listTokens(db, u.id).find((t) => t.id === tid)?.name
    if (!name || !revokeToken(db, tid, u.id)) return say(web, s, 'bad', '이미 끊었거나 없는 PC예요.')
    audit(db, { actor: s.user.id, action: 'device.revoke', target: u.id, detail: { device: name } })
    say(web, s, 'ok', `'${name}' 연결을 끊었어요.`)
  }))
}
