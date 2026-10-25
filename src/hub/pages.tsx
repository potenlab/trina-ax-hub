/** @jsxImportSource hono/jsx */
// Phone chat and schedule pages (mobile first). Uses the shared page shell; answers are rendered with the small safe
// Markdown renderer (input escaped first). Live progress comes from GET /app/chats/:id/events (SSE).
import { raw } from 'hono/html'
import type { Principal } from '../policy/access'
import { Csrf, Page, type NavItem } from '../ui/layout'
import { fmtAgo, fmtDateTime } from '../ui/format'
import { renderMarkdown } from './markdown'
import type { Chat, ChatSummary, Message } from './chats'
import { describeCron, MY_FOLDER, PRESETS, toMyFolder, type Schedule, type ScheduleRun } from './schedules'

export const NAV: NavItem[] = [
  { href: '/app', label: '채팅' },
  { href: '/app/schedules', label: '예약 작업' },
]

/** The phone pages' navigation, with a way back to the personal page (and the admin pages for admins). */
export function hubNav(user: Principal | null | undefined): NavItem[] {
  if (!user) return NAV
  const admin = user.role === 'owner' || user.role === 'admin'
  return [...NAV, { href: '/me', label: '내 PC' }, ...(admin ? [{ href: '/admin', label: '관리' }] : [])]
}

/** Download link for a team-folder file the person may read (GET /app/files checks it again). */
export const fileHref = (rel: string) => `/app/files?path=${encodeURIComponent(rel)}`

const HUB_CSS = `
.hub{max-width:720px;margin:0 auto}.hub input,.hub textarea,.hub select{font-size:16px}
.hub-head{display:flex;align-items:center;gap:10px;margin:0 0 14px}.hub-head h1{flex:1;min-width:0;margin:0;font-size:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hub-head .back{font-size:22px;line-height:1;text-decoration:none;color:var(--muted);padding:2px 6px 4px}
.chatlist{list-style:none;margin:0 0 16px;padding:0;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.chatlist li+li{border-top:1px solid var(--line)}.chatlist a{display:block;padding:12px 14px;color:var(--ink);text-decoration:none}
.chatlist .t{display:flex;gap:8px;align-items:center;font-weight:600}.chatlist .t span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chatlist .t time{font-weight:400;color:var(--muted);font-size:12px;flex:none}
.chatlist .p{color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.thread{display:flex;flex-direction:column;gap:10px;padding:0 0 140px}
.msg{max-width:88%;padding:10px 14px;border-radius:16px;overflow-wrap:anywhere}
.msg.user{align-self:flex-end;background:var(--accent);color:var(--accent-ink);border-bottom-right-radius:5px;white-space:pre-wrap}
.msg.assistant{align-self:flex-start;background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:5px}
.msg.error{align-self:flex-start;background:var(--bad-soft);color:var(--bad);border-bottom-left-radius:5px;white-space:pre-wrap}
.msg .live{white-space:pre-wrap}.msg .live:empty{display:none}.msg .status{color:var(--muted);font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.msg .status form{margin-left:auto}
.dots{display:inline-flex;gap:3px}.dots i{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:hubdot 1.2s infinite ease-in-out}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes hubdot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.composer{position:fixed;left:0;right:0;bottom:0;background:var(--panel);border-top:1px solid var(--line);padding:10px 14px calc(10px + env(safe-area-inset-bottom));z-index:5}
.composer form{max-width:720px;margin:0 auto;display:flex;gap:8px;align-items:flex-end}
.composer textarea{min-height:46px;height:46px;max-height:40vh;resize:none;line-height:1.45}.composer .btn{height:46px;flex:none}
.hints{display:flex;flex-direction:column;gap:8px}.hints button{text-align:left;justify-content:flex-start;white-space:normal}
.md>*:first-child{margin-top:0}.md>*:last-child{margin-bottom:0}.md p{margin:.45em 0}
.md h3,.md h4,.md h5,.md h6{margin:.9em 0 .35em;line-height:1.35}.md h3{font-size:17px}.md h4{font-size:16px}.md h5,.md h6{font-size:15px}
.md ul,.md ol{margin:.4em 0;padding-left:1.4em}.md li{margin:.15em 0}.md .task{font-size:14px}
.md pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow-x:auto;white-space:pre}
.md code{background:var(--bg);border-radius:4px;padding:1px 4px}.md pre code{background:none;padding:0}
.md blockquote{margin:.5em 0;padding:2px 12px;border-left:3px solid var(--line);color:var(--muted)}
.md .tablewrap{margin:.5em 0}.md table{font-size:13px}.md hr{border:0;border-top:1px solid var(--line);margin:1em 0}.md a{word-break:break-all}
.sched .top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sched .top b{flex:1;min-width:0;font-size:16px}
.sched .meta{margin:6px 0 0;color:var(--muted);font-size:13px}.sched .meta div{margin:2px 0}
.sched .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.sched details{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}.sched summary{cursor:pointer;color:var(--accent);font-size:14px}
.sched details .md{margin-top:8px;max-height:60vh;overflow:auto}
.hint{font-size:12px;color:var(--muted)}
`

