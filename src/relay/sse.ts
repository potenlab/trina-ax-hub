// Reading the model's answer while it streams through, without holding it back: an incremental SSE parser and a tap
// that takes the model, the usage numbers and the Skill invocations out of the Messages API events.
import type { ApiUsage } from './pricing'
import { SkillCollector, skillsInContent } from './skills'

/** What the tap fills in (the usage recorder). */
export interface MessageSink {
  model: string
  usage: ApiUsage
  skill(name: string): void
  /** characters of model output streamed so far: text, thinking and tool-input JSON deltas */
  outputChars?: number
  /** message_delta (the final usage numbers) was seen */
  finalUsage?: boolean
  /** an `error` event inside a stream that had started well (e.g. overloaded) */
  streamError?(type: string, message: string): void
}

/** a single SSE line longer than this is skipped (no real event is close; keeps memory bounded) */
const MAX_LINE = 8 * 1024 * 1024

/** Incremental `text/event-stream` parser (event + data fields; comments and other fields are ignored). */
export class SseReader {
  private buf = ''
  private skipping = false
  private event = ''
  private data: string[] = []
  private readonly dec = new TextDecoder()

  constructor(private readonly onEvent: (event: string, data: string) => void) {}

  push(chunk: Uint8Array) { this.feed(this.dec.decode(chunk, { stream: true })) }

  /** the stream ended: a last line without a newline and a pending event still count */
  end() {
    this.feed(this.dec.decode())
    if (this.buf && !this.skipping) this.line(this.buf)
    this.buf = ''
    this.dispatch()
  }

  private feed(text: string) {
    const s = this.buf + text
    let from = 0
    for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', from)) {
      if (this.skipping) this.skipping = false
      else this.line(s.slice(from, i))
      from = i + 1
    }
    this.buf = s.slice(from)
    if (this.buf.length > MAX_LINE) { this.buf = ''; this.skipping = true }
  }

  private line(l: string) {
    if (l.endsWith('\r')) l = l.slice(0, -1)
    if (l === '') { this.dispatch(); return }
    if (l.startsWith(':')) return
    const c = l.indexOf(':')
    const field = c < 0 ? l : l.slice(0, c)
    let value = c < 0 ? '' : l.slice(c + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.event = value
    else if (field === 'data') this.data.push(value)
  }

  private dispatch() {
    if (this.data.length) this.onEvent(this.event, this.data.join('\n'))
    this.event = ''
    this.data = []
  }
}

/** Copies the numbers (and short strings such as `speed`) of a usage object over what is known so far. Later events
 * carry running totals, so the latest value wins; nulls never erase a number. */
export function mergeUsage(into: ApiUsage, from: unknown) {
  if (!from || typeof from !== 'object') return
  const target = into as Record<string, unknown>
  for (const [k, v] of Object.entries(from as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) target[k] = v
    else if (typeof v === 'string' && v.length <= 40) target[k] = v
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sub = (target[k] && typeof target[k] === 'object' ? target[k] : {}) as Record<string, unknown>
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) if (typeof sv === 'number' && Number.isFinite(sv)) sub[sk] = sv
      target[k] = sub
    }
  }
}

/** The characters of model output a content_block_delta carries (signatures and citations are not output text). */
export function deltaChars(delta: unknown): number {
  const d = delta as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return 0
  const v = d.type === 'text_delta' ? d.text : d.type === 'thinking_delta' ? d.thinking : d.type === 'input_json_delta' ? d.partial_json : null
  return typeof v === 'string' ? v.length : 0
}

/** Watches a Messages API event stream: model and input/cache numbers from message_start, output (running total)
 * from message_delta, the characters of output streamed (for an estimate when the stream ends before
 * message_delta), Skill tool_use blocks from content_block_start/delta/stop, and error events. Never throws. */
export class MessageTap {
  private readonly skills = new SkillCollector()
  private readonly reader = new SseReader((event, data) => this.onEvent(event, data))

  constructor(private readonly sink: MessageSink) {}

  push(chunk: Uint8Array) { try { this.reader.push(chunk) } catch { /* reading is best effort; the bytes still flow */ } }
  end() { try { this.reader.end() } catch {} }

  private onEvent(event: string, data: string) {
    if (event === 'ping') return
    let ev: Record<string, any>
    try { ev = JSON.parse(data) } catch { return }
    if (!ev || typeof ev !== 'object') return
    switch (ev.type) {
      case 'message_start':
        if (typeof ev.message?.model === 'string' && ev.message.model) this.sink.model = ev.message.model
        mergeUsage(this.sink.usage, ev.message?.usage)
        break
      case 'message_delta':
        mergeUsage(this.sink.usage, ev.usage)
        if (ev.usage && typeof ev.usage === 'object') this.sink.finalUsage = true
        break
      case 'content_block_start':
        this.skills.start(ev.index, ev.content_block)
        break
      case 'content_block_delta':
        this.sink.outputChars = (this.sink.outputChars ?? 0) + deltaChars(ev.delta)
        if (this.skills.collecting) this.skills.delta(ev.index, ev.delta)
        break
      case 'error':
        this.sink.streamError?.(String(ev.error?.type ?? 'error'), String(ev.error?.message ?? ''))
        break
      case 'content_block_stop': {
        const name = this.skills.stop(ev.index)
        if (name) this.sink.skill(name)
        break
      }
    }
  }
}

/** The same for a non-streaming response body (a Message object). */
export function tapMessage(sink: MessageSink, body: unknown) {
  if (!body || typeof body !== 'object') return
  const m = body as Record<string, unknown>
  if (typeof m.model === 'string' && m.model) sink.model = m.model
  mergeUsage(sink.usage, m.usage)
  sink.finalUsage = true
  for (const s of skillsInContent(m.content)) sink.skill(s)
}
