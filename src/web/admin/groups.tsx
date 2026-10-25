/** @jsxImportSource hono/jsx */
// Groups: list, create, rename, members, delete. Groups are what folder rules and budgets usually point at (부서, 팀).
import type { App, C } from '../../http/app'
import { createGroup, deleteGroup, getUser, listGroups, listUsers, setUserGroups } from '../../auth/users'
import { listRules } from '../../policy/rules-admin'
import { listBudgets } from '../../usage/budgets'
import { audit } from '../../audit'
import { Csrf } from '../../ui/layout'
import { type Web, type Flash, Shell, Empty, ButtonForm, render, takeFlashes, act, say, fail, field, ACCESS_LABEL, PERIOD_LABEL } from '../kit'
import { BudgetMeter } from '../me'

const groupOf = (web: Web, id: string) => listGroups(web.ctx.db).find((g) => g.id === id) ?? null

function GroupsPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { db } = p.web.ctx
  const s = p.c.get('session')!
  const groups = listGroups(db)
  const users = listUsers(db)
  const rules = listRules(db)
  return (
    <Shell c={p.c} title="그룹" active="/admin/groups" flashes={p.flashes}>
      <h1>그룹</h1>
      <p class="lead">부서나 팀을 그룹으로 묶으면 폴더 권한과 예산을 한 번에 줄 수 있어요.</p>
      {groups.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>그룹</th><th class="num">사람</th><th class="hide-sm">구성원</th><th class="num hide-sm">폴더 규칙</th><th></th></tr></thead>
          <tbody>{groups.map((g) => {
            const members = users.filter((u) => u.groups.some((x) => x.id === g.id))
            return (
              <tr>
                <td><a href={`/admin/groups/${g.id}`}><b>{g.name}</b></a></td>
                <td class="num">{g.members}</td>
                <td class="hide-sm"><div class="chips">{members.slice(0, 8).map((u) => <span class="badge">{u.name}</span>)}{members.length > 8 ? <span class="muted small">외 {members.length - 8}명</span> : null}</div></td>
                <td class="num hide-sm">{rules.filter((r) => r.subjectType === 'group' && r.subjectId === g.id).length}</td>
                <td class="right"><a class="btn small" href={`/admin/groups/${g.id}`}>관리</a></td>
              </tr>
            )
          })}</tbody>
        </table></div>
      ) : <Empty title="아직 그룹이 없어요">예: 영업팀, 재무팀, 디자인팀. 아래에서 만들어 보세요.</Empty>}

      <form method="post" action="/admin/groups" class="card" id="add">
        <h2>그룹 만들기</h2>
        <Csrf token={s.csrf} />
        <div class="row">
          <div class="field"><label for="name">그룹 이름</label><input id="name" name="name" required maxlength={40} placeholder="예: 영업팀" /></div>
          <div><button class="btn primary" type="submit" style="margin-bottom:12px">만들기</button></div>
        </div>
      </form>
    </Shell>
  )
}

