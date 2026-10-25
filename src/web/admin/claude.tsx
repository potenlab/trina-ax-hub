/** @jsxImportSource hono/jsx */
// Claude 조직 설정 (/admin/claude): a step-by-step guide for the owner of a Claude Team or Enterprise organization.
// The admin pastes values this hub generates into Claude's admin console once; employees then only sign in to Claude
// and press Connect, with nothing installed on their PCs (docs/DESIGN.md, "Two ways to use Claude").
//
//   GET  /admin/claude                       the guide with live status
//   POST /admin/claude/plan                  step 0: Team·Enterprise / Pro·Max / company API key (setting claude_org)
//   POST /admin/claude/name                  the connector's name in Claude
//   POST /admin/claude/token                 make (or replace) the org token; its JSON is shown once
//   POST /admin/claude/token/revoke          stop the org token
//   POST /admin/claude/pasted                "붙여 넣었어요" → managedSettingsAt
//   POST /admin/claude/unknown/clear         empty the unknown-email list
//   GET  /admin/claude/skill.zip?path=…      one skill as a .zip for "Upload a skill"
import type { Child } from 'hono/jsx'
import { raw } from 'hono/html'
import type { App, C } from '../../http/app'
import type { Ctx } from '../../context'
import { audit } from '../../audit'
import { Csrf, CopyBlock } from '../../ui/layout'
import { fmtAgo, fmtDateTime, fmtNum } from '../../ui/format'
import { defaultModelAccess, MODEL_ACCESS_LABEL } from '../../auth/access-mode'
import { type Web, type Flash, Shell, ButtonForm, Empty, render, takeFlashes, act, say, fail, field } from '../kit'
import { companyName } from '../settings'
import { skillsUnavailableReason } from '../../skills/marketplace'
import { activeOrgToken, revokeOrgToken, rotateOrgToken } from '../../org/token'
import { cleanConnectorName, defaultConnectorName, getClaudeOrg, setClaudeOrg } from '../../org/claude-org'
import { ANTHROPIC_OUTBOUND_RANGE, TOKEN_PLACEHOLDER, connectorUrl, coworkOtlp, managedSettingsJson } from '../../org/managed'
import { clearUnknownEmails, listUnknownEmails, orgIngestStats, orgReportingPeople, resetOrgIngestStats } from '../../org/telemetry'
import { orgStatus } from '../../org/status'
import { orgSkillZip, orgSkills } from '../../org/skillzips'

/** The public https address Claude can reach, or null (then the page asks for one first and shows nothing else). */
export function claudeHubUrl(ctx: Ctx): string | null {
  return ctx.config.publicUrl && skillsUnavailableReason(ctx.config) === null ? ctx.config.publicUrl : null
}

// A just-made org token is shown once, on the next page load (like a temp password). Kept only in memory.
const SHOWN_TTL_MS = 10 * 60_000
const shownTokens = new WeakMap<Web, Map<string, { token: string; at: number }>>()
function keepShown(web: Web, key: string, token: string) {
  let m = shownTokens.get(web)
  if (!m) shownTokens.set(web, (m = new Map()))
  const now = Date.now()
  for (const [k, v] of m) if (v.at < now - SHOWN_TTL_MS) m.delete(k)
  m.set(key, { token, at: now })
}
function takeShown(web: Web, key: string): string | null {
  const m = shownTokens.get(web)
  const v = m?.get(key)
  m?.delete(key)
  return v && v.at >= Date.now() - SHOWN_TTL_MS ? v.token : null
}

type Choice = 'team' | 'individual' | 'company_key'

const PAGE_CSS = `
.stepno{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;border-radius:13px;background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:14px;margin-right:8px}
.opt{color:var(--muted);font-weight:400;font-size:13px;margin-left:6px}
.fld{margin:0 0 12px}.fld .lab{font-size:13px;color:var(--muted);font-weight:600;margin:0 0 2px}.fld .copy pre.cmd{margin:2px 0}
.menu{font-weight:600}
.fine{font-size:13px;color:var(--muted)}
ul.tight{margin:6px 0 10px;padding-left:20px}ul.tight li{margin:3px 0}
`

