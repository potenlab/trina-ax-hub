/** @jsxImportSource hono/jsx */
// The personal page as a first-run page: one "다음에 할 일" card chosen from the person's situation (how they reach
// Claude, whether the hub has a public address, whether the Claude app or a PC is already connected, whether they have
// used it), the PC command for exactly one operating system with the code made on the spot, and the live status line.
import { raw } from 'hono/html'
import type { C } from '../http/app'
import { Csrf, CopyBlock } from '../ui/layout'
import { fmtDateTime } from '../ui/format'
import { enrollCodeState } from '../auth/enroll'
import type { ModelAccess } from '../auth/access-mode'
import type { User } from '../auth/users'
import { type Web, requestOrigin, INSTALL_DONE_LINE } from './kit'
import { effectiveUrls, installCommands, urlWarnings, type HubUrls } from './settings'
import { ClaudeAppSteps, connectorLabel } from './connector-help'
import type { ClaudeOrg } from './claude-org'

// which computer ---------------------------------------------------------------------------------------------------

export type Os = 'mac' | 'windows' | 'mobile' | 'other'

/** The visitor's computer from the browser's User-Agent. `override` (?os=windows) lets someone ask for the other command. */
export function detectOs(ua: string | undefined | null, override?: string | null): Os {
  if (override === 'mac' || override === 'windows' || override === 'other') return override
  const u = ua ?? ''
  if (/iPhone|iPad|iPod|Android/i.test(u)) return 'mobile'
  if (/Windows/i.test(u)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(u)) return 'mac'
  return 'other'
}

// which card --------------------------------------------------------------------------------------------------------

export interface Situation {
  access: ModelAccess
  /** the hub has a public https address (Claude's apps can only reach the hub through one) */
  publicUrl: boolean
  /** a live Claude app connection */
  connector: boolean
  /** a connected PC */
  pc: boolean
  /** any usage or tool call this month */
  used: boolean
}

export type NextStep = 'app-connect' | 'app-need-url' | 'app-ready' | 'pc-connect' | 'pc-ready' | 'all-set'

export function pickNextStep(s: Situation): NextStep {
  const pcStep = s.pc ? (s.used ? 'all-set' : 'pc-ready') : null
  if (s.access === 'company_key') return pcStep ?? 'pc-connect'
  if (s.connector) return s.used ? 'all-set' : 'app-ready'
  // someone who already works from a PC does not need nagging about the app
  if (s.pc && s.used) return 'all-set'
  if (!s.publicUrl) return pcStep ?? 'app-need-url'
  return 'app-connect'
}

// the code made on the page -----------------------------------------------------------------------------------------

interface Pending { code: string; expiresAt: string }
const pending = new WeakMap<Web, Map<string, Pending>>()
const store = (web: Web) => { let m = pending.get(web); if (!m) { m = new Map(); pending.set(web, m) } return m }

/** Remember the plain code a person just made, so the page shows the same command after a reload. The database only
 *  keeps its hash. In memory only: a restart forgets it and the page offers a new one. */
export function rememberCode(web: Web, userId: string, p: Pending) { store(web).set(userId, p) }

export type CodeView = { state: 'none' } | { state: 'used' } | ({ state: 'waiting' } & Pending)

export function codeView(web: Web, userId: string): CodeView {
  const m = store(web)
  const p = m.get(userId)
  if (!p) return { state: 'none' }
  const st = enrollCodeState(web.ctx.db, p.code)
  if (st === 'waiting') return { state: 'waiting', ...p }
  if (st === 'used') return { state: 'used' }
  m.delete(userId)
  return { state: 'none' }
}

// pieces --------------------------------------------------------------------------------------------------------------

const EXAMPLE = "회사 폴더에 뭐가 있어?"
export const APP_DONE_LINE = `✓ Claude 앱이 연결됐어요. Claude에게 '${EXAMPLE}'라고 물어보세요.`
const PC_DONE_LINE = `✓ 이 PC가 연결됐어요. 새 터미널에서 claude 를 실행하고 '${EXAMPLE}'라고 물어보세요.`

