/** @jsxImportSource hono/jsx */
// Shared pieces of the web pages: per-hub state (flash messages, login limiter), guards, form parsing with the CSRF
// check, the page shell with navigation, and small components.
import type { Child } from 'hono/jsx'
import { raw } from 'hono/html'
import type { MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { AppEnv, C } from '../http/app'
import type { Ctx } from '../context'
import { csrfOk, type SessionAuth } from '../auth/sessions'
import { getUser, type User } from '../auth/users'
import { Page, Csrf, CopyBlock, type NavItem } from '../ui/layout'
import { fmtDateTime } from '../ui/format'
import { secret, safeEqual } from '../ids'
import { HttpError } from '../http/errors'
import { cookieName, isHttps } from '../http/cookies'
import { Denied } from '../policy/errors'
import { effectiveUrls, installCommands, urlWarnings } from './settings'

// per-hub state ------------------------------------------------------------------------------------------------------

/** One-time messages shown on the next page (also carries a just-made temp password or enroll code, once). */
export type Flash =
  | { kind: 'ok' | 'warn' | 'bad'; text: string }
  | { kind: 'enroll'; code: string; expiresAt: string; userId: string; who: string }
  | { kind: 'password'; password: string; userId: string; username: string; who: string }

const FLASH_TTL_MS = 10 * 60_000

export class FlashStore {
  private m = new Map<string, { at: number; items: Flash[] }>()
  push(key: string, f: Flash) {
    const now = Date.now()
    for (const [k, v] of this.m) if (v.at < now - FLASH_TTL_MS) this.m.delete(k)
    const e = this.m.get(key) ?? { at: now, items: [] }
    e.at = now
    e.items.push(f)
    this.m.set(key, e)
  }
  take(key: string): Flash[] {
    const e = this.m.get(key)
    this.m.delete(key)
    return e && e.at >= Date.now() - FLASH_TTL_MS ? e.items : []
  }
}

import { FailureLimiter } from '../auth/rate-limit'
export { FailureLimiter }

export interface Web {
  ctx: Ctx
  flash: FlashStore
  /** failed logins: per (username + address), and per address with a higher cap. Never per username alone: the whole
   *  office shares one address through the tunnel, and anyone could otherwise lock the owner out by guessing. */
  login: { pair: FailureLimiter; ip: FailureLimiter }
  /** true while /setup is creating the owner (two posts at once must not make two owners) */
  settingUp: boolean
}

/** wrong passwords for one username from one address */
export const LOGIN_MAX_FAILURES = 10
/** wrong passwords from one address, any username (an office shares an address, so this is higher) */
export const LOGIN_IP_MAX_FAILURES = 50
export const LOGIN_WINDOW_MS = 15 * 60_000

export function makeWeb(ctx: Ctx): Web {
  return {
    ctx, flash: new FlashStore(), settingUp: false,
    login: { pair: new FailureLimiter(LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS), ip: new FailureLimiter(LOGIN_IP_MAX_FAILURES, LOGIN_WINDOW_MS) },
  }
}

// request helpers ----------------------------------------------------------------------------------------------------

export { isHttps }

/** The address the browser used (scheme honours x-forwarded-proto behind the tunnel). */
export const requestOrigin = (c: C) => `${isHttps(c) ? 'https' : 'http'}://${c.req.header('host') ?? new URL(c.req.url).host}`

/** Client IP (the foundation already resolves Cloudflare's cf-connecting-ip for tunnelled requests). */
export const clientIp = (c: C): string => c.get('clientIp') || 'unknown'

/** A local path to go back to after login (never another site). */
export function safeNext(v: unknown): string | null {
  return typeof v === 'string' && /^\/(?![\/\\])[\x21-\x7e]*$/.test(v) && v.length < 300 ? v : null
}

export type Form = Record<string, string | string[]>

async function readForm(c: C): Promise<Form> {
  let raw: Record<string, unknown> = {}
  try { raw = await c.req.parseBody({ all: true }) } catch { raw = {} }
  const out: Form = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string')
  }
  return out
}

