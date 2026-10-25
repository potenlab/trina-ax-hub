/** @jsxImportSource hono/jsx */
// Settings: company name and hub concurrency (admins), public/LAN address and the company API key (owner only).
// The key is write-only here: the page shows whether one is set and its last 4 characters, never the key.
import type { App, C } from '../../http/app'
import type { Ctx } from '../../context'
import { audit } from '../../audit'
import { Csrf, CopyBlock } from '../../ui/layout'
import { defaultModelAccess, setDefaultModelAccess, MODEL_ACCESS_LABEL, type ModelAccess } from '../../auth/access-mode'
import { type Web, type Flash, Shell, ButtonForm, render, takeFlashes, act, say, fail, field, isOwner } from '../kit'
import { companyName, configuredDefaults, configuredHubUrl, effectiveUrls, hubConcurrency, krwPerUsd, needsReconnect, saveSetting } from '../settings'
import { listTokens } from '../../auth/tokens'
import { getSetting } from '../../db'
import { PRODUCT } from '../../product'

const KEY_CHECK_TIMEOUT_MS = 10_000

/** Connected PCs set up with another hub address than the one PCs get now. */
export function staleDevices(ctx: Ctx) {
  const current = configuredHubUrl(effectiveUrls(ctx))
  return listTokens(ctx.db).filter((t) => !t.revoked_at && needsReconnect(t.hub_url, current))
}
const API_KEY = /^[\x21-\x7e]{10,400}$/

/** A hub address typed by the owner → its origin ('' → null). */
export function cleanUrl(v: string, o: { https: boolean; what: string }): string | null {
  const t = v.trim().replace(/\/+$/, '')
  if (!t) return null
  let u: URL
  try { u = new URL(t) } catch { return fail(`${o.what}가 주소 모양이 아니에요. 예: ${o.https ? 'https://acme.example.com' : 'http://192.168.0.10:47900'}`) }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(`${o.what}는 http:// 또는 https:// 로 시작해야 해요.`)
  if (o.https && u.protocol !== 'https:') fail(`${o.what}는 https:// 로 시작해야 해요. 회사 스킬 설치는 https 주소에서만 돼요.`)
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) fail(`${o.what}는 뒤에 경로 없이 적어 주세요. 예: https://acme.example.com`)
  return u.origin
}

