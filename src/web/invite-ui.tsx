/** @jsxImportSource hono/jsx */
// Invite links as the admin sees them: the ready-to-send message, the one-time link card, and the bulk invite
// (paste "이름, 이메일" lines → preview → create). Pure helpers first so they can be tested without a page.
import type { Database } from 'bun:sqlite'
import type { C } from '../http/app'
import type { Ctx } from '../context'
import { CopyBlock, Csrf } from '../ui/layout'
import { fmtDateTime } from '../ui/format'
import { audit } from '../audit'
import { HttpError } from '../http/errors'
import {
  INVITE_TTL_MS, createInvite, createInvitedUser, deriveUsername, emailOwner, normalizeEmail, validEmail,
} from '../auth/invites'
import { setUserGroups } from '../auth/users'
import type { Web } from './kit'
import { requestOrigin } from './kit'
import { effectiveUrls, companyName } from './settings'
import { deliverInvite } from './invite-mail'
import type { BulkRow } from './invite-types'

export const INVITE_DAYS = Math.round(INVITE_TTL_MS / 86_400_000)

/** `https://<hub>/join/<token>` on the address people can reach (public, else office, else the one the admin used). */
export const joinLink = (ctx: Ctx, c: C, token: string) => `${effectiveUrls(ctx, requestOrigin(c)).hubUrl}/join/${token}`

/** The text an admin pastes into a chat or mail. */
export function inviteMessage(o: { company: string; name: string; link: string; reset?: boolean }): string {
  return o.reset
    ? [`[${o.company}] ${o.name}님, 비밀번호를 다시 정하는 링크예요.`, `아래 링크에서 새 비밀번호를 정해 주세요. (${INVITE_DAYS}일 안에 한 번만 쓸 수 있어요)`, o.link].join('\n')
    : [`[${o.company}] ${o.name}님, 회사 AI에 초대했어요.`, 'Claude 앱을 먼저 설치해 두세요.', `아래 링크에서 비밀번호를 정하면 시작할 수 있어요. (${INVITE_DAYS}일 안에 한 번만 쓸 수 있어요)`, o.link].join('\n')
}

/** A warning when the link would not open for people outside the office. */
export function linkReach(ctx: Ctx, c: C): string | null {
  const u = effectiveUrls(ctx, requestOrigin(c))
  if (u.kind === 'public') return null
  let host = ''
  try { host = new URL(u.hubUrl).hostname } catch {}
  if (u.kind === 'lan') return '이 링크는 사무실 네트워크 안에서만 열려요. 밖에서도 쓰려면 \'설정 › 접속 주소\'에 공개 주소를 넣은 뒤 링크를 다시 만들어 주세요.'
  return /^(localhost|127\.|\[?::1\]?$|0\.0\.0\.0)/i.test(host)
    ? "이 링크는 허브 컴퓨터 안에서만 열려요. '설정 › 접속 주소'에 사내 주소나 공개 주소를 넣은 뒤 링크를 다시 만들어 주세요."
    : '이 링크는 같은 사무실 네트워크에서만 열릴 수 있어요. 밖에서도 쓰려면 공개 주소를 넣어 주세요.'
}

/** The link just made for one person: copy buttons for the link and for the message. Shown once. */
export function InviteOnce(p: { ctx: Ctx; c: C; token: string; expiresAt: string; who: string; reset: boolean; mailed: boolean }) {
  const link = joinLink(p.ctx, p.c, p.token)
  const message = inviteMessage({ company: companyName(p.ctx), name: p.who, link, reset: p.reset })
  const reach = linkReach(p.ctx, p.c)
  return (
    <div class="card oneshot" id="invite-once">
      <h2>{p.who}님 {p.reset ? '비밀번호 초기화 링크' : '초대 링크'}</h2>
      <CopyBlock id="invite-link" text={link} />
      <p class="muted small">한 번만 쓸 수 있고 {fmtDateTime(p.expiresAt)}까지 유효해요. 이 화면을 벗어나면 다시 볼 수 없어요. 필요하면 {p.reset ? "'초기화 링크 만들기'" : "'초대 링크 다시 만들기'"}를 다시 눌러요.</p>
      <h3>보낼 메시지</h3>
      <CopyBlock id="invite-message" text={message} />
      <p class="muted small">{p.mailed ? '메일로도 보냈어요. 못 받은 사람에게는 메시지를 복사해서 보내 주세요.' : '메일로 바로 보내는 기능은 아직 없어요. 메시지를 복사해서 카카오톡이나 메일로 보내 주세요.'}</p>
      {reach ? <div class="notice warn small" style="margin:12px 0 0">{reach}</div> : null}
    </div>
  )
}

// bulk ---------------------------------------------------------------------------------------------------------------

export const BULK_MAX = 300

