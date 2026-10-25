// Admin CLI on the hub machine: `bun src/cli.ts <command>` (the installed `trina-ax` command calls this; it also
// handles start/stop/restart itself, see deploy/macos/trina-ax.sh). `trina-ax help` lists the commands.
//
// Messages are Korean. An error prints one line, never a stack trace (TRINA_AX_DEBUG=1 shows it). Nothing here
// prints the company API key, a token or a stored password; temporary passwords are printed once, on purpose.
// Settings are saved the same way the settings page saves them (`saveSetting`), with the same URL rules.
import fs from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { loadConfig, which } from './config'
import { openDb, getSetting, setSetting } from './db'
import { fileSecrets } from './secrets'
import { silentLog } from './log'
import { makeCtx, type Ctx } from './context'
import { HttpError } from './http/errors'
import { audit } from './audit'
import { createUser, getUserByUsername, listUsers, setPassword } from './auth/users'
import { makeEnrollCode } from './auth/enroll'
import { listTokens } from './auth/tokens'
import { initTeamFolder } from './policy/rules-admin'
import { effectiveUrls, installCommands, localUrl, saveSetting, urlWarnings } from './web/settings'
import { checkApiKey, cleanUrl } from './web/admin/settings'
import { tempPassword } from './web/admin/users'
import { secret } from './ids'
import { PRODUCT } from './product'
import { DEFAULT_PRICES, priceTable, type PriceEntry } from './relay/pricing'
import { listVersions, restoreVersion } from './files/versions'

// ------------------------------------------------------------------------------------------------------------------
// plumbing

class CliError extends Error {}
const die = (msg: string): never => { throw new CliError(msg) }

let ctxCache: Ctx | null = null
/** The hub's database, secrets and config, opened on first use (help and logs never open the database). */
function hub(): Ctx {
  if (ctxCache) return ctxCache
  const config = loadConfig()
  const db = openDb(path.join(config.dataDir, 'hub.db'))
  ctxCache = makeCtx({ config, db, secrets: fileSecrets(config.dataDir), log: silentLog })
  return ctxCache
}

function closeHub() { try { ctxCache?.db.close() } catch {} ctxCache = null }

interface Args { pos: string[]; opts: Map<string, string | true> }
interface Spec { values?: string[]; bools?: string[] }

/** `--name value`, `--name=value` and boolean flags; anything else that starts with '-' is an error. */
export function parseArgs(argv: string[], spec: Spec): Args {
  const values = new Set(spec.values ?? []), bools = new Set([...(spec.bools ?? []), '--help', '-h'])
  const pos: string[] = [], opts = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') { pos.push(...argv.slice(i + 1)); break }
    if (!a.startsWith('-') || a === '-') { pos.push(a); continue }
    const eq = a.indexOf('=')
    const name = eq > 0 ? a.slice(0, eq) : a
    if (values.has(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i]
      if (v === undefined) die(`${name} 다음에 값을 적어 주세요.`)
      opts.set(name, v!)
    } else if (bools.has(name) && eq < 0) opts.set(name, true)
    else die(`모르는 옵션이에요: ${a} (도움말: trina-ax help)`)
  }
  return { pos, opts }
}
const val = (a: Args, n: string) => { const v = a.opts.get(n); return typeof v === 'string' ? v : undefined }
const on = (a: Args, n: string) => a.opts.has(n)

async function readSecretLine(prompt: string): Promise<string> {
  if (process.stdin.isTTY) {
    process.stdout.write(prompt)
    Bun.spawnSync(['stty', '-echo'], { stdin: 'inherit' })
    try {
      for await (const line of console) return line.trim()
      return ''
    } finally {
      Bun.spawnSync(['stty', 'echo'], { stdin: 'inherit' })
      process.stdout.write('\n')
    }
  }
  const text = await new Response(Bun.stdin.stream()).text()
  return (text.split(/\r?\n/)[0] ?? '').trim()
}

/** GET with a timeout; never throws. */
async function probe(url: string, ms: number, init: RequestInit = {}) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(ms), ...init })
    const text = await r.text().catch(() => '')
    let json: any = null
    try { json = JSON.parse(text) } catch {}
    return { ok: true as const, status: r.status, headers: r.headers, text, json }
  } catch (e) {
    const name = (e as Error)?.name
    return { ok: false as const, error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'connect' }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const logsDir = (dataDir: string) => process.env.TRINA_AX_LOG_DIR ?? path.join(path.dirname(dataDir), 'logs')
const ROLE: Record<string, string> = { owner: '소유자', admin: '관리자', member: '직원' }
const LOOPBACK = /^(localhost|.+\.localhost|127\.\d+\.\d+\.\d+|\[::1\]|\[::\]|0\.0\.0\.0)$/i
const API_KEY = /^[\x21-\x7e]{10,400}$/ // the settings page's rule
const fmtGb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯　-〿＀-￯]/.test(ch) ? 2 : 1), 0)))

/** Address checks: the settings page's `cleanUrl`, plus "other PCs must be able to open it" (no loopback). */
export function checkUrls(o: { public?: string; lan?: string }): { publicUrl?: string | null; lanUrl?: string | null } {
  const out: { publicUrl?: string | null; lanUrl?: string | null } = {}
  const notLocal = (u: string | null, what: string) => {
    if (u && LOOPBACK.test(new URL(u).hostname)) die(`${what}는 다른 PC에서 여는 주소예요. localhost나 127.0.0.1은 쓸 수 없어요.`)
    return u
  }
  if (o.public !== undefined) out.publicUrl = notLocal(cleanUrl(o.public, { https: true, what: '공개 주소' }), '공개 주소')
  if (o.lan !== undefined) out.lanUrl = notLocal(cleanUrl(o.lan, { https: false, what: '사내 주소' }), '사내 주소')
  return out
}

const userOrDie = (username: string | undefined, usage: string) => {
  if (!username) die(`사용법: ${usage}`)
  return getUserByUsername(hub().db, username!) ?? die(`없는 아이디예요: ${username}  (목록: trina-ax users)`)
}

// ------------------------------------------------------------------------------------------------------------------
// commands

interface Command { usage: string; summary: string; help: string; spec?: Spec; run(a: Args): Promise<number | void> | number | void }

const COMMANDS: Record<string, Command> = {}
const SERVICE: Record<string, string> = {
  start: '허브(와 터널) 켜기',
  stop: '허브(와 터널) 끄기. 정말 꺼져요',
  restart: '다시 시작 (주소·설정을 바꾼 뒤)',
}