/** First value of a form field, trimmed ('' when missing). */
export const field = (f: Form, k: string): string => { const v = f[k]; return (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim() }
/** Raw value (passwords are not trimmed). */
export const rawField = (f: Form, k: string): string => { const v = f[k]; return Array.isArray(v) ? v[0] ?? '' : v ?? '' }
export const fields = (f: Form, k: string): string[] => { const v = f[k]; return v === undefined ? [] : Array.isArray(v) ? v : [v] }

export class CsrfError extends Error {}

/** Parse a form posted by a logged-in person and check its `_csrf`. Throws CsrfError (answered 403). */
export async function sessionForm(c: C): Promise<{ form: Form; session: SessionAuth }> {
  const session = c.get('session')
  const form = await readForm(c)
  if (!session || !csrfOk(session, rawField(form, '_csrf'))) throw new CsrfError()
  return { form, session }
}

// Forms shown before anyone is logged in (login, setup) use a double-submit cookie instead of the session secret.
export const PRE_CSRF_COOKIE = 'tax_pre'

export function preCsrfToken(c: C): string {
  const have = getCookie(c, cookieName(c, PRE_CSRF_COOKIE))
  if (have && /^[A-Za-z0-9_-]{20,64}$/.test(have)) return have
  const t = secret(18)
  setCookie(c, cookieName(c, PRE_CSRF_COOKIE), t, { httpOnly: true, sameSite: 'Lax', secure: isHttps(c), path: '/' })
  return t
}

export async function preForm(c: C): Promise<{ form: Form; ok: boolean }> {
  const form = await readForm(c)
  const cookie = getCookie(c, cookieName(c, PRE_CSRF_COOKIE)) ?? ''
  const given = rawField(form, '_csrf')
  return { form, ok: cookie.length >= 20 && safeEqual(cookie, given) }
}

export const csrfRefused = (c: C) =>
  c.html(doc(<Page title="다시 시도해 주세요" narrow><h1>다시 시도해 주세요</h1>
    <p class="lead">보안 확인에 실패했어요. 페이지를 새로 고친 뒤 다시 해 주세요.</p><a class="btn" href="/">처음으로</a></Page>), 403)

/** Run a form action; HttpError / Denied messages become a flash and the person goes back to `back`. */
export async function act(web: Web, c: C, back: string, fn: (form: Form, s: SessionAuth) => Promise<string | void> | string | void) {
  let parsed: { form: Form; session: SessionAuth }
  try { parsed = await sessionForm(c) } catch (e) { if (e instanceof CsrfError) return csrfRefused(c); throw e }
  try {
    const to = await fn(parsed.form, parsed.session)
    return c.redirect(to || back, 303)
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 403) return forbidden(c, parsed.session, e.message)
      web.flash.push(parsed.session.idHash, { kind: 'bad', text: e.message })
      return c.redirect(back, 303)
    }
    if (e instanceof Denied) {
      web.flash.push(parsed.session.idHash, { kind: 'bad', text: '폴더 경로가 올바르지 않아요. 팀 폴더 안의 경로를 / 로 이어서 적어 주세요 (예: shared/영업).' })
      return c.redirect(back, 303)
    }
    throw e
  }
}

export const fail = (message: string, status = 400): never => { throw new HttpError(status, 'validation', message) }

// guards -------------------------------------------------------------------------------------------------------------

const isAdminRole = (r: string) => r === 'owner' || r === 'admin'

/** Logged in, account loaded; a person who must change their password is sent to /me/password first. */
export const pageGuard = (web: Web, o: { admin?: boolean } = {}): MiddlewareHandler<AppEnv> => async (c, next) => {
  const s = c.get('session')
  if (!s) {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return c.redirect('/login?next=' + encodeURIComponent(c.req.path + (new URL(c.req.url).search)))
    return c.redirect('/login', 303)
  }
  const u = getUser(web.ctx.db, s.user.id)
  if (!u) return c.redirect('/login')
  if (u.mustChangePassword && c.req.path !== '/me/password') return c.redirect('/me/password', c.req.method === 'GET' ? 302 : 303)
  if (o.admin && !isAdminRole(u.role)) return forbidden(c, s, '관리자만 볼 수 있는 페이지예요.')
  await next()
}

