// Claude Code `-p --output-format stream-json --verbose --include-partial-messages` → hub progress.
// Shapes seen with Claude Code 2.1.309 (smoke run against a local fake, 2026-10-25):
//   {"type":"system","subtype":"init","session_id","model","tools","mcp_servers",...}
//   {"type":"stream_event","event":{"type":"message_start"|"content_block_start"|"content_block_delta"|...}}
//   {"type":"assistant","message":{"content":[text | tool_use]},"error"?}   (one per finished content block)
//   {"type":"user","message":{"content":[tool_result]}}
//   {"type":"result","subtype":"success"|"error_during_execution"|...,"is_error","result","total_cost_usd","session_id"}
// Ideas from Team AX `engine/claude-parse.ts` and `engine/lines.ts`.

/** Text lines from a byte stream that arrives in arbitrary pieces, keeping split UTF-8 characters (Hangul) whole. */
export class Utf8Lines {
  private dec = new TextDecoder('utf-8')
  private buf = ''
  push(bytes: Uint8Array): string[] {
    this.buf += this.dec.decode(bytes, { stream: true })
    const out: string[] = []
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) { out.push(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 1) }
    return out
  }
  end(): string[] {
    this.buf += this.dec.decode()
    const rest = this.buf
    this.buf = ''
    return rest ? [rest] : []
  }
}

/** The last `max` characters of a byte stream (stderr), for error messages and logs. */
export class TextTail {
  private dec = new TextDecoder('utf-8')
  text = ''
  constructor(private max: number) {}
  push(bytes: Uint8Array) {
    this.text += this.dec.decode(bytes, { stream: true })
    if (this.text.length > this.max * 2) this.text = this.text.slice(-this.max)
  }
  get value() { return this.text.slice(-this.max) }
}

export type StreamEvent =
  | { type: 'session'; sessionId: string; model: string | null }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }

export interface FinalResult { isError: boolean; text: string | null; subtype: string | null; costUsd: number }

const MAX_TEXT = 1_000_000

export class StreamParser {
  sessionId: string | null = null
  model: string | null = null
  sawInit = false
  /** everything the assistant wrote, text blocks joined by a blank line (what the phone shows live) */
  text = ''
  /** text of the last assistant message that had text (a schedule's report without the "let me look" preamble) */
  lastText = ''
  /** an API error Claude Code reported as a synthetic assistant message (relay 403/503, auth, overload ...) */
  apiError: string | null = null
  result: FinalResult | null = null
  private sawDeltas = false
  private msgText = ''

  push(line: string): StreamEvent[] {
    if (!line.trim()) return []
    let ev: any
    try { ev = JSON.parse(line) } catch { return [] }
    if (!ev || typeof ev !== 'object') return []
    const out: StreamEvent[] = []
    if (ev.type === 'system' && ev.subtype === 'init') {
      this.sawInit = true
      if (typeof ev.session_id === 'string') this.sessionId = ev.session_id
      if (typeof ev.model === 'string') this.model = ev.model
      if (this.sessionId) out.push({ type: 'session', sessionId: this.sessionId, model: this.model })
    } else if (ev.type === 'stream_event') {
      const e = ev.event ?? {}
      if (e.type === 'message_start') this.msgText = ''
      else if (e.type === 'content_block_start' && e.content_block?.type === 'text') {
        if (this.text && !this.text.endsWith('\n\n')) out.push(this.addText(this.text.endsWith('\n') ? '\n' : '\n\n'))
        if (this.msgText) this.msgText += '\n\n'
      } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') {
        this.sawDeltas = true
        this.msgText += e.delta.text
        this.lastText = this.msgText
        out.push(this.addText(e.delta.text))
      }
    } else if (ev.type === 'assistant') {
      const content: any[] = Array.isArray(ev.message?.content) ? ev.message.content : []
      if (ev.error && ev.error !== 'refusal') {
        // an API error comes as an assistant message whose text is the raw error: never answer text
        this.apiError = content.map((b) => (b?.type === 'text' ? String(b.text ?? '') : '')).join(' ').trim() || String(ev.error)
        return out
      }
      for (const b of content) {
        if (b?.type === 'tool_use' && typeof b.name === 'string') out.push({ type: 'tool', name: b.name, input: b.input && typeof b.input === 'object' ? b.input : {} })
        else if (b?.type === 'text' && typeof b.text === 'string' && b.text && !this.sawDeltas) {
          // no partial messages (older CLI): take whole blocks
          if (this.text) out.push(this.addText('\n\n'))
          out.push(this.addText(b.text))
          this.lastText = b.text
        }
      }
    } else if (ev.type === 'result') {
      if (typeof ev.session_id === 'string' && !this.sessionId) this.sessionId = ev.session_id
      const cost = Number(ev.total_cost_usd)
      this.result = {
        isError: ev.is_error === true,
        text: typeof ev.result === 'string' ? ev.result : null,
        subtype: typeof ev.subtype === 'string' ? ev.subtype : null,
        costUsd: Number.isFinite(cost) && cost > 0 ? cost : 0,
      }
      if (!this.text && this.result.text && !this.result.isError) out.push(this.addText(this.result.text))
    }
    return out
  }

  private addText(delta: string): StreamEvent {
    if (this.text.length < MAX_TEXT) this.text += delta
    return { type: 'text', delta }
  }
}