COMMANDS.status = {
  usage: 'status [--json]',
  summary: '허브 상태와 설정 한눈에 보기',
  help: '서버가 응답하는지, 주소(공개·사내), API 키가 있는지, 사람 수를 보여 줘요.\n소유자가 아직 없으면 다른 컴퓨터에서 /setup 을 열 수 있는 일회용 주소도 보여 줘요.\n--json: 프로그램이 읽기 좋은 형태 (키·토큰은 들어가지 않아요)',
  spec: { bools: ['--json'] },
  async run(a) {
    const ctx = hub()
    const { config, db, secrets } = ctx
    const u = effectiveUrls(ctx)
    const users = listUsers(db)
    const pcs = listTokens(db).filter((t) => !t.revoked_at).length
    const local = localUrl(ctx)
    const h = await probe(local + '/healthz', 2000)
    const running = h.ok && h.json?.product === PRODUCT.id ? String(h.json.version ?? '?') : null
    if (on(a, '--json')) {
      console.log(JSON.stringify({
        product: PRODUCT.id, version: PRODUCT.version, server: { url: local, running: !!running, version: running },
        dataDir: config.dataDir, teamRoot: config.teamRoot, host: config.host, port: config.port,
        publicUrl: u.publicUrl, lanUrl: u.lanUrl, hubUrl: u.hubUrl, apiKey: !!secrets.getApiKey(),
        claudeBin: config.claudeBin, users: users.length, activeUsers: users.filter((x) => x.status === 'active').length, devices: pcs,
      }, null, 2))
      return
    }
    const row = (k: string, v: string) => console.log(`  ${pad(k, 12)} ${v}`)
    console.log(`${PRODUCT.displayName} ${PRODUCT.version}`)
    row('서버', running ? `응답해요 · ${local}${running !== PRODUCT.version ? ` · 돌고 있는 버전 ${running} → trina-ax restart` : ''}` : `응답하지 않아요 · ${local} → trina-ax start / trina-ax logs`)
    row('듣는 주소', `${config.host}:${config.port}`)
    row('공개 주소', u.publicUrl ?? '(없음: 회사 스킬 설치에는 https 공개 주소가 필요해요)')
    row('사내 주소', u.lanUrl ?? '(없음)')
    row('PC 연결 주소', u.hubUrl)
    row('API 키', secrets.apiKeyHint() ?? '(없음: 설정 화면이나 trina-ax set-key 로 넣어 주세요)')
    row('claude', config.claudeBin ?? '(없음: 휴대폰 채팅·예약 작업이 꺼져 있어요)')
    row('사람', `${users.length}명 (사용 중 ${users.filter((x) => x.status === 'active').length}) · 연결된 PC ${pcs}대`)
    row('데이터', config.dataDir)
    row('팀 폴더', config.teamRoot)
    if (!users.length) {
      const t = secrets.ensureSetupToken()
      row('처음 설정', `이 Mac: ${local}/setup`)
      row('', `다른 컴퓨터: ${u.hubUrl}/setup?t=${t}  (한 번만 쓰는 주소예요)`)
    }
  },
}

COMMANDS.ping = {
  usage: 'ping [--wait 초]',
  summary: '허브가 이 컴퓨터에서 응답하는지 확인',
  help: '허브의 /healthz 에 물어봐요. --wait 를 주면 응답할 때까지 그 시간만큼 기다려요 (켜거나 다시 시작한 뒤).\n응답하면 0, 아니면 1로 끝나요.',
  spec: { values: ['--wait'] },
  async run(a) {
    const ctx = hub()
    const wait = Number(val(a, '--wait') ?? 0)
    if (!Number.isFinite(wait) || wait < 0 || wait > 600) die('--wait 는 0~600초로 적어 주세요.')
    const url = localUrl(ctx)
    const until = Date.now() + wait * 1000
    for (;;) {
      const h = await probe(url + '/healthz', 2000)
      if (h.ok && h.json?.product === PRODUCT.id) {
        const v = String(h.json.version ?? '?')
        console.log(`허브가 응답해요: ${url} (버전 ${v})${v !== PRODUCT.version ? ` · 설치된 코드는 ${PRODUCT.version}이에요 → trina-ax restart` : ''}`)
        return 0
      }
      if (Date.now() >= until) break
      await sleep(1000)
    }
    console.error(`허브가 ${url} 에서 응답하지 않아요. 로그: trina-ax logs · 켜기: trina-ax start`)
    return 1
  },
}

COMMANDS.init = {
  usage: 'init --username 아이디 [--name 이름] [--company 회사이름]',
  summary: '소유자 계정 만들기 (/setup 대신)',
  help: '웹의 /setup 과 같은 일을 터미널에서 해요. 비밀번호는 입력받거나 표준 입력의 첫 줄에서 읽어요 (인자로 받지 않아요).\n소유자가 이미 있으면 아무것도 하지 않아요.',
  spec: { values: ['--username', '--name', '--company'] },
  async run(a) {
    const ctx = hub()
    if (listUsers(ctx.db).length) die('이미 소유자가 있어요.')
    const username = val(a, '--username') ?? die('--username 이 필요해요.')
    const name = val(a, '--name') ?? username
    const password = await readSecretLine('소유자 비밀번호 (8자 이상): ')
    if (process.stdin.isTTY && password !== await readSecretLine('한 번 더: ')) die('두 비밀번호가 달라요.')
    const owner = await createUser(ctx.db, { username, name, role: 'owner', password })
    const company = val(a, '--company')
    if (company?.trim()) saveSetting(ctx, 'companyName', company.trim().slice(0, 60))
    ctx.secrets.clearSetupToken()
    initTeamFolder(ctx.db, ctx.fx.root)
    audit(ctx.db, { actor: owner.id, action: 'setup', target: owner.id, detail: { via: 'cli', companyName: company ?? null } })
    console.log(`소유자 ${owner.name}(${owner.username})을(를) 만들었어요. ${effectiveUrls(ctx).hubUrl}/login 에서 로그인하세요.`)
  },
}

