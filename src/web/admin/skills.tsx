/** @jsxImportSource hono/jsx */
// Skills: packs → skills with descriptions, who can use each pack (from the folder rules), RULES.md preview.
import fs from 'node:fs'
import path from 'node:path'
import type { App, C } from '../../http/app'
import { scanSkills, SKILLS_DIR, RULES_FILE, type Skill } from '../../skills/catalog'
import { atLeast, loadPrincipal } from '../../policy/access'
import { listUsers } from '../../auth/users'
import { skillReport } from '../../usage/report'
import { fmtNum, monthStart } from '../../ui/format'
import { type Web, type Flash, Shell, Empty, render, takeFlashes } from '../kit'
import { nextMonthStart } from '../me'

const PREVIEW_CHARS = 8000

function readRules(root: string): string | null {
  const file = path.join(root, SKILLS_DIR, RULES_FILE)
  try {
    if (!fs.lstatSync(file).isFile()) return null
    const t = fs.readFileSync(file, 'utf8')
    return t.length > PREVIEW_CHARS ? t.slice(0, PREVIEW_CHARS) + '\n…' : t
  } catch { return null }
}

function SkillsPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { ctx } = p.web
  const skills = scanSkills(ctx.fx.root)
  const packs = new Map<string, Skill[]>()
  for (const s of skills) packs.set(s.pack, [...(packs.get(s.pack) ?? []), s])
  const rules = ctx.rules()
  const people = listUsers(ctx.db).filter((u) => u.status === 'active').map((u) => loadPrincipal(ctx.db, u.id)!).filter(Boolean)
  const audience = (segs: string[]) => people.filter((pr) => atLeast(rules.access(pr, segs), 'read'))
  const now = new Date()
  const uses = new Map<string, number>()
  for (const r of skillReport(ctx.db, monthStart(now), nextMonthStart(now))) {
    const k = r.key.includes(':') ? r.key.slice(r.key.lastIndexOf(':') + 1) : r.key
    uses.set(k, (uses.get(k) ?? 0) + r.count)
  }
  const rulesText = readRules(ctx.fx.root)
  return (
    <Shell c={p.c} title="스킬" active="/admin/skills" flashes={p.flashes}>
      <h1>스킬</h1>
      <p class="lead">팀 폴더의 skills/ 에 있는 회사 스킬이에요. 읽기 권한이 있는 사람의 PC에 'company' 플러그인으로 자동 설치돼요.</p>

      {packs.size ? [...packs].map(([pack, xs]) => {
        const who = audience([SKILLS_DIR, pack])
        const everyone = who.length === people.length
        return (
          <div class="card">
            <div class="sec" style="margin-top:0"><h2>{pack} <span class="muted small">{xs.length}개</span></h2>
              <span class="small">{everyone ? <span class="badge good">모든 사람</span> : <span class="badge">{who.length}명</span>}</span></div>
            {everyone ? null : (
              <p class="small muted" style="margin:0 0 10px">쓸 수 있는 사람: {who.length ? who.map((w) => w.name).join(', ') : '없음'} ·{' '}
                <a href="/admin/folders">폴더 권한에서 바꾸기</a></p>
            )}
            <div class="tablewrap" style="margin:0"><table>
              <thead><tr><th>스킬</th><th>설명</th><th class="num hide-sm">이번 달</th></tr></thead>
              <tbody>{xs.map((s) => {
                const sw = audience(s.path.split('/'))
                return (
                  <tr><td><b>{s.name}</b><div class="muted small"><code>{s.path}</code></div>
                    {sw.length !== who.length ? <div class="small"><span class="badge warn">{sw.length}명만</span></div> : null}</td>
                    <td class="muted">{s.description}</td>
                    <td class="num hide-sm">{fmtNum((uses.get(s.name) ?? 0) + (s.name !== s.dir ? uses.get(s.dir) ?? 0 : 0))}회</td></tr>
                )
              })}</tbody>
            </table></div>
          </div>
        )
      }) : <Empty title="아직 스킬이 없어요">아래 방법으로 첫 스킬을 넣어 보세요.</Empty>}

      <div class="sec"><h2>회사 규칙 (RULES.md)</h2><span class="muted small">모든 직원의 Claude가 항상 따르는 내용</span></div>
      {rulesText !== null && rulesText.trim()
        ? <pre class="preview">{rulesText}</pre>
        : <Empty title="회사 규칙이 아직 없어요">팀 폴더에 skills/RULES.md 를 만들고 "항상 존댓말로 답한다"처럼 적으면 모든 직원의 Claude가 따라요.</Empty>}

      <div class="card" style="margin-top:28px">
        <h2>스킬 넣는 법</h2>
        <ol class="steps">
          <li>팀 폴더에서 <code>skills/&lt;묶음&gt;/&lt;스킬 이름&gt;/SKILL.md</code> 를 만들어요. 모두가 쓰는 스킬은 <code>skills/company/</code> 에 둬요.</li>
          <li>부서 전용 스킬은 <code>skills/영업</code> 같은 묶음 폴더에 두고, 폴더 권한에서 그 폴더의 읽기 권한을 그 그룹에만 줘요.</li>
          <li>직원 PC의 Claude Code는 다시 열 때 새 스킬을 자동으로 받아요.</li>
        </ol>
        <p class="muted small" style="margin:0">팀 폴더 위치(허브 컴퓨터): <code>{ctx.config.teamRoot}</code></p>
      </div>
    </Shell>
  )
}

export function mountSkills(app: App, web: Web) {
  app.get('/admin/skills', (c) => render(c, <SkillsPage web={web} c={c} flashes={takeFlashes(web, c)} />))
}
