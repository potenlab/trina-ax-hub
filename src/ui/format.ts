// Number and date formatting for pages (Korean locale, server time zone).
/** Always two decimals so amounts line up and compare: $0.07, $45.00, $1,234.50 */
export const fmtUsd = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Rough won amount for a dollar total at a fixed rate (labelled 약 — the bill is in dollars): 약 12,600원 */
export function fmtKrw(usd: number, krwPerUsd: number): string {
  const won = usd * krwPerUsd
  const step = won >= 10_000 ? 100 : 10
  return `약 ${(Math.round(won / step) * step).toLocaleString('ko-KR')}원`
}
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
