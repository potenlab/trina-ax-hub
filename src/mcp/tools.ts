// The MCP tools the PC's Claude Code sees as mcp__trina__<name>. Names and input schemas are a contract (docs/DESIGN.md
// "files + MCP"; hub sessions allow every name in MCP_TOOL_NAMES). Descriptions are written for the model.
import { z } from 'zod'
import type { Ctx } from '../context'
import { nowIso } from '../db'
import type { Principal } from '../policy/access'
import { Denied, ToolError } from '../policy/errors'
import { PRODUCT } from '../product'
import { FileService, READ_MAX_CHARS, READ_MAX_LINES } from '../files/service'

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export interface ToolOutcome { content: ToolContent[]; isError?: boolean; summary: string }
interface Done { content: ToolContent[]; summary: string }

interface ToolDef<S extends z.ZodType> {
  name: string
  description: string
  input: S
  run(svc: FileService, a: z.infer<S>): Done | Promise<Done>
}
const tool = <S extends z.ZodType>(d: ToolDef<S>) => d

const teamPath = (what: string) => z.string().min(1).max(1024).describe(`${what}, relative to the company team folder, e.g. "shared/보고서.md". No leading "/", "~" or "..".`)
const text = (t: string): ToolContent[] => [{ type: 'text', text: t }]