/** Split one pasted line into cells. Tabs (a spreadsheet paste) win over commas; "double quotes" keep a comma inside a cell. */
export function splitCells(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : ','
  const out: string[] = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else quoted = false } else cur += ch
    } else if (ch === '"' && cur.trim() === '') { quoted = true; cur = '' }
    else if (ch === sep) { out.push(cur.trim()); cur = '' }
    else cur += ch
  }
  out.push(cur.trim())
  return out
}

export interface ParsedLine { line: number; name: string; email: string; problem?: string }

const HEADER = /(이메일|e-?mail|메일)/i

/** "이름, 이메일" per line (comma or tab; email first also works; extra columns are ignored; a header line is skipped). */
export function parseBulk(text: string): { rows: ParsedLine[]; header: boolean; tooMany: boolean } {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  const rows: ParsedLine[] = []
  let header = false, tooMany = false
  lines.forEach((raw, i) => {
    if (!raw.trim()) return
    const cs = splitCells(raw)
    if (rows.length === 0 && !header && !cs.some((x) => x.includes('@')) && cs.some((x) => HEADER.test(x))) { header = true; return }
    if (rows.length >= BULK_MAX) { tooMany = true; return }
    const filled = cs.filter(Boolean)
    const at = cs.findIndex((x) => x.includes('@'))
    // no cell has an @: the second filled cell is meant as the address ("홍길동, hong.gmail.com"), and is named as wrong
    const email = at >= 0 ? normalizeEmail(cs[at]!) : normalizeEmail(filled[1] ?? '')
    const name = (at >= 0 ? cs.find((x, j) => j !== at && x) : filled[0]) ?? ''
    const r: ParsedLine = { line: i + 1, name, email }
    if (!name) r.problem = '이름이 없어요.'
    else if (name.length > 40) r.problem = '이름이 너무 길어요 (40자 안으로).'
    else if (!email) r.problem = '이메일이 없어요.'
    else if (!validEmail(email)) r.problem = '이메일 모양이 이상해요.'
    rows.push(r)
  })
  return { rows, header, tooMany }
}

/** Check parsed lines against the people who already exist and against each other. Nothing is written. */
export function planBulk(db: Database, rows: ParsedLine[]): BulkRow[] {
  const seen = new Set<string>()
  return rows.map((r): BulkRow => {
    const base = { line: r.line, name: r.name, email: r.email }
    if (r.problem) return { ...base, status: 'skip', reason: r.problem }
    if (seen.has(r.email)) return { ...base, status: 'skip', reason: '목록에 같은 이메일이 앞에도 있어요.' }
    seen.add(r.email)
    const owner = emailOwner(db, r.email)
    if (owner) return { ...base, status: 'skip', reason: owner.mustChangePassword ? '이미 초대한 이메일이에요. 사람 페이지에서 링크를 다시 만들 수 있어요.' : '이미 가입한 이메일이에요.' }
    return { ...base, status: 'new' }
  })
}

/** Create everyone the plan lets through: a person with no password yet, their groups, and their invite link. */
export function createBulk(web: Web, actor: string, rows: BulkRow[], groupId: string | null): BulkRow[] {
  const { ctx } = web
  const db = ctx.db
  const taken = new Set<string>()
  const out = db.transaction(() => rows.map((r): BulkRow => {
    if (r.status !== 'new') return r
    try {
      const username = deriveUsername(db, r.email, taken)
      taken.add(username.toLowerCase())
      const u = createInvitedUser(db, { username, name: r.name, email: r.email, role: 'member' })
      if (groupId) setUserGroups(db, u.id, [groupId])
      const inv = createInvite(db, u.id, 'invite', actor)
      audit(db, { actor, action: 'user.create', target: u.id, detail: { username: u.username, role: 'member', invite: true, bulk: true } })
      audit(db, { actor, action: 'invite.create', target: u.id, detail: { kind: 'invite', bulk: true } })
      return { ...r, userId: u.id, token: inv.token, expiresAt: inv.expiresAt }
    } catch (e) {
      return { ...r, status: 'skip', reason: e instanceof HttpError ? e.message : '만들지 못했어요.' }
    }
  }))()
  ctx.rulesChanged()
  return out
}

/** Hand each new link to the mailer (does nothing while the hub has no mail service). */
export async function mailBulk(web: Web, c: C, rows: BulkRow[]) {
  const company = companyName(web.ctx)
  for (const r of rows) {
    if (r.status !== 'new' || !r.token) continue
    const link = joinLink(web.ctx, c, r.token)
    r.mailed = await deliverInvite(web.mailer, { to: r.email, name: r.name, company, link, message: inviteMessage({ company, name: r.name, link }), expiresAt: r.expiresAt!, kind: 'invite' })
  }
}