/** The command(s) for the visitor's computer, with the code inside. */
export function PcCommandBox(p: { urls: HubUrls; os: Os; mode: ModelAccess; code: string; expiresAt: string }) {
  const cmd = installCommands(p.urls.hubUrl, p.code)
  const win = p.os === 'windows'
  const both = p.os === 'other'
  return (
    <div id="pc-box">
      <ol class="steps">
        <li>{win ? <>시작 메뉴에서 <b>PowerShell</b>을 열어요.</> : both ? <>터미널(맥: 응용 프로그램 › 유틸리티 › 터미널)이나 윈도우의 <b>PowerShell</b>을 열어요.</> : <><b>터미널</b>을 열어요. (응용 프로그램 › 유틸리티 › 터미널)</>}</li>
        <li>아래 명령을 <b>복사</b>해서 붙여 넣고 Enter를 눌러요.</li>
        <li>'{INSTALL_DONE_LINE}'가 나오면 {win ? '새 PowerShell' : '터미널'}을 새로 열고 <code>claude</code>를 입력해요.{p.mode === 'subscription' ? <> 처음이면 <code>/login</code>으로 본인 Claude 계정에 로그인해요.</> : null}</li>
      </ol>
      {win ? null : (<>{both ? <p class="cmdlabel">맥 · 리눅스 (터미널)</p> : null}<CopyBlock id="cmd-mac" text={cmd.mac} /></>)}
      {win || both ? (<>{both ? <p class="cmdlabel">윈도우 (PowerShell)</p> : null}<CopyBlock id="cmd-win" text={cmd.windows} /></>) : null}
      <p class="muted small">연결 코드 <span class="secret" style="font-size:15px">{p.code}</span> · 한 번만 쓸 수 있고 {fmtDateTime(p.expiresAt)}까지 유효해요. 이 페이지를 다시 열어도 같은 명령이 보여요.</p>
    </div>
  )
}

/** Make a code with one press. With scripts on, the box appears in place (no page change); without, the page reloads with it. */
export function PcConnect(p: { c: C; web: Web; me: User; csrf: string; os: Os; mode: ModelAccess }) {
  const urls = effectiveUrls(p.web.ctx, requestOrigin(p.c))
  if (p.os === 'mobile') {
    return (
      <div id="pc-connect">
        <div class="notice"><b>PC에서 이 페이지를 열어 주세요.</b> PC 연결은 연결할 컴퓨터에서 해요. 아래 주소를 PC로 보내서 열어도 돼요.</div>
        <CopyBlock id="page-address" text={`${requestOrigin(p.c)}/me`} />
      </div>
    )
  }
  const cur = codeView(p.web, p.me.id)
  const warnings = urlWarnings(urls)
  return (
    <div id="pc-connect">
      <div id="pc-slot">
        {cur.state === 'waiting' ? <PcCommandBox urls={urls} os={p.os} mode={p.mode} code={cur.code} expiresAt={cur.expiresAt} /> : null}
        {cur.state === 'used' ? <div class="notice small">방금 만든 코드로 PC를 연결했어요. 다른 PC도 연결하려면 새 명령을 만들어요.</div> : null}
      </div>
      <form method="post" action="/me/enroll" data-enroll style="margin-top:8px">
        <Csrf token={p.csrf} />
        <input type="hidden" name="os" value={p.os} />
        <button class={'btn' + (cur.state === 'waiting' ? '' : ' primary')} type="submit">{cur.state === 'waiting' ? '새 코드 만들기' : '연결 명령 만들기'}</button>
      </form>
      {p.os === 'mac' ? <p class="muted small" style="margin-top:8px">윈도우 PC에 설치하나요? <a href="/me?os=windows#pc-connect">윈도우 명령 보기</a></p> : null}
      {p.os === 'windows' ? <p class="muted small" style="margin-top:8px">맥에 설치하나요? <a href="/me?os=mac#pc-connect">맥 명령 보기</a></p> : null}
      {warnings.length ? <div class="notice warn small" style="margin:12px 0 0">{warnings.length === 1 ? warnings[0] : <ul>{warnings.map((w) => <li>{w}</li>)}</ul>}</div> : null}
    </div>
  )
}

