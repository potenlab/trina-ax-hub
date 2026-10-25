/** @jsxImportSource hono/jsx */
// People: list, add (temp password shown once), edit, reset password, make an enroll code, see/revoke their PCs.
import crypto from 'node:crypto'
import type { App, C } from '../../http/app'
import type { SessionAuth } from '../../auth/sessions'
import { createUser, getUser, listUsers, listGroups, setPassword, setUserGroups, updateUser, type Role, type User } from '../../auth/users'
import { listTokens, revokeToken } from '../../auth/tokens'
import { makeEnrollCode } from '../../auth/enroll'
import { audit } from '../../audit'
import { usageReport } from '../../usage/report'
import { fmtKrw, fmtNum, fmtUsd, monthStart } from '../../ui/format'
import { Csrf } from '../../ui/layout'
import {
  type Web, type Flash, type Form, Shell, Stat, Empty, ButtonForm, EnrollResult, render, takeFlashes, act, say, fail, field, fields,
  roleBadge, requestOrigin, ROLE_LABEL,
} from '../kit'
import { DeviceTable, activeDevices, nextMonthStart, peopleNames, unapproved, type DeviceView } from '../me'
import { configuredHubUrl, effectiveUrls, krwPerUsd } from '../settings'

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

function UsersPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { ctx } = p.web
  const s = p.c.get('session')!
  const users = listUsers(ctx.db)
  const groups = listGroups(ctx.db)
  const devices = activeDevices(listTokens(ctx.db))
  const pcs = new Map<string, number>()
  for (const d of devices) pcs.set(d.user_id, (pcs.get(d.user_id) ?? 0) + 1)
  const now = new Date()
  const cost = new Map(usageReport(ctx.db, { from: monthStart(now), to: nextMonthStart(now), groupBy: 'user' }).rows.map((r) => [r.key, r.costUsd]))
  return (
    <Shell c={p.c} title="사람" active="/admin/users" flashes={p.flashes}>
      <h1>사람</h1>
      <p class="lead">직원 계정을 만들고 역할과 그룹을 정해요. 계정마다 PC를 여러 대 연결할 수 있어요.</p>

      <div class="tablewrap"><table>
        <thead><tr><th>이름</th><th>역할</th><th class="hide-sm">그룹</th><th class="num">PC</th><th class="num hide-sm">이번 달</th><th></th></tr></thead>
        <tbody>{users.map((u) => (
          <tr>
            <td><a href={`/admin/users/${u.id}`}><b>{u.name}</b></a><div class="muted small">{u.username}</div></td>
            <td>{roleBadge(u.role)}{u.status === 'disabled' ? <> <span class="badge bad">꺼짐</span></> : null}{u.mustChangePassword ? <div class="muted small">첫 로그인 전</div> : null}</td>
            <td class="hide-sm"><div class="chips">{u.groups.map((g) => <span class="badge">{g.name}</span>)}</div></td>
            <td class="num">{pcs.get(u.id) ?? 0}</td>
            <td class="num hide-sm">{fmtUsd(cost.get(u.id) ?? 0)}</td>
            <td class="right"><a class="btn small" href={`/admin/users/${u.id}`}>관리</a></td>
          </tr>
        ))}</tbody>
      </table></div>
      {users.length === 1 ? <Empty title="아직 직원이 없어요">아래에서 직원 계정을 만들어 주세요. 임시 비밀번호가 나오면 본인에게 전해 주면 돼요.</Empty> : null}

      <form method="post" action="/admin/users" class="card" id="add">
        <h2>사람 추가</h2>
        <Csrf token={s.csrf} />
        <div class="row">
          <div class="field"><label for="name">이름</label><input id="name" name="name" required maxlength={40} placeholder="홍길동" /></div>
          <div class="field"><label for="username">아이디</label><input id="username" name="username" required autocapitalize="off" pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,31}" placeholder="영문·숫자 (예: gildong)" /></div>
          <div class="field" style="max-width:160px"><label for="role">역할</label>
            <select id="role" name="role"><option value="member">직원</option><option value="admin">관리자</option></select></div>
        </div>
        <GroupChecks groups={groups} checked={new Set()} />
        <p class="muted small">임시 비밀번호가 만들어져요. 처음 로그인할 때 본인이 새 비밀번호로 바꿔요.</p>
        <button class="btn primary" type="submit">추가하기</button>
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
          <p class="lead">아이디 {u.username}{u.mustChangePassword ? ' · 아직 첫 로그인 전이에요' : ''}</p></div>
      </div>
      {pw ? <PasswordOnce c={p.c} web={p.web} f={pw} /> : null}
      {enroll ? <EnrollResult c={p.c} ctx={ctx} code={enroll.code} expiresAt={enroll.expiresAt} who={u.name} forOther={u.id !== s.user.id} /> : null}
      {!manageable ? <div class="notice warn">소유자 계정은 소유자만 바꿀 수 있어요.</div> : null}

      <div class="grid">
        <Stat label="이번 달 비용" value={fmtUsd(usage.totals.costUsd)} hint={usage.totals.costUsd > 0 ? fmtKrw(usage.totals.costUsd, rate) : undefined} />
        <Stat label="이번 달 요청" value={fmtNum(usage.totals.requests)} />
        <Stat label="연결된 PC" value={`${active.length}대`} />
      </div>

      {manageable ? (
        <form method="post" action={base} class="card">
          <h2>정보</h2>
          <Csrf token={s.csrf} />
          <div class="row">
            <div class="field"><label for="name">이름</label><input id="name" name="name" value={u.name} required maxlength={40} /></div>
            <div class="field"><label for="email">이메일 (선택)</label><input id="email" type="email" name="email" value={u.email ?? ''} maxlength={120} /></div>
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

      {manageable && !self ? (
        <div class="card danger" style="margin-top:28px">
          <h2>비밀번호 초기화</h2>
          <p class="muted">비밀번호를 잊었을 때 써요. 새 임시 비밀번호가 나오고, 그 사람은 다시 로그인해야 해요. 연결된 PC는 그대로예요.</p>
          <ButtonForm action={`${base}/password`} csrf={s.csrf} label="임시 비밀번호로 초기화" small={false} danger confirm={`${u.name}님의 비밀번호를 초기화할까요?`} />
        </div>
      ) : null}
    </Shell>
  )
}