export const forbidden = (c: C, s: SessionAuth | null, message: string) =>
  c.html(doc(
    <Shell c={c} title="볼 수 없어요" active="">
      <h1>볼 수 없어요</h1>
      <p class="lead">{message}</p>
      <a class="btn" href={s && isAdminRole(s.user.role) ? '/admin' : '/me'}>내 페이지로</a>
    </Shell>), 403)

export const isOwner = (s: SessionAuth) => s.user.role === 'owner'
export const isAdmin = (s: SessionAuth) => isAdminRole(s.user.role)

// rendering ----------------------------------------------------------------------------------------------------------

/** Page markup with a doctype (the shell renders <html> without one). */
export const doc = (node: unknown) => '<!doctype html>' + String(node)

export function render(c: C, node: unknown, status: 200 | 400 | 403 | 404 | 429 = 200) {
  return c.html(doc(node), status)
}

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: '대시보드' },
  { href: '/admin/users', label: '사람' },
  { href: '/admin/groups', label: '그룹' },
  { href: '/admin/folders', label: '폴더 권한' },
  { href: '/files', label: '회사 파일' },
  { href: '/admin/versions', label: '되살리기' },
  { href: '/admin/budgets', label: '예산' },
  { href: '/admin/usage', label: '사용량' },
  { href: '/admin/skills', label: '스킬' },
  { href: '/admin/settings', label: '설정' },
  { href: '/admin/audit', label: '기록' },
]
const PERSONAL_NAV: NavItem[] = [{ href: '/me', label: '내 PC' }, { href: '/files', label: '회사 파일' }, { href: '/app', label: '채팅' }]

export function navFor(role: string | undefined): NavItem[] {
  if (!role) return []
  return isAdminRole(role) ? [...ADMIN_NAV, ...PERSONAL_NAV.filter((n) => n.href !== '/files')] : PERSONAL_NAV
}

/** Extra styles for these pages (on top of the shared CSS); same tokens, same look. */
export const WEB_CSS = `
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 16px}.head .lead{margin:0}
.sec{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:28px 0 10px}.sec h2{margin:0}
.card h2:first-child,.card h3:first-child{margin-top:0}.card h3{font-size:15px;margin:16px 0 8px}
.card>:last-child{margin-bottom:0}
.empty{color:var(--muted);text-align:center;padding:22px 16px;background:var(--panel);border:1px dashed var(--line);border-radius:var(--radius);margin:0 0 16px}
.empty b{display:block;color:var(--ink);font-weight:600;margin-bottom:2px}
.secret{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:24px;font-weight:700;letter-spacing:.06em;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 14px;display:inline-block;user-select:all;word-break:break-all}
.oneshot{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
ol.steps{margin:6px 0 12px;padding-left:22px}ol.steps li{margin:4px 0}
.cmdlabel{font-size:13px;font-weight:600;color:var(--muted);margin:14px 0 0}
.copy pre.cmd{padding-right:64px}
.notice ul{margin:0;padding-left:18px}.notice li+li{margin-top:4px}.notice.small{font-size:13px}
.notice .actions{margin-top:10px}.notice.card{border:0}
.devname{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.devnote{color:var(--muted);font-size:12px;margin-top:2px}
.health{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin:0 0 16px}
.health .card{margin:0}.health h3{margin:0 0 6px;font-size:14px;color:var(--muted);font-weight:600}.health p{margin:4px 0}
.alert{border-color:var(--bad);background:var(--bad-soft)}.alert h2{color:var(--bad)}.alert.warnish{border-color:var(--warn);background:var(--warn-soft)}.alert.warnish h2{color:var(--warn)}
.alert .kv{margin-top:10px}.alert .kv dd{word-break:break-word}
.names{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 0}
td.nowrap,th.nowrap{white-space:nowrap}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.checks{display:flex;gap:6px 16px;flex-wrap:wrap;padding:4px 0}.checks label{display:flex;gap:6px;align-items:center;font-size:14px;color:var(--ink);font-weight:400}
.checks input{width:auto}
.tree{list-style:none;margin:0;padding:0}.tree li{padding:6px 0;border-bottom:1px solid var(--line)}.tree li:last-child{border-bottom:0}
.tree ul{list-style:none;margin:4px 0 0;padding:0 0 0 22px}.tree ul li{border-bottom:0;padding:3px 0}
.tree .name{font-weight:600}.tree ul .name{font-weight:400}
.meter{min-width:140px}.meter .bar{margin:4px 0 2px}
.daychart{display:flex;align-items:flex-end;gap:2px;height:136px;border-bottom:1px solid var(--line);padding-top:32px}
.daychart .d{flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end;justify-content:center;position:relative;outline:none;cursor:default}
.daychart .d i{display:block;width:100%;max-width:24px;background:var(--accent);border-radius:4px 4px 0 0}
.daychart .d:hover i,.daychart .d:focus i{opacity:.75}.daychart .d:focus-visible{box-shadow:inset 0 0 0 2px var(--accent-soft)}
.daychart .d:hover::after,.daychart .d:focus::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg);font-size:12px;line-height:1.4;padding:4px 8px;border-radius:6px;white-space:nowrap;z-index:2;pointer-events:none}
.daychart .d:nth-child(-n+5):hover::after,.daychart .d:nth-child(-n+5):focus::after{left:0;transform:none}
.daychart .d:nth-last-child(-n+5):hover::after,.daychart .d:nth-last-child(-n+5):focus::after{left:auto;right:0;transform:none}
.daxis{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-top:4px}
details summary{cursor:pointer;color:var(--accent)}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}.kv dt{color:var(--muted);font-size:13px}.kv dd{margin:0}
.danger{border-color:var(--bad-soft)}
.right{text-align:right}.show-sm{display:none}.badge{white-space:nowrap}
td .btn.small,td form.inline{white-space:nowrap}
.range{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}.range a.on{background:var(--accent-soft);color:var(--accent);border-color:transparent;font-weight:600}
pre.preview{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto;margin:0}
@media (max-width:640px){
  h1{font-size:20px}.secret{font-size:20px}.kv{grid-template-columns:1fr}.kv dt{margin-top:6px}
  .hide-sm{display:none}.show-sm{display:block}
}
`

