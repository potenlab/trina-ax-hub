/** @jsxImportSource hono/jsx */
// First-run setup, login, logout and password change.
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { App, C } from '../http/app'
import { createSession, destroySession, SESSION_TTL_MS, csrfOk } from '../auth/sessions'
import { countUsers, createUser, getUser, getUserByUsername, setPassword, verifyPassword } from '../auth/users'
import { getUserByLogin } from '../auth/invites'
import { initTeamFolder } from '../policy/rules-admin'
import { audit } from '../audit'
import { HttpError } from '../http/errors'
import { PRODUCT } from '../product'
import { cookieName } from '../http/cookies'
import { safeEqual } from '../ids'
import { Page, Csrf } from '../ui/layout'
import {
  type Web, type Form, WebHead, render, field, rawField, preForm, preCsrfToken, sessionForm, CsrfError, csrfRefused,
  clientIp, safeNext, isHttps, Shell, LOGIN_WINDOW_MS,
} from './kit'
import { companyName, saveSetting } from './settings'

const MIN_PASSWORD = 8
const API_KEY = /^[\x21-\x7e]{10,400}$/

export function startSession(web: Web, c: C, userId: string) {
  const s = createSession(web.ctx.db, userId)
  setCookie(c, cookieName(c, PRODUCT.sessionCookie), s.id, { httpOnly: true, sameSite: 'Lax', secure: isHttps(c), path: '/', maxAge: Math.floor(SESSION_TTL_MS / 1000) })
}

const homeFor = (role: string) => (role === 'owner' || role === 'admin' ? '/admin' : '/me')

// Where a person was going when they had to log in or join (the Claude app connect screen, for one). The login page
// keeps it for 15 minutes, so a person who then opens their invite link in the same browser still lands there.
export const NEXT_COOKIE = 'tax_next'
const NEXT_TTL_S = 15 * 60

export function rememberNext(c: C, next: string | null) {
  if (next && next.startsWith('/oauth/continue/')) {
    setCookie(c, cookieName(c, NEXT_COOKIE), next, { httpOnly: true, sameSite: 'Lax', secure: isHttps(c), path: '/', maxAge: NEXT_TTL_S })
  }
}
export const rememberedNext = (c: C): string | null => safeNext(getCookie(c, cookieName(c, NEXT_COOKIE)))
export const forgetNext = (c: C) => deleteCookie(c, cookieName(c, NEXT_COOKIE), { path: '/', secure: isHttps(c) })

// setup ----------------------------------------------------------------------------------------------------------------
// Until the owner exists, /setup opens only on the hub computer itself (a browser there, not through the Cloudflare
// tunnel) or with the one-time token printed in the server log and by `trina-ax status`. Otherwise whoever reaches a
// fresh hub first through its public address could make themselves the owner.

function setupAllowed(web: Web, c: C, given: string | undefined): boolean {
  if (c.get('localDirect')) return true
  const t = web.ctx.secrets.setupToken()
  return !!t && !!given && given.length === t.length && safeEqual(given, t)
}

const SetupLocked = () => (
  <Page title="처음 설정" narrow head={<WebHead />}>
    <h1>처음 설정</h1>
    <div class="notice warn">처음 설정은 허브 컴퓨터(맥미니)에서 열거나, 서버 로그나 <code>trina-ax status</code>에 나온 설정 주소로 열어 주세요.</div>
  </Page>
)

interface SetupValues { companyName: string; username: string; name: string }