function groupNames(web: Web, ids: string[]) {
  const all = new Map(listGroups(web.ctx.db).map((g) => [g.id, g.name]))
  return ids.map((id) => all.get(id)).filter((n): n is string => !!n)
}

async function addUser(web: Web, s: SessionAuth, f: Form): Promise<string> {
  const role = field(f, 'role') === 'admin' ? 'admin' : 'member'
  const password = tempPassword()
  const u = await createUser(web.ctx.db, { username: field(f, 'username'), name: field(f, 'name').slice(0, 40), role, password, mustChangePassword: true })
  const groups = fields(f, 'groups')
  if (groups.length) setUserGroups(web.ctx.db, u.id, groups)
  web.ctx.rulesChanged()
  audit(web.ctx.db, { actor: s.user.id, action: 'user.create', target: u.id, detail: { username: u.username, role, groups: groupNames(web, groups) } })
  web.flash.push(s.idHash, { kind: 'password', password, userId: u.id, username: u.username, who: u.name })
  return `/admin/users/${u.id}`
}

export function mountUsers(app: App, web: Web) {
  const { ctx } = web
  const db = ctx.db

  app.get('/admin/users', (c) => render(c, <UsersPage web={web} c={c} flashes={takeFlashes(web, c)} />))
  app.post('/admin/users', (c) => act(web, c, '/admin/users#add', (f, s) => addUser(web, s, f)))

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
    const patch: Parameters<typeof updateUser>[2] = { name: field(f, 'name').slice(0, 40), email: field(f, 'email').slice(0, 120) || null }
    if (!self && u.role !== 'owner') {
      if (role === 'member' || role === 'admin') patch.role = role
      if (status === 'active' || status === 'disabled') patch.status = status
    }
    const after = updateUser(db, u.id, patch)
    const groups = fields(f, 'groups')
    setUserGroups(db, u.id, groups)
    ctx.rulesChanged()
    const before = new Set(u.groups.map((g) => g.id))
    const changed: Record<string, unknown> = {}
    if (after.name !== u.name) changed.name = after.name
    if ((after.email ?? '') !== (u.email ?? '')) changed.email = after.email ? 'set' : 'removed'
    if (after.role !== u.role) changed.role = after.role
    if (after.status !== u.status) changed.status = after.status
    if (groups.length !== before.size || groups.some((g) => !before.has(g))) changed.groups = groupNames(web, groups)
    if (Object.keys(changed).length) audit(db, { actor: s.user.id, action: 'user.update', target: u.id, detail: changed })
    say(web, s, 'ok', after.status === 'disabled' && u.status !== 'disabled' ? `${after.name}님을 껐어요. 로그인과 연결된 PC가 모두 끊겼어요.` : '저장했어요.')
  }))

  app.post('/admin/users/:id/password', (c) => act(web, c, `/admin/users/${c.req.param('id')}`, async (_f, s) => {
    const u = loadTarget(web, c)
    mustManage(s, u)
    if (u.id === s.user.id) fail('내 비밀번호는 내 페이지의 \'비밀번호 바꾸기\'에서 바꿔요.')
    const password = tempPassword()
    await setPassword(db, u.id, password, true)
    db.query('DELETE FROM sessions WHERE user_id = ?').run(u.id)
    audit(db, { actor: s.user.id, action: 'user.password_reset', target: u.id })
    web.flash.push(s.idHash, { kind: 'password', password, userId: u.id, username: u.username, who: u.name })
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
