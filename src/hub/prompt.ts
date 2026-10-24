// The short text appended to Claude Code's system prompt for a hub session (--append-system-prompt): who the person
// is, how to reach company files (only the trina MCP tools), the company rules and the skills they may use.
// Claude Code records the system prompt on a conversation's first request and reuses it on --resume, so nothing in
// a chat's prompt may depend on the time of a later turn.
import type { Ctx } from '../context'
import type { Principal } from '../policy/access'
import { rulesFor, skillsFor } from '../skills/catalog'
import { PRODUCT } from '../product'

const RULES_MAX = 1500
const SKILLS_MAX = 1500
const ROLE: Record<Principal['role'], string> = { owner: '대표', admin: '관리자', member: '직원' }

export type PromptKind = { kind: 'chat' } | { kind: 'schedule'; name: string; outputDir: string; at: Date }

export function groupNames(ctx: Ctx, ids: string[]): string[] {
  if (!ids.length) return []
  const rows = ctx.db.query(`SELECT name FROM groups WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`).all(...ids) as { name: string }[]
  return rows.map((r) => r.name)
}

const fmtRunAt = (d: Date) =>
  new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d)

export function buildSystemPrompt(ctx: Ctx, user: Principal, o: PromptKind): string {
  const t = (name: string) => `mcp__${PRODUCT.mcpName}__${name}`
  const groups = groupNames(ctx, user.groups)
  const lines: string[] = [
    `# ${PRODUCT.displayName} 허브`,
    `상대: ${user.name}님 (${ROLE[user.role]}${groups.length ? `, 그룹: ${groups.join(', ')}` : ''}).`,
  ]
  if (o.kind === 'chat') {
    lines.push('휴대폰 채팅으로 묻고 있어요. 휴대폰 화면에서 읽기 좋게 짧고 분명하게 답하세요.')
  } else {
    lines.push(
      `예약 작업 "${o.name}"이 ${fmtRunAt(o.at)}에 자동으로 실행됐어요. 답을 기다리는 사람이 없으니 되묻지 말고 끝까지 해내세요.`,
      `마지막 답은 Markdown 보고서로 쓰세요. 그 답이 그대로 팀 폴더 ${o.outputDir || '(최상위)'}/ 에 파일로 저장돼요.`,
    )
  }
  lines.push(
    '따로 요청이 없으면 한국어(존댓말)로 답하세요.',
    `회사 파일은 trina 도구로만 다룰 수 있어요: ${['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'make_folder', 'move_file', 'delete_file'].map(t).join(', ')}. ` +
      '경로는 팀 폴더 기준 상대 경로예요(예: shared/회의록.md). 이 컴퓨터의 다른 파일, 명령 실행, 웹 검색은 쓸 수 없어요.',
    `${user.name}님의 개인 폴더: users/${user.id}/`,
    '파일을 만들거나 바꾸거나 옮기거나 지웠다면 무엇을 했는지 답에 적으세요.',
  )
  const root = ctx.fx.root
  const rules = ctx.rules()
  const rulesText = rulesFor(root, rules, user, RULES_MAX)
  if (rulesText) lines.push('', '## 회사 규칙 (skills/RULES.md)', rulesText)
  const skills = skillsFor(root, rules, user)
  if (skills.length) {
    lines.push('', `## 쓸 수 있는 스킬`, `스킬을 쓰려면 먼저 ${t('read_skill')} 도구로 열어서 그 안내를 따르세요.`)
    let used = 0
    let shown = 0
    for (const s of skills) {
      const line = `- ${s.name}: ${s.description.length > 160 ? s.description.slice(0, 160) + '…' : s.description}`
      if (used + line.length > SKILLS_MAX) break
      lines.push(line)
      used += line.length + 1
      shown++
    }
    if (shown < skills.length) lines.push(`- 외 ${skills.length - shown}개 (list_files로 skills/ 폴더를 보면 전체를 알 수 있어요)`)
  }
  return lines.join('\n')
}