export function human(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

export const TOOLS = [
  tool({
    name: 'list_files',
    description: [
      "List folders and files in the company team folder on the Trina AX hub (shared by the company; not this computer's disk).",
      'Only what this person may see is shown. Each line is a path you can pass to the other tools; folders end with "/".',
      'Files show size and last change time. "(read-only)" marks places this person cannot change.',
    ].join(' '),
    input: z.object({
      path: z.string().max(1024).optional().describe('Folder to list, relative to the team folder. Omit (or "") for the top level.'),
      depth: z.number().int().min(1).max(3).optional().describe('How many folder levels to show, 1 to 3 (default 1).'),
    }),
    run(svc, a) {
      const r = svc.list(a.path, a.depth ?? 1)
      const head = `Team folder: ${r.path ? r.path + '/' : '(top level)'}${r.readOnly ? '  (read-only)' : ''}`
      const lines = r.entries.map((e) => e.type === 'folder'
        ? `${e.path}/${e.readOnly ? '  (read-only)' : ''}`
        : `${e.path}  ${human(e.size ?? 0)}  ${e.mtime}${e.readOnly ? '  (read-only)' : ''}`)
      const folders = r.entries.filter((e) => e.type === 'folder').length
      const tail = r.entries.length === 0 ? '(empty folder)'
        : `(${plural(folders, 'folder')}, ${plural(r.entries.length - folders, 'file')}${r.truncated ? '; the list was cut, list a smaller folder or use search_files' : ''})`
      return { content: text([head, ...lines, tail].join('\n')), summary: `${r.path || '.'} depth=${a.depth ?? 1} -> ${r.entries.length} entries` }
    },
  }),
  tool({
    name: 'read_file',
    description: [
      'Read a file from the company team folder. Text comes back with line numbers,',
      `at most ${READ_MAX_LINES} lines or about ${READ_MAX_CHARS.toLocaleString('en-US')} characters per call; use offset and limit to read further.`,
      'Word, PowerPoint, Excel, PDF and Hangul (HWP/HWPX) documents are converted to text automatically.',
      'PNG, JPEG, GIF and WebP images (up to 5 MB) are returned as images.',
    ].join(' '),
    input: z.object({
      path: teamPath('File to read'),
      offset: z.number().int().min(1).optional().describe('Line number to start at (1 = the first line). Use it to continue a long file.'),
      limit: z.number().int().min(1).max(READ_MAX_LINES).optional().describe(`How many lines to return (default and maximum ${READ_MAX_LINES}).`),
    }),
    async run(svc, a) {
      const r = await svc.read(a.path, { offset: a.offset, limit: a.limit })
      if (r.kind === 'image') {
        return { content: [{ type: 'image', data: r.data, mimeType: r.mimeType }, { type: 'text', text: `Image ${r.path} (${human(r.size)})` }], summary: `${r.path} -> image ${human(r.size)}` }
      }
      if (r.totalLines === 0) return { content: text(r.converted ? '(no text could be extracted from this document)' : '(empty file)'), summary: `${r.path} -> empty` }
      const body = r.lines.map((l, i) => `${String(r.from + i).padStart(6)}\t${l}`).join('\n')
      const notes: string[] = []
      const last = r.from + r.lines.length - 1
      if (last < r.totalLines) {
        notes.push(`Showing lines ${r.from}-${last} of ${r.totalLines}${r.cutAtChars ? ' (the page is full)' : ''}. Call read_file with offset=${last + 1} to continue.`)
      }
      if (r.converted) notes.push('Text extracted from the document; layout and images are not shown.')
      if (r.encoding !== 'utf-8') notes.push(`The file is ${r.encoding === 'euc-kr' ? 'EUC-KR (CP949)' : 'UTF-16'} text; shown converted.`)
      const out = notes.length ? `${body}\n\n[${notes.join(' ')}]` : body
      return { content: text(out), summary: `${r.path} -> lines ${r.from}-${last} of ${r.totalLines}${r.converted ? ' (converted)' : ''}` }
    },
  }),
  tool({
    name: 'search_files',
    description: [
      'Search the company team folder. mode "content" (default) finds lines that contain the query inside files, including the text of',
      'Word, Excel, PowerPoint, PDF and HWP documents; the query is a case-insensitive regular expression (ripgrep syntax; if it is not a',
      'valid one it is searched as plain text). mode "name" finds files and folders whose name contains the query.',
      'Only files this person may read are searched. Narrow it with path (a folder or a file) and glob (e.g. "*.md" or "2026/**/*.xlsx").',
    ].join(' '),
    input: z.object({
      query: z.string().min(1).max(1000).describe('Text (or regular expression) to look for; in name mode, part of a file or folder name.'),
      path: z.string().max(1024).optional().describe('Folder or file to search in, relative to the team folder (default: everything this person can read).'),
      mode: z.enum(['content', 'name']).optional().describe('"content" (default) searches inside files, "name" searches file and folder names.'),
      glob: z.string().max(300).optional().describe('Only files matching this pattern: "*.md" matches the file name, a pattern with "/" matches the path below the search folder.'),
      limit: z.number().int().min(1).max(500).optional().describe('Maximum number of results (default 100).'),
    }),
    async run(svc, a) {
      const r = await svc.search(a)
      const where = r.path || '.'
      if (r.mode === 'name') {
        const lines = r.hits.map((h) => (h.type === 'folder' ? `${h.path}/` : `${h.path}  ${human(h.size ?? 0)}  ${h.mtime}`))
        const notes = [r.truncated ? `Showing the first ${r.hits.length}; narrow the search for more.` : '', r.timedOut ? 'The search stopped at the time limit; results may be incomplete.' : ''].filter(Boolean)
        const body = lines.length ? lines.join('\n') : 'No files or folders found.'
        return { content: text(notes.length ? `${body}\n\n[${notes.join(' ')}]` : body), summary: `name in ${where} (query ${a.query.length} chars) -> ${r.hits.length} hits` }
      }
      const lines = r.hits.map((h) => `${h.path}:${h.line}: ${h.text}`)
      const notes = [
        lines.length ? `${plural(r.hits.length, 'match', 'matches')} in ${plural(r.files, 'file')}.` : '',
        r.truncated ? `Results were cut at ${r.hits.length}; narrow the search with path or glob.` : '',
        r.literal ? 'The query was not a valid regular expression, so it was searched as plain text.' : '',
        r.timedOut ? 'The search stopped at the time limit; results may be incomplete.' : '',
        r.officePending ? `${r.officePending} documents are still being indexed; search again in a minute for complete results.` : '',
      ].filter(Boolean)
      const body = lines.length ? lines.join('\n') : 'No matches.'
      return { content: text(notes.length ? `${body}\n\n[${notes.join(' ')}]` : body), summary: `content in ${where} (query ${a.query.length} chars) -> ${r.hits.length} lines in ${r.files} files` }
    },
  }),
  tool({
    name: 'write_file',
    description: [
      'Create a text file (Markdown, txt, csv, json, html, ...) in the company team folder; missing folders are created.',
      'If the file already exists the call fails unless overwrite is true; to change part of a file use edit_file instead.',
      'A replaced file is kept on the hub as an earlier version. Word, Excel, PDF and other binary formats cannot be written with this tool.',
    ].join(' '),
    input: z.object({
      path: teamPath('File to create'),
      content: z.string().describe('The full text content of the file (UTF-8).'),
      overwrite: z.boolean().optional().describe('Replace the file if it already exists (default false).'),
    }),
    run(svc, a) {
      const r = svc.write(a.path, a.content, { overwrite: a.overwrite })
      const msg = r.created ? `Created ${r.path} (${human(r.size)}).`
        : !r.changed ? `No change: ${r.path} already has this content.`
          : `Replaced ${r.path} (${human(r.size)}). The previous version is kept on the hub.`
      return { content: text(msg), summary: `${r.path} -> ${r.created ? 'created' : r.changed ? 'replaced' : 'unchanged'} ${r.size} B` }
    },
  }),
  tool({
    name: 'edit_file',
    description: [
      'Replace exact text in a text file in the company team folder. old_string must match the file exactly, including spaces and',
      'line breaks, and must occur exactly once unless replace_all is true. Read the file first and copy the text from it (without the',
      'line-number prefix). The previous version is kept on the hub.',
    ].join(' '),
    input: z.object({
      path: teamPath('File to edit'),
      old_string: z.string().describe('The exact text to replace.'),
      new_string: z.string().describe('The text to put in its place (must differ from old_string).'),
      replace_all: z.boolean().optional().describe('Replace every occurrence instead of exactly one (default false).'),
    }),
    run(svc, a) {
      const r = svc.edit(a.path, a.old_string, a.new_string, a.replace_all ?? false)
      return { content: text(`Edited ${r.path} (${plural(r.replacements, 'replacement')}). The previous version is kept on the hub.`), summary: `${r.path} -> ${r.replacements} replaced` }
    },
  }),
  tool({
    name: 'make_folder',
    description: 'Create a folder (and any missing parent folders) in the company team folder. Succeeds without change if the folder already exists.',
    input: z.object({ path: teamPath('Folder to create') }),
    run(svc, a) {
      const r = svc.makeFolder(a.path)
      return { content: text(r.created ? `Created folder ${r.path}/.` : `Folder ${r.path || '(top level)'}/ already exists.`), summary: `${r.path} -> ${r.created ? 'created' : 'exists'}` }
    },
  }),
  tool({
    name: 'move_file',
    description: [
      'Move or rename a file or folder inside the company team folder. "to" is the full new path including the name',
      '(e.g. from "shared/a.md" to "shared/2026/a.md"); missing folders are created. Needs write access at both places.',
      'Fails if "to" already exists, unless overwrite is true and both are files (the replaced file is kept on the hub).',
      'Folders that have their own permission rules cannot be moved.',
    ].join(' '),
    input: z.object({
      from: teamPath('The file or folder to move'),
      to: teamPath('Its new path, including the name'),
      overwrite: z.boolean().optional().describe('Replace an existing file at "to" (default false).'),
    }),
    run(svc, a) {
      const r = svc.move(a.from, a.to, { overwrite: a.overwrite })
      const msg = r.from === r.to ? `Nothing to do: ${r.from} is already there.` : `Moved ${r.from} to ${r.to}.${r.replacedVersionId ? ' The replaced file is kept on the hub.' : ''}`
      return { content: text(msg), summary: `${r.from} -> ${r.to}${r.replacedVersionId ? ' (replaced)' : ''}` }
    },
  }),
  tool({
    name: 'delete_file',
    description: 'Delete a file from the company team folder. It goes to the hub\'s trash (an admin can restore it); nothing is erased. A folder can be deleted only when it is empty.',
    input: z.object({ path: teamPath('File (or empty folder) to delete') }),
    run(svc, a) {
      const r = svc.remove(a.path)
      const msg = r.type === 'file' ? `Deleted ${r.path}. It was moved to the hub's trash; an admin can restore it.` : `Deleted the empty folder ${r.path}/.`
      return { content: text(msg), summary: `${r.path} -> ${r.type === 'file' ? 'trash' : 'folder removed'}` }
    },
  }),
  tool({
    name: 'read_skill',
    description: [
      "Read one of the company's skills: its SKILL.md instructions and the list of its files. Use it when a task matches a company skill",
      "listed in this server's instructions and the skill is not available on this computer, or to check a skill's details.",
      'The skill\'s other files can then be read with read_file.',
    ].join(' '),
    input: z.object({ name: z.string().min(1).max(300).describe('The skill name as listed (e.g. "quote-draft"), "company:<name>", or its folder path under skills/.') }),
    run(svc, a) {
      const r = svc.readSkill(a.name)
      const files = r.files.length ? `Files (read them with read_file):\n${r.files.map((f) => `- ${f}`).join('\n')}` : 'Files: only SKILL.md.'
      const out = [`Skill: ${r.name} (${r.path}/)`, `Description: ${r.description}`, files, '', '--- SKILL.md ---', r.text].join('\n')
      return { content: text(out), summary: `${r.path} (${r.name})` }
    },
  }),
] as const

export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name)
/** The names Claude Code gives these tools (`--allowedTools` for hub sessions). */
export const MCP_TOOL_NAMES: string[] = TOOL_NAMES.map((n) => `mcp__${PRODUCT.mcpName}__${n}`)

