// Number and date formatting for pages (Korean locale, server time zone).
export const fmtUsd = (n: number) => '$' + (n < 10 ? n.toFixed(2) : n < 1000 ? n.toFixed(1) : Math.round(n).toLocaleString('en-US'))
export const fmtNum = (n: number) => n.toLocaleString('ko-KR')
export const fmtTokens = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n))
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—'
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)) : '—'

/** "3분 전", "어제" style relative time */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '없음'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  if (s < 172800) return '어제'
  return `${Math.floor(s / 86400)}일 전`
}

/** Start of this month / today (server local) */
export const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1)
export const dayStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