export interface CardProps {
  c: C
  web: Web
  me: User
  csrf: string
  org: ClaudeOrg
  step: NextStep
  sit: Situation
  os: Os
  urls: HubUrls
  isAdmin: boolean
}

const Live = (p: { name: 'connector-wait' | 'connector-done' | 'pc-wait' | 'pc-done'; hidden?: boolean; class?: string; children: any }) =>
  <div data-live={p.name} hidden={p.hidden} class={p.class}>{p.children}</div>

/** The one card: what to do next. */
export function NextCard(p: CardProps) {
  const { step } = p
  const mode = p.sit.access
  const address = `${p.urls.publicUrl ?? p.urls.hubUrl}/mcp`
  const label = connectorLabel(p.web.ctx, p.org)
  const done = step === 'app-ready' || step === 'pc-ready' || step === 'all-set'
  const head = (
    <div class="actions" style="margin-bottom:6px"><span class={'badge ' + (done ? 'good' : 'warn')}>{done ? '준비됐어요' : '다음에 할 일'}</span></div>
  )

  if (step === 'app-connect') return (
    <section id="next" class="card oneshot">
      {head}
      <h2>Claude 앱에서 회사 AI 연결하기</h2>
      <p>한 번만 연결해 두면 Claude 앱(컴퓨터·휴대폰)에서 회사 폴더와 회사 스킬을 바로 써요. AI 사용은 본인 Claude 계정으로 해요.</p>
      <ClaudeAppSteps plan={p.org.plan} connectorName={label} address={address} id="me-connector" />
      <Live name="connector-wait" class="muted small">연결을 기다리고 있어요. 연결하면 이 화면이 저절로 바뀌어요.</Live>
      <Live name="connector-done" hidden class="notice">{APP_DONE_LINE}</Live>
    </section>
  )

  if (step === 'app-need-url') return (
    <section id="next" class="card oneshot">
      {head}
      <h2>Claude 앱 연결은 관리자가 먼저 준비해야 해요</h2>
      <p>Claude 앱에서 회사 AI를 연결하려면 회사의 공개 주소(https)가 있어야 해요. 관리자에게 공개 주소를 넣어 달라고 부탁해 주세요.</p>
      {p.isAdmin ? <a class="btn primary" href="/admin/settings#urls">접속 주소 정하러 가기</a> : null}
      <p class="muted small" style="margin-top:10px">PC의 Claude Code는 공개 주소 없이도 연결할 수 있어요. 아래 'Claude Code도 쓰나요?'를 봐 주세요.</p>
    </section>
  )

  if (step === 'app-ready') return (
    <section id="next" class="card oneshot">
      {head}
      <h2>Claude 앱이 연결돼 있어요</h2>
      <p class="notice" style="margin:0">{APP_DONE_LINE}</p>
    </section>
  )

  if (step === 'pc-connect') return (
    <section id="next" class="card oneshot">
      {head}
      <h2>내 PC에 회사 AI 연결하기</h2>
      <p>PC의 Claude Code가 회사 파일·스킬과 연결돼요. AI 사용료는 회사 계정으로 나가요.</p>
      <PcConnect c={p.c} web={p.web} me={p.me} csrf={p.csrf} os={p.os} mode={mode} />
      <Live name="pc-wait" class="muted small" >PC에서 명령을 실행하면 이 화면이 저절로 바뀌어요.</Live>
      <Live name="pc-done" hidden class="notice">{PC_DONE_LINE}</Live>
    </section>
  )

  if (step === 'pc-ready') return (
    <section id="next" class="card oneshot">
      {head}
      <h2>PC가 연결돼 있어요</h2>
      <p class="notice" style="margin:0 0 10px">{PC_DONE_LINE}</p>
      <details><summary class="small">PC를 더 연결하기</summary>
        <div style="margin-top:10px"><PcConnect c={p.c} web={p.web} me={p.me} csrf={p.csrf} os={p.os} mode={mode} /></div>
      </details>
    </section>
  )

  // all-set
  const appHint = mode === 'subscription' && !p.sit.connector && p.sit.publicUrl
  return (
    <section id="next" class="card">
      {head}
      <h2>모두 준비됐어요</h2>
      <p style="margin:0">{p.sit.connector ? 'Claude 앱이 연결돼 있어요. ' : ''}{p.sit.pc ? 'PC도 연결돼 있어요. ' : ''}Claude에게 회사 폴더나 회사 스킬에 대해 물어보세요.</p>
      {appHint ? (
        <details style="margin-top:10px"><summary class="small">휴대폰·Claude 앱에서도 쓰려면</summary>
          <div style="margin-top:10px"><ClaudeAppSteps plan={p.org.plan} connectorName={label} address={address} id="me-connector" /></div>
        </details>
      ) : null}
    </section>
  )
}

