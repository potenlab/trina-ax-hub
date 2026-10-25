// Pure pieces of the relay: the SSE reader, the usage/skill tap, skill names and the request rules.
import { describe, expect, test } from 'bun:test'
import { SseReader, MessageTap, mergeUsage, tapMessage, deltaChars, type MessageSink } from '../../src/relay/sse'
import { skillName, skillsInContent, SkillCollector } from '../../src/relay/skills'
import { checkBody, upstreamUrl, upstreamHeaders, responseHeaders, refusedTool } from '../../src/relay/proxy'
import { UsageRecorder, estimateOutputTokens, CHARS_PER_TOKEN } from '../../src/relay/record'
import { errorInfo, NOTED_STATUS } from '../../src/relay/upstream'
import { Inflight } from '../../src/relay/inflight'
import type { Ctx } from '../../src/context'
import type { ApiUsage } from '../../src/relay/pricing'

const enc = new TextEncoder()

function read(pieces: (string | Uint8Array)[]): [string, string][] {
  const out: [string, string][] = []
  const r = new SseReader((e, d) => out.push([e, d]))
  for (const p of pieces) r.push(typeof p === 'string' ? enc.encode(p) : p)
  r.end()
  return out
}

function sink(): MessageSink & { skills: string[]; errors: string[] } {
  const skills: string[] = []
  const errors: string[] = []
  return { model: 'asked', usage: {} as ApiUsage, skills, errors, skill: (s) => { skills.push(s) }, streamError: (t, m) => { errors.push(`${t}: ${m}`) } }
}

describe('SseReader', () => {
  test('events with names, CRLF, comments, multi-line data', () => {
    expect(read(['event: a\r\ndata: {"x":1}\r\n\r\n', ': comment\n\n', 'data: one\ndata: two\n\n', 'event: b\ndata:no-space\n\n']))
      .toEqual([['a', '{"x":1}'], ['', 'one\ntwo'], ['b', 'no-space']])
  })

  test('lines and multi-byte characters split across chunks', () => {
    const bytes = enc.encode('event: t\ndata: {"text":"견적서"}\n\n')
    const pieces = Array.from({ length: bytes.length }, (_, i) => bytes.slice(i, i + 1))
    expect(read(pieces)).toEqual([['t', '{"text":"견적서"}']])
  })

  test('a last event without the blank line still counts at the end', () => {
    expect(read(['data: tail'])).toEqual([['', 'tail']])
  })
})