const CONFIRM_JS = `document.addEventListener('submit',e=>{const f=e.target;if(f&&f.dataset&&f.dataset.confirm&&!confirm(f.dataset.confirm))e.preventDefault()},true)`

export const WebHead = () => (<><style>{raw(WEB_CSS)}</style><script>{raw(CONFIRM_JS)}</script></>)

/** Page shell with the right navigation for the logged-in person and their flash messages. */
export function Shell(p: { c: C; title: string; active: string; narrow?: boolean; flashes?: Flash[]; children: Child }) {
  const s = p.c.get('session')
  return (
    <Page title={p.title} user={s?.user ?? null} nav={navFor(s?.user.role)} active={p.active} narrow={p.narrow} head={<WebHead />} csrf={s?.csrf}>
      {(p.flashes ?? []).filter((f): f is Extract<Flash, { text: string }> => 'text' in f).map((f) => (
        <div class={'notice' + (f.kind === 'ok' ? '' : ' ' + f.kind)} role="status">{f.text}</div>
      ))}
      {p.children}
    </Page>
  )
}

/** Flash messages for the current session (consumed). */
export const takeFlashes = (web: Web, c: C): Flash[] => { const s = c.get('session'); return s ? web.flash.take(s.idHash) : [] }
export const say = (web: Web, s: SessionAuth, kind: 'ok' | 'warn' | 'bad', text: string) => web.flash.push(s.idHash, { kind, text })

// components ---------------------------------------------------------------------------------------------------------

export const Stat = (p: { label: string; value: Child; hint?: Child }) => (
  <div class="stat"><span>{p.label}</span><b>{p.value}</b>{p.hint ? <span>{p.hint}</span> : null}</div>
)

export const Empty = (p: { title: string; children?: Child }) => <div class="empty"><b>{p.title}</b>{p.children}</div>

export const Bar = (p: { ratio: number }) => {
  const pct = Math.max(0, Math.min(100, Math.round(p.ratio * 100)))
  return <div class={'bar' + (p.ratio >= 1 ? ' over' : '')}><i style={`width:${pct}%`} /></div>
}