COMMANDS['set-key'] = {
  usage: 'set-key',
  summary: '회사 Anthropic API 키 넣기 (입력으로만 받아요)',
  help: '키는 화면에 보이지 않게 입력받거나 표준 입력에서 읽어요. 명령 인자로는 받지 않아요 (셸 기록에 남지 않게).\n예: pbpaste | trina-ax set-key\n저장 위치: data/secrets/anthropic-api-key (0600). 확인: trina-ax doctor --live',
  async run() {
    const ctx = hub()
    const key = await readSecretLine('Anthropic API 키: ')
    if (!API_KEY.test(key)) die('키 모양이 이상해요. 공백 없이 그대로 붙여 넣어 주세요.')
    const replaced = !!ctx.secrets.getApiKey()
    ctx.secrets.setApiKey(key)
    audit(ctx.db, { actor: null, action: 'apikey.set', detail: { replaced, via: 'cli' } })
    console.log(`${replaced ? '바꿨어요' : '저장했어요'} (${ctx.secrets.apiKeyHint()}). 잘 되는지 확인: trina-ax doctor --live`)
    if (!key.startsWith('sk-ant-')) console.log('참고: Anthropic 키는 보통 sk-ant- 로 시작해요. 맞는 키인지 확인해 주세요.')
  },
}

COMMANDS['remove-key'] = {
  usage: 'remove-key',
  summary: 'API 키 지우기',
  help: '키를 지우면 새 키를 넣을 때까지 직원들의 Claude가 답하지 않아요.',
  run() {
    const ctx = hub()
    if (!ctx.secrets.getApiKey()) { console.log('지울 키가 없어요.'); return }
    ctx.secrets.setApiKey(null)
    audit(ctx.db, { actor: null, action: 'apikey.remove', detail: { via: 'cli' } })
    console.log('API 키를 지웠어요. 새 키를 넣을 때까지 직원들의 Claude가 답하지 않아요.')
  },
}

COMMANDS['set-url'] = {
  usage: "set-url [--public https://…] [--lan http://…] [--dry-run]",
  summary: 'PC가 쓰는 주소 정하기 (공개 https · 사내)',
  help: "설정 화면의 '주소'와 같은 곳에 저장해요.\n  --public  어디서나 열리는 https 주소 (Cloudflare 터널). 회사 스킬 설치에 필요해요. localhost는 안 돼요.\n  --lan     사무실 안에서 쓰는 주소 (http 가능). 예: http://192.168.0.10:47900\n  ''        빈 값을 주면 지워요 (예: --public '')\n  --dry-run 저장하지 않고 형식만 확인\n옵션 없이 실행하면 지금 주소를 보여 줘요. 직원을 연결하기 전에 정해 두세요 (PC는 연결할 때의 주소를 기억해요).\n적용: trina-ax restart",
  spec: { values: ['--public', '--lan'], bools: ['--dry-run'] },
  run(a) {
    const pub = val(a, '--public'), lan = val(a, '--lan')
    if (pub === undefined && lan === undefined) {
      if (on(a, '--dry-run')) die('확인할 주소를 --public 또는 --lan 으로 적어 주세요.')
      const u = effectiveUrls(hub())
      console.log(`공개 주소  ${u.publicUrl ?? '-'}\n사내 주소  ${u.lanUrl ?? '-'}\nPC 연결    ${u.hubUrl}`)
      return
    }
    const checked = checkUrls({ public: pub, lan })
    if (on(a, '--dry-run')) { console.log('주소 형식이 맞아요.'); return }
    const ctx = hub()
    if ('publicUrl' in checked) saveSetting(ctx, 'publicUrl', checked.publicUrl ?? null)
    if ('lanUrl' in checked) saveSetting(ctx, 'lanUrl', checked.lanUrl ?? null)
    audit(ctx.db, { actor: null, action: 'settings.urls', detail: { ...checked, via: 'cli' } })
    const u = effectiveUrls(ctx)
    console.log(`저장했어요.\n  공개 주소  ${u.publicUrl ?? '-'}\n  사내 주소  ${u.lanUrl ?? '-'}\n  PC 연결    ${u.hubUrl}`)
    for (const w of urlWarnings(u)) console.log(`  ! ${w}`)
    console.log('허브에 적용하려면: trina-ax restart')
  },
}

COMMANDS.users = {
  usage: 'users',
  summary: '사람 목록',
  help: '아이디, 이름, 역할, 상태, 그룹, 연결된 PC 수를 보여 줘요. 바꾸는 일은 웹의 관리 > 사람에서 해요.',
  run() {
    const { db } = hub()
    const users = listUsers(db)
    const pcs = new Map<string, number>()
    for (const t of listTokens(db)) if (!t.revoked_at) pcs.set(t.user_id, (pcs.get(t.user_id) ?? 0) + 1)
    console.log(`${pad('아이디', 18)} ${pad('이름', 14)} ${pad('역할', 8)} ${pad('상태', 12)} ${pad('PC', 4)} 그룹`)
    for (const u of users) {
      const state = u.status === 'disabled' ? '꺼짐' : u.mustChangePassword ? '첫 로그인 전' : '사용 중'
      console.log(`${pad(u.username, 18)} ${pad(u.name, 14)} ${pad(ROLE[u.role] ?? u.role, 8)} ${pad(state, 12)} ${pad(String(pcs.get(u.id) ?? 0), 4)} ${u.groups.map((g) => g.name).join(', ') || '-'}`)
    }
    console.log(`${users.length}명`)
  },
}

COMMANDS['user-add'] = {
  usage: 'user-add 아이디 ["이름"] [--admin] [--email 주소]',
  summary: '사람 추가 (임시 비밀번호가 한 번 나와요)',
  help: '임시 비밀번호는 웹과 같은 모양(xxxx-xxxx-xxxx)이고 지금 한 번만 보여요. 본인에게 직접 전해 주세요.\n처음 로그인하면 새 비밀번호를 정해요. 그룹은 웹의 관리 > 사람에서 정해요.',
  spec: { values: ['--email'], bools: ['--admin'] },
  async run(a) {
    const ctx = hub()
    const username = a.pos[0] ?? die('사용법: trina-ax user-add <아이디> "<이름>" [--admin]')
    const password = tempPassword()
    const role = on(a, '--admin') ? 'admin' : 'member'
    const u = await createUser(ctx.db, { username, name: (a.pos[1] ?? username).slice(0, 40), email: val(a, '--email') ?? null, role, password, mustChangePassword: true })
    ctx.rulesChanged()
    audit(ctx.db, { actor: null, action: 'user.create', target: u.id, detail: { username: u.username, role, via: 'cli' } })
    console.log(`${u.name}(${u.username})님을 ${ROLE[role]}(으)로 추가했어요.`)
    console.log(`  임시 비밀번호  ${password}   (지금만 보여요. 처음 로그인할 때 새 비밀번호로 바꿔요)`)
    console.log(`  로그인 주소    ${effectiveUrls(ctx).hubUrl}/login`)
    console.log(`  PC 연결 코드   trina-ax enroll ${u.username}`)
  },
}

