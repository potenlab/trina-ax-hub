/** @jsxImportSource hono/jsx */
// Folder permissions: the team folder's top two levels (from disk), the rules, add/remove a rule, and a quick
// "what can this person do here" check.
import fs from 'node:fs'
import path from 'node:path'
import type { App, C } from '../../http/app'
import type { Ctx } from '../../context'
import { listRules, setRule, type RuleView, type Subject } from '../../policy/rules-admin'
import { loadPrincipal, type Access } from '../../policy/access'
import { parseInput, walk } from '../../policy/resolve'
import { badSegment, hiddenEntry } from '../../policy/names'
import { listGroups, listUsers } from '../../auth/users'
import { audit } from '../../audit'
import { PRODUCT } from '../../product'
import { Csrf } from '../../ui/layout'
import { type Web, type Flash, Shell, Empty, ButtonForm, render, takeFlashes, act, say, fail, field, ACCESS_LABEL } from '../kit'

const MAX_PER_LEVEL = 60

export interface TreeNode { name: string; path: string; children: TreeNode[]; more: number }

/** Folder names a person could see in the team folder (no hidden, server-internal, odd or linked entries). */
function subfolders(abs: string, depth: number): { names: string[]; more: number } {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return { names: [], more: 0 } }
  const names = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !hiddenEntry(e.name, depth) && badSegment(e.name) === null)
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ko'))
  return { names: names.slice(0, MAX_PER_LEVEL), more: Math.max(0, names.length - MAX_PER_LEVEL) }
}

/** Top two levels of the team folder. users/ is shown without its personal folders. */
export function folderTree(root: string): TreeNode[] {
  const top = subfolders(root, 0)
  return top.names.map((name) => {
    if (name === 'users' || name === PRODUCT.systemDir) return { name, path: name, children: [], more: 0 }
    const sub = subfolders(path.join(root, name), 1)
    return { name, path: name, children: sub.names.map((n) => ({ name: n, path: `${name}/${n}`, children: [], more: 0 })), more: sub.more }
  })
}

export const subjectLabel = (r: Pick<RuleView, 'subjectType' | 'subjectName' | 'subjectId'>) =>
  r.subjectType === 'everyone' ? '모두' : r.subjectType === 'role' ? (r.subjectId === 'admin' ? '관리자 역할' : '직원 역할 전체') : r.subjectType === 'group' ? `그룹 · ${r.subjectName}` : r.subjectName

const accessBadge = (a: Access) => <span class={'badge' + (a === 'write' ? ' good' : a === 'none' ? ' bad' : '')}>{ACCESS_LABEL[a]}</span>

const RuleChips = (p: { rules: RuleView[] }) => (
  p.rules.length ? <span class="chips" style="display:inline-flex;margin-left:6px">{p.rules.map((r) => <span class="badge">{subjectLabel(r)} · {ACCESS_LABEL[r.access]}</span>)}</span> : null
)

/** Team-folder path typed by an admin → actual on-disk names ('' = the whole team folder). */
export function canonicalFolder(ctx: Ctx, input: string): { path: string; exists: boolean } {
  const t = input.trim().replace(/^\/+|\/+$/g, '')
  if (t === '') return { path: '', exists: true }
  const segs = parseInput(t)
  const w = walk(ctx.fx.root, segs, ctx.fx.caseInsensitive)
  const exists = w.missing.length === 0 && w.st.isDirectory()
  return { path: [...w.actual, ...w.missing].join('/'), exists }
}

function parseSubject(v: string): { type: Subject; id: string | null } {
  if (v === 'everyone') return { type: 'everyone', id: null }
  const m = /^(role|group|user):(.+)$/.exec(v)
  if (!m) fail('누구에게 줄지 골라 주세요.')
  return { type: m![1] as Subject, id: m![2]! }
}

function FoldersPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { ctx } = p.web
  const s = p.c.get('session')!
  const tree = folderTree(ctx.fx.root)
  const rules = listRules(ctx.db)
  const byPath = new Map<string, RuleView[]>()
  for (const r of rules) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r])
  const groups = listGroups(ctx.db)
  const people = listUsers(ctx.db).filter((u) => u.status === 'active')
  const known = [...new Set([...tree.flatMap((n) => [n.path, ...n.children.map((c) => c.path)]).filter((x) => x !== 'users'), ...rules.map((r) => r.path).filter(Boolean)])].sort()
  // access check
  const checkUser = p.c.req.query('who') ?? ''
  const checkPath = p.c.req.query('path') ?? ''
  let checked: { name: string; path: string; access: Access } | { error: string } | null = null
  if (checkUser) {
    const pr = loadPrincipal(ctx.db, checkUser)
    try {
      const f = canonicalFolder(ctx, checkPath)
      checked = pr ? { name: pr.name, path: f.path, access: ctx.rules().access(pr, f.path ? f.path.split('/') : []) } : { error: '없거나 꺼진 계정이에요.' }
    } catch { checked = { error: '폴더 경로가 올바르지 않아요.' } }
  }
  return (
    <Shell c={p.c} title="폴더 권한" active="/admin/folders" flashes={p.flashes}>
      <h1>폴더 권한</h1>
      <p class="lead">누가 어떤 회사 폴더를 보고 고칠 수 있는지 정해요. 직원 PC의 Claude도 똑같이 이 권한을 따라요.</p>

      <div class="card">
        <h2>이렇게 정해져요</h2>
        <ul style="margin:0;padding-left:20px">
          <li>규칙은 폴더에 붙고, 그 아래 폴더에도 그대로 적용돼요. 더 아래 폴더에 규칙을 두면 그게 우선이에요.</li>
          <li>같은 폴더에서 여러 규칙이 맞으면 <b>사람 › 그룹 › 직원 역할 › 모두</b> 순서로 정해요.</li>
          <li>관리자와 소유자는 규칙과 상관없이 모든 폴더를 쓸 수 있어요. 개인 폴더(users/)는 본인만 열 수 있어요.</li>
          <li>맞는 규칙이 하나도 없는 폴더는 보이지 않아요.</li>
        </ul>
      </div>

      <div class="sec"><h2>팀 폴더</h2><span class="muted small">위 두 단계까지 보여요 · <a href="/files">회사 파일 열기</a></span></div>
      <form method="post" action="/files/folder" class="card" style="padding:12px 16px">
        <Csrf token={s.csrf} />
        <input type="hidden" name="dir" value="" />
        <input type="hidden" name="next" value="/admin/folders" />
        <div class="row">
          <div class="field" style="margin:0;max-width:380px"><label for="newfolder">새 폴더 (맨 위에 만들어요)</label>
            <input id="newfolder" name="name" placeholder="예: 영업, 재무, 공지" required maxlength={80} autocomplete="off" /></div>
          <div><button class="btn" type="submit">새 폴더</button></div>
        </div>
      </form>
      {tree.length ? (
        <div class="card"><ul class="tree">
          {byPath.has('') ? <li><span class="name">(팀 폴더 전체)</span><RuleChips rules={byPath.get('')!} /></li> : null}
          {tree.map((n) => (
            <li>
              <span class="name">📁 {n.name}</span>
              {n.name === 'users' ? <span class="muted small"> · 개인 폴더 (본인만)</span> : <><RuleChips rules={byPath.get(n.path) ?? []} /> <a class="small" style="margin-left:8px" href={`/files?path=${encodeURIComponent(n.path)}`}>파일 보기</a></>}
              {n.children.length ? (
                <ul>{n.children.map((ch) => <li><span class="name">{ch.name}</span><RuleChips rules={byPath.get(ch.path) ?? []} /></li>)}
                  {n.more ? <li class="muted small">…외 {n.more}개</li> : null}</ul>
              ) : null}
            </li>
          ))}
        </ul></div>
      ) : <Empty title="팀 폴더가 비어 있어요">위에서 새 폴더를 만들거나, <a href="/files">회사 파일</a>에서 파일을 올려 보세요. 폴더가 생기면 여기에 보여요.</Empty>}

      <div class="sec"><h2>규칙</h2><span class="muted small">{rules.length}개</span></div>
      {rules.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>폴더</th><th>누구</th><th>권한</th><th></th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr>
              <td><code>{r.path || '(팀 폴더 전체)'}</code></td><td>{subjectLabel(r)}</td><td>{accessBadge(r.access)}</td>
              <td class="right"><ButtonForm action="/admin/folders/rules/delete" csrf={s.csrf} label="지우기" danger
                hidden={{ path: r.path, subjectType: r.subjectType, subjectId: r.subjectId ?? '' }}
                confirm={`${r.path || '팀 폴더 전체'}의 '${subjectLabel(r)}' 규칙을 지울까요?`} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title="규칙이 없어요">아래에서 첫 규칙을 만들어 보세요.</Empty>}

      <form method="post" action="/admin/folders/rules" class="card" id="add">
        <h2>규칙 추가</h2>
        <Csrf token={s.csrf} />
        <div class="row">
          <div class="field"><label for="path">폴더</label>
            <input id="path" name="path" list="folders" required placeholder="예: shared/회계" autocapitalize="off" />
            <datalist id="folders">{known.map((k) => <option value={k} />)}</datalist></div>
          <div class="field"><label for="subject">누구</label>
            <select id="subject" name="subject">
              <option value="everyone">모두</option>
              <option value="role:member">직원 역할 전체</option>
              {groups.length ? <optgroup label="그룹">{groups.map((g) => <option value={`group:${g.id}`}>{g.name}</option>)}</optgroup> : null}
              <optgroup label="사람">{people.map((u) => <option value={`user:${u.id}`}>{u.name} ({u.username})</option>)}</optgroup>
            </select></div>
          <div class="field" style="max-width:170px"><label for="access">권한</label>
            <select id="access" name="access"><option value="read">읽기</option><option value="write">읽기·쓰기</option><option value="none">볼 수 없음</option></select></div>
        </div>
        <p class="muted small">같은 폴더·같은 대상의 규칙이 이미 있으면 새 권한으로 바뀌어요. 팀 폴더 전체에 주려면 / 를 적어요.</p>
        <button class="btn primary" type="submit">추가하기</button>
      </form>

      <form method="get" action="/admin/folders#check" class="card" id="check">
        <h2>권한 확인</h2>
        <div class="row">
          <div class="field"><label for="who">사람</label>
            <select id="who" name="who">{people.map((u) => <option value={u.id} selected={u.id === checkUser}>{u.name} ({u.username})</option>)}</select></div>
          <div class="field"><label for="cpath">폴더</label><input id="cpath" name="path" list="folders" value={checkPath} placeholder="예: shared/회계" autocapitalize="off" /></div>
          <div><button class="btn" type="submit" style="margin-bottom:12px">확인</button></div>
        </div>
        {checked ? ('error' in checked
          ? <div class="notice bad">{checked.error}</div>
          : <div class="notice"><b>{checked.name}</b>님은 <code>{checked.path || '(팀 폴더 전체)'}</code> 에서 {accessBadge(checked.access)} 권한이에요.</div>) : null}
      </form>
    </Shell>
  )
}