/** A form with only a button (revoke, delete). `confirm` asks first. */
export const ButtonForm = (p: { action: string; csrf: string; label: string; danger?: boolean; primary?: boolean; small?: boolean; confirm?: string; hidden?: Record<string, string> }) => (
  <form class="inline" method="post" action={p.action} data-confirm={p.confirm}>
    <Csrf token={p.csrf} />
    {Object.entries(p.hidden ?? {}).map(([k, v]) => <input type="hidden" name={k} value={v} />)}
    <button type="submit" class={['btn', p.small !== false ? 'small' : '', p.danger ? 'danger' : '', p.primary ? 'primary' : ''].filter(Boolean).join(' ')}>{p.label}</button>
  </form>
)

/** The installers' last line on success (installer/install.sh.tmpl and install.ps1.tmpl print exactly this). */
export const INSTALL_DONE_LINE = '✓ 연결을 마쳤어요'

/**
 * The enroll code and the install commands, shown once right after the code was made. Steps and commands come first
 * (on a phone the warnings would otherwise push them off the screen); the address warnings follow as one note.
 * `forOther` = an admin made the code for someone else: that PC waits for the person's approval.
 */
export function EnrollResult(p: { c: C; ctx: Ctx; code: string; expiresAt: string; who?: string; forOther?: boolean }) {
  const urls = effectiveUrls(p.ctx, requestOrigin(p.c))
  const cmd = installCommands(urls.hubUrl, p.code)
  const warnings = urlWarnings(urls)
  return (
    <div class="card oneshot">
      <h2>{p.who ? `${p.who}님 PC 연결 코드` : 'PC 연결 코드'}</h2>
      <p><span class="secret">{p.code}</span></p>
      <p class="muted small">한 번만 쓸 수 있고 {fmtDateTime(p.expiresAt)}까지 유효해요. 이 화면을 벗어나면 다시 볼 수 없어요.</p>
      <ol class="steps">
        <li>연결할 PC에서 <b>터미널</b>을 열어요. (맥: 응용 프로그램 › 유틸리티 › 터미널 / 윈도우: 시작 메뉴에서 <b>PowerShell</b>)</li>
        <li>아래 명령 중 PC에 맞는 것을 <b>복사</b>해서 붙여 넣고 Enter를 눌러요.</li>
        <li>'{INSTALL_DONE_LINE}'가 나오면 터미널을 새로 열고 <code>claude</code>를 입력해 보세요. 데스크톱 앱을 쓰면 앱을 다시 열어 주세요.</li>
      </ol>
      <p class="cmdlabel">맥 · 리눅스 (터미널)</p>
      <CopyBlock id="cmd-mac" text={cmd.mac} />
      <p class="cmdlabel">윈도우 (PowerShell)</p>
      <CopyBlock id="cmd-win" text={cmd.windows} />
      {p.forOther ? <p class="small" style="margin-top:12px">이 코드로 연결한 PC는 {p.who ?? '본인'}님이 '내 PC' 페이지에서 승인해야 개인 폴더를 열 수 있어요. 회사 파일과 AI는 바로 돼요.</p> : null}
      {warnings.length ? (
        <div class="notice warn small" style="margin:12px 0 0">{warnings.length === 1 ? warnings[0] : <ul>{warnings.map((w) => <li>{w}</li>)}</ul>}</div>
      ) : null}
    </div>
  )
}

// labels -------------------------------------------------------------------------------------------------------------

export const ROLE_LABEL: Record<string, string> = { owner: '소유자', admin: '관리자', member: '직원' }
export const ACCESS_LABEL: Record<string, string> = { none: '볼 수 없음', read: '읽기', write: '읽기·쓰기' }
export const PERIOD_LABEL: Record<string, string> = { day: '하루', month: '한 달' }
export const SOURCE_LABEL: Record<string, string> = { pc: 'PC', hub: '휴대폰·예약' }
/** budget action when the limit is reached */
export const BUDGET_ACTION_LABEL: Record<string, string> = { block: '막기', warn: '표시만' }

/** "김대표님이" — 님 ends in a consonant, so the particle is always 이 whatever the name is. */
export const byName = (name: string) => `${name}님이`

export const roleBadge = (role: string) => <span class={'badge' + (role === 'member' ? '' : ' good')}>{ROLE_LABEL[role] ?? role}</span>

export type { User }