COMMANDS['reset-password'] = {
  usage: 'reset-password 아이디',
  summary: '임시 비밀번호 새로 만들기 (비밀번호를 잊었을 때)',
  help: '새 임시 비밀번호를 한 번 보여 주고, 그 사람의 웹 로그인을 모두 끊어요. 연결된 PC(Claude)는 그대로 돼요.',
  async run(a) {
    const ctx = hub()
    const u = userOrDie(a.pos[0], 'trina-ax reset-password <아이디>')
    const password = tempPassword()
    await setPassword(ctx.db, u.id, password, true)
    ctx.db.query('DELETE FROM sessions WHERE user_id = ?').run(u.id)
    audit(ctx.db, { actor: null, action: 'user.password_reset', target: u.id, detail: { via: 'cli' } })
    console.log(`${u.name}(${u.username}) 임시 비밀번호: ${password}   (지금만 보여요. 로그인하면 새로 정해요)`)
    console.log(`  로그인 주소  ${effectiveUrls(ctx).hubUrl}/login`)
  },
}

COMMANDS.enroll = {
  usage: 'enroll 아이디',
  summary: 'PC 연결 코드 + 설치 명령 만들기',
  help: '24시간 동안 한 번 쓸 수 있는 코드를 만들고, 그 PC의 터미널(Mac)이나 PowerShell(Windows)에 붙여 넣을 한 줄을 보여 줘요.\n관리자가 대신 만든 연결이라, 본인 개인 폴더(users/<아이디>/)는 본인이 웹의 내 페이지에서 승인해야 열려요.',
  run(a) {
    const ctx = hub()
    const u = userOrDie(a.pos[0], 'trina-ax enroll <아이디>')
    if (u.status !== 'active') die('꺼진 계정이에요. 먼저 웹의 관리 > 사람에서 상태를 사용 중으로 바꿔 주세요.')
    const { code, expiresAt } = makeEnrollCode(ctx.db, u.id, null)
    audit(ctx.db, { actor: null, action: 'enroll.create', target: u.id, detail: { via: 'cli' } })
    const urls = effectiveUrls(ctx)
    const cmd = installCommands(urls.hubUrl, code)
    console.log(`${u.name}의 PC 연결 코드: ${code} (${new Date(expiresAt).toLocaleString('ko-KR')}까지, 한 번만)`)
    console.log(`  Mac:     ${cmd.mac}`)
    console.log(`  Windows: ${cmd.windows}`)
    for (const w of urlWarnings(urls)) console.log(`  ! ${w}`)
  },
}

// ---- doctor

type Mark = 'ok' | 'warn' | 'bad'
const MARK: Record<Mark, string> = { ok: '✓', warn: '!', bad: '✗' }