const Step = (p: { n: number; id: string; title: string; optional?: boolean; children: Child }) => (
  <section class="card" id={p.id}>
    <h2><span class="stepno">{p.n}</span>{p.title}{p.optional ? <span class="opt">(선택)</span> : null}</h2>
    {p.children}
  </section>
)

const Fld = (p: { label: string; id: string; text: string; hint?: Child }) => (
  <div class="fld"><div class="lab">{p.label}</div><CopyBlock id={p.id} text={p.text} />{p.hint ? <div class="fine">{p.hint}</div> : null}</div>
)

const PER_GROUP = '그룹별 스킬은 Claude Code 설치 명령이나 Claude 앱 연결의 스킬 목록으로 나눠져요.'

function kb(n: number): string {
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

function NeedsPublicUrl() {
  return (
    <div class="card">
      <div class="notice warn">
        먼저 공개 주소(https)를 정해 주세요. Claude는 Anthropic 서버에서 이 허브로 접속해서, 인터넷 어디서나 열리는 https 주소가 있어야 해요.
      </div>
      <p class="small">공개 주소는 설정 페이지의 '접속 주소'에서 정해요. 정하고 나면 이 페이지에 Claude에 붙여 넣을 값이 나와요.</p>
      <a class="btn primary" href="/admin/settings#urls">설정에서 공개 주소 정하기</a>
    </div>
  )
}

function ClaudePage(p: { web: Web; c: C; flashes: Flash[]; shown: string | null }) {
  const { ctx } = p.web
  const db = ctx.db
  const s = p.c.get('session')!
  const hub = claudeHubUrl(ctx)
  const flashes = p.flashes
  if (!hub) {
    return (
      <Shell c={p.c} title="Claude 조직 설정" active="/admin/claude" flashes={flashes}>
        <h1>Claude 조직 설정</h1>
        <p class="lead">Claude 관리 콘솔에 한 번만 붙여 넣으면, 직원은 PC에 아무것도 설치하지 않고 로그인만 하면 돼요.</p>
        <NeedsPublicUrl />
      </Shell>
    )
  }

  const org = getClaudeOrg(db)
  const choice: Choice | null = org.plan ?? (org.companyKeyChosen ? 'company_key' : null)
  const company = companyName(ctx)
  const status = orgStatus(db)
  const tokenInfo = activeOrgToken(db)
  const team = choice === 'team'

  const pick = (v: Choice, title: string, desc: string) => (
    <label class="choice"><input type="radio" name="plan" value={v} checked={choice === v} required />
      <span><b>{title}</b><br /><span class="muted small">{desc}</span></span></label>
  )

  return (
    <Shell c={p.c} title="Claude 조직 설정" active="/admin/claude" flashes={flashes}>
      <style>{raw(PAGE_CSS)}</style>
      <h1>Claude 조직 설정</h1>
      <p class="lead">Claude 관리 콘솔에 아래 값을 한 번만 붙여 넣어요. 그러면 직원은 PC에 아무것도 설치하지 않고, Claude에 로그인한 뒤 '연결'만 누르면 돼요.</p>

      <Step n={0} id="step0" title="어떤 Claude를 쓰나요?">
        <form method="post" action="/admin/claude/plan">
          <Csrf token={s.csrf} />
          {pick('team', 'Claude Team·Enterprise', '회사가 Claude 조직을 만들고 직원을 초대했어요. 관리 콘솔에 한 번 설정하면 돼요.')}
          {pick('individual', 'Pro·Max 개인 구독', '직원이 각자 구독해요. 회사 관리 콘솔이 없어서 직원이 각자 커넥터를 추가해요.')}
          {pick('company_key', '회사 API 키', '회사 Anthropic API 키로 요금을 내요. 직원 PC에 설치 명령을 한 번 실행해요.')}
          <button class="btn primary" type="submit">저장</button>
        </form>
        {choice === null ? <p class="muted small" style="margin-top:12px">고르면 그에 맞는 단계가 아래에 나와요.</p> : null}
      </Step>

      {choice === 'individual' ? <IndividualSteps hub={hub} name={org.connectorName} s={s} /> : null}
      {choice === 'company_key' ? <CompanyKeySteps ctx={ctx} /> : null}

      {team || choice === 'individual' ? (
        <Step n={1} id="step1" title={team ? '커넥터 추가하기 (회사 파일·스킬을 Claude 앱에서)' : '직원이 커넥터 추가하기'}>
          {team ? (<>
            <p>Claude 소유자(Owner)가 조직 커넥터를 한 번 만들어요. 이름과 주소는 아래 값을 그대로 넣으면 돼요.</p>
            <ol class="steps">
              <li>Claude에서 <span class="menu">Organization settings › Connectors</span> 를 열어요.</li>
              <li><b>Add</b> › <b>Custom</b> 을 눌러요. 종류를 물으면 <b>Web</b> 을 골라요.</li>
              <li>아래 이름과 주소를 넣어요.</li>
              <li><b>Authentication</b> 은 <b>Sign in now</b>(지금 로그인), <b>OAuth client</b> 는 <b>Register automatically</b>(자동 등록)로 해요. OAuth 클라이언트 ID와 비밀번호는 비워 둬요.</li>
              <li><b>Add</b> 를 눌러요.</li>
            </ol>
          </>) : null}
          <ConnectorFields hub={hub} name={org.connectorName} csrf={s.csrf} defaultName={defaultConnectorName(db)} />
          {team ? (
            <p>그러면 직원은 Claude에서 <span class="menu">Customize › Connectors</span> 의 <b>Custom</b> 표시가 붙은 '{org.connectorName}'을 찾아 <b>Connect</b> 를 눌러요. 허브 아이디로 로그인하고 '허용'을 누르면 끝이에요. 웹·데스크톱·휴대폰·Cowork·Claude Code가 같은 연결을 써요.</p>
          ) : null}
          <div class="notice warn small">
            Claude는 Anthropic 서버(<code>{ANTHROPIC_OUTBOUND_RANGE}</code>)에서 이 허브로 접속해요. 그 주소에서 <code>/mcp</code>, <code>/oauth/*</code>, <code>/.well-known/*</code> 가 열려야 해요. Cloudflare의 봇 차단·WAF 챌린지·Access를 이 주소 앞에 두지 마세요.
          </div>
          {team ? <p class="fine">'Authentication' 같은 인증 설정은 커넥터를 만든 뒤에는 바꿀 수 없어요. 바꾸려면 커넥터를 지우고 다시 만들어야 하고, 직원은 다시 Connect 해야 해요.</p> : null}
        </Step>
      ) : null}

      {team ? (<>
        <ManagedStep web={p.web} hub={hub} shown={p.shown} tokenInfo={tokenInfo} pastedAt={org.managedSettingsAt} csrf={s.csrf} withoutEmail={status.withoutEmail} />
        <CoworkStep hub={hub} shown={p.shown} />
        <SkillsStep ctx={ctx} />
      </>) : null}

      {team || choice === 'individual' ? (
        <StatusCard ctx={ctx} team={team} csrf={s.csrf} tokenInfo={tokenInfo} company={company} />
      ) : null}
    </Shell>
  )
}

function ConnectorFields(p: { hub: string; name: string; csrf: string; defaultName: string }) {
  return (<>
    <Fld label="이름" id="connector-name" text={p.name} hint="Claude 화면에 보이는 이름이에요. 아래에서 바꿀 수 있어요." />
    <Fld label="MCP server URL (주소)" id="connector-url" text={connectorUrl(p.hub)} />
    <form method="post" action="/admin/claude/name" class="row" style="margin:0 0 12px">
      <Csrf token={p.csrf} />
      <div class="field"><label for="connectorName">이름 바꾸기</label><input id="connectorName" name="connectorName" value={p.name} maxlength={60} placeholder={p.defaultName} /></div>
      <div><button class="btn" type="submit" style="margin-bottom:12px">저장</button></div>
    </form>
  </>)
}

function IndividualSteps(p: { hub: string; name: string; s: { csrf: string } }) {
  return (
    <section class="card" id="individual">
      <h2>Pro·Max 개인 구독이에요</h2>
      <p>개인 구독에는 회사 관리 콘솔이 없어요. 직원이 각자 자기 Claude에 커넥터를 추가해요. 아래 1단계의 이름과 주소를 직원에게 알려 주세요.</p>
      <ol class="steps">
        <li>직원이 Claude(웹·데스크톱)에서 <span class="menu">Customize › Connectors</span> 를 열어요.</li>
        <li><b>Add custom connector</b> 를 눌러 이름과 주소를 넣고 <b>Add</b> 를 눌러요.</li>
        <li>목록에서 그 커넥터의 <b>Connect</b> 를 눌러요. 허브 아이디로 로그인하고 '허용'을 눌러요.</li>
      </ol>
      <p class="fine">같은 Claude 계정으로 로그인한 Claude Code에서도 이 커넥터가 보여요. 개인 구독은 회사가 사용량을 모으거나 스킬을 깔아 줄 수 없어서, 그게 필요한 사람만 '내 PC'에서 PC 연결 코드로 설치해요.</p>
      <p class="fine">{PER_GROUP}</p>
    </section>
  )
}

function CompanyKeySteps(p: { ctx: Ctx }) {
  const mode = defaultModelAccess(p.ctx.db)
  return (
    <section class="card" id="companykey">
      <h2>회사 API 키예요</h2>
      <p>이 방식은 직원 PC의 Claude Code가 허브를 거쳐 Anthropic에 가요. Claude 관리 콘솔 설정은 쓰지 않아요. (허브 주소를 따로 정한 Claude Code는 관리 콘솔 설정을 받지 않아요.)</p>
      <ol class="steps">
        <li>설정에서 회사 API 키를 넣고 <a href="/admin/settings#key">'연결 확인'</a>을 눌러요.</li>
        <li><a href="/admin/settings#access">설정 › Claude 사용 방식</a>에서 '{MODEL_ACCESS_LABEL.company_key}'를 골라요. 지금 회사 기본값은 <b>{MODEL_ACCESS_LABEL[mode]}</b>예요.</li>
        <li>직원 PC마다 설치 명령을 한 번 실행해요. 직원이 <a href="/me">내 PC</a>에서 'PC 연결하기'를 누르면 명령이 나와요. 관리자가 <a href="/admin/users">사람</a> 페이지에서 연결 코드를 만들어 줄 수도 있어요.</li>
      </ol>
      {mode === 'company_key' ? null : <div class="notice warn small">회사 기본값이 '{MODEL_ACCESS_LABEL[mode]}'이에요. 사람마다 따로 '회사 API 키'로 정하지 않으면 PC 연결이 구독 방식으로 설정돼요.</div>}
    </section>
  )
}

function ManagedStep(p: { web: Web; hub: string; shown: string | null; tokenInfo: ReturnType<typeof activeOrgToken>; pastedAt: string | null; csrf: string; withoutEmail: number }) {
  const json = managedSettingsJson(p.hub, p.shown ?? TOKEN_PLACEHOLDER)
  return (
    <Step n={2} id="step2" title="Claude Code 관리 설정 붙여 넣기 (사용량·스킬)">
      <p>모든 직원의 Claude Code가 이 설정을 저절로 받아요. 사용 기록을 허브로 보내고, 전체 직원용 스킬을 깔아 줘요.</p>

      <h3>조직 토큰</h3>
      <p>
        {p.tokenInfo
          ? <><span class="badge good">사용 중</span> <code>{p.tokenInfo.prefix}…</code> <span class="muted small">만든 때 {fmtDateTime(p.tokenInfo.createdAt)} · 마지막 사용 {fmtAgo(p.tokenInfo.lastUsedAt)}</span></>
          : <><span class="badge">없음</span> <span class="muted small">먼저 토큰을 만들어야 붙여 넣을 JSON이 나와요.</span></>}
      </p>
      <div class="actions" style="margin-bottom:12px">
        <ButtonForm action="/admin/claude/token" csrf={p.csrf} small={false} primary={!p.tokenInfo}
          label={p.tokenInfo ? '새로 만들기' : '조직 토큰 만들기'}
          confirm={p.tokenInfo ? '새로 만들면 지금 쓰는 토큰이 바로 멈춰요. 새 JSON을 Claude 관리 콘솔에 다시 붙여 넣어야 해요. 새로 만들까요?' : undefined} />
        {p.tokenInfo ? <ButtonForm action="/admin/claude/token/revoke" csrf={p.csrf} small={false} danger label="멈추기"
          confirm="조직 토큰을 멈출까요? 직원 Claude의 사용 기록과 전체 스킬 업데이트가 멈춰요." /> : null}
      </div>
      <p class="fine">토큰은 만들 때 한 번만 보여요. 다시 보려면 '새로 만들기'를 눌러야 하고, 그러면 이전 토큰은 바로 멈춰서 JSON을 다시 붙여 넣어야 해요.</p>

      <h3>붙여 넣기</h3>
      <ol class="steps">
        <li>Claude에서 <span class="menu">Organization settings › Claude Code › Managed settings</span> 를 열어요. Owner(소유자)만 열 수 있어요.</li>
        <li>아래 JSON을 복사해서 붙여 넣고 저장해요. 이미 다른 설정이 있으면 <code>env</code>, <code>extraKnownMarketplaces</code>, <code>enabledPlugins</code> 만 합쳐요.</li>
        <li>붙여 넣었으면 아래 '붙여 넣었어요'를 눌러요.</li>
      </ol>
      {p.shown ? (<>
        <div class="notice">지금 한 번만 보여요. 복사해서 Claude 관리 콘솔에 붙여 넣어 주세요.</div>
        <CopyBlock id="managed-json" text={json} />
      </>) : (<>
        <pre class="cmd" id="managed-json-preview">{json}</pre>
        <p class="fine">{TOKEN_PLACEHOLDER} 자리에는 조직 토큰이 들어가요. 토큰을 만들면 완성된 JSON이 한 번 나와요.</p>
      </>)}

      <div class="actions" style="margin:12px 0">
        <ButtonForm action="/admin/claude/pasted" csrf={p.csrf} small={false} label="붙여 넣었어요" />
        {p.pastedAt ? <span class="badge good">붙여 넣었다고 표시했어요 · {fmtDateTime(p.pastedAt)}</span> : <span class="muted small">아직 표시하지 않았어요.</span>}
      </div>

      <h3>이 JSON이 하는 일</h3>
      <ul class="tight">
        <li><b>사용량</b>: Claude Code의 사용 기록(OpenTelemetry)을 허브로 보내요. 허브는 기록에 적힌 직원 이메일로 사람을 찾아요. 그래서 <a href="/admin/users">사람</a> 페이지에 직원 이메일이 있어야 해요.{p.withoutEmail ? <> 지금 이메일이 없는 사람이 <b>{p.withoutEmail}명</b> 있어요.</> : null}</li>
        <li><b>스킬</b>: 전체 직원용 마켓플레이스와 <code>company-all</code> 플러그인을 켜요. 모든 직원이 읽을 수 있는 스킬만 들어요. {PER_GROUP}</li>
        <li><b>프롬프트 내용은 보내지 않아요</b> (<code>OTEL_LOG_USER_PROMPTS</code> 를 0으로 고정해요).</li>
        <li>'내 PC'의 설치 명령으로 연결한 PC에는 개인 플러그인(<code>company</code>)과 전체 플러그인(<code>company-all</code>)이 같이 깔려요. 같은 스킬이 두 번 보일 수 있어요.</li>
        <li><code>ANTHROPIC_BASE_URL</code> 이나 <code>ANTHROPIC_AUTH_TOKEN</code> 은 넣지 않았어요. 넣으면 Claude Code가 관리 설정을 아예 받지 않아요. 직원은 자기 Claude 로그인으로 그대로 써요.</li>
      </ul>
      <div class="notice warn small">
        이 토큰은 직원의 PC에 저장돼서 직원이 모두 볼 수 있어요. 그래서 사용 기록 보내기와 전체 스킬 읽기만 되게 막아 뒀어요. 파일, AI 요청, 다른 페이지는 열지 못해요. 다만 누군가 다른 사람 이메일로 기록을 보낼 수는 있어서, 구독 사용량 숫자는 참고용으로 봐 주세요.
      </div>

      <h3>직원이 보게 될 것</h3>
      <ul class="tight">
        <li>Claude Code를 다시 시작하면(최대 한 시간 안에 설정을 받아요) 처음 한 번 <b>'조직 설정 적용'</b> 승인 화면이 나와요. 사용 기록을 보낼 주소(<code>OTEL_EXPORTER_OTLP_…</code>)를 적용해도 되는지 묻는 화면이라, <b>승인</b>을 누르면 돼요.</li>
        <li>거절하면 Claude Code가 종료돼요. 승인은 조직 단위로 기억돼요. 설정이 바뀌면(토큰을 새로 만들 때 포함) 다시 나올 수 있어요.</li>
        <li><code>claude -p</code>나 VS Code 채팅창, 데스크톱 앱의 Code 탭에서는 승인 화면을 못 띄워요. 그때는 그 실행에만 적용되고, 터미널에서 한 번 열어 승인해야 기억돼요.</li>
        <li>Claude Code 2.1.238 이상이 필요해요. 직원이 <code>claude doctor</code> 를 실행하면 <code>Managed settings (remote)</code> 줄에서 받았는지 볼 수 있어요.</li>
      </ul>
    </Step>
  )
}

function CoworkStep(p: { hub: string; shown: string | null }) {
  const cw = coworkOtlp(p.hub, p.shown ?? TOKEN_PLACEHOLDER)
  return (
    <Step n={3} id="step3" title="Cowork 사용 기록 보내기" optional>
      <p>Cowork는 Claude Code와 설정이 따로예요. Claude에서 <span class="menu">Admin settings › Cowork</span> 를 열고 아래 세 칸을 채워요. Claude 데스크톱 1.1.4173 이상에서 되고, 새로 연 Cowork 세션부터 적용돼요.</p>
      <Fld label="OTLP endpoint" id="cowork-endpoint" text={cw.endpoint} hint={<>Cowork가 뒤에 <code>/v1/logs</code> 를 붙여서 <code>{cw.logsUrl}</code> 로 보내요.</>} />
      <Fld label="OTLP protocol" id="cowork-protocol" text={cw.protocol} hint="허브는 http/json만 받아요." />
      {p.shown
        ? <Fld label="OTLP headers" id="cowork-headers" text={cw.headers} hint="지금 한 번만 보여요." />
        : (<div class="fld"><div class="lab">OTLP headers</div><pre class="cmd">{cw.headers}</pre>
            <div class="fine">{TOKEN_PLACEHOLDER} 자리에는 2단계의 조직 토큰이 들어가요. 토큰을 새로 만들면 여기에도 한 번 나와요.</div></div>)}
      <p class="fine">Cowork 기록에도 직원 이메일이 들어 있어서 2단계와 같은 방식으로 사람을 찾아요. 프롬프트 내용을 보낼지는 직원 PC의 Claude 데스크톱 설정(<code>otlpContentCapture</code>)이 정해요.</p>
    </Step>
  )
}

function SkillsStep(p: { ctx: Ctx }) {
  const skills = orgSkills(p.ctx)
  return (
    <Step n={4} id="step4" title="Claude 앱에 스킬 올리기" optional>
      <p>Claude 웹·데스크톱 앱에서 회사 스킬을 쓰게 하려면 스킬을 올려요. 올린 스킬은 조직의 모든 직원에게 바로 나가요.</p>
      <ol class="steps">
        <li>Claude에서 <span class="menu">Organization settings › Plugins & skills</span> 를 열어요. 먼저 <b>Policy</b> 탭에서 <b>Cloud code execution and file creation</b> 과 <b>Skills</b> 가 켜져 있는지 봐요.</li>
        <li><b>Add</b> › <b>Upload a skill</b> 을 눌러요.</li>
        <li>아래에서 받은 .zip을 올려요. 스킬마다 한 번씩 해요.</li>
      </ol>
      {skills.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>스킬</th><th class="hide-sm">설명</th><th class="num">파일</th><th></th></tr></thead>
          <tbody>{skills.map((sk) => (
            <tr>
              <td><b>{sk.name}</b><div class="muted small">{sk.path} · {kb(sk.bytes)}</div>
                {sk.portable ? null : <div class="small" style="color:var(--warn)">폴더 이름이 영문 소문자·숫자·하이픈이 아니면 Claude가 올리기를 거절할 수 있어요.</div>}</td>
              <td class="hide-sm small">{sk.description}</td>
              <td class="num">{sk.files}</td>
              <td class="right nowrap"><a class="btn small" href={`/admin/claude/skill.zip?path=${encodeURIComponent(sk.path)}`}>.zip 받기</a></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title="모든 직원이 읽을 수 있는 스킬이 아직 없어요">팀 폴더의 skills/ 아래에 스킬을 넣고 읽기 권한을 '모두'에게 주면 여기에 나와요.</Empty>}
      <ul class="tight">
        <li>올린 스킬은 복사본이에요. 팀 폴더에서 고쳐도 저절로 바뀌지 않아요. 바뀌면 같은 스킬을 다시 올려요.</li>
        <li>Claude Code에서는 2단계의 플러그인이 저절로 업데이트돼요. 4단계를 하면 Claude Code에 같은 스킬이 두 번 보일 수 있어요. Claude 앱에서 스킬이 필요 없으면 이 단계는 건너뛰어도 돼요.</li>
        <li>{PER_GROUP} 모든 직원이 읽을 수 없는 스킬은 여기에 나오지 않아요.</li>
      </ul>
    </Step>
  )
}

function StatusCard(p: { ctx: Ctx; team: boolean; csrf: string; tokenInfo: ReturnType<typeof activeOrgToken>; company: string }) {
  const { ctx } = p
  const st = orgStatus(ctx.db)
  const ingest = orgIngestStats(ctx.db)
  const unknown = p.team ? listUnknownEmails(ctx.db) : []
  const reporting = p.team ? orgReportingPeople(ctx.db) : 0
  return (
    <section class="card" id="status">
      <h2>지금 상태</h2>
      <dl class="kv">
        <dt>Claude 앱 커넥터</dt>
        <dd><b>{st.connected}</b> / {st.people}명이 연결했어요
          <div class="bar" style="max-width:260px;margin-top:4px"><i style={`width:${st.people ? Math.round((st.connected / st.people) * 100) : 0}%`} /></div></dd>
        {p.team ? (<>
          <dt>사용 기록</dt>
          <dd>{!p.tokenInfo
            ? <span class="muted">조직 토큰이 없어요. 2단계에서 만들어 주세요.</span>
            : ingest.lastAt
              ? <>마지막으로 받은 때 <b>{fmtAgo(ingest.lastAt)}</b> · 최근 7일에 사용량이 들어온 사람 <b>{reporting}명</b></>
              : <span class="muted">아직 받은 기록이 없어요. 직원이 Claude Code를 다시 시작하고 승인하면 들어와요.</span>}</dd>
          <dt>이메일이 없는 사람</dt>
          <dd>{st.withoutEmail ? <><b>{st.withoutEmail}명</b> · 이메일이 없으면 기록이 누구 것인지 몰라요. <a href="/admin/users">사람</a> 페이지에서 넣어 주세요.</> : '없어요'}</dd>
        </>) : null}
      </dl>

      {p.team && unknown.length ? (
        <div class="notice warn" style="margin-top:14px">
          <b>허브에 없는 이메일</b> — 사람 목록에 이메일을 넣어 주세요.
          <ul class="tight">{unknown.map((u) => (
            <li><code>{u.email}</code> ({fmtNum(u.records)}건) <span class="small">· 마지막 {fmtAgo(u.lastSeen)}{u.ambiguous ? ' · 같은 이메일을 쓰는 사람이 여럿이에요' : ''}</span></li>
          ))}</ul>
          <div class="actions">
            <a class="btn small" href="/admin/users">사람 목록 열기</a>
            <ButtonForm action="/admin/claude/unknown/clear" csrf={p.csrf} label="목록 비우기" />
          </div>
        </div>
      ) : null}
      {p.team && ingest.missingEmail ? (
        <p class="small muted" style="margin-top:12px">이메일 없이 들어온 기록이 {fmtNum(ingest.missingEmail)}건 있어요. Claude에 로그인하지 않고 쓴 기록이라 저장하지 않았어요.</p>
      ) : null}
    </section>
  )
}

export function mountClaudeOrg(app: App, web: Web) {
  const { ctx } = web
  const db = ctx.db
  const needHub = () => { if (!claudeHubUrl(ctx)) fail('먼저 설정에서 공개 주소(https)를 정해 주세요.') }

  app.get('/admin/claude', (c) => {
    const s = c.get('session')!
    return render(c, <ClaudePage web={web} c={c} flashes={takeFlashes(web, c)} shown={takeShown(web, s.idHash)} />)
  })

  app.post('/admin/claude/plan', (c) => act(web, c, '/admin/claude', (f, s) => {
    const v = field(f, 'plan')
    if (v !== 'team' && v !== 'individual' && v !== 'company_key') fail('종류를 골라 주세요.')
    setClaudeOrg(db, v === 'company_key' ? { plan: null, companyKeyChosen: true } : { plan: v as 'team' | 'individual' })
    audit(db, { actor: s.user.id, action: 'claude_org.plan', detail: { plan: v } })
    say(web, s, 'ok', '저장했어요.')
  }))

  app.post('/admin/claude/name', (c) => act(web, c, '/admin/claude#step1', (f, s) => {
    const name = cleanConnectorName(field(f, 'connectorName'))
    setClaudeOrg(db, { connectorName: name })
    audit(db, { actor: s.user.id, action: 'claude_org.name', detail: { connectorName: getClaudeOrg(db).connectorName } })
    say(web, s, 'ok', '커넥터 이름을 저장했어요. Claude에 이미 만든 커넥터의 이름은 Claude에서 바꿔 주세요.')
  }))

  app.post('/admin/claude/token', (c) => act(web, c, '/admin/claude#step2', (_f, s) => {
    needHub()
    const r = rotateOrgToken(db, s.user.id)
    resetOrgIngestStats(db)
    setClaudeOrg(db, { managedSettingsAt: null })
    audit(db, { actor: s.user.id, action: r.replaced ? 'org_token.rotate' : 'org_token.create', target: r.id })
    keepShown(web, s.idHash, r.token)
    say(web, s, 'ok', r.replaced
      ? '새 조직 토큰을 만들었어요. 이전 토큰은 바로 멈췄어요. 아래 JSON을 Claude 관리 콘솔에 다시 붙여 넣어 주세요.'
      : '조직 토큰을 만들었어요. 아래 JSON을 Claude 관리 콘솔에 붙여 넣어 주세요.')
  }))

  app.post('/admin/claude/token/revoke', (c) => act(web, c, '/admin/claude#step2', (_f, s) => {
    const t = activeOrgToken(db)
    if (!t || !revokeOrgToken(db)) return say(web, s, 'bad', '멈출 토큰이 없어요.')
    setClaudeOrg(db, { managedSettingsAt: null })
    audit(db, { actor: s.user.id, action: 'org_token.revoke', target: t.id })
    say(web, s, 'warn', '조직 토큰을 멈췄어요. 다시 쓰려면 새로 만들어 JSON을 다시 붙여 넣어야 해요.')
  }))

  app.post('/admin/claude/pasted', (c) => act(web, c, '/admin/claude#step2', (_f, s) => {
    if (!activeOrgToken(db)) return say(web, s, 'bad', '먼저 조직 토큰을 만들어 주세요.')
    setClaudeOrg(db, { managedSettingsAt: new Date().toISOString() })
    audit(db, { actor: s.user.id, action: 'claude_org.pasted' })
    say(web, s, 'ok', '표시했어요. 직원이 Claude Code를 다시 시작하면 적용돼요.')
  }))

  app.post('/admin/claude/unknown/clear', (c) => act(web, c, '/admin/claude#status', (_f, s) => {
    clearUnknownEmails(db)
    audit(db, { actor: s.user.id, action: 'claude_org.unknown_clear' })
    say(web, s, 'ok', '목록을 비웠어요.')
  }))

  app.get('/admin/claude/skill.zip', (c) => {
    const path = c.req.query('path') ?? ''
    const found = orgSkillZip(ctx, path)
    if (!found) return c.text('모든 직원이 읽을 수 있는 스킬만 받을 수 있어요.', 404)
    const ascii = /^[A-Za-z0-9._-]+$/.test(found.skill.dir) ? found.skill.dir : 'skill'
    return c.body(found.zip as Uint8Array<ArrayBuffer>, 200, {
      'content-type': 'application/zip',
      'content-length': String(found.zip.length),
      'content-disposition': `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(found.skill.dir)}.zip`,
    })
  })
}

