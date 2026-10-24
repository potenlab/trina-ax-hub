// Which skills the model invoked. Claude Code runs a skill through its `Skill` tool, so a skill use shows up in the
// model's answer as a tool_use block named "Skill" whose input names the skill: `{"skill": "quote-draft"}` (older
// versions: `command` or `name`). Company skills come from the "company" plugin and may be named `company:<skill>`;
// the prefix is dropped so they count under the same name as skill files read through MCP.

/** Claude Code's tool that runs a skill */
export const SKILL_TOOL = 'Skill'
const PLUGIN_PREFIX = 'company:'
const MAX_NAME = 120
/** a Skill tool input is tiny; anything bigger is not one we can use */
const MAX_INPUT = 64 * 1024

/** The skill a Skill tool input names, normalized; null when it names none. */
export function skillName(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  const raw = [o.skill, o.command, o.name].find((v) => typeof v === 'string' && v.trim())
  if (typeof raw !== 'string') return null
  // `command` once carried "/name args": the first word is the skill
  let name = raw.trim().split(/\s+/)[0]!.replace(/^\/+/, '')
  if (name.startsWith(PLUGIN_PREFIX)) name = name.slice(PLUGIN_PREFIX.length)
  if (!name || name.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/** Skill tool_use blocks in a non-streaming response's `content`. */
export function skillsInContent(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const b of content as Record<string, unknown>[]) {
    if (b && b.type === 'tool_use' && b.name === SKILL_TOOL) {
      const s = skillName(b.input)
      if (s) out.push(s)
    }
  }
  return out
}

/** Follows Skill tool_use blocks through a stream: start → input_json_delta pieces → stop. */
export class SkillCollector {
  private readonly open = new Map<number, { json: string; input: unknown }>()

  get collecting(): boolean { return this.open.size > 0 }

  /** content_block_start */
  start(index: unknown, block: unknown) {
    const b = block as Record<string, unknown> | null
    if (typeof index !== 'number' || !b || b.type !== 'tool_use' || b.name !== SKILL_TOOL) return
    this.open.set(index, { json: '', input: b.input })
  }

  /** content_block_delta */
  delta(index: unknown, delta: unknown) {
    const d = delta as Record<string, unknown> | null
    const block = typeof index === 'number' ? this.open.get(index) : undefined
    if (!block || !d || d.type !== 'input_json_delta' || typeof d.partial_json !== 'string') return
    if (block.json.length + d.partial_json.length > MAX_INPUT) { this.open.delete(index as number); return }
    block.json += d.partial_json
  }

  /** content_block_stop: the skill this block named, if it was a Skill block */
  stop(index: unknown): string | null {
    const block = typeof index === 'number' ? this.open.get(index) : undefined
    if (!block) return null
    this.open.delete(index as number)
    if (!block.json.trim()) return skillName(block.input)
    try { return skillName(JSON.parse(block.json)) } catch { return null }
  }
}
