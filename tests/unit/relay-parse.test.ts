// Pure pieces of the relay: the SSE reader, the usage/skill tap, skill names and the request rules.
import { describe, expect, test } from 'bun:test'
import { SseReader, MessageTap, mergeUsage, tapMessage, type MessageSink } from '../../src/relay/sse'
import { skillName, skillsInContent, SkillCollector } from '../../src/relay/skills'
import { checkBody, upstreamUrl, upstreamHeaders, responseHeaders } from '../../src/relay/proxy'
import type { ApiUsage } from '../../src/relay/pricing'

const enc = new TextEncoder()

function read(pieces: (string | Uint8Array)[]): [string, string][] {
  const out: [string, string][] = []
  const r = new SseReader((e, d) => out.push([e, d]))
  for (const p of pieces) r.push(typeof p === 'string' ? enc.encode(p) : p)
  r.end()
  return out
}

function sink(): MessageSink & { skills: string[] } {
  const skills: string[] = []
  return { model: 'asked', usage: {} as ApiUsage, skills, skill: (s) => { skills.push(s) } }
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

  test('mergeUsage keeps numbers when later values are null', () => {
    const u: ApiUsage = { input_tokens: 5 }
    mergeUsage(u, { input_tokens: null, output_tokens: 7, cache_creation: { ephemeral_1h_input_tokens: 3, junk: 'x' } })
    expect(u).toEqual({ input_tokens: 5, output_tokens: 7, cache_creation: { ephemeral_1h_input_tokens: 3 } })
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
    // tools, betas and content blocks are not filtered
    expect(await status(JSON.stringify({ model: 'claude-opus-5-5', tools: [{ type: 'web_fetch_20260209', name: 'web_fetch' }], messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://x.example/a.png' } }] }] }))).toBe(200)
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