function SetupPage(p: { csrf: string; token?: string; values?: SetupValues; error?: string }) {
  const v = p.values ?? { companyName: '', username: '', name: '' }
  return (
    <Page title="처음 설정" narrow head={<WebHead />}>
      <h1>처음 설정</h1>
      <p class="lead">회사 이름과 이 허브를 관리할 소유자 계정을 만들어요. 1분이면 끝나요.</p>
      {p.error ? <div class="notice bad" role="alert">{p.error}</div> : null}
      <form method="post" action="/setup" class="card">
        <Csrf token={p.csrf} />
        {p.token ? <input type="hidden" name="setup" value={p.token} /> : null}
        <div class="field"><label for="companyName">회사 이름</label>
          <input id="companyName" name="companyName" value={v.companyName} required maxlength={60} placeholder="예: 트리나상사" autocomplete="organization" /></div>
        <h3>소유자 계정</h3>
        <div class="row">
          <div class="field"><label for="name">이름</label><input id="name" name="name" value={v.name} required maxlength={40} autocomplete="name" /></div>
          <div class="field"><label for="username">아이디</label>
            <input id="username" name="username" value={v.username} required pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,31}" autocapitalize="off" autocomplete="username" placeholder="영문·숫자" /></div>
        </div>
        <div class="row">
          <div class="field"><label for="password">비밀번호 (8자 이상)</label><input id="password" type="password" name="password" required minlength={MIN_PASSWORD} autocomplete="new-password" /></div>
          <div class="field"><label for="password2">비밀번호 확인</label><input id="password2" type="password" name="password2" required minlength={MIN_PASSWORD} autocomplete="new-password" /></div>
        </div>
        <h3>Anthropic API 키 <span class="muted small">(선택 · 나중에 설정에서 넣어도 돼요)</span></h3>
        <div class="field"><label for="apiKey">회사 API 키</label>
          <input id="apiKey" type="password" name="apiKey" autocomplete="off" spellcheck={false} placeholder="sk-ant-…" />
          <span class="muted small">회사 Anthropic 계정의 키예요. 모든 사용 요금이 이 계정으로 청구돼요. 저장한 뒤에는 화면에 다시 보이지 않아요.</span></div>
        <button class="btn primary" type="submit">설정 끝내기</button>
      </form>
    </Page>
  )
}

async function doSetup(web: Web, f: Form): Promise<{ userId: string }> {
  const values = { companyName: field(f, 'companyName'), username: field(f, 'username'), name: field(f, 'name') }
  const pw = rawField(f, 'password'), pw2 = rawField(f, 'password2'), key = field(f, 'apiKey')
  if (!values.companyName || values.companyName.length > 60) throw new HttpError(400, 'validation', '회사 이름을 60자 안으로 적어 주세요.')
  if (pw.length < MIN_PASSWORD) throw new HttpError(400, 'validation', '비밀번호는 8자 이상이어야 해요.')
  if (pw !== pw2) throw new HttpError(400, 'validation', '두 비밀번호가 서로 달라요.')
  if (key && !API_KEY.test(key)) throw new HttpError(400, 'validation', 'API 키 모양이 이상해요. 공백 없이 그대로 붙여 넣어 주세요.')
  const db = web.ctx.db
  const owner = await createUser(db, { username: values.username, name: values.name, role: 'owner', password: pw })
  initTeamFolder(db, web.ctx.fx.root)
  web.ctx.rulesChanged()
  saveSetting(web.ctx, 'companyName', values.companyName)
  if (key) web.ctx.secrets.setApiKey(key)
  web.ctx.secrets.clearSetupToken()
  audit(db, { actor: owner.id, action: 'setup', target: owner.id, detail: { companyName: values.companyName, apiKey: !!key } })
  return { userId: owner.id }
}

// login ----------------------------------------------------------------------------------------------------------------

function LoginPage(p: { csrf: string; company: string; username?: string; next?: string | null; error?: string; info?: string }) {
  return (
    <Page title="로그인" narrow head={<WebHead />}>
      <h1>{p.company}</h1>
      <p class="lead">회사 AI에 로그인해요.</p>
      {p.error ? <div class="notice bad" role="alert">{p.error}</div> : null}
      {p.info ? <div class="notice">{p.info}</div> : null}
      {p.next?.startsWith('/oauth/continue/') ? <div class="notice small">Claude 앱 연결을 이어서 할게요. 로그인하면 바로 이어져요. 처음이라면 받은 초대 링크를 먼저 열어 비밀번호를 정해 주세요.</div> : null}
      <form method="post" action="/login" class="card">
        <Csrf token={p.csrf} />
        {p.next ? <input type="hidden" name="next" value={p.next} /> : null}
        <div class="field"><label for="username">이메일 또는 아이디</label>
          <input id="username" name="username" value={p.username ?? ''} required autocapitalize="off" autocomplete="username" spellcheck={false} autofocus={!p.username} /></div>
        <div class="field"><label for="password">비밀번호</label>
          <input id="password" type="password" name="password" required autocomplete="current-password" autofocus={!!p.username} /></div>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center">로그인</button>
      </form>
      <p class="muted small">비밀번호를 잊었으면 회사 관리자에게 새 링크를 부탁해 주세요.</p>
    </Page>
  )
}

// a hash to verify against when the username does not exist (same timing as a wrong password)
let dummyHash: Promise<string> | null = null
const dummy = () => (dummyHash ??= Bun.password.hash('trina-ax-not-a-password'))

// password change -------------------------------------------------------------------------------------------------------

