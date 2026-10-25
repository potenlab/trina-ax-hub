/** @jsxImportSource hono/jsx */
// /join/<token>: a person opens the invite (or password-reset) link their admin sent, chooses a password, and is
// logged in. The link works once and for 7 days (src/auth/invites.ts). A dead link gets a plain Korean page that says
// to ask the admin for a new one.
import type { App, C } from '../http/app'
import { audit } from '../audit'
import { Page, Csrf } from '../ui/layout'
import { lookupInvite, redeemInvite, type InviteKind, type InviteProblem } from '../auth/invites'
import { type Web, WebHead, doc, field, rawField, preForm, preCsrfToken, safeNext, clientIp } from './kit'
import { companyName } from './settings'
import { forgetNext, rememberedNext, startSession } from './auth'

const MIN_PASSWORD = 8

const DEAD: Record<InviteProblem, { title: string; text: string; login?: boolean }> = {
  unknown: { title: '열 수 없는 링크예요', text: '링크를 끝까지 복사했는지 확인해 보세요. 그래도 안 되면 회사 관리자에게 새 링크를 부탁해 주세요.' },
  expired: { title: '링크 기간이 지났어요', text: '링크는 만든 날부터 7일 동안만 쓸 수 있어요. 회사 관리자에게 새 링크를 부탁해 주세요.' },
  used: { title: '이미 쓴 링크예요', text: '비밀번호를 이미 정했다면 로그인 화면에서 들어가요. 처음이 아닌데 안 열리면 회사 관리자에게 새 링크를 부탁해 주세요.', login: true },
  revoked: { title: '새 링크가 만들어져서 이 링크는 쓸 수 없어요', text: '관리자에게 가장 최근에 받은 링크를 열어 주세요. 없으면 회사 관리자에게 새 링크를 부탁해 주세요.' },
  off: { title: '지금은 쓸 수 없는 계정이에요', text: '회사 관리자에게 물어봐 주세요.' },
}

function DeadLink(p: { why: InviteProblem; company: string }) {
  const d = DEAD[p.why]
  return (
    <Page title={d.title} narrow head={<><WebHead /><meta name="robots" content="noindex" /></>}>
      <h1>{p.company}</h1>
      <div class="notice bad" role="alert"><b>{d.title}</b><br />{d.text}</div>
      {d.login ? <a class="btn" href="/login">로그인하기</a> : null}
    </Page>
  )
}

function JoinPage(p: { csrf: string; token: string; company: string; name: string; login: string; kind: InviteKind; next: string | null; error?: string }) {
  const reset = p.kind === 'reset'
  return (
    <Page title={reset ? '비밀번호 다시 정하기' : '시작하기'} narrow head={<><WebHead /><meta name="robots" content="noindex" /></>}>
      <h1>{p.company}</h1>
      <p class="lead">{reset ? `${p.name}님, 새 비밀번호를 정해 주세요.` : `${p.name}님, 반가워요. 로그인할 때 쓸 비밀번호를 정해 주세요.`}</p>
      {p.error ? <div class="notice bad" role="alert">{p.error}</div> : null}
      <form method="post" action={`/join/${p.token}`} class="card">
        <Csrf token={p.csrf} />
        {p.next ? <input type="hidden" name="next" value={p.next} /> : null}
        <div class="field"><label for="password">비밀번호 (8자 이상)</label>
          <input id="password" type="password" name="password" required minlength={MIN_PASSWORD} autocomplete="new-password" autofocus /></div>
        <div class="field"><label for="password2">비밀번호 확인</label>
          <input id="password2" type="password" name="password2" required minlength={MIN_PASSWORD} autocomplete="new-password" /></div>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center">{reset ? '비밀번호 바꾸고 들어가기' : '비밀번호 정하고 시작하기'}</button>
      </form>
      <p class="muted small">다음에 로그인할 때는 <b>{p.login}</b> 으로 들어와요.</p>
      {reset ? null : <p class="muted small">Claude 앱을 먼저 설치해 두면 바로 이어서 연결할 수 있어요.</p>}
    </Page>
  )
}

export function mountJoin(app: App, web: Web) {
  const { ctx } = web
  const db = ctx.db
  const dead = (c: C, why: InviteProblem) => c.html(doc(<DeadLink why={why} company={companyName(ctx)} />), why === 'unknown' ? 404 : 410)
  const loginOf = (u: { email: string | null; username: string }) => u.email ?? u.username

  app.get('/join/:token', (c) => {
    const token = c.req.param('token')
    const l = lookupInvite(db, token)
    c.header('cache-control', 'no-store')
    if (!l.ok) return dead(c, l.why)
    const next = safeNext(c.req.query('next')) ?? rememberedNext(c)
    return c.html(doc(<JoinPage csrf={preCsrfToken(c)} token={token} company={companyName(ctx)} name={l.user.name} login={loginOf(l.user)} kind={l.invite.kind} next={next} />))
  })

  app.post('/join/:token', async (c) => {
    const token = c.req.param('token')
    c.header('cache-control', 'no-store')
    const { form, ok } = await preForm(c)
    const l = lookupInvite(db, token)
    if (!l.ok) return dead(c, l.why)
    const next = safeNext(field(form, 'next')) ?? rememberedNext(c)
    const again = (error: string, status: 400 | 403) =>
      c.html(doc(<JoinPage csrf={preCsrfToken(c)} token={token} company={companyName(ctx)} name={l.user.name} login={loginOf(l.user)} kind={l.invite.kind} next={next} error={error} />), status)
    if (!ok) return again('페이지가 오래됐어요. 다시 한 번 눌러 주세요.', 403)
    const pw = rawField(form, 'password'), pw2 = rawField(form, 'password2')
    if (pw.length < MIN_PASSWORD) return again('비밀번호는 8자 이상이어야 해요.', 400)
    if (pw !== pw2) return again('두 비밀번호가 서로 달라요.', 400)
    const hash = await Bun.password.hash(pw)
    const done = redeemInvite(db, token, hash)
    // somebody else used the link between the check above and now
    if (!done) return dead(c, 'used')
    // whatever sessions this person had are over (a reset link exists because the old password may be known to others)
    db.query('DELETE FROM sessions WHERE user_id = ?').run(done.user.id)
    startSession(web, c, done.user.id)
    audit(db, { actor: done.user.id, action: 'invite.join', target: done.user.id, detail: { kind: done.kind, ip: clientIp(c) } })
    forgetNext(c)
    return c.redirect(next ?? '/me', 303)
  })
}
