// The phone's Markdown renderer (safety first) and the stream-json parser.
import { describe, expect, test } from 'bun:test'
import { renderMarkdown, inline } from '../../src/hub/markdown'
import { StreamParser, Utf8Lines } from '../../src/hub/stream'
import { failureMessage } from '../../src/hub/runner'

describe('markdown: safe', () => {
  test('HTML is escaped everywhere', () => {
    const evil = '<script>alert(1)</script> <img src=x onerror=alert(1)> "q" \'s\' &amp;'
    const out = renderMarkdown(`# ${evil}\n\n${evil}\n\n- ${evil}\n\n> ${evil}\n\n| a | b |\n|---|---|\n| ${evil} | x |\n\n\`\`\`\n${evil}\n\`\`\`\n\n\`${evil}\``)
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out).toContain('&amp;amp;')
  })

  test('only http(s) and mailto links become links', () => {
    expect(inline('[a](javascript:alert(1))')).toBe('[a](javascript:alert(1))')
    expect(inline('[a](data:text/html,x)')).not.toContain('<a')
    expect(inline('[a](/logout)')).not.toContain('<a')
    expect(inline('[문서](https://example.com/a?b=1&c="2")')).not.toContain('"2"')
    expect(inline('[문서](https://example.com/a?b=1&c=2)')).toBe('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">문서</a>')
    expect(inline('메일 [보내기](mailto:a@b.co)')).toContain('href="mailto:a@b.co"')
  })

  test('bare URLs, trailing punctuation outside', () => {
    expect(inline('여기 https://example.com/x. 보세요')).toBe('여기 <a href="https://example.com/x" target="_blank" rel="noopener noreferrer">https://example.com/x</a>. 보세요')
    expect(inline('(https://example.com/a_(b))')).toContain('href="https://example.com/a_(b)"')
  })

  test('code spans are not formatted', () => {
    expect(inline('`**not bold** <b>`')).toBe('<code>**not bold** &lt;b&gt;</code>')
    expect(inline('[`code` link](https://x.io)')).toBe('<a href="https://x.io" target="_blank" rel="noopener noreferrer"><code>code</code> link</a>')
  })
})

describe('markdown: features', () => {
  test('headings, paragraphs, line breaks', () => {
    expect(renderMarkdown('# 제목\n## 소제목\n본문 한 줄\n다음 줄\n\n새 문단')).toBe('<h3>제목</h3>\n<h4>소제목</h4>\n<p>본문 한 줄<br>다음 줄</p>\n<p>새 문단</p>')
  })

  test('bold, italic, strikethrough; snake_case stays', () => {
    expect(inline('**굵게** *기울임* ~~취소~~ snake_case_name 2*3*4')).toBe('<strong>굵게</strong> <em>기울임</em> <del>취소</del> snake_case_name 2*3*4')
  })

  test('lists: bullets, numbers, nesting, tasks, loose items', () => {
    expect(renderMarkdown('- 하나\n- 둘\n  - 둘의 하나\n- 셋')).toBe('<ul><li>하나</li><li>둘<ul><li>둘의 하나</li></ul></li><li>셋</li></ul>')
    expect(renderMarkdown('1. 첫째\n2. 둘째')).toBe('<ol><li>첫째</li><li>둘째</li></ol>')
    expect(renderMarkdown('- [ ] 할 일\n- [x] 끝')).toBe('<ul><li><span class="task">☐</span> 할 일</li><li><span class="task">☑</span> 끝</li></ul>')
    expect(renderMarkdown('- a\n\n- b\n\n끝')).toBe('<ul><li>a</li><li>b</li></ul>\n<p>끝</p>')
  })

  test('fenced code keeps its text', () => {
    expect(renderMarkdown('```ts\nconst a = 1 < 2\n\n**x**\n```')).toBe('<pre><code>const a = 1 &lt; 2\n\n**x**</code></pre>')
    expect(renderMarkdown('```\nnever closed')).toBe('<pre><code>never closed</code></pre>')
  })

  test('tables, quotes, rules', () => {
    expect(renderMarkdown('| 이름 | 금액 |\n|:--|--:|\n| 커피 | **3,000** |')).toBe(
      '<div class="tablewrap"><table><thead><tr><th>이름</th><th>금액</th></tr></thead><tbody><tr><td>커피</td><td><strong>3,000</strong></td></tr></tbody></table></div>')
    expect(renderMarkdown('> 인용\n> 둘째 줄')).toBe('<blockquote><p>인용<br>둘째 줄</p></blockquote>')
    expect(renderMarkdown('위\n\n---\n\n아래')).toBe('<p>위</p>\n<hr>\n<p>아래</p>')
  })
})