const CHAT_JS = `(()=>{
const $=s=>document.querySelector(s),form=$('#composer form'),ta=form&&form.querySelector('textarea'),btn=form&&form.querySelector('button')
const bottom=()=>window.scrollTo(0,document.body.scrollHeight)
const grow=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,innerHeight*.4)+'px'}
if(ta){ta.addEventListener('input',grow);ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();form.requestSubmit()}})}
if(form)form.addEventListener('submit',e=>{if(!ta.value.trim()){e.preventDefault();return}setTimeout(()=>{btn.disabled=true;btn.textContent='보내는 중'},0)})
document.querySelectorAll('[data-hint]').forEach(b=>b.addEventListener('click',()=>{ta.value=b.dataset.hint;grow();ta.focus()}))
document.querySelectorAll('form[data-confirm]').forEach(f=>f.addEventListener('submit',e=>{if(!confirm(f.dataset.confirm))e.preventDefault()}))
bottom()
const live=$('#live');if(!live)return
const st=live.querySelector('.status-text'),body=live.querySelector('.live'),es=new EventSource(live.dataset.events)
const near=()=>innerHeight+scrollY>=document.body.scrollHeight-160
const on=(n,f)=>es.addEventListener(n,e=>{try{f(JSON.parse(e.data))}catch(_){}})
on('status',d=>{st.textContent=d.text})
on('text',d=>{const n=near();body.textContent=d.full?d.text:body.textContent+d.text;if(n)bottom()})
const end=()=>{es.close();if(ta){ta.disabled=false;btn.disabled=false;ta.placeholder='메시지를 입력하세요'}}
on('done',d=>{end();live.className='msg assistant';live.innerHTML='<div class="md"></div>';live.firstChild.innerHTML=d.html;bottom()})
on('failed',d=>{end();live.className='msg error';live.textContent=d.text})
})()`

const SCHED_JS = `(()=>{
const w=document.querySelector('select[name=when]'),c=document.getElementById('cronField')
const sync=()=>{if(w&&c)c.style.display=w.value==='custom'?'':'none'};if(w){w.addEventListener('change',sync);sync()}
document.querySelectorAll('form[data-confirm]').forEach(f=>f.addEventListener('submit',e=>{if(!confirm(f.dataset.confirm))e.preventDefault()}))
})()`

const head = <style>{raw(HUB_CSS)}</style>

export const NOTICES: Record<string, { text: string; kind?: 'warn' | 'bad' }> = {
  busy: { text: '앞 질문의 답을 기다리는 중이에요. 답이 오면 다시 보내 주세요.', kind: 'warn' },
  limit: { text: '이미 진행 중인 작업이 많아요. 끝난 뒤 다시 보내 주세요.', kind: 'warn' },
  deleted: { text: '대화를 지웠어요.' },
  cancelled: { text: '작업을 취소했어요.' },
  created: { text: '예약 작업을 만들었어요.' },
  started: { text: '지금 실행을 시작했어요. 끝나면 결과가 여기와 저장 폴더에 남아요.' },
  running: { text: '이미 실행 중이에요. 끝난 뒤 다시 눌러 주세요.', kind: 'warn' },
  on: { text: '예약 작업을 켰어요.' },
  off: { text: '예약 작업을 껐어요.' },
  removed: { text: '예약 작업을 지웠어요.' },
}

const Notice = (p: { code?: string | null; text?: string | null; kind?: 'warn' | 'bad' }) => {
  const n = p.text ? { text: p.text, kind: p.kind } : p.code ? NOTICES[p.code] : undefined
  return n ? <div class={`notice${n.kind ? ' ' + n.kind : ''}`} role="status">{n.text}</div> : null
}

