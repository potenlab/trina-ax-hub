// A small, safe Markdown renderer for answers on the phone. Every piece of input text is HTML-escaped before it is
// wrapped in one of a fixed set of tags; links keep only http(s) and mailto targets. Supported: headings, paragraphs,
// line breaks, bullet / numbered / task lists (nested by indentation), fenced and inline code, bold, italic,
// strikethrough, links and bare URLs, block quotes, horizontal rules and pipe tables.

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const SAFE_URL = /^(https?:\/\/|mailto:)[^\s<>"']+$/i
const PH = '\u0000'

/** Inline formatting of one line (or one table cell). */
export function inline(src: string): string {
  const keep: string[] = []
  const hold = (html: string) => `${PH}${keep.push(html) - 1}${PH}`
  let s = src.replace(/\u0000/g, '')
  // code spans first: nothing inside them is formatted
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t, code: string) => hold(`<code>${escapeHtml(code.trim() || code)}</code>`))
  // [text](url)
  s = s.replace(/\[([^\]\n]{1,500})\]\(\s*<?([^)\s>]{1,2000})>?(?:\s+"[^"]*")?\s*\)/g, (m, text: string, url: string) =>
    SAFE_URL.test(url) ? hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${formatted(text)}</a>`) : m)
  // bare URLs
  s = s.replace(/\bhttps?:\/\/[^\s<>"'`]+/gi, (url: string) => {
    let tail = ''
    // sentence punctuation after a URL is not part of it; a ')' only when it has no '(' to close
    const count = (c: string) => url.split(c).length - 1
    while (/[.,;:!?\]]$/.test(url) || (url.endsWith(')') && count(')') > count('('))) { tail = url.slice(-1) + tail; url = url.slice(0, -1) }
    return hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`) + tail
  })
  s = formatted(s)
  // a held link may itself hold a code span: restore until nothing is left
  const re = new RegExp(`${PH}(\\d+)${PH}`, 'g')
  for (let n = 0; n < 4 && s.includes(PH); n++) s = s.replace(re, (_m, i: string) => keep[Number(i)] ?? '')
  return s.replace(/\u0000/g, '')
}

/** Escape, then bold / italic / strikethrough (placeholders pass through untouched). */
function formatted(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

interface Item { indent: number; ordered: boolean; text: string }

function renderList(items: Item[]): string {
  let html = ''
  const stack: { indent: number; tag: 'ul' | 'ol' }[] = []
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1]!.indent) html += `</li></${stack.pop()!.tag}>`
    const top = stack[stack.length - 1]
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? 'ol' : 'ul'
      html += `<${tag}><li>`
      stack.push({ indent: it.indent, tag })
    } else html += '</li><li>'
    const task = /^\[([ xX])\]\s+(.*)$/.exec(it.text)
    html += task ? `<span class="task">${task[1] === ' ' ? '☐' : '☑'}</span> ${inline(task[2]!)}` : inline(it.text)
  }
  while (stack.length) html += `</li></${stack.pop()!.tag}>`
  return html
}

export function renderMarkdown(src: string, depth = 0): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = [] } }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const close = fence[1]!
      const buf: string[] = []
      i++
      while (i < lines.length && !(lines[i]!.trim().startsWith(close[0]!.repeat(3)) && lines[i]!.trim().replace(/[`~]/g, '') === '')) buf.push(lines[i++]!)
      i++
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }
    if (!line.trim()) { flush(); i++; continue }
    const h = HEADING.exec(line)
    if (h) {
      flush()
      const level = Math.min(6, h[1]!.length + 2)
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`)
      i++
      continue
    }
    if (HR.test(line)) { flush(); out.push('<hr>'); i++; continue }
    if (QUOTE.test(line)) {
      flush()
      const buf: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!)) buf.push(QUOTE.exec(lines[i++]!)![1]!)
      out.push(`<blockquote>${depth < 4 ? renderMarkdown(buf.join('\n'), depth + 1) : escapeHtml(buf.join('\n'))}</blockquote>`)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
      flush()
      const head = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(splitRow(lines[i++]!))
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${head.map((_c, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    if (ITEM.test(line)) {
      flush()
      const items: Item[] = []
      while (i < lines.length) {
        const l = lines[i]!
        const m = ITEM.exec(l)
        if (m) { items.push({ indent: m[1]!.replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]!), text: m[3]! }); i++; continue }
        if (!l.trim()) {
          // a blank line inside a list continues it only when another item follows
          let j = i + 1
          while (j < lines.length && !lines[j]!.trim()) j++
          if (j < lines.length && ITEM.test(lines[j]!)) { i = j; continue }
          break
        }
        // an indented line continues the previous item
        if (/^\s{2,}\S/.test(l) && items.length && !FENCE.test(l)) { items[items.length - 1]!.text += '\n' + l.trim(); i++; continue }
        break
      }
      out.push(renderList(items).replace(/\n/g, "<br>"))
      continue
    }
    para.push(line.trim())
    i++
  }
  flush()
  return out.join('\n')
}