describe('stream-json parser', () => {
  const lines = (...evs: unknown[]) => evs.map((e) => JSON.stringify(e))

  test('session, deltas across messages, last message, cost', () => {
    const p = new StreamParser()
    const out = lines(
      { type: 'system', subtype: 'init', session_id: '8b81bd43-ad6b-4caa-aeef-e2330d59e48a', model: 'claude-opus-5-5' },
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '볼게요.' } } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '볼게요.' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__trina__read_file', input: { path: 'a.md' } }] } },
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '# 결과' } } },
      { type: 'result', subtype: 'success', is_error: false, result: '# 결과', total_cost_usd: 0.5 },
    ).flatMap((l) => p.push(l))
    expect(out[0]).toEqual({ type: 'session', sessionId: '8b81bd43-ad6b-4caa-aeef-e2330d59e48a', model: 'claude-opus-5-5' })
    expect(out.filter((e) => e.type === 'tool')).toEqual([{ type: 'tool', name: 'mcp__trina__read_file', input: { path: 'a.md' } }])
    expect(p.text).toBe('볼게요.\n\n# 결과')
    expect(out.filter((e) => e.type === 'text').map((e) => (e as any).delta).join('')).toBe(p.text)
    expect(p.lastText).toBe('# 결과')
    expect(p.result).toEqual({ isError: false, text: '# 결과', subtype: 'success', costUsd: 0.5 })
  })

  test('without partial messages, whole blocks are used; API errors are not answer text', () => {
    const p = new StreamParser()
    for (const l of lines(
      { type: 'assistant', message: { content: [{ type: 'text', text: '안녕' }] } },
      { type: 'assistant', error: 'unknown', message: { content: [{ type: 'text', text: 'API Error: 503 {"error":{"message":"회사 API 키가 아직 없어요."}}' }] } },
      { type: 'result', is_error: true, result: 'API Error' },
    )) p.push(l)
    expect(p.text).toBe('안녕')
    expect(p.apiError).toContain('503')
    expect(failureMessage(p, '', 1)).toBe('회사 API 키가 아직 없어요.')
  })

  test('garbage lines are ignored; failure messages', () => {
    const p = new StreamParser()
    expect(p.push('not json')).toEqual([])
    expect(p.push('')).toEqual([])
    expect(failureMessage(p, 'Error: 401 invalid x-api-key tax_secretsecret', 1)).toBe('허브 인증에 실패했어요. 관리자에게 알려 주세요.')
    expect(failureMessage(p, 'boom tax_abcdef123', 2)).toBe('Claude가 답하지 못했어요. (boom tax_…)')
    expect(failureMessage(p, '', 2)).toBe('Claude가 답하지 못했어요. (종료 코드 2)')
  })

  test('UTF-8 split across chunks stays whole', () => {
    const bytes = new TextEncoder().encode('{"a":"한글"}\n두번째')
    const u = new Utf8Lines()
    const got = [...u.push(bytes.slice(0, 7)), ...u.push(bytes.slice(7)), ...u.end()]
    expect(got).toEqual(['{"a":"한글"}', '두번째'])
  })
})
