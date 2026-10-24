// The MCP `instructions` Claude Code puts into the model's system prompt ("MCP Server Instructions"): who the person
// is, how company files are reached, the company rules (skills/RULES.md) and the person's skills. Claude Code cuts
// server instructions at 4,096 characters, so this stays at or under INSTRUCTIONS_MAX.
import type { Ctx } from '../context'
import { getSetting } from '../db'
import type { Principal } from '../policy/access'
import { rulesFor, skillsFor } from '../skills/catalog'

export const INSTRUCTIONS_MAX = 3500
/** Settings key of the company name (set on /setup and /admin/settings). */
export const COMPANY_NAME_SETTING = 'companyName'

const RULES_MAX = 1400
const SKILL_LINE_MAX = 160
const ROLE: Record<Principal['role'], string> = { owner: 'owner', admin: 'admin', member: 'member' }

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function groupNames(ctx: Ctx, user: Principal): string[] {
  if (!user.groups.length) return []
  const rows = ctx.db.query(`SELECT name FROM groups WHERE id IN (${user.groups.map(() => '?').join(',')}) ORDER BY name`).all(...user.groups) as { name: string }[]
  return rows.map((r) => r.name)
}

export function buildInstructions(ctx: Ctx, user: Principal): string {
  const company = oneLine(getSetting<string>(ctx.db, COMPANY_NAME_SETTING, '') || '', 80)
  const name = oneLine(user.name, 60) || 'this person'
  const groups = oneLine(groupNames(ctx, user).join(', '), 200)
  const rules = ctx.rules()

  const head = [
    `Trina AX: the shared file hub${company ? ` of ${company}` : ' of this company'}.`,
    `You are working with ${name} (${ROLE[user.role]}${groups ? `; groups: ${groups}` : ''}).`,
    '',
    'Company files live in the team folder on this hub, not on this computer. Reach them only through these tools '
      + '(list_files, read_file, search_files, write_file, edit_file, make_folder, move_file, delete_file, read_skill), with paths '
      + 'relative to the team folder such as "shared/report.md" (never local paths, "/" or "~"). '
      + `Every call runs with ${name}'s folder permissions: a folder they may not see looks exactly like one that does not exist, `
      + 'and read-only places refuse changes. Overwritten and deleted files are kept on the hub, and an admin can restore them.',
    user.noPersonal
      ? `${name}'s personal folder stays closed on this computer until ${name} approves it on their 내 PC page (someone else set it up). `
        + 'Save work in the matching team folder.'
      : `${name}'s personal folder is users/${user.id}/ (only they can see it). Use it for drafts and personal notes; `
        + 'save work that others should see in the matching team folder.',
  ].join('\n')

  const rulesText = rulesFor(ctx.fx.root, rules, user, 4000)
  const skills = skillsFor(ctx.fx.root, rules, user)
  const skillHead = '\nCompany skills, installed on this computer as the "company" plugin (their files are under skills/ in the team folder; '
    + 'if a skill is not available here, read_skill shows its instructions):'
  const skillLines = skills.map((s) => `- ${oneLine(s.name, 64)}: ${oneLine(s.description, SKILL_LINE_MAX)}`)
  const rulesHead = '\nCompany rules (skills/RULES.md), always follow them:'

  // the rules get what the skill list leaves, at least RULES_MAX; the skill list gets the rest, cut line by line
  const fixed = head.length + (skills.length ? skillHead.length : 0) + (rulesText ? rulesHead.length + 1 : 0)
  const skillsFull = skillLines.reduce((n, l) => n + l.length + 1, 0)
  const rulesBudget = Math.max(Math.min(RULES_MAX, rulesText.length), INSTRUCTIONS_MAX - fixed - skillsFull - 4)
  const rulesShown = rulesText ? trimTo(rulesText, rulesBudget) : ''

  const parts = [head]
  if (rulesShown) parts.push(rulesHead, rulesShown)
  let out = parts.join('\n')
  if (skills.length) out += '\n' + fitSkills(skillHead, skillLines, INSTRUCTIONS_MAX - out.length - 1)
  return out.length > INSTRUCTIONS_MAX ? out.slice(0, INSTRUCTIONS_MAX - 1) + '…' : out
}

function trimTo(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 40)).trimEnd() + '\n… (read skills/RULES.md for the rest)'
}

/** The skill header and as many skill lines as fit in `room`, then "… and N more". */
function fitSkills(head: string, lines: string[], room: number): string {
  const out = [head]
  let used = head.length
  for (let i = 0; i < lines.length; i++) {
    const more = `- … and ${lines.length - i} more (list_files skills/ or read_skill to see them)`
    const l = lines[i]!
    const needMore = i < lines.length - 1 ? more.length + 1 : 0
    if (used + l.length + 1 + needMore > room) {
      if (used + more.length + 1 <= room) out.push(more)
      break
    }
    out.push(l)
    used += l.length + 1
  }
  return out.join('\n')
}