COMMANDS.doctor = {
  usage: 'doctor [--live]',
  summary: '점검: 서버, 키, 주소, claude, 디스크, DB, 팀 폴더',
  help: '하나씩 확인하고 고칠 방법을 알려 줘요. 문제가 있으면 1로 끝나요.\n  --live  Anthropic에 실제로 물어봐서 API 키가 되는지도 확인 (10초 제한, 키는 화면에 나오지 않아요)\n공개 주소는 /healthz 와 함께 /v1, /mcp, /plugins, /install.sh 가 Cloudflare에 막히지 않고 허브까지 오는지 봐요.',
  spec: { bools: ['--live'] },
  async run(a) {
    const ctx = hub()
    const { config, db, secrets } = ctx
    const results: { mark: Mark; what: string; text: string }[] = []
    const add = (mark: Mark, what: string, text: string) => { results.push({ mark, what, text }); console.log(`  ${MARK[mark]} ${pad(what, 12)} ${text}`) }
    console.log(`${PRODUCT.displayName} ${PRODUCT.version} 점검`)

    // server
    const local = localUrl(ctx)
    const h = await probe(local + '/healthz', 3000)
    if (h.ok && h.json?.product === PRODUCT.id) {
      const v = String(h.json.version ?? '?')
      add(v === PRODUCT.version ? 'ok' : 'warn', '서버', v === PRODUCT.version ? `${local} 에서 응답해요` : `응답하지만 돌고 있는 버전(${v})이 설치된 코드(${PRODUCT.version})와 달라요 → trina-ax restart`)
    } else add('bad', '서버', `${local} 에서 응답하지 않아요 → trina-ax start, 안 되면 trina-ax logs`)

    // people
    const users = listUsers(db)
    if (!users.length) add('warn', '소유자', '아직 없어요 → trina-ax status 에 나온 /setup 주소를 여세요')
    else add('ok', '사람', `${users.length}명`)

    // API key
    if (!secrets.getApiKey()) add('bad', 'API 키', '없어요. 직원들의 Claude가 답하지 않아요 → 설정 화면 또는 trina-ax set-key')
    else if (on(a, '--live')) {
      const r = await checkApiKey(ctx)
      add(r.ok ? 'ok' : 'bad', 'API 키', `${secrets.apiKeyHint()} · ${r.message}`)
    } else add('ok', 'API 키', `${secrets.apiKeyHint()} 있어요 (실제로 되는지는 --live)`)

    // addresses
    const u = effectiveUrls(ctx)
    if (!u.publicUrl) add('warn', '공개 주소', '없어요. 회사 스킬이 PC에 설치되지 않고, 사무실 밖에서는 연결이 안 돼요 → docs/OPERATOR.md 의 Cloudflare 터널')
    else {
      const p = await probe(u.publicUrl + '/healthz', 10_000)
      const where = u.publicUrl
      if (!u.publicUrl.startsWith('https://')) add('warn', '공개 주소', `${where} 가 https가 아니에요. 회사 스킬 설치는 https에서만 돼요`)
      if (!p.ok) add('bad', '공개 주소', `${where} 가 ${p.error === 'timeout' ? '10초 안에 답하지 않아요' : '열리지 않아요 (DNS·인터넷 확인)'} → 터널: trina-ax status, trina-ax logs --tunnel`)
      else if (p.json?.product === PRODUCT.id) {
        add('ok', '공개 주소', `${where} 에서 허브가 응답해요`)
        const blocked: string[] = []
        for (const route of ['/v1/models', '/mcp', '/plugins/marketplace.json', '/install.sh']) {
          const r = await probe(u.publicUrl + route, 10_000)
          const html = r.ok && (r.headers.get('content-type') ?? '').includes('text/html')
          if (!r.ok || (r.status >= 300 && r.status < 400) || r.headers.get('cf-mitigated') || html) blocked.push(route)
        }
        if (blocked.length) add('bad', '공개 경로', `${blocked.join(', ')} 가 허브까지 오지 않아요. Cloudflare Access·Bot Fight Mode·WAF 확인을 이 경로들 앞에 두면 안 돼요`)
        else add('ok', '공개 경로', '/v1 /mcp /plugins /install.sh 가 막히지 않고 허브까지 와요')
      } else {
        const st = p.status
        const why = st >= 300 && st < 400 ? '로그인 화면(Cloudflare Access 등)으로 넘어가요. 허브 주소 앞에는 막는 것을 두면 안 돼요'
          : p.headers.get('cf-mitigated') ? 'Cloudflare 보안 확인(Bot Fight Mode·WAF challenge)이 막고 있어요'
          : st === 502 || st === 530
          ? '터널이 허브에 닿지 않아요 (터널 서비스·공개 호스트 이름의 http://localhost:' + config.port + ' 확인)'
          : `허브가 아닌 곳이 답해요 (응답 ${st})`
        add('bad', '공개 주소', `${where}: ${why}`)
      }
    }
    if (u.lanUrl) {
      if (config.host === '127.0.0.1' || config.host === 'localhost') add('warn', '사내 주소', `${u.lanUrl} 이지만 허브가 ${config.host}에서만 들어서 다른 PC는 못 열어요 → install-hub.sh --host 0.0.0.0`)
      else {
        const l = await probe(u.lanUrl + '/healthz', 3000)
        if (l.ok && l.json?.product === PRODUCT.id) add('ok', '사내 주소', `${u.lanUrl} 에서 응답해요`)
        else add('warn', '사내 주소', `${u.lanUrl} 이 이 Mac에서도 안 열려요. 주소가 바뀌었을 수 있어요 → ipconfig getifaddr en0, trina-ax set-url --lan`)
      }
    }

    // claude for hub sessions
    if (!config.claudeBin) add('warn', 'claude', '없어요. 휴대폰 채팅·예약 작업이 꺼져 있어요 → curl -fsSL https://claude.ai/install.sh | bash 후 install-hub.sh 다시 실행')
    else {
      const r = Bun.spawnSync([config.claudeBin, '--version'], { stdout: 'pipe', stderr: 'pipe', timeout: 10_000, env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })
      const v = r.stdout.toString().trim().split('\n')[0]
      if (r.exitCode === 0 && v) add('ok', 'claude', `${v} (${config.claudeBin})`)
      else add('bad', 'claude', `${config.claudeBin} 이 실행되지 않아요 → 다시 설치하고 install-hub.sh 다시 실행`)
    }

    // disk
    const seen = new Set<number>()
    for (const [what, dir] of [['디스크', config.dataDir], ['디스크(팀)', config.teamRoot]] as const) {
      try {
        const dev = fs.statSync(dir).dev
        if (seen.has(dev)) continue
        seen.add(dev)
        const s = fs.statfsSync(dir)
        const free = s.bavail * s.bsize
        add(free < 1024 ** 3 ? 'bad' : free < 5 * 1024 ** 3 ? 'warn' : 'ok', what, `남은 공간 ${fmtGb(free)}${free < 5 * 1024 ** 3 ? ' → 공간을 비워 주세요 (팀 폴더 .trina/trash, 오래된 로그)' : ''}`)
      } catch { add('bad', what, `${dir} 을 읽지 못했어요`) }
    }

    // database
    try {
      const rows = db.query('PRAGMA quick_check').all() as Record<string, string>[]
      const first = rows.map((r) => Object.values(r)[0]).filter((v) => v !== 'ok')
      if (!first.length) {
        const size = fs.statSync(path.join(config.dataDir, 'hub.db')).size
        add('ok', 'DB', `이상 없어요 (${(size / 1024 ** 2).toFixed(1)} MB)`)
      } else add('bad', 'DB', `손상이 보여요: ${String(first[0]).slice(0, 120)} → 백업에서 되살리기 (docs/OPERATOR.md)`)
    } catch (e) { add('bad', 'DB', `검사하지 못했어요: ${(e as Error).message}`) }

    // team folder
    for (const [what, dir] of [['팀 폴더', config.teamRoot], ['버전 보관', path.join(config.teamRoot, PRODUCT.systemDir)]] as const) {
      const probeFile = path.join(dir, `${PRODUCT.tmpPrefix}doctor-${secret(6)}`)
      try { fs.writeFileSync(probeFile, 'ok'); fs.rmSync(probeFile); add('ok', what, `쓸 수 있어요 (${dir})`) }
      catch { try { fs.rmSync(probeFile, { force: true }) } catch {}; add('bad', what, `${dir} 에 쓸 수 없어요 → 폴더 주인·권한 확인 (ls -ld)`) }
    }

    // secrets on disk
    try {
      const mode = fs.statSync(config.dataDir).mode & 0o777
      if (mode & 0o077) add('warn', '권한', `${config.dataDir} 가 ${mode.toString(8)}이에요. 다른 사용자가 읽을 수 있어요 → chmod 700`)
      else add('ok', '권한', `data 폴더 ${mode.toString(8)}`)
    } catch {}

    // the Mac must not sleep
    if (process.platform === 'darwin' && fs.existsSync('/usr/bin/pmset')) {
      const out = Bun.spawnSync(['/usr/bin/pmset', '-g'], { stdout: 'pipe', stderr: 'ignore', timeout: 5000 }).stdout.toString()
      const sleepMin = /^\s*sleep\s+(\d+)/m.exec(out)?.[1]
      const autorestart = /^\s*autorestart\s+(\d+)/m.exec(out)?.[1]
      if (sleepMin && sleepMin !== '0') add('warn', '전원', `${sleepMin}분 동안 쓰지 않으면 Mac이 잠들어요 → sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1`)
      else if (autorestart === '0') add('warn', '전원', '정전 뒤 자동 시동이 꺼져 있어요 → sudo pmset -a autorestart 1')
      else if (sleepMin) add('ok', '전원', '잠자기 꺼짐')
    }

    // logs
    const log = path.join(logsDir(config.dataDir), 'hub.log')
    try {
      const size = fs.statSync(log).size
      if (size > 200 * 1024 ** 2) add('warn', '로그', `hub.log 가 ${(size / 1024 ** 2).toFixed(0)} MB예요. 로그 순환이 안 되는 것 같아요 → install-hub.sh 다시 실행`)
    } catch {}

    const bad = results.filter((r) => r.mark === 'bad').length, warn = results.filter((r) => r.mark === 'warn').length
    console.log(bad || warn ? `\n문제 ${bad}개, 확인할 것 ${warn}개` : '\n모두 괜찮아요.')
    return bad ? 1 : 0
  },
}