const byName = new Map<string, ToolDef<z.ZodType>>(TOOLS.map((t) => [t.name, t as unknown as ToolDef<z.ZodType>]))

let listed: { name: string; description: string; inputSchema: Record<string, unknown> }[] | null = null
/** tools/list entries: JSON Schema (draft-7) from the zod inputs, without $schema. */
export function toolList() {
  return (listed ??= TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input, { target: 'draft-7' }) as Record<string, unknown>
    delete schema.$schema
    return { name: t.name, description: t.description, inputSchema: schema }
  }))
}

export const hasTool = (name: string) => byName.has(name)

/** The path-like argument of a call, for the audit summary (never contents). */
function pathOf(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  for (const k of ['path', 'from', 'name']) if (typeof a[k] === 'string') return (a[k] as string).slice(0, 200)
  return ''
}

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')

/** Text of one result at most (see READ_MAX_CHARS: larger results leave the model with a 2 KB preview only). */
export const OUTPUT_MAX_CHARS = 40_000

/** Cut an over-long text result at a line boundary, with a note on how to get the rest. */
function clamp(out: Done, tool: string): Done {
  const content = out.content.map((c) => {
    if (c.type !== 'text' || c.text.length <= OUTPUT_MAX_CHARS) return c
    const room = OUTPUT_MAX_CHARS - 200
    const cut = c.text.lastIndexOf('\n', room)
    const how = tool === 'read_skill' ? 'read the rest of SKILL.md with read_file and an offset'
      : tool === 'list_files' ? 'list a smaller folder or use a smaller depth'
        : 'narrow it with path, glob or a smaller limit'
    return { type: 'text' as const, text: `${c.text.slice(0, cut > room / 2 ? cut : room)}\n\n[Output cut at ${OUTPUT_MAX_CHARS.toLocaleString('en-US')} characters; ${how}.]` }
  })
  return { ...out, content }
}

