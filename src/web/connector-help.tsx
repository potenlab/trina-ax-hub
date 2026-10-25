/** @jsxImportSource hono/jsx */
// How a person connects the company AI inside their Claude app, in menu names. Used on the personal page (/me) and on
// the page a browser gets when it opens the connector address itself (GET /mcp). Claude has no link that opens the
// connector screen, so these are exact menu paths, not links.
import type { Ctx } from '../context'
import { Page, CopyBlock } from '../ui/layout'
import type { ClaudeOrg } from './claude-org'
import { readClaudeOrg } from './claude-org'
import { companyName } from './settings'
import { WebHead } from './kit'

export interface StepsProps {
  plan: ClaudeOrg['plan']
  /** the name people look for in Claude's connector list */
  connectorName: string
  /** https://<hub>/mcp */
  address: string
  /** element id prefix for the copy button */
  id: string
}

/**
 * plan team: the steps for people in a Claude Team organization (the owner added the connector once, members press 연결).
 * plan individual: the steps for people who add it themselves in their own Pro/Max account.
 * unknown: both, each under its own heading.
 */
export function ClaudeAppSteps(p: StepsProps) {
  const team = p.plan !== 'individual'
  const solo = p.plan !== 'team'
  const both = p.plan === null
  return (<>
    {team ? (
      <div>
        {both ? <h3>회사가 Claude Team을 쓰는 경우</h3> : null}
        <ol class="steps">
          <li>Claude 앱(데스크톱·휴대폰·claude.ai)을 열고 회사 Claude 계정으로 로그인해요.</li>
          <li><b>사용자 지정(Customize) › 커넥터</b>로 가요.</li>
          <li>'<b>{p.connectorName}</b>' 옆의 <b>연결</b>을 눌러요.</li>
          <li>회사 AI 로그인 화면이 열리면 로그인한 뒤 <b>허용</b>을 눌러요.</li>
        </ol>
        <p class="muted small">목록에 '{p.connectorName}'이 안 보이면 관리자에게 알려 주세요.</p>
      </div>
    ) : null}
    {solo ? (
      <div>
        {both ? <h3>개인 Claude(Pro·Max)를 쓰는 경우</h3> : null}
        <ol class="steps">
          <li>컴퓨터에서 Claude 앱이나 claude.ai를 열어요.</li>
          <li><b>사용자 지정(Customize) › 커넥터 › 커넥터 추가 › 커스텀 커넥터</b>를 눌러요.</li>
          <li>이름에는 '<b>{p.connectorName}</b>', 주소에는 아래 주소를 붙여 넣고 추가해요.</li>
          <li>추가된 커넥터 옆의 <b>연결</b>을 누르고, 회사 AI 로그인 화면에서 로그인한 뒤 <b>허용</b>을 눌러요.</li>
        </ol>
        <CopyBlock id={`${p.id}-address`} text={p.address} />
      </div>
    ) : null}
    <p class="muted small">휴대폰에서 이 단계가 안 보이면 컴퓨터의 claude.ai에서 한 번 연결해 두세요. 그러면 휴대폰에도 나타나요.</p>
  </>)
}

/** The name to show for the connector: what the Claude owner typed, else the company name. */
export const connectorLabel = (ctx: Ctx, org: ClaudeOrg) => org.connectorName ?? companyName(ctx)

/** What a browser sees at the connector address. Claude itself never asks for HTML. */
export function connectorHelpHtml(ctx: Ctx, origin: string): string {
  const org = readClaudeOrg(ctx.db)
  const company = companyName(ctx)
  const node = (
    <Page title="회사 AI 연결 주소" narrow head={<WebHead />}>
      <h1>{company}</h1>
      <p class="lead">이 주소는 브라우저에서 여는 곳이 아니에요. Claude 앱의 커넥터 설정에 붙여 넣는 주소예요.</p>
      <div class="card">
        <h2>Claude 앱에서 회사 AI 연결하기</h2>
        <ClaudeAppSteps plan={org.plan} connectorName={connectorLabel(ctx, org)} address={`${origin}/mcp`} id="mcp-help" />
      </div>
      <p><a class="btn" href="/me">내 페이지로 가기</a></p>
    </Page>
  )
  return '<!doctype html>' + String(node)
}