/** Subscription people: Claude Code is the second way in, folded away until asked for. */
export function ClaudeCodeSection(p: { c: C; web: Web; me: User; csrf: string; os: Os; org: ClaudeOrg; open: boolean }) {
  const managed = p.org.plan === 'team' && !!p.org.managedSettingsAt
  return (
    <div class="card" id="claude-code">
      <details open={p.open}>
        <summary><b>Claude Code도 쓰나요?</b></summary>
        <div style="margin-top:12px">
          {managed
            ? <p style="margin:0">회사 Claude 계정으로 로그인하면 회사 스킬과 연결이 자동으로 들어가요. 처음 한 번 뜨는 '조직 설정 적용' 창에서 승인을 눌러 주세요.</p>
            : (<>
              <p>터미널의 Claude Code에서도 회사 파일과 스킬을 쓰려면 PC를 연결해요. AI는 본인 Claude 계정으로 써요.</p>
              <PcConnect c={p.c} web={p.web} me={p.me} csrf={p.csrf} os={p.os} mode="subscription" />
            </>)}
        </div>
      </details>
    </div>
  )
}

// the live status line ---------------------------------------------------------------------------------------------

/** Polls /me/status.json every 5 seconds and flips the status lines and, on a new connection, shows the success text. Stops once
 *  everything the page waits for is true. `need` lists what the page waits for. */
export function LiveScript(p: { need: ('connector' | 'pc')[] }) {
  const js = `(()=>{const need=${JSON.stringify(p.need)};if(!need.length)return
const show=(n,on)=>document.querySelectorAll('[data-live="'+n+'"]').forEach(e=>{e.hidden=!on})
let t=null
const tick=async()=>{if(document.hidden)return
try{const r=await fetch('/me/status.json',{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}})
if(r.status===401){clearInterval(t);return}if(!r.ok)return
const d=await r.json()
for(const k of ['connector','pc']){show(k+'-wait',!d[k]);show(k+'-done',!!d[k])}
if(need.every(k=>d[k]))clearInterval(t)}catch(_){}}
t=setInterval(tick,5000)})()`
  return <script>{raw(js)}</script>
}

/** Makes the connect-a-PC button show the command in place instead of reloading the page. Falls back to the plain form. */
export const ENROLL_JS = `(()=>{document.addEventListener('submit',async e=>{const f=e.target;if(!f||!f.hasAttribute||!f.hasAttribute('data-enroll'))return
e.preventDefault();const b=f.querySelector('button');if(b)b.disabled=true
try{const r=await fetch(f.action,{method:'POST',credentials:'same-origin',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(f))})
if(!r.ok)throw 0;const d=await r.json();const slot=f.parentNode.querySelector('#pc-slot');if(!slot)throw 0
slot.innerHTML=d.html;if(b){b.textContent='새 코드 만들기';b.classList.remove('primary')}}
catch(_){f.submit();return}if(b)b.disabled=false})})()`