function GroupPage(p: { web: Web; c: C; flashes: Flash[]; group: { id: string; name: string } }) {
  const { db } = p.web.ctx
  const s = p.c.get('session')!
  const g = p.group
  const users = listUsers(db)
  const members = users.filter((u) => u.groups.some((x) => x.id === g.id))
  const others = users.filter((u) => !u.groups.some((x) => x.id === g.id) && u.status === 'active')
  const rules = listRules(db).filter((r) => r.subjectType === 'group' && r.subjectId === g.id)
  const budgets = listBudgets(db).filter((b) => b.subjectType === 'group' && b.subjectId === g.id)
  const base = `/admin/groups/${g.id}`
  return (
    <Shell c={p.c} title={g.name} active="/admin/groups" flashes={p.flashes}>
      <p class="small"><a href="/admin/groups">← 그룹 목록</a></p>
      <h1>{g.name}</h1>
      <p class="lead">구성원 {members.length}명</p>

      <div class="sec"><h2>구성원</h2></div>
      {members.length ? (
        <div class="tablewrap"><table>
          <tbody>{members.map((u) => (
            <tr><td><a href={`/admin/users/${u.id}`}><b>{u.name}</b></a> <span class="muted small">{u.username}</span></td>
              <td class="right"><ButtonForm action={`${base}/members/${u.id}/remove`} csrf={s.csrf} label="빼기" danger /></td></tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title="아직 구성원이 없어요">아래에서 사람을 넣어 주세요.</Empty>}
      {others.length ? (
        <form method="post" action={`${base}/members`} class="card">
          <Csrf token={s.csrf} />
          <div class="row">
            <div class="field"><label for="userId">사람 넣기</label>
              <select id="userId" name="userId">{others.map((u) => <option value={u.id}>{u.name} ({u.username})</option>)}</select></div>
            <div><button class="btn primary" type="submit" style="margin-bottom:12px">넣기</button></div>
          </div>
        </form>
      ) : null}

      <div class="sec"><h2>이 그룹의 폴더 권한</h2><a class="small" href="/admin/folders">폴더 권한 관리</a></div>
      {rules.length ? (
        <div class="tablewrap"><table>
          <tbody>{rules.map((r) => <tr><td><code>{r.path || '(팀 폴더 전체)'}</code></td><td>{ACCESS_LABEL[r.access]}</td></tr>)}</tbody>
        </table></div>
      ) : <p class="muted">이 그룹에만 준 폴더 권한은 없어요.</p>}

      {budgets.length ? (<>
        <div class="sec"><h2>이 그룹의 예산</h2><a class="small" href="/admin/budgets">예산 관리</a></div>
        <div class="tablewrap"><table>
          <tbody>{budgets.map((b) => <tr><td>{PERIOD_LABEL[b.period]}</td><td><BudgetMeter b={b} /></td></tr>)}</tbody>
        </table></div>
      </>) : null}

      <form method="post" action={`${base}/rename`} class="card" style="margin-top:28px">
        <h2>이름 바꾸기</h2>
        <Csrf token={s.csrf} />
        <div class="row">
          <div class="field"><label for="name">그룹 이름</label><input id="name" name="name" value={g.name} required maxlength={40} /></div>
          <div><button class="btn" type="submit" style="margin-bottom:12px">바꾸기</button></div>
        </div>
      </form>

      <div class="card danger">
        <h2>그룹 지우기</h2>
        <p class="muted">구성원 계정은 그대로예요. 이 그룹에 준 폴더 권한 {rules.length}개와 예산 {budgets.length}개는 함께 지워져요.</p>
        <ButtonForm action={`${base}/delete`} csrf={s.csrf} label="그룹 지우기" small={false} danger confirm={`'${g.name}' 그룹을 지울까요? 이 그룹의 폴더 권한과 예산도 함께 지워져요.`} />
      </div>
    </Shell>
  )
}

export function mountGroups(app: App, web: Web) {
  const { ctx } = web
  const db = ctx.db
  const need = (id: string) => groupOf(web, id) ?? fail('없는 그룹이에요.', 404)

  app.get('/admin/groups', (c) => render(c, <GroupsPage web={web} c={c} flashes={takeFlashes(web, c)} />))
  app.get('/admin/groups/:id', (c) => {
    const g = groupOf(web, c.req.param('id'))
    if (!g) return c.redirect('/admin/groups')
    return render(c, <GroupPage web={web} c={c} flashes={takeFlashes(web, c)} group={g} />)
  })

  app.post('/admin/groups', (c) => act(web, c, '/admin/groups#add', (f, s) => {
    const g = createGroup(db, field(f, 'name'))
    audit(db, { actor: s.user.id, action: 'group.create', target: g.id, detail: { name: g.name } })
    say(web, s, 'ok', `'${g.name}' 그룹을 만들었어요. 이제 사람을 넣어 주세요.`)
    return `/admin/groups/${g.id}`
  }))

  app.post('/admin/groups/:id/rename', (c) => act(web, c, `/admin/groups/${c.req.param('id')}`, (f, s) => {
    const g = need(c.req.param('id'))
    const name = field(f, 'name')
    if (!name || name.length > 40) fail('그룹 이름은 1~40자로 정해 주세요.')
    if (name === g.name) return
    if (db.query('SELECT 1 FROM groups WHERE name = ? AND id != ?').get(name, g.id)) fail('이미 있는 그룹이에요.', 409)
    db.query('UPDATE groups SET name = ? WHERE id = ?').run(name, g.id)
    audit(db, { actor: s.user.id, action: 'group.rename', target: g.id, detail: { from: g.name, to: name } })
    say(web, s, 'ok', '이름을 바꿨어요.')
  }))

  app.post('/admin/groups/:id/members', (c) => act(web, c, `/admin/groups/${c.req.param('id')}`, (f, s) => {
    const g = need(c.req.param('id'))
    const u = getUser(db, field(f, 'userId')) ?? fail('없는 사람이에요.')
    if (u.groups.some((x) => x.id === g.id)) return
    setUserGroups(db, u.id, [...u.groups.map((x) => x.id), g.id])
    ctx.rulesChanged()
    audit(db, { actor: s.user.id, action: 'group.member_add', target: g.id, detail: { group: g.name, user: u.username } })
    say(web, s, 'ok', `${u.name}님을 넣었어요.`)
  }))

  app.post('/admin/groups/:id/members/:uid/remove', (c) => act(web, c, `/admin/groups/${c.req.param('id')}`, (_f, s) => {
    const g = need(c.req.param('id'))
    const u = getUser(db, c.req.param('uid')) ?? fail('없는 사람이에요.')
    setUserGroups(db, u.id, u.groups.map((x) => x.id).filter((id) => id !== g.id))
    ctx.rulesChanged()
    audit(db, { actor: s.user.id, action: 'group.member_remove', target: g.id, detail: { group: g.name, user: u.username } })
    say(web, s, 'ok', `${u.name}님을 뺐어요.`)
  }))

  app.post('/admin/groups/:id/delete', (c) => act(web, c, '/admin/groups', (_f, s) => {
    const g = need(c.req.param('id'))
    deleteGroup(db, g.id)
    ctx.rulesChanged()
    audit(db, { actor: s.user.id, action: 'group.delete', target: g.id, detail: { name: g.name } })
    say(web, s, 'ok', `'${g.name}' 그룹을 지웠어요.`)
  }))
}