/** Ask the upstream for its model list with the company key. Never puts the key in the result. */
export async function checkApiKey(ctx: Ctx): Promise<{ ok: boolean; status: number; message: string }> {
  const key = ctx.secrets.getApiKey()
  if (!key) return { ok: false, status: 0, message: '먼저 API 키를 넣어 주세요.' }
  let r: Response
  try {
    r = await fetch(`${ctx.config.upstreamBaseUrl}/v1/models?limit=100`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'user-agent': `${PRODUCT.id}/${PRODUCT.version}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    })
  } catch (e) {
    const timeout = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError'
    return { ok: false, status: 0, message: timeout ? 'Anthropic이 10초 안에 답하지 않았어요. 인터넷 연결을 확인하고 다시 해 주세요.' : 'Anthropic에 연결하지 못했어요. 허브 컴퓨터의 인터넷 연결을 확인해 주세요.' }
  }
  let body: any = null
  try { body = await r.json() } catch {}
  if (r.ok) {
    const n = Array.isArray(body?.data) ? body.data.length : 0
    return { ok: true, status: r.status, message: n ? `연결됐어요. 이 키로 모델 ${n}개를 쓸 수 있어요.` : '연결됐어요. 키가 잘 작동해요.' }
  }
  const type = typeof body?.error?.type === 'string' ? body.error.type.replace(/[^a-z_]/g, '').slice(0, 40) : ''
  const why =
    r.status === 401 ? '키가 맞지 않아요. Anthropic 콘솔에서 키를 다시 복사해 넣어 주세요.'
    : r.status === 403 ? '이 키로는 쓸 수 없어요. Anthropic 콘솔에서 키의 권한과 결제 상태를 확인해 주세요.'
    : r.status === 429 ? '요청이 너무 많다고 해요. 잠시 뒤 다시 확인해 주세요.'
    : r.status >= 300 && r.status < 400 ? 'Anthropic 주소가 다른 곳으로 넘기려고 해요. 허브 설정의 upstream 주소를 확인해 주세요.'
    : r.status >= 500 ? 'Anthropic 쪽에 잠시 문제가 있어요. 조금 뒤 다시 확인해 주세요.'
    : '확인하지 못했어요.'
  return { ok: false, status: r.status, message: `${why} (응답 ${r.status}${type ? ` · ${type}` : ''})` }
}

/** How many active people use each way (their own choice or the company default). */
export function accessCounts(ctx: Ctx): Record<ModelAccess, number> {
  const out: Record<ModelAccess, number> = { subscription: 0, company_key: 0 }
  const def = defaultModelAccess(ctx.db)
  for (const r of ctx.db.query("SELECT model_access FROM users WHERE status = 'active'").all() as { model_access: ModelAccess | null }[]) out[r.model_access ?? def]++
  return out
}

function SettingsPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { ctx } = p.web
  const s = p.c.get('session')!
  const owner = isOwner(s)
  const urls = effectiveUrls(ctx)
  const defaults = configuredDefaults(ctx)
  const savedPublic = getSetting<string | null>(ctx.db, 'publicUrl', null)
  const savedLan = getSetting<string | null>(ctx.db, 'lanUrl', null)
  const hint = ctx.secrets.apiKeyHint()
  const stale = staleDevices(ctx)
  const fromConfig = (saved: string | null, def: string | null) => (!saved && def ? <span class="muted small">설정 파일 값: {def} · 비우면 이 값을 써요</span> : null)
  return (
    <Shell c={p.c} title="설정" active="/admin/settings" flashes={p.flashes}>
      <h1>설정</h1>
      <p class="lead">회사 정보, 접속 주소, Anthropic API 키를 관리해요.{owner ? '' : ' 주소와 API 키는 소유자만 바꿀 수 있어요.'}</p>

      <form method="post" action="/admin/settings/general" class="card" id="general">
        <h2>회사</h2>
        <Csrf token={s.csrf} />
        <div class="row">
          <div class="field"><label for="companyName">회사 이름</label><input id="companyName" name="companyName" value={companyName(ctx)} required maxlength={60} /></div>
          <div class="field" style="max-width:220px"><label for="hubConcurrency">휴대폰·예약 작업 동시 실행</label>
            <select id="hubConcurrency" name="hubConcurrency">{[1, 2, 3, 4, 5, 6].map((n) => <option value={String(n)} selected={hubConcurrency(ctx) === n}>{n}개</option>)}</select></div>
        </div>
        <p class="muted small">동시 실행은 허브 컴퓨터에서 한꺼번에 돌릴 휴대폰 채팅·예약 작업 수예요. 맥 미니라면 2~3개가 알맞아요. 나머지는 차례를 기다려요.</p>
        <div class="field" style="max-width:220px"><label for="krwPerUsd">원화 환산 (1달러당 원)</label>
          <input id="krwPerUsd" name="krwPerUsd" inputmode="numeric" value={String(krwPerUsd(ctx))} maxlength={6} /></div>
        <p class="muted small">사용 요금은 달러로 청구돼요. 화면의 '약 N원'은 이 고정 환율로 어림한 금액이에요.</p>
        <button class="btn primary" type="submit">저장</button>
      </form>

      <form method="post" action="/admin/settings/urls" class="card" id="urls">
        <h2>접속 주소</h2>
        <Csrf token={s.csrf} />
        {urls.publicUrl ? null : <div class="notice warn">공개 주소가 없어서 회사 스킬이 PC에 설치되지 않아요. 파일과 AI 사용은 돼요. 직원 PC를 연결하기 전에 공개 주소부터 넣어 주세요. 나중에 넣으면 그 전에 연결한 PC는 다시 연결해야 해요.</div>}
        <div class="field"><label for="publicUrl">공개 주소 (https)</label>
          <input id="publicUrl" name="publicUrl" value={savedPublic ?? ''} placeholder={defaults.publicUrl ?? 'https://acme.example.com'} disabled={!owner} inputmode="url" autocapitalize="off" spellcheck={false} />
          <span class="muted small">어디서나 열리는 주소예요(Cloudflare 터널 등). 회사 스킬 설치, 사무실 밖 PC, 휴대폰 사용에 필요해요.</span>
          {fromConfig(savedPublic, defaults.publicUrl)}</div>
        <div class="field"><label for="lanUrl">사내 주소</label>
          <input id="lanUrl" name="lanUrl" value={savedLan ?? ''} placeholder={defaults.lanUrl ?? 'http://192.168.0.10:47900'} disabled={!owner} inputmode="url" autocapitalize="off" spellcheck={false} />
          <span class="muted small">사무실 네트워크에서 허브 컴퓨터를 여는 주소예요. 공개 주소가 없을 때 PC 연결에 써요.</span>
          {fromConfig(savedLan, defaults.lanUrl)}</div>
        <p class="small">지금 PC 연결에 쓰는 주소: <code>{urls.hubUrl}</code></p>
        {stale.length ? <div class="notice warn small">예전 주소로 연결된 PC가 {stale.length}대 있어요 ({stale.slice(0, 5).map((t) => `${t.user_name ?? ''} '${t.name}'`).join(', ')}{stale.length > 5 ? ' …' : ''}). 각자 '내 PC' 페이지의 안내대로 다시 연결해야 해요.</div> : null}
        {owner ? <button class="btn primary" type="submit">저장</button> : null}
      </form>

      <form method="post" action="/admin/settings/access" class="card" id="access">
        <h2>Claude 사용 방식</h2>
        <Csrf token={s.csrf} />
        <p>회사 기본값이에요. 사람마다 '사람' 페이지에서 따로 정할 수 있어요.</p>
        <label class="choice"><input type="radio" name="access" value="subscription" checked={defaultModelAccess(ctx.db) === 'subscription'} />
          <span><b>각자 Claude 구독</b> <span class="muted small">(Team 좌석·Pro·Max)</span><br />
          <span class="muted small">직원이 본인 구독으로 로그인해요. 허브는 회사 파일·스킬을 주고 사용량만 받아서 보여 줘요. 예산으로 막지는 않아요(각자 구독 한도가 적용돼요).</span></span></label>
        <label class="choice"><input type="radio" name="access" value="company_key" checked={defaultModelAccess(ctx.db) === 'company_key'} />
          <span><b>회사 API 키</b><br />
          <span class="muted small">AI 요청이 허브를 거쳐 아래 회사 키로 청구돼요. 사람별 예산으로 막을 수 있어요.</span></span></label>
        <p class="small">지금: 각자 구독 {accessCounts(ctx).subscription}명 · 회사 키 {accessCounts(ctx).company_key}명</p>
        <p class="muted small">방식을 바꾸면 그 사람의 PC는 '내 PC'에서 다시 연결해야 적용돼요.</p>
        <button class="btn primary" type="submit">저장</button>
      </form>

      <div class="card" id="connector">
        <h2>Claude 앱 커넥터 (웹·데스크톱·휴대폰)</h2>
        {urls.publicUrl ? (<>
          <p>직원이 본인 Claude 앱에서 회사 파일·스킬을 쓰려면 이 주소를 커스텀 커넥터로 추가해요.</p>
          <CopyBlock id="connector-url" text={`${urls.publicUrl}/mcp`} />
          <ul class="small">
            <li><b>Claude Team</b>: 소유자가 Claude의 조직 설정 › 커넥터 › 추가 › 커스텀에 한 번 넣으면, 직원은 각자 설정 › 커넥터에서 '연결'을 누르고 허브 아이디로 로그인해요.</li>
            <li><b>Pro·Max</b>: 각자 Claude 설정 › 커넥터 › 커스텀 커넥터 추가에 이 주소를 넣고 허브 아이디로 로그인해요.</li>
          </ul>
          <p class="muted small">Claude는 Anthropic 서버에서 이 주소로 접속해요. Cloudflare에서 이 주소의 /mcp, /oauth, /.well-known 앞에 접근 제한(Access, 봇 차단)을 두지 마세요.</p>
        </>) : <div class="notice warn">공개 주소(https)가 있어야 Claude 앱 커넥터를 쓸 수 있어요. 위의 접속 주소부터 넣어 주세요.</div>}
      </div>

      <div class="card" id="key">
        <h2>Anthropic API 키</h2>
        <p>'회사 API 키' 방식인 사람의 AI 사용과 휴대폰 채팅·예약 작업(허브에서 실행)이 이 키로 Anthropic에 청구돼요. 키는 허브 컴퓨터에만 저장되고 화면에는 다시 보이지 않아요.</p>
        <dl class="kv" style="margin-bottom:14px">
          <dt>상태</dt><dd>{hint ? <><span class="badge good">설정됨</span> <code>{hint}</code></> : <span class="badge bad">없음</span>}</dd>
        </dl>
        <div class="actions" style="margin-bottom:14px">
          {hint ? <ButtonForm action="/admin/settings/key/check" csrf={s.csrf} label="연결 확인" small={false} /> : null}
          {hint && owner ? <ButtonForm action="/admin/settings/key/remove" csrf={s.csrf} label="키 지우기" small={false} danger
            confirm="API 키를 지울까요? 지우면 모든 직원의 Claude가 멈춰요." /> : null}
        </div>
        {owner ? (
          <form method="post" action="/admin/settings/key">
            <Csrf token={s.csrf} />
            <div class="row">
              <div class="field"><label for="apiKey">{hint ? '새 키로 바꾸기' : '키 넣기'}</label>
                <input id="apiKey" type="password" name="apiKey" required autocomplete="off" spellcheck={false} placeholder="sk-ant-…" /></div>
              <div><button class="btn primary" type="submit" style="margin-bottom:12px">저장</button></div>
            </div>
            <p class="muted small">Anthropic 콘솔(console.anthropic.com) › API Keys 에서 만든 키를 붙여 넣어요.</p>
          </form>
        ) : <p class="muted small">키는 소유자만 넣거나 바꿀 수 있어요.</p>}
      </div>
    </Shell>
  )
}

export function mountSettings(app: App, web: Web) {
  const { ctx } = web
  const db = ctx.db
  const ownerOnly = (s: { user: { role: string } }) => { if (s.user.role !== 'owner') fail('소유자만 바꿀 수 있어요.', 403) }

  app.get('/admin/settings', (c) => render(c, <SettingsPage web={web} c={c} flashes={takeFlashes(web, c)} />))

  app.post('/admin/settings/general', (c) => act(web, c, '/admin/settings', (f, s) => {
    const name = field(f, 'companyName')
    if (!name || name.length > 60) fail('회사 이름을 60자 안으로 적어 주세요.')
    const n = Number(field(f, 'hubConcurrency'))
    if (!Number.isInteger(n) || n < 1 || n > 6) fail('동시 실행은 1~6개 중에서 골라 주세요.')
    const rateText = field(f, 'krwPerUsd').replace(/[,\s원]/g, '')
    const rate = rateText === '' ? krwPerUsd(ctx) : Number(rateText)
    if (!Number.isFinite(rate) || rate < 100 || rate > 10_000) fail('원화 환산은 1달러당 100~10,000원 사이 숫자로 적어 주세요. 예: 1400')
    const changed: Record<string, unknown> = {}
    if (name !== companyName(ctx)) { saveSetting(ctx, 'companyName', name); changed.companyName = name }
    if (n !== hubConcurrency(ctx)) { saveSetting(ctx, 'hubConcurrency', n); changed.hubConcurrency = n }
    if (rate !== krwPerUsd(ctx)) { saveSetting(ctx, 'krwPerUsd', rate); changed.krwPerUsd = rate }
    if (Object.keys(changed).length) audit(db, { actor: s.user.id, action: 'settings.update', detail: changed })
    say(web, s, 'ok', '저장했어요.')
  }))

  app.post('/admin/settings/access', (c) => act(web, c, '/admin/settings#access', (f, s) => {
    const v = field(f, 'access')
    if (v !== 'subscription' && v !== 'company_key') return say(web, s, 'bad', '방식을 골라 주세요.')
    setDefaultModelAccess(ctx.db, v)
    audit(ctx.db, { actor: s.user.id, action: 'settings.access', detail: { defaultModelAccess: v } })
    say(web, s, 'ok', `회사 기본값을 '${MODEL_ACCESS_LABEL[v]}'(으)로 바꿨어요.`)
  }))

  app.post('/admin/settings/urls', (c) => act(web, c, '/admin/settings#urls', (f, s) => {
    ownerOnly(s)
    const publicUrl = cleanUrl(field(f, 'publicUrl'), { https: true, what: '공개 주소' })
    const lanUrl = cleanUrl(field(f, 'lanUrl'), { https: false, what: '사내 주소' })
    saveSetting(ctx, 'publicUrl', publicUrl)
    saveSetting(ctx, 'lanUrl', lanUrl)
    audit(db, { actor: s.user.id, action: 'settings.urls', detail: { publicUrl, lanUrl } })
    say(web, s, 'ok', `저장했어요. 이제 PC 연결에 ${effectiveUrls(ctx).hubUrl} 을 써요.`)
    const stale = staleDevices(ctx).length
    if (stale) say(web, s, 'warn', `예전 주소로 연결된 PC ${stale}대는 다시 연결해야 해요. 각자 '내 PC' 페이지에 안내가 나와요.`)
  }))

  app.post('/admin/settings/key', (c) => act(web, c, '/admin/settings#key', (f, s) => {
    ownerOnly(s)
    const key = field(f, 'apiKey')
    if (!API_KEY.test(key)) fail('키 모양이 이상해요. 공백 없이 그대로 붙여 넣어 주세요.')
    const replaced = !!ctx.secrets.getApiKey()
    ctx.secrets.setApiKey(key)
    audit(db, { actor: s.user.id, action: 'apikey.set', detail: { replaced } })
    say(web, s, 'ok', `API 키를 ${replaced ? '바꿨어요' : '저장했어요'}. '연결 확인'으로 잘 되는지 확인해 보세요.`)
  }))

  app.post('/admin/settings/key/remove', (c) => act(web, c, '/admin/settings#key', (_f, s) => {
    ownerOnly(s)
    if (!ctx.secrets.getApiKey()) return say(web, s, 'bad', '지울 키가 없어요.')
    ctx.secrets.setApiKey(null)
    audit(db, { actor: s.user.id, action: 'apikey.remove' })
    say(web, s, 'warn', 'API 키를 지웠어요. 새 키를 넣을 때까지 직원들의 Claude가 답하지 않아요.')
  }))

  app.post('/admin/settings/key/check', (c) => act(web, c, '/admin/settings#key', async (_f, s) => {
    const r = await checkApiKey(ctx)
    audit(db, { actor: s.user.id, action: 'apikey.check', detail: { ok: r.ok, status: r.status } })
    say(web, s, r.ok ? 'ok' : 'bad', r.message)
  }))
}