export function BulkPreview(p: { rows: BulkRow[]; header: boolean; tooMany: boolean; text: string; group: string; groupName: string | null; csrf: string }) {
  const fresh = p.rows.filter((r) => r.status === 'new').length
  const skipped = p.rows.length - fresh
  return (<>
    <p class="lead">{fresh ? <><b>{fresh}명</b>의 초대 링크를 만들어요.</> : '만들 수 있는 사람이 없어요.'}{skipped ? ` ${skipped}명은 건너뛰어요.` : ''}{p.groupName ? ` 그룹: ${p.groupName}` : ''}</p>
    {p.header ? <p class="muted small">첫 줄은 머리글로 보고 건너뛰었어요.</p> : null}
    {p.tooMany ? <div class="notice warn small">한 번에 {BULK_MAX}명까지 만들 수 있어요. 나머지는 다시 붙여 넣어 주세요.</div> : null}
    <div class="tablewrap"><table>
      <thead><tr><th class="num">줄</th><th>이름</th><th>이메일</th><th>결과</th></tr></thead>
      <tbody>{p.rows.map((r) => (
        <tr><td class="num">{r.line}</td><td>{r.name || '—'}</td><td style="word-break:break-all">{r.email || '—'}</td>
          <td>{r.status === 'new' ? <span class="badge good">만들어요</span> : <><span class="badge warn">건너뜀</span> <span class="small">{r.reason}</span></>}</td></tr>
      ))}</tbody>
    </table></div>
    <div class="actions">
      {fresh ? (
        <form method="post" action="/admin/users/bulk" class="inline">
          <Csrf token={p.csrf} />
          <textarea name="text" hidden>{p.text}</textarea>
          <input type="hidden" name="group" value={p.group} />
          <button class="btn primary" type="submit">{fresh}명 초대 링크 만들기</button>
        </form>
      ) : null}
      <a class="btn" href="/admin/users#bulk">다시 고치기</a>
    </div>
  </>)
}

export function BulkResult(p: { ctx: Ctx; c: C; rows: BulkRow[]; group: string | null }) {
  const made = p.rows.filter((r) => r.status === 'new' && r.token)
  const skipped = p.rows.filter((r) => r.status === 'skip')
  const company = companyName(p.ctx)
  const links = made.map((r) => ({ r, link: joinLink(p.ctx, p.c, r.token!) }))
  const all = links.map(({ r, link }) => inviteMessage({ company, name: r.name, link })).join('\n\n--------\n\n')
  const reach = linkReach(p.ctx, p.c)
  return (
    <div class="card oneshot" id="bulk-result">
      <h2>{made.length}명을 초대했어요{skipped.length ? ` (${skipped.length}명 건너뜀)` : ''}</h2>
      <p class="muted small">링크는 한 번만 쓸 수 있고 {INVITE_DAYS}일 안에 열어야 해요. 이 화면을 벗어나면 다시 볼 수 없어요. 필요하면 사람 페이지에서 '초대 링크 다시 만들기'를 눌러요.{p.group ? ` 그룹: ${p.group}` : ''}</p>
      {made.length ? (<>
        <div class="actions" style="margin:8px 0">
          <button type="button" class="btn primary" data-copy="bulk-all">모두 복사</button>
          <span class="muted small">사람마다 메시지가 하나씩 들어 있어요. 이름을 보고 나눠서 보내요.</span>
        </div>
        <div class="tablewrap"><table>
          <thead><tr><th>이름</th><th>이메일</th><th>링크</th></tr></thead>
          <tbody>{links.map(({ r, link }, i) => (
            <tr><td><b>{r.name}</b></td><td style="word-break:break-all">{r.email}</td>
              <td><code id={`bulk-link-${i}`} style="word-break:break-all">{link}</code> <button type="button" class="btn small" data-copy={`bulk-link-${i}`}>복사</button></td></tr>
          ))}</tbody>
        </table></div>
        <h3>모두 복사로 복사되는 메시지</h3>
        <pre class="preview" id="bulk-all">{all}</pre>
      </>) : null}
      {skipped.length ? (<>
        <h3>건너뜀</h3>
        <ul class="small">{skipped.map((r) => <li>{r.line}줄 {r.name || r.email || ''} — {r.reason}</li>)}</ul>
      </>) : null}
      {reach ? <div class="notice warn small" style="margin:12px 0 0">{reach}</div> : null}
      <p class="muted small">{made.every((r) => r.mailed) && made.length ? '모두 메일로도 보냈어요.' : made.some((r) => r.mailed) ? '일부는 메일로도 보냈어요. 못 받은 사람에게는 메시지를 복사해서 보내 주세요.' : '메일로 바로 보내는 기능은 아직 없어요.'}</p>
    </div>
  )
}