describe('MessageTap', () => {
  const ev = (type: string, d: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...d })}\n\n`

  test('model and usage from message_start, running output total from message_delta', () => {
    const s = sink()
    const tap = new MessageTap(s)
    tap.push(enc.encode(ev('message_start', { message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 2 }, service_tier: 'standard' } } })))
    tap.push(enc.encode(ev('message_delta', { usage: { output_tokens: 40 } }) + ev('message_delta', { usage: { output_tokens: 90, input_tokens: null, server_tool_use: { web_search_requests: 2 } } })))
    tap.end()
    expect(s.model).toBe('claude-opus-5-5')
    expect(s.usage).toEqual({ input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 90, cache_creation: { ephemeral_5m_input_tokens: 2 }, service_tier: 'standard', server_tool_use: { web_search_requests: 2 } } as ApiUsage)
  })

  test('Skill blocks: pieces joined at stop; other tools and broken JSON ignored; parallel blocks kept apart', () => {
    const s = sink()
    const tap = new MessageTap(s)
    const delta = (index: number, partial_json: string) => ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json } })
    tap.push(enc.encode([
      ev('content_block_start', { index: 0, content_block: { type: 'tool_use', name: 'Skill', input: {} } }),
      ev('content_block_start', { index: 1, content_block: { type: 'tool_use', name: 'Read', input: {} } }),
      ev('content_block_start', { index: 2, content_block: { type: 'tool_use', name: 'Skill', input: {} } }),
      delta(0, '{"skill":"a'), delta(1, '{"skill":"not-a-skill"}'), delta(2, '{"command":"/b-skill arg'), delta(0, 'lpha"}'), delta(2, 's"}'),
      ev('content_block_stop', { index: 1 }), ev('content_block_stop', { index: 0 }), ev('content_block_stop', { index: 2 }),
      ev('content_block_start', { index: 3, content_block: { type: 'tool_use', name: 'Skill', input: {} } }),
      delta(3, '{"skill":'), ev('content_block_stop', { index: 3 }),
      ev('content_block_start', { index: 4, content_block: { type: 'tool_use', name: 'Skill', input: { skill: 'whole-input' } } }),
      ev('content_block_stop', { index: 4 }),
    ].join('')))
    tap.end()
    expect(s.skills).toEqual(['alpha', 'b-skill', 'whole-input'])
  })

  test('garbage never throws', () => {
    const s = sink()
    const tap = new MessageTap(s)
    tap.push(enc.encode('data: {not json\n\ndata: null\n\ndata: 5\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":"x"}\n\n'))
    tap.end()
    expect(s.usage).toEqual({})
  })

  test('non-streaming body', () => {
    const s = sink()
    tapMessage(s, { model: 'claude-haiku-5-5', usage: { input_tokens: 3, output_tokens: 4 }, content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'x' } }] })
    expect(s).toMatchObject({ model: 'claude-haiku-5-5', usage: { input_tokens: 3, output_tokens: 4 }, skills: ['x'] })
  })

  test('counts streamed output characters (text, thinking, tool input; not signatures) and sees the final usage', () => {
    const s = sink()
    const tap = new MessageTap(s)
    const d = (index: number, delta: Record<string, unknown>) => ev('content_block_delta', { index, delta })
    tap.push(enc.encode([
      ev('message_start', { message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1 } } }),
      d(0, { type: 'thinking_delta', thinking: 'abcde' }), d(0, { type: 'signature_delta', signature: 'x'.repeat(500) }),
      d(1, { type: 'text_delta', text: '견적서 초안' }), d(2, { type: 'input_json_delta', partial_json: '{"a":1}' }),
      d(3, { type: 'citations_delta', citation: { cited_text: 'long text' } }),
    ].join('')))
    expect(s.outputChars).toBe(5 + 6 + 7)
    expect(s.finalUsage).toBeUndefined()
    tap.push(enc.encode(ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } })))
    tap.end()
    expect(s.finalUsage).toBe(true)
    expect(deltaChars(null)).toBe(0)
    expect(deltaChars({ type: 'text_delta', text: 5 })).toBe(0)
  })

  test('an error event inside the stream is reported', () => {
    const s = sink()
    const tap = new MessageTap(s)
    tap.push(enc.encode(ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })))
    tap.end()
    expect(s.errors).toEqual(['overloaded_error: Overloaded'])
  })

  test('mergeUsage keeps numbers when later values are null', () => {
    const u: ApiUsage = { input_tokens: 5 }
    mergeUsage(u, { input_tokens: null, output_tokens: 7, cache_creation: { ephemeral_1h_input_tokens: 3, junk: 'x' } })
    expect(u).toEqual({ input_tokens: 5, output_tokens: 7, cache_creation: { ephemeral_1h_input_tokens: 3 } })
  })
})

describe('output estimate when the stream ends early', () => {
  const recorder = () => new UsageRecorder({} as Ctx, { userId: 'u', tokenId: 't', source: 'pc', jobId: null }, 'claude-opus-5-5')

  test('max(reported, estimate) only when message_delta never came', () => {
    expect(CHARS_PER_TOKEN).toBe(2.5)
    expect(estimateOutputTokens(0)).toBe(0)
    expect(estimateOutputTokens(1)).toBe(1)
    expect(estimateOutputTokens(1000)).toBe(400)
    const r = recorder()
    r.usage = { input_tokens: 100, output_tokens: 1 }
    r.outputChars = 1000
    expect(r.recordedUsage()).toEqual({ input_tokens: 100, output_tokens: 400 })
    r.usage.output_tokens = 900 // a running total larger than the estimate wins
    expect(r.recordedUsage().output_tokens).toBe(900)
    r.usage.output_tokens = 120
    r.finalUsage = true // the final number is Anthropic's, even if the estimate is bigger
    expect(r.recordedUsage().output_tokens).toBe(120)
    const none = recorder()
    none.usage = { output_tokens: 1 }
    expect(none.recordedUsage()).toEqual({ output_tokens: 1 })
  })
})

describe('in-flight slots', () => {
  test('per person and in total; release once; stale slots expire', () => {
    const f = new Inflight()
    const lim = { perUser: 2, total: 3 }
    const a1 = f.acquire('a', lim), a2 = f.acquire('a', lim)
    expect(f.acquire('a', lim)).toEqual({ full: 'user' })
    const b1 = f.acquire('b', lim)
    expect(f.acquire('c', lim)).toEqual({ full: 'total' })
    expect([f.count(), f.count('a'), f.count('b')]).toEqual([3, 2, 1])
    if (!('release' in a1) || !('release' in a2) || !('release' in b1)) throw new Error('no slot')
    a1.release(); a1.release()
    expect([f.count(), f.count('a')]).toEqual([2, 1])
    expect('release' in f.acquire('c', lim)).toBe(true)
    // an hour later the old slots no longer count
    expect('release' in f.acquire('a', lim, Date.now() + 61 * 60_000)).toBe(true)
    expect(f.count()).toBe(1)
  })
})

describe('upstream errors', () => {
  test('errorInfo reads type and message; NOTED_STATUS', () => {
    expect(errorInfo('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}')).toEqual({ type: 'invalid_request_error', message: 'Your credit balance is too low' })
    expect(errorInfo('<html>')).toEqual({ type: '', message: '' })
    expect(errorInfo(null)).toEqual({ type: '', message: '' })
    expect([400, 401, 402, 403, 404, 413, 429, 500, 503, 529].every(NOTED_STATUS)).toBe(true)
    expect([200, 307, 409, 422].some(NOTED_STATUS)).toBe(false)
  })
})

describe('skill names', () => {
  test('skill, then command, then name; plugin prefix and slash dropped', () => {
    expect(skillName({ skill: 'quote-draft' })).toBe('quote-draft')
    expect(skillName({ skill: 'company:quote-draft' })).toBe('quote-draft')
    expect(skillName({ command: '/quote-draft 삼성전자' })).toBe('quote-draft')
    expect(skillName({ name: 'pitch' })).toBe('pitch')
    expect(skillName({ skill: 'other-plugin:thing' })).toBe('other-plugin:thing')
    expect(skillName({ skill: '  ', command: 'fallback' })).toBe('fallback')
    for (const bad of [null, 'quote', [], {}, { skill: 5 }, { skill: 'x'.repeat(121) }, { skill: 'a\u0000b' }]) expect(skillName(bad)).toBeNull()
  })

  test('skillsInContent and an oversized streamed input', () => {
    expect(skillsInContent([{ type: 'tool_use', name: 'Skill', input: { skill: 'a' } }, { type: 'text', text: 'Skill' }, null])).toEqual(['a'])
    expect(skillsInContent('nope')).toEqual([])
    const c = new SkillCollector()
    c.start(0, { type: 'tool_use', name: 'Skill', input: {} })
    c.delta(0, { type: 'input_json_delta', partial_json: '{"skill":"' + 'x'.repeat(70 * 1024) })
    expect(c.collecting).toBe(false)
    expect(c.stop(0)).toBeNull()
  })
})

describe('request rules', () => {
  test('checkBody', async () => {
    expect(checkBody('{"model":"claude-opus-5-5","messages":[]}')).toMatchObject({ model: 'claude-opus-5-5' })
    expect(checkBody('{"model":"claude-3-5-sonnet-latest"}')).toMatchObject({ model: 'claude-3-5-sonnet-latest' })
    const status = async (raw: string) => { const r = checkBody(raw); return 'refuse' in r ? r.refuse.status : 200 }
    expect(await status('')).toBe(400)
    expect(await status('null')).toBe(400)
    expect(await status('"str"')).toBe(400)
    expect(await status('{"model":"claude-opus-5-5[1m]"}')).toBe(400)
    expect(await status('{"model":"claude-' + 'a'.repeat(81) + '"}')).toBe(400)
    expect(await status('{"model":"claude-opus-5-5","container":null}')).toBe(403)
    expect(await status('{"model":"x","mcp_servers":[]}')).toBe(403)
    // betas and content blocks are not filtered
    expect(await status(JSON.stringify({ model: 'claude-opus-5-5', tools: [{ type: 'web_fetch_20260209', name: 'web_fetch' }], messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://x.example/a.png' } }] }] }))).toBe(200)
  })

  test('server tools that run code or cannot be priced are refused; Claude Code\'s tools, web search/fetch and tool search pass', async () => {
    const status = (tools: unknown) => { const r = checkBody(JSON.stringify({ model: 'claude-opus-5-5', tools })); return 'refuse' in r ? r.refuse.status : 200 }
    for (const type of ['code_execution_20250522', 'code_execution_20250825', 'code_execution_20260120', 'code_execution_20260521', 'bash_code_execution_20250825',
      'text_editor_code_execution_20250825', 'mcp_toolset', 'advisor_20260301', 'Code_Execution_20260521']) {
      expect(status([{ name: 'Read', input_schema: { type: 'object' } }, { type, name: 'x' }])).toBe(403)
      expect(refusedTool([{ type }])).toBe(type)
    }
    const allowed = [
      { name: 'Bash', description: 'd', input_schema: { type: 'object' } }, { type: 'custom', name: 'mine', input_schema: { type: 'object' } },
      { name: 'mcp__trina__read_file', input_schema: { type: 'object' }, defer_loading: true },
      { type: 'web_search_20250305', name: 'web_search', max_uses: 8 }, { type: 'web_search_20260209', name: 'web_search' },
      { type: 'web_fetch_20250910', name: 'web_fetch' }, { type: 'web_fetch_20260209', name: 'web_fetch' }, { type: 'web_fetch_20260318', name: 'web_fetch' },
      { type: 'tool_search_tool_regex_20251119', name: 'tool_search_tool_regex' }, { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
      { type: 'bash_20250124', name: 'bash' }, { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' }, { type: 'memory_20250818', name: 'memory' },
      { type: 'computer_toolset_20260801' }, { type: 'browser_toolset_20260801' },
    ]
    expect(status(allowed)).toBe(200)
    expect(status('not a list')).toBe(200)
    expect(status([null, 5, 'x'])).toBe(200)
    const r = checkBody(JSON.stringify({ model: 'claude-opus-5-5', tools: [{ type: 'code_execution_20250825<script>', name: 'code_execution' }] }))
    expect('refuse' in r && (await r.refuse.json() as any).error).toEqual({ type: 'permission_error', message: expect.stringContaining('code_execution_20250825script 도구를 쓸 수 없어요') })
  })

  test('upstreamUrl keeps only allowed query parameters', () => {
    const q = new URLSearchParams('beta=true&beta=false&x=1')
    expect(upstreamUrl('https://api.anthropic.com/', '/v1/messages', q, { beta: /^true$/ })).toBe('https://api.anthropic.com/v1/messages?beta=true')
    expect(upstreamUrl('https://api.anthropic.com', '/v1/messages', new URLSearchParams(), { beta: /^true$/ })).toBe('https://api.anthropic.com/v1/messages')
  })

  test('upstreamHeaders adds a version when none came; responseHeaders drops cookies', () => {
    const h = upstreamHeaders(new Headers({ authorization: 'Bearer tax_x', 'x-api-key': 'tax_y' }), 'sk-company', false)
    expect([...h.keys()].sort()).toEqual(['anthropic-version', 'x-api-key'])
    expect(h.get('x-api-key')).toBe('sk-company')
    const r = responseHeaders(new Headers({ 'set-cookie': 'a=b', 'content-length': '5', 'content-encoding': 'gzip', 'request-id': 'r1', 'retry-after': '3', 'x-should-retry': 'true' }))
    expect([...r.keys()].sort()).toEqual(['request-id', 'retry-after', 'x-should-retry'])
  })
})