// ---- backup

const RESTORE_STEPS = (backup: string, home: string, withTeam: boolean) => [
  `1. 허브 끄기:              trina-ax stop`,
  `2. 지금 데이터 옮겨 두기:  mv ${home}/data ${home}/data.before-restore`,
  `3. 백업 데이터 넣기:       mkdir -m 700 ${home}/data && cp -Rp ${backup}/data/. ${home}/data/`,
  `4. 권한:                   chmod 700 ${home}/data ${home}/data/secrets && chmod 600 ${home}/data/hub.db`,
  withTeam
    ? `5. 팀 폴더 (필요할 때만):  rsync -a ${backup}/team/ ${home}/team/   (지금 팀 폴더 위에 덮어써요. 먼저 옮겨 두면 더 안전해요)`
    : `5. 팀 폴더는 이 백업에 없어요 (--with-team). Time Machine 등에서 ${home}/team 을 되살리세요.`,
  `6. 켜고 점검:              trina-ax start && trina-ax doctor`,
]

COMMANDS.backup = {
  usage: 'backup <폴더> [--with-team]',
  summary: 'DB·키·설정 백업 (허브를 끄지 않고)',
  help: '<폴더>/trina-ax-backup-<날짜시간>/ 을 만들어요 (0700).\n  data/hub.db       DB 전체를 일관된 한 파일로 (SQLite VACUUM INTO, 허브가 돌고 있어도 돼요)\n  data/secrets/     API 키 등 (0600), data/config.json, data/tunnel-token\n  team/             --with-team 일 때 팀 폴더 전체 (rsync, 지운 파일 보관함·이전 버전 포함)\n백업에는 API 키가 들어 있어요. 외장 디스크나 회사 금고처럼 안전한 곳에 두세요. 되살리는 방법도 함께 적어 둬요 (RESTORE.txt).',
  spec: { bools: ['--with-team'] },
  run(a) {
    const target = a.pos[0] ?? die('사용법: trina-ax backup <폴더> [--with-team]')
    const ctx = hub()
    const { config, db } = ctx
    const parent = path.resolve(target)
    fs.mkdirSync(parent, { recursive: true })
    const d = new Date(), two = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
    const dest = path.join(parent, `trina-ax-backup-${stamp}`)
    if (fs.existsSync(dest)) die(`이미 있어요: ${dest}`)
    const home = path.dirname(config.dataDir)
    const inside = (p: string, dir: string) => p === dir || p.startsWith(dir + path.sep)
    const real = fs.realpathSync(parent)
    if (inside(real, fs.realpathSync(config.dataDir)) || inside(real, fs.realpathSync(config.teamRoot))) die('백업 폴더를 data/ 나 team/ 안에 둘 수 없어요.')
    fs.mkdirSync(path.join(dest, 'data'), { recursive: true, mode: 0o700 })
    fs.chmodSync(dest, 0o700)

    const dbCopy = path.join(dest, 'data', 'hub.db')
    db.query('VACUUM INTO ?').run(dbCopy)
    fs.chmodSync(dbCopy, 0o600)
    const check = new Database(dbCopy, { readonly: true })
    const ok = (check.query('PRAGMA quick_check').get() as Record<string, string> | null)
    check.close()
    if (!ok || Object.values(ok)[0] !== 'ok') die(`백업한 DB 검사에 실패했어요: ${dbCopy}`)

    const copied = ['data/hub.db']
    const copyFile = (rel: string) => {
      const from = path.join(config.dataDir, rel)
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) return
      fs.copyFileSync(from, path.join(dest, 'data', rel))
      fs.chmodSync(path.join(dest, 'data', rel), 0o600)
      copied.push(`data/${rel}`)
    }
    const secretsDir = path.join(config.dataDir, 'secrets')
    if (fs.existsSync(secretsDir)) {
      fs.mkdirSync(path.join(dest, 'data', 'secrets'), { mode: 0o700 })
      for (const f of fs.readdirSync(secretsDir)) if (!f.endsWith('.tmp')) copyFile(path.join('secrets', f))
    }
    copyFile('config.json')
    copyFile('tunnel-token')

    const withTeam = on(a, '--with-team')
    if (withTeam) {
      const rsync = which('rsync')
      if (rsync) {
        const r = Bun.spawnSync([rsync, '-a', `${config.teamRoot}/`, `${path.join(dest, 'team')}/`], { stdout: 'ignore', stderr: 'pipe' })
        if (r.exitCode !== 0) die(`팀 폴더 복사에 실패했어요: ${r.stderr.toString().trim().split('\n')[0]}`)
      } else fs.cpSync(config.teamRoot, path.join(dest, 'team'), { recursive: true, preserveTimestamps: true })
      fs.chmodSync(path.join(dest, 'team'), 0o750)
      copied.push('team/')
    }

    const steps = RESTORE_STEPS(dest, home, withTeam)
    fs.writeFileSync(path.join(dest, 'RESTORE.txt'), [
      `Trina AX 백업 ${d.toLocaleString('ko-KR')} · ${PRODUCT.displayName} ${PRODUCT.version}`,
      `원래 위치: ${home}`, `들어 있는 것: ${copied.join(', ')}`,
      '이 백업에는 회사 API 키가 들어 있어요. 안전한 곳에 두세요.', '', '되살리기 (허브 Mac에서):', ...steps, '',
    ].join('\n'), { mode: 0o600 })
    audit(db, { actor: null, action: 'backup', detail: { withTeam, via: 'cli' } })

    console.log(`백업했어요: ${dest}`)
    console.log(`  ${copied.join(', ')}`)
    console.log('  이 백업에는 회사 API 키가 들어 있어요. 안전한 곳에 두세요.')
    console.log('되살리기 (RESTORE.txt 에도 있어요):')
    for (const s of steps) console.log(`  ${s}`)
  },
}