function PasswordPage(p: { c: C; forced: boolean; csrf: string; next?: string | null; error?: string }) {
  return (
    <Shell c={p.c} title="비밀번호 바꾸기" active="" narrow>
      <h1>비밀번호 바꾸기</h1>
      {p.forced
        ? <p class="lead">처음 로그인했거나 비밀번호가 초기화됐어요. 앞으로 쓸 비밀번호를 새로 정해 주세요.</p>
        : <p class="lead">지금 비밀번호를 확인한 뒤 새 비밀번호로 바꿔요.</p>}
      {p.error ? <div class="notice bad" role="alert">{p.error}</div> : null}
      <form method="post" action="/me/password" class="card">
        <Csrf token={p.csrf} />
        {p.next ? <input type="hidden" name="next" value={p.next} /> : null}
        {p.forced ? null : <div class="field"><label for="current">지금 비밀번호</label><input id="current" type="password" name="current" required autocomplete="current-password" /></div>}
        <div class="field"><label for="password">새 비밀번호 (8자 이상)</label><input id="password" type="password" name="password" required minlength={MIN_PASSWORD} autocomplete="new-password" /></div>
        <div class="field"><label for="password2">새 비밀번호 확인</label><input id="password2" type="password" name="password2" required minlength={MIN_PASSWORD} autocomplete="new-password" /></div>
        <div class="actions"><button class="btn primary" type="submit">바꾸기</button>{p.forced ? null : <a class="btn" href="/me">취소</a>}</div>
      </form>
    </Shell>
  )
}