/**
 * Run one tool for `user` and record a tool_events row (who, which token, tool, a short summary with the path, ok).
 * Never throws: every failure comes back as an isError result the model can read.
 */
export async function callTool(ctx: Ctx, user: Principal, tokenId: string | null, name: string, args: unknown): Promise<ToolOutcome> {
  const def = byName.get(name)
  let out: ToolOutcome
  if (!def) out = { content: text(`Error: unknown tool '${name}'`), isError: true, summary: 'unknown tool' }
  else {
    const parsed = def.input.safeParse(args ?? {})
    if (!parsed.success) out = { content: text(`Invalid input: ${issues(parsed.error)}`), isError: true, summary: `${pathOf(args)} -> invalid input` }
    else {
      try {
        out = clamp(await def.run(new FileService(ctx, user), parsed.data), name)
      } catch (e) {
        out = failure(ctx, name, args, e)
      }
    }
  }
  recordToolEvent(ctx, user.id, tokenId, name, out)
  return out
}

function failure(ctx: Ctx, name: string, args: unknown, e: unknown): ToolOutcome {
  const p = pathOf(args)
  if (e instanceof Denied || e instanceof ToolError) {
    const hint = e.message.startsWith('not found or no access') ? '. Check the path with list_files or search_files.' : ''
    return { content: text(`Error: ${e.message}${hint}`), isError: true, summary: `${p} -> ${e instanceof Denied ? 'denied' : 'error'}: ${e.message}` }
  }
  ctx.log.error('tool failed', { tool: name, err: String((e as Error)?.message ?? e).slice(0, 300) })
  return { content: text('Error: the hub could not complete this request (internal error). Try again, or tell an admin if it keeps happening.'), isError: true, summary: `${p} -> internal error` }
}

export function recordToolEvent(ctx: Ctx, userId: string, tokenId: string | null, name: string, out: Pick<ToolOutcome, 'summary' | 'isError'>) {
  try {
    ctx.db.query('INSERT INTO tool_events (user_id, token_id, tool, summary, ok, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, tokenId, name.slice(0, 64), out.summary.replace(/\s+/g, ' ').slice(0, 300), out.isError ? 0 : 1, nowIso())
  } catch (e) {
    ctx.log.warn('tool event not recorded', { tool: name.slice(0, 64), err: String((e as Error)?.message ?? e).slice(0, 200) })
  }
}