export function mountFolders(app: App, web: Web) {
  const { ctx } = web
  const db = ctx.db

  app.get('/admin/folders', (c) => render(c, <FoldersPage web={web} c={c} flashes={takeFlashes(web, c)} />))

  app.post('/admin/folders/rules', (c) => act(web, c, '/admin/folders', (f, s) => {
    const raw = field(f, 'path')
    if (!raw) fail('폴더를 적어 주세요. 팀 폴더 전체는 / 예요.')
    const folder = canonicalFolder(ctx, raw)
    const subject = parseSubject(field(f, 'subject'))
    const access = field(f, 'access') as Access
    if (!['none', 'read', 'write'].includes(access)) fail('권한을 골라 주세요.')
    setRule(db, folder.path, subject.type, subject.id, access)
    ctx.rulesChanged()
    const label = subjectLabel({ subjectType: subject.type, subjectId: subject.id, subjectName: listRules(db).find((r) => r.path === folder.path && r.subjectType === subject.type && r.subjectId === subject.id)?.subjectName ?? '' })
    audit(db, { actor: s.user.id, action: 'rule.set', target: folder.path || '/', detail: { subject: label, access } })
    say(web, s, 'ok', `${folder.path || '팀 폴더 전체'}: ${label} → ${ACCESS_LABEL[access]}`)
    if (!folder.exists) say(web, s, 'warn', `'${folder.path}' 폴더는 아직 없어요. 그 이름으로 폴더를 만들면 이 규칙이 적용돼요.`)
  }))

  app.post('/admin/folders/rules/delete', (c) => act(web, c, '/admin/folders', (f, s) => {
    const p = field(f, 'path')
    const type = field(f, 'subjectType') as Subject
    const id = field(f, 'subjectId') || null
    const rule = listRules(db).find((r) => r.path === p && r.subjectType === type && (r.subjectId ?? null) === id)
    if (!rule) return say(web, s, 'bad', '이미 지운 규칙이에요.')
    setRule(db, p, type, id, null)
    ctx.rulesChanged()
    audit(db, { actor: s.user.id, action: 'rule.remove', target: p || '/', detail: { subject: subjectLabel(rule), access: rule.access } })
    say(web, s, 'ok', '규칙을 지웠어요.')
  }))
}