export function mountAuth(app: App, web: Web) {
  const { ctx } = web
  const db = ctx.db

  app.get('/', (c) => {
    if (countUsers(db) === 0) return c.redirect('/setup')
    const s = c.get('session')
    if (!s) return c.redirect('/login')
    return c.redirect(homeFor(s.user.role))
  })

  // setup ------------------------------------------------------------------------------------------------------------
  app.get('/setup', (c) => {
    if (countUsers(db) > 0) return c.redirect(c.get('session') ? '/' : '/login')
    const token = c.req.query('t')
    if (!setupAllowed(web, c, token)) return render(c, <SetupLocked />, 403)
    return render(c, <SetupPage csrf={preCsrfToken(c)} token={token} />)
  })

  app.post('/setup', async (c) => {
    if (countUsers(db) > 0 || web.settingUp) return c.redirect('/login', 303)
    const { form, ok } = await preForm(c)
    const values = { companyName: field(form, 'companyName'), username: field(form, 'username'), name: field(form, 'name') }
    const token = rawField(form, 'setup') || undefined
    if (!setupAllowed(web, c, token)) return render(c, <SetupLocked />, 403)
    if (!ok) return render(c, <SetupPage csrf={preCsrfToken(c)} token={token} values={values} error="페이지가 오래됐어요. 다시 한 번 눌러 주세요." />, 403)
    // the check above and this flag run without an await in between: a second post waits for nothing and is refused
    if (countUsers(db) > 0 || web.settingUp) return c.redirect('/login', 303)
    web.settingUp = true
    try {
      const { userId } = await doSetup(web, form)
      startSession(web, c, userId)
      return c.redirect('/admin', 303)
    } catch (e) {
      if (e instanceof HttpError) return render(c, <SetupPage csrf={preCsrfToken(c)} token={token} values={values} error={e.message} />, 400)
      throw e
    } finally {
      web.settingUp = false
    }
  })

  // login ------------------------------------------------------------------------------------------------------------
  app.get('/login', (c) => {
    if (countUsers(db) === 0) return c.redirect('/setup')
    const next = safeNext(c.req.query('next'))
    const s = c.get('session')
    if (s) return c.redirect(next ?? homeFor(s.user.role))
    rememberNext(c, next)
    return render(c, <LoginPage csrf={preCsrfToken(c)} company={companyName(ctx)} next={next}
      info={c.req.query('bye') !== undefined ? '로그아웃했어요.' : c.req.query('changed') !== undefined ? '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.' : undefined} />)
  })

  app.post('/login', async (c) => {
    const { form, ok } = await preForm(c)
    const username = field(form, 'username').slice(0, 64)
    const password = rawField(form, 'password')
    const next = safeNext(field(form, 'next'))
    const again = (error: string, status: 400 | 403 | 429) =>
      render(c, <LoginPage csrf={preCsrfToken(c)} company={companyName(ctx)} username={username} next={next} error={error} />, status)
    if (!ok) return again('페이지가 오래됐어요. 다시 로그인해 주세요.', 403)
    const ip = clientIp(c)
    const ipKey = 'ip:' + ip
    const pairKey = `${username.toLowerCase()}\n${ip}`
    if (web.login.ip.blocked(ipKey) || web.login.pair.blocked(pairKey)) {
      return again(`로그인 시도가 너무 많아요. ${Math.round(LOGIN_WINDOW_MS / 60_000)}분 뒤에 다시 해 주세요.`, 429)
    }
    const u = username ? getUserByLogin(db, username) : null
    const good = u ? await verifyPassword(u.passwordHash, password) : (await Bun.password.verify(password || 'x', await dummy()), false)
    if (!u || !good || u.status !== 'active') {
      web.login.ip.fail(ipKey)
      web.login.pair.fail(pairKey)
      if (u) audit(db, { actor: null, action: 'login.fail', target: u.id, detail: { ip: clientIp(c) } })
      return again('이메일·아이디 또는 비밀번호가 맞지 않아요.', 400)
    }
    web.login.pair.clear(pairKey)
    startSession(web, c, u.id)
    audit(db, { actor: u.id, action: 'login', target: u.id, detail: { ip: clientIp(c) } })
    // a person who must choose a new password first keeps their destination through that screen
    if (u.mustChangePassword) return c.redirect('/me/password' + (next ? '?next=' + encodeURIComponent(next) : ''), 303)
    forgetNext(c)
    return c.redirect(next ?? homeFor(u.role), 303)
  })

  // logout -----------------------------------------------------------------------------------------------------------
  // The shared header's logout button carries no _csrf field, so a same-origin check stands in for it: browsers send
  // Sec-Fetch-Site / Origin on every form post. A form that does carry _csrf is checked the usual way.
  app.post('/logout', async (c) => {
    const s = c.get('session')
    let given: unknown
    try { given = (await c.req.parseBody())._csrf } catch {}
    const site = c.req.header('sec-fetch-site')
    const origin = c.req.header('origin')
    let sameOrigin = site ? site === 'same-origin' : false
    if (!site && origin) { try { sameOrigin = new URL(origin).host === (c.req.header('host') ?? '') } catch {} }
    if (s) {
      if (!(given !== undefined ? csrfOk(s, given) : sameOrigin)) return csrfRefused(c)
      destroySession(db, getCookie(c, cookieName(c, PRODUCT.sessionCookie)))
      audit(db, { actor: s.user.id, action: 'logout', target: s.user.id })
    }
    deleteCookie(c, cookieName(c, PRODUCT.sessionCookie), { path: '/', secure: isHttps(c) })
    return c.redirect('/login?bye', 303)
  })

  // password ---------------------------------------------------------------------------------------------------------
  app.get('/me/password', (c) => {
    const s = c.get('session')!
    const u = getUser(db, s.user.id)!
    return render(c, <PasswordPage c={c} forced={u.mustChangePassword} csrf={s.csrf} next={safeNext(c.req.query('next'))} />)
  })

  app.post('/me/password', async (c) => {
    let parsed
    try { parsed = await sessionForm(c) } catch (e) { if (e instanceof CsrfError) return csrfRefused(c); throw e }
    const { form, session } = parsed
    const u = getUser(db, session.user.id)!
    const withHash = getUserByUsername(db, u.username)!
    const forced = u.mustChangePassword
    const next = safeNext(field(form, 'next'))
    const again = (error: string) => render(c, <PasswordPage c={c} forced={forced} csrf={session.csrf} next={next} error={error} />, 400)
    const pw = rawField(form, 'password'), pw2 = rawField(form, 'password2')
    if (!forced && !(await verifyPassword(withHash.passwordHash, rawField(form, 'current')))) return again('지금 비밀번호가 맞지 않아요.')
    if (pw.length < MIN_PASSWORD) return again('새 비밀번호는 8자 이상이어야 해요.')
    if (pw !== pw2) return again('두 비밀번호가 서로 달라요.')
    if (await verifyPassword(withHash.passwordHash, pw)) return again('지금과 다른 비밀번호로 정해 주세요.')
    await setPassword(db, u.id, pw, false)
    // other browsers logged in as this person are logged out
    db.query('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(u.id, session.idHash)
    audit(db, { actor: u.id, action: 'password.change', target: u.id, detail: forced ? { first: true } : undefined })
    if (next) return c.redirect(next, 303)
    web.flash.push(session.idHash, { kind: 'ok', text: '비밀번호를 바꿨어요.' })
    return c.redirect(homeFor(u.role), 303)
  })
}