const NoClaude = () => (
  <div class="notice warn">이 허브에서는 휴대폰 채팅을 쓸 수 없어요 (허브에서 실행하려면 회사 API 키와 Claude Code가 필요해요).
    휴대폰에서는 본인 Claude 앱에 회사 커넥터를 추가해서 쓰세요. 방법은 <a href="/me#claude-apps">내 PC 페이지</a>에 있어요.</div>
)

const Dots = () => <span class="dots" aria-hidden="true"><i /><i /><i /></span>

export interface HubStats { running: number; queued: number; limit: number; doneToday: number; failedToday: number }

export function HomePage(p: { user: Principal; chats: ChatSummary[]; notice?: string | null; claudeReady: boolean; stats?: HubStats | null }) {
  return (
    <Page title="채팅" user={p.user} nav={hubNav(p.user)} active="/app" head={head}>
      <div class="hub">
        <Notice code={p.notice} />
        {p.claudeReady ? null : <NoClaude />}
        <div class="hub-head"><h1>채팅</h1><a class="btn primary" href="/app/chats/new">새 대화</a></div>
        {p.stats ? (
          <div class="grid" aria-label="허브 작업 현황">
            <div class="stat"><b>{p.stats.running} / {p.stats.limit}</b><span>지금 실행 중 (동시 실행 한도)</span></div>
            <div class="stat"><b>{p.stats.queued}</b><span>기다리는 작업</span></div>
            <div class="stat"><b>{p.stats.doneToday}</b><span>오늘 끝난 작업</span></div>
            <div class="stat"><b>{p.stats.failedToday}</b><span>오늘 실패한 작업</span></div>
          </div>
        ) : null}
        {p.chats.length ? (
          <ul class="chatlist">
            {p.chats.map((c) => (
              <li>
                <a href={`/app/chats/${c.id}`}>
                  <div class="t">
                    <span>{c.title}</span>
                    {c.active_status === 'running' ? <span class="badge good">답하는 중</span> : c.active_status === 'queued' ? <span class="badge warn">기다리는 중</span> : null}
                    <time datetime={c.updated_at}>{fmtAgo(c.updated_at)}</time>
                  </div>
                  <div class="p">{c.last_role === 'error' ? '⚠ ' : ''}{(c.last_text ?? '').replace(/\s+/g, ' ').slice(0, 120)}</div>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div class="card">
            <p style="margin:0 0 6px"><b>아직 대화가 없어요.</b></p>
            <p class="muted small" style="margin:0">휴대폰에서도 회사 파일과 스킬을 쓰는 Claude에게 물어볼 수 있어요. 내 권한으로 볼 수 있는 폴더만 다뤄요.</p>
          </div>
        )}
      </div>
    </Page>
  )
}

const HINTS = [
  'shared 폴더에 어떤 파일이 있는지 알려 줘',
  '이번 주 회의록을 찾아서 세 줄로 요약해 줘',
  '내가 쓸 수 있는 회사 스킬을 알려 줘',
]

const Composer = (p: { action: string; csrf: string; disabled: boolean; placeholder: string; value?: string; autofocus?: boolean }) => (
  <div class="composer" id="composer">
    <form method="post" action={p.action}>
      <Csrf token={p.csrf} />
      <textarea name="text" rows={1} placeholder={p.placeholder} required disabled={p.disabled} autofocus={p.autofocus} aria-label="메시지">{p.value ?? ''}</textarea>
      <button class="btn primary" type="submit" disabled={p.disabled}>보내기</button>
    </form>
  </div>
)

export function NewChatPage(p: { user: Principal; csrf: string; claudeReady: boolean; error?: string | null; text?: string }) {
  return (
    <Page title="새 대화" user={p.user} nav={hubNav(p.user)} active="/app" head={head}>
      <div class="hub">
        <div class="hub-head"><a class="back" href="/app" aria-label="대화 목록">‹</a><h1>새 대화</h1></div>
        {p.claudeReady ? null : <NoClaude />}
        <Notice text={p.error} kind="bad" />
        <div class="card">
          <p style="margin:0 0 10px" class="muted small">예를 들어 이렇게 물어볼 수 있어요.</p>
          <div class="hints">{HINTS.map((h) => <button type="button" class="btn" data-hint={h}>{h}</button>)}</div>
        </div>
        <div class="thread" />
      </div>
      <Composer action="/app/chats" csrf={p.csrf} disabled={!p.claudeReady} placeholder="무엇을 도와드릴까요?" value={p.text} autofocus />
      <script>{raw(CHAT_JS)}</script>
    </Page>
  )
}

export interface LiveJob { id: string; state: 'queued' | 'running'; status: string; text: string }

export function ChatPage(p: { user: Principal; csrf: string; chat: Chat; messages: Message[]; live: LiveJob | null; notice?: string | null; error?: string | null; claudeReady: boolean }) {
  const busy = !!p.live
  return (
    <Page title={p.chat.title} user={p.user} nav={hubNav(p.user)} active="/app" head={head}>
      <div class="hub">
        <div class="hub-head">
          <a class="back" href="/app" aria-label="대화 목록">‹</a>
          <h1>{p.chat.title}</h1>
          <form class="inline" method="post" action={`/app/chats/${p.chat.id}/delete`} data-confirm="이 대화를 지울까요? 되돌릴 수 없어요.">
            <Csrf token={p.csrf} /><button class="btn small danger" type="submit">지우기</button>
          </form>
        </div>
        <Notice code={p.notice} />
        <Notice text={p.error} kind="bad" />
        {p.claudeReady ? null : <NoClaude />}
        <div class="thread">
          {p.messages.map((m) =>
            m.role === 'assistant' ? <div class="msg assistant"><div class="md">{raw(renderMarkdown(m.text))}</div></div>
              : m.role === 'error' ? <div class="msg error">{m.text}</div>
                : <div class="msg user">{m.text}</div>)}
          {p.live ? (
            <div class="msg assistant pending" id="live" data-events={`/app/chats/${p.chat.id}/events?job=${p.live.id}`} aria-live="polite">
              <div class="status"><Dots /><span class="status-text">{p.live.status}</span>
                <form class="inline" method="post" action={`/app/chats/${p.chat.id}/cancel`}><Csrf token={p.csrf} /><button class="btn small" type="submit">취소</button></form>
              </div>
              <div class="live">{p.live.text}</div>
            </div>
          ) : null}
        </div>
      </div>
      <Composer action={`/app/chats/${p.chat.id}/messages`} csrf={p.csrf} disabled={busy || !p.claudeReady}
        placeholder={busy ? '답을 기다리는 중이에요' : '메시지를 입력하세요'} />
      <script>{raw(CHAT_JS)}</script>
    </Page>
  )
}

export interface ScheduleView extends Schedule { last: ScheduleRun | null; active: 'queued' | 'running' | null }
export interface ScheduleForm { name?: string; when?: string; cron?: string; prompt?: string; outputDir?: string }

const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  done: { label: '성공', cls: 'good' }, failed: { label: '실패', cls: 'bad' }, cancelled: { label: '취소됨', cls: '' },
}

export function SchedulesPage(p: { user: Principal; csrf: string; schedules: ScheduleView[]; form: ScheduleForm; notice?: string | null; error?: string | null; claudeReady: boolean }) {
  const f = p.form
  const when = f.when ?? PRESETS[1].key
  return (
    <Page title="예약 작업" user={p.user} nav={hubNav(p.user)} active="/app/schedules" head={head}>
      <div class="hub">
        <div class="hub-head"><h1>예약 작업</h1></div>
        <p class="lead">정해진 시간에 Claude가 일을 하고, 결과를 문서 파일(.md)로 팀 폴더에 저장해요.</p>
        <Notice code={p.notice} />
        {p.claudeReady ? null : <NoClaude />}
        {p.schedules.map((s) => {
          const st = s.last ? RUN_STATUS[s.last.status] : null
          return (
            <div class="card sched">
              <div class="top">
                <b>{s.name}</b>
                {s.active === 'running' ? <span class="badge warn">실행 중</span> : s.active === 'queued' ? <span class="badge warn">기다리는 중</span> : null}
                {s.enabled ? <span class="badge good">켜짐</span> : <span class="badge">꺼짐</span>}
              </div>
              <div class="meta">
                <div>{describeCron(s.cron)}{s.enabled ? <> · 다음 실행 {fmtDateTime(s.next_run_at)}</> : null}</div>
                <div>저장 폴더: {s.output_dir ? toMyFolder(p.user.id, s.output_dir) : '—'}</div>
                <div>
                  마지막 실행: {s.last ? <>
                    {st ? <span class={`badge ${st.cls}`}>{st.label}</span> : null} {fmtDateTime(s.last.started_at ?? s.last.created_at)}
                    {s.last.output_path ? <> · <a href={fileHref(s.last.output_path)} download title={toMyFolder(p.user.id, s.last.output_path)}>{s.last.output_path.split('/').pop()}</a></> : null}
                    {s.last.status !== 'done' && s.last.error ? <> · {s.last.error}</> : null}
                  </> : '아직 없어요'}
                </div>
              </div>
              {s.last?.status === 'done' && s.last.result ? (
                <details><summary>마지막 결과 보기</summary><div class="md">{raw(renderMarkdown(s.last.result.slice(0, 50_000)))}</div></details>
              ) : null}
              <div class="actions">
                <form class="inline" method="post" action={`/app/schedules/${s.id}/run`}><Csrf token={p.csrf} /><button class="btn small primary" type="submit" disabled={!!s.active || !p.claudeReady}>지금 실행</button></form>
                <form class="inline" method="post" action={`/app/schedules/${s.id}/toggle`}><Csrf token={p.csrf} /><button class="btn small" type="submit">{s.enabled ? '끄기' : '켜기'}</button></form>
                <form class="inline" method="post" action={`/app/schedules/${s.id}/delete`} data-confirm="이 예약 작업을 지울까요? 저장된 파일은 그대로 남아요.">
                  <Csrf token={p.csrf} /><button class="btn small danger" type="submit">지우기</button>
                </form>
              </div>
            </div>
          )
        })}
        {p.schedules.length ? null : <div class="card muted">아직 예약 작업이 없어요. 아래에서 만들어 보세요.</div>}
        <h2 id="new">새 예약 작업</h2>
        <form class="card" method="post" action="/app/schedules#new">
          <Notice text={p.error} kind="bad" />
          <Csrf token={p.csrf} />
          <div class="field"><label for="s-name">이름</label><input id="s-name" name="name" maxlength={60} required value={f.name ?? ''} placeholder="예: 주간 영업 보고" /></div>
          <div class="field">
            <label for="s-when">언제</label>
            <select id="s-when" name="when">
              {PRESETS.map((x) => <option value={x.key} selected={when === x.key}>{x.label}</option>)}
              <option value="custom" selected={when === 'custom'}>직접 입력 (cron)</option>
            </select>
          </div>
          <div class="field" id="cronField">
            <label for="s-cron">cron (분 시 일 월 요일)</label>
            <input id="s-cron" name="cron" value={f.cron ?? ''} placeholder="예: 30 8 * * 1-5 (평일 오전 8시 30분)" autocomplete="off" />
            <span class="hint">서버 시간 기준이에요. 30분보다 자주 실행할 수는 없어요.</span>
          </div>
          <div class="field"><label for="s-prompt">할 일</label><textarea id="s-prompt" name="prompt" required maxlength={8000} placeholder="예: shared/영업 폴더에서 이번 주에 바뀐 파일을 읽고 주간 보고를 써 줘.">{f.prompt ?? ''}</textarea></div>
          <div class="field">
            <label for="s-dir">결과를 저장할 폴더</label>
            <input id="s-dir" name="outputDir" required value={f.outputDir ?? `${MY_FOLDER}/예약 작업`} autocomplete="off" />
            <span class="hint">'{MY_FOLDER}'는 나만 보는 개인 폴더예요. 다른 곳은 팀 폴더 기준 경로로 적어요 (예: shared/영업). 내가 쓸 수 있는 폴더만 고를 수 있어요.</span>
          </div>
          <button class="btn primary" type="submit">만들기</button>
        </form>
      </div>
      <script>{raw(SCHED_JS)}</script>
    </Page>
  )
}

export function MessagePage(p: { user: Principal | null; title: string; message: string; back?: string }) {
  return (
    <Page title={p.title} user={p.user} nav={hubNav(p.user)} head={head} narrow>
      <div class="card">
        <h1>{p.title}</h1>
        <p>{p.message}</p>
        <a class="btn" href={p.back ?? '/app'}>돌아가기</a>
      </div>
    </Page>
  )
}