// ---- pricing

/** The same rules the relay applies to the `pricing` setting (it silently skips entries that break them). */
export function checkPricing(v: unknown): PriceEntry[] {
  if (!Array.isArray(v)) die('가격 파일은 JSON 배열이어야 해요: [{ "match": "^claude-…", "input": 3, … }]')
  const rate = (o: any, k: string, where: string) => {
    if (typeof o?.[k] !== 'number' || !Number.isFinite(o[k]) || o[k] < 0) die(`${where}: ${k} 는 0 이상의 숫자(USD / 100만 토큰)여야 해요.`)
  }
  return (v as unknown[]).map((e: any, i) => {
    const where = `${i + 1}번째 항목`
    if (typeof e?.match !== 'string' || !e.match || e.match.length > 200) die(`${where}: match (모델 이름 정규식)가 필요해요.`)
    try { new RegExp(e.match, 'i') } catch { die(`${where}: match 가 정규식이 아니에요: ${e.match}`) }
    for (const k of ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead']) rate(e, k, where)
    if (e.longPrompt !== undefined) {
      if (!Number.isInteger(e.longPrompt?.above) || e.longPrompt.above <= 0) die(`${where}: longPrompt.above 는 양의 정수(토큰 수)여야 해요.`)
      for (const k of ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead']) rate(e.longPrompt, k, `${where} longPrompt`)
    }
    return e as PriceEntry
  })
}

const fmtRates = (e: PriceEntry) => `입력 ${e.input} · 출력 ${e.output} · 캐시 쓰기 ${e.cacheWrite5m}/${e.cacheWrite1h} · 캐시 읽기 ${e.cacheRead}${e.longPrompt ? ` (프롬프트 ${e.longPrompt.above.toLocaleString()} 토큰 넘으면 ${e.longPrompt.input} / ${e.longPrompt.output})` : ''}`

COMMANDS.pricing = {
  usage: 'pricing [show | check <모델> | set <파일.json> | reset]',
  summary: '모델 가격표 보기·바꾸기 (새 모델이 나왔을 때)',
  help: '사용량 화면의 비용은 이 가격표로 계산해요 (USD / 100만 토큰). 기본값은 코드에 들어 있고, 여기서 더한 항목이 먼저 맞춰져요.\n  show            더한 항목과 기본값 보기\n  check <모델>    그 모델에 어떤 가격이 쓰이는지 (예: claude-sonnet-5-5)\n  set <파일>      더할 항목을 JSON 배열로 저장 (전체를 바꿔요). 예:\n                  [{"match":"^claude-sonnet-6(-\\\\d{8})?$","input":3,"output":15,"cacheWrite5m":3.75,"cacheWrite1h":6,"cacheRead":0.3}]\n  reset           더한 항목을 모두 지우고 기본값만 써요\n다시 시작하지 않아도 다음 요청부터 적용돼요. 이미 기록된 비용은 바뀌지 않아요.\n모르는 모델은 가장 비싼 가격으로 계산해요 (싸게 보이지 않게).',
  run(a) {
    const { db } = hub()
    const [sub = 'show', arg] = a.pos
    if (sub === 'show') {
      const extra = getSetting<unknown>(db, 'pricing', [])
      const list = Array.isArray(extra) ? extra as PriceEntry[] : []
      console.log(list.length ? `더한 항목 ${list.length}개 (먼저 맞춰요):` : '더한 항목 없음 (기본값만 써요)')
      for (const e of list) console.log(`  ${e.match}\n    ${fmtRates(e)}`)
      console.log('기본값:')
      for (const e of DEFAULT_PRICES) console.log(`  ${e.match}\n    ${fmtRates(e)}`)
      return
    }
    if (sub === 'check') {
      const model = arg ?? die('사용법: trina-ax pricing check <모델 이름>')
      const entry = priceTable(db).entryFor(model)
      const known = [...(getSetting<unknown[]>(db, 'pricing', []) ?? []), ...DEFAULT_PRICES].some((e: any) => { try { return new RegExp(e.match, 'i').test(model) } catch { return false } })
      console.log(`${model}: ${fmtRates(entry)}${known ? '' : '\n  ! 맞는 항목이 없어서 가장 비싼 가격으로 계산해요 → trina-ax pricing set'}`)
      return
    }
    if (sub === 'set') {
      const file = arg ?? die('사용법: trina-ax pricing set <파일.json>')
      let v: unknown
      try { v = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { return die(`JSON 파일을 읽지 못했어요: ${(e as Error).message}`) }
      const entries = checkPricing(v)
      setSetting(db, 'pricing', entries)
      audit(db, { actor: null, action: 'settings.pricing', detail: { entries: entries.length, via: 'cli' } })
      console.log(`가격표에 ${entries.length}개 항목을 저장했어요. 다음 요청부터 적용돼요.`)
      return
    }
    if (sub === 'reset') {
      setSetting(db, 'pricing', [])
      audit(db, { actor: null, action: 'settings.pricing', detail: { entries: 0, via: 'cli' } })
      console.log('더한 항목을 지웠어요. 기본값만 써요.')
      return
    }
    die(`모르는 하위 명령이에요: ${sub} (show, check, set, reset)`)
  },
}

// ---- single team files: kept versions and the trash (src/files/versions.ts) ------------------------------------

const ownerId = (ctx: Ctx): string => {
  const r = ctx.db.query("SELECT id FROM users WHERE role = 'owner'").get() as { id: string } | null
  return r?.id ?? die('소유자가 아직 없어요. 먼저 /setup 이나 trina-ax init 으로 소유자를 만들어 주세요.')
}

const REASON: Record<string, string> = { overwrite: '덮어쓰기 전', trash: '삭제', move: '옮기기 전' }

COMMANDS.versions = {
  usage: 'versions [경로] [-n 개수]',
  summary: '지워지거나 덮어쓴 파일의 보관본 보기',
  help: '팀 폴더에서 지운 파일(휴지통)과 덮어쓰기 전 파일을 최근 것부터 보여 줘요. 90일이 지나면 정리돼요.\n  경로    이 경로로 시작하는 것만 (예: shared/견적)\n  -n 50   보여 줄 개수\n되살리기: trina-ax restore <번호>',
  spec: { values: ['-n'] },
  run(a) {
    const ctx = hub()
    const rows = listVersions(ctx, { path: a.pos[0], limit: Number(a.opts.get('-n') ?? 50) || 50 })
    if (!rows.length) { console.log('보관본이 없어요.'); return }
    for (const r of rows) {
      const when = new Date(r.createdAt).toLocaleString('ko-KR')
      console.log(`${r.id}  ${when}  ${REASON[r.reason] ?? r.reason}  ${r.path}  (${r.size.toLocaleString()} B${r.userName ? ', ' + r.userName : ''})${r.stored ? '' : '  ! 보관본이 없어졌어요'}`)
    }
    console.log('\n되살리기: trina-ax restore <번호> [--to 다른/경로]')
  },
}

COMMANDS.restore = {
  usage: 'restore <번호> [--to 경로]',
  summary: '보관본 하나 되살리기',
  help: '`trina-ax versions` 의 번호로 파일을 원래 자리에 되살려요. 지금 그 자리에 파일이 있으면 그 파일도 보관본으로 남긴 뒤 바꿔요.\n  --to 경로   다른 자리에 되살리기 (팀 폴더 안 경로)\n관리자 화면의 되살리기 페이지와 같아요.',
  spec: { values: ['--to'] },
  run(a) {
    const ctx = hub()
    const id = a.pos[0] ?? die('사용법: trina-ax restore <번호> [--to 경로]  (번호는 trina-ax versions 로 찾아요)')
    const to = a.opts.get('--to')
    try {
      const r = restoreVersion(ctx, id, ownerId(ctx), typeof to === 'string' ? { to } : {})
      audit(ctx.db, { actor: null, action: 'file.restore', target: r.path, detail: { version: id, via: 'cli' } })
      console.log(`되살렸어요: ${r.path}`)
    } catch (e) {
      die((e as Error).message)
    }
  },
}

COMMANDS.logs = {
  usage: 'logs [-f] [-n 줄수] [--tunnel]',
  summary: '허브 로그 보기 (-f: 계속 보기)',
  help: '<home>/logs/hub.log 의 마지막 줄들을 보여 줘요 (JSON 한 줄씩). --tunnel 은 Cloudflare 터널 로그.\n  -f      새 줄을 계속 보여 줘요 (Ctrl+C로 끝)\n  -n 200  보여 줄 줄 수\nLinux(systemd)에서는 journalctl -u trina-ax 를 보여 줘요. 로그에는 토큰·키·파일 내용이 들어가지 않아요.',
  spec: { values: ['-n'], bools: ['-f', '--follow', '--tunnel'] },
  async run(a) {
    const lines = val(a, '-n') ?? '200'
    if (!/^\d{1,6}$/.test(lines)) die('-n 은 줄 수(숫자)로 적어 주세요.')
    const follow = on(a, '-f') || on(a, '--follow')
    const config = loadConfig()
    const file = path.join(logsDir(config.dataDir), on(a, '--tunnel') ? 'tunnel.log' : 'hub.log')
    let cmd: string[]
    if (fs.existsSync(file)) cmd = ['tail', '-n', lines, ...(follow ? ['-F'] : []), file]
    else if (process.platform === 'linux' && which('journalctl')) {
      cmd = ['journalctl', '-u', on(a, '--tunnel') ? 'cloudflared' : 'trina-ax', '-n', lines, '--no-pager', '-o', 'cat', ...(follow ? ['-f'] : [])]
    } else return die(`로그 파일이 없어요: ${file}`)
    const p = Bun.spawn(cmd, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
    process.on('SIGINT', () => { try { p.kill('SIGINT') } catch {} })
    return await p.exited
  },
}

COMMANDS.help = {
  usage: 'help [명령]',
  summary: '도움말',
  help: '명령 목록, 또는 한 명령의 자세한 설명을 보여 줘요. 각 명령 뒤에 --help 를 붙여도 돼요.',
  run(a) {
    const name = a.pos[0]
    if (name) {
      const c = COMMANDS[name]
      if (c) { console.log(`trina-ax ${c.usage}\n  ${c.summary}\n\n${c.help}`); return }
      if (SERVICE[name]) { console.log(`trina-ax ${name} [hub|tunnel]\n  ${SERVICE[name]}\n\n설치된 trina-ax 명령(install-hub.sh가 만든 ~/TrinaAX/bin/trina-ax)에서 써요. 기본은 허브와 터널 둘 다예요.`); return }
      return die(`모르는 명령이에요: ${name}`)
    }
    console.log(`${PRODUCT.displayName} ${PRODUCT.version} 관리 명령\n\n사용법: trina-ax <명령> [옵션]   ·   자세히: trina-ax help <명령>\n`)
    console.log('서비스 (설치된 trina-ax 명령)')
    for (const [n, s] of Object.entries(SERVICE)) console.log(`  ${pad(n, 16)} ${s}`)
    console.log(`  ${pad('status', 16)} ${COMMANDS.status!.summary}`)
    console.log(`  ${pad('logs', 16)} ${COMMANDS.logs!.summary}`)
    console.log('\n관리')
    for (const [n, c] of Object.entries(COMMANDS)) if (!['status', 'logs', 'help'].includes(n)) console.log(`  ${pad(n, 16)} ${c.summary}`)
  },
}

export async function main(argv: string[]): Promise<number> {
  const [name = 'help', ...rest] = argv
  if (name === '--help' || name === '-h') return main(['help', ...rest])
  if (SERVICE[name]) die(`'${name}' 은 설치된 trina-ax 명령에서 써요 (install-hub.sh가 만든 ~/TrinaAX/bin/trina-ax ${name}).`)
  const c = COMMANDS[name] ?? die(`모르는 명령이에요: ${name}  (목록: trina-ax help)`)
  const a = parseArgs(rest, c.spec ?? {})
  if (on(a, '--help') || on(a, '-h')) return main(['help', name])
  return (await c.run(a)) ?? 0
}

if (import.meta.main) {
  let code = 1
  try {
    code = await main(process.argv.slice(2))
  } catch (e) {
    if (e instanceof HttpError || e instanceof CliError) console.error(e.message)
    else console.error(`오류: ${(e as Error)?.message ?? String(e)}`)
    if (process.env.TRINA_AX_DEBUG && e instanceof Error) console.error(e.stack)
    code = 1
  } finally {
    closeHub()
  }
  process.exit(code)
}
