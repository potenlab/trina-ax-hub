#!/usr/bin/env bun
// 새 고객 허브의 공개 주소 <회사>.trina.app 을 만들고 관리해요. TreeSoop 운영자 컴퓨터에서 실행해요 (고객 Mac 아님).
//
//   bun deploy/cloudflare/customer-address.ts new <회사> [--port 47900] [--out DIR]
//   bun deploy/cloudflare/customer-address.ts list
//   bun deploy/cloudflare/customer-address.ts check <회사>
//   bun deploy/cloudflare/customer-address.ts token <회사> [--out DIR]
//   bun deploy/cloudflare/customer-address.ts remove <회사> --yes
//
// 공통 옵션
//   --domain D          기본 trina.app
//   --cf-token-file F   Cloudflare API 토큰 파일. 없으면 CLOUDFLARE_API_TOKEN, 그다음 ~/.config/trina-ax/cloudflare-token
//
// 토큰 권한: Zone · Zone · Read 와 Zone · DNS · Edit (그 도메인), Account · Cloudflare Tunnel · Edit
//
// new 가 하는 일
//   1. 이름 확인: 영문 소문자·숫자·하이픈 2~40자. 예약어(www, console, drive …)와 이미 있는 DNS 이름은 거절
//   2. 터널 trina-ax-<회사> (설정은 Cloudflare 쪽에 둬요): https://<회사>.<domain> → 허브 http://127.0.0.1:<port>
//   3. DNS CNAME <회사>.<domain> → <터널>.cfargotunnel.com (Cloudflare 프록시). *.trina.app 은 Universal SSL 이
//      덮어요. 한 단계만 덮어서 acme.ax.trina.app 같은 두 단계 이름은 쓰지 않아요
//   4. 터널 토큰을 <out>/<회사>-tunnel-token.txt (0600) 에 저장. 화면에는 찍지 않아요
// 다시 실행해도 안전해요: 있는 터널·DNS 는 그대로 쓰고 없는 것만 만들어요.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const DEFAULT_DOMAIN = 'trina.app'
export const DEFAULT_PORT = 47900
export const TUNNEL_PREFIX = 'trina-ax-'
const API = 'https://api.cloudflare.com/client/v4'

/** Names a customer can't take: ours today (DNS of trina.app on 2026-10-25), ours likely tomorrow, and mail/infra names. */
export const RESERVED = new Set([
  // in use on trina.app
  'www', 'console', 'drive', 'local', 'staging', 'send', 'cloud', 'ax-demo',
  // products and pages
  'ax', 'geo', 'marketing', 'hub', 'app', 'apps', 'api', 'admin', 'dashboard', 'demo', 'docs', 'doc', 'help', 'support',
  'status', 'blog', 'news', 'about', 'contact', 'careers', 'jobs', 'partner', 'partners', 'pricing', 'billing', 'pay',
  'shop', 'store', 'legal', 'privacy', 'terms', 'security', 'trust', 'install', 'setup', 'connect', 'login', 'signin',
  'sign-in', 'signup', 'auth', 'sso', 'id', 'account', 'accounts', 'my', 'me', 'manual', 'case-study', 'solutions',
  // environments
  'dev', 'test', 'tests', 'qa', 'stage', 'preview', 'beta', 'alpha', 'sandbox', 'prod', 'production', 'internal',
  // infra and mail
  'cdn', 'static', 'assets', 'img', 'images', 'media', 'files', 'upload', 'uploads', 'mail', 'email', 'smtp', 'imap',
  'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns', 'ftp', 'vpn', 'git', 'ci', 'autodiscover', 'autoconfig', 'webmail',
  'postmaster', 'hostmaster', 'webmaster', 'abuse', 'root', 'm', 'mobile', 'ko', 'en',
  // brand
  'trina', 'treesoop', 'potenlab', 'claude', 'anthropic',
])

export class AddressError extends Error {}

/** Lowercases and checks a customer name; returns it or throws AddressError with what to do instead. */
export function checkSlug(raw: string): string {
  const s = (raw ?? '').trim().toLowerCase()
  const example = '영문 소문자·숫자·하이픈으로 2~40자 적어 주세요 (예: jdr, acme-korea).'
  if (!s) throw new AddressError(`회사 이름이 비었어요. ${example}`)
  if (!/^[a-z0-9-]+$/.test(s)) throw new AddressError(`"${raw}" 은 주소로 쓸 수 없어요. ${example}`)
  if (s.length < 2 || s.length > 40) throw new AddressError(`"${s}" 은 길이가 맞지 않아요. ${example}`)
  if (s.startsWith('-') || s.endsWith('-')) throw new AddressError(`"${s}" 은 하이픈으로 시작하거나 끝날 수 없어요.`)
  if (s.includes('--')) throw new AddressError(`"${s}" 처럼 하이픈을 두 번 잇는 이름은 쓰지 않아요 (xn-- 같은 특수 주소와 헷갈려요).`)
  if (RESERVED.has(s)) throw new AddressError(`"${s}" 은 트리나가 쓰거나 쓸 이름이라 고객 주소로 줄 수 없어요. 회사 이름을 그대로 써 주세요.`)
  return s
}

// Cloudflare API ---------------------------------------------------------------------------------------------------

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>
type CfError = { code: number; message: string }
type Zone = { id: string; name: string; account: { id: string } }
type DnsRecord = { id: string; type: string; name: string; content: string; proxied?: boolean }
type Tunnel = { id: string; name: string; status?: string; connections?: unknown[] }
type Ingress = { hostname?: string; service: string }
type TunnelConfig = { config?: { ingress?: Ingress[] } | null }

export class Cloudflare {
  constructor(private readonly token: string, private readonly fetchFn: FetchFn = fetch, private readonly base = API) {}

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const where = `${method} ${path.split('?')[0]}`
    let res: Response
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (e) {
      throw new AddressError(`Cloudflare에 연결하지 못했어요 (${where}): ${(e as Error).message}`)
    }
    let d: { success?: boolean; errors?: CfError[]; result?: T }
    try { d = (await res.json()) as typeof d } catch { throw new AddressError(`Cloudflare 응답을 읽지 못했어요 (HTTP ${res.status}, ${where})`) }
    if (!d.success) throw new AddressError(explain(where, path, res.status, d.errors ?? []))
    return d.result as T
  }
}

function explain(where: string, path: string, status: number, errors: CfError[]): string {
  const what = errors.map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${status}`
  const denied = status === 401 || status === 403 || errors.some((e) => e.code === 10000 || e.code === 9109)
  if (!denied) return `Cloudflare 요청이 실패했어요 (${where}): ${what}`
  const need = path.includes('/dns_records') ? 'Zone · DNS · Edit' : path.includes('/cfd_tunnel') ? 'Account · Cloudflare Tunnel · Edit' : 'Zone · Zone · Read'
  return `Cloudflare 토큰에 권한이 없어요. 토큰에 ${need} 를 더해 주세요 (${where}: ${what}). 권한은 몇 분 뒤에 반영되기도 해요.`
}

export type Env = { cf: Cloudflare; domain: string; log: (line: string) => void }

const enc = encodeURIComponent
const tunnelTarget = (t: Tunnel) => `${t.id}.cfargotunnel.com`

async function zoneOf(env: Env): Promise<Zone> {
  const zones = await env.cf.call<Zone[]>('GET', `/zones?name=${enc(env.domain)}`)
  const z = zones.find((x) => x.name === env.domain)
  if (!z) throw new AddressError(`이 토큰으로는 ${env.domain} 영역이 보이지 않아요. 토큰의 Zone 권한에 ${env.domain} 이 들어 있는지 확인해 주세요.`)
  return z
}

const recordsNamed = (env: Env, zone: Zone, fqdn: string) =>
  env.cf.call<DnsRecord[]>('GET', `/zones/${zone.id}/dns_records?name=${enc(fqdn)}&per_page=100`)

async function tunnelNamed(env: Env, account: string, name: string): Promise<Tunnel | null> {
  const list = await env.cf.call<Tunnel[]>('GET', `/accounts/${account}/cfd_tunnel?name=${enc(name)}&is_deleted=false`)
  return list.find((t) => t.name === name) ?? null
}

async function ingressOf(env: Env, account: string, tunnel: Tunnel): Promise<Ingress[]> {
  const c = await env.cf.call<TunnelConfig>('GET', `/accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`)
  return c?.config?.ingress ?? []
}

const hostsOf = (ingress: Ingress[]) => ingress.map((r) => r.hostname).filter((h): h is string => Boolean(h))

/** Our record = exactly one CNAME for the name, pointing at this tunnel. */
const isOurs = (records: DnsRecord[], tunnel: Tunnel | null) =>
  Boolean(tunnel) && records.length === 1 && records[0]!.type === 'CNAME' && records[0]!.content === tunnelTarget(tunnel!)

function secret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
}

async function saveToken(env: Env, account: string, tunnel: Tunnel, slug: string, outDir: string): Promise<string> {
  const token = await env.cf.call<string>('GET', `/accounts/${account}/cfd_tunnel/${tunnel.id}/token`)
  if (typeof token !== 'string' || token.length < 20) throw new AddressError('Cloudflare가 터널 토큰을 주지 않았어요. 잠시 뒤 token 명령으로 다시 받아 주세요.')
  mkdirSync(outDir, { recursive: true })
  const file = resolve(outDir, `${slug}-tunnel-token.txt`)
  writeFileSync(file, token + '\n', { mode: 0o600 })
  chmodSync(file, 0o600)
  env.log(`터널 토큰을 저장했어요: ${file} (0600. 토큰은 화면에 보여 주지 않아요)`)
  return file
}

// commands ---------------------------------------------------------------------------------------------------------

export type Created = { url: string; tunnelId: string; tokenFile: string; made: { tunnel: boolean; route: boolean; dns: boolean } }

export async function createAddress(env: Env, rawSlug: string, opts: { port?: number; outDir: string }): Promise<Created> {
  const slug = checkSlug(rawSlug)
  const fqdn = `${slug}.${env.domain}`
  const zone = await zoneOf(env)
  const account = zone.account.id
  const name = TUNNEL_PREFIX + slug
  const records = await recordsNamed(env, zone, fqdn)
  let tunnel = await tunnelNamed(env, account, name)

  if (records.length && !isOurs(records, tunnel)) {
    throw new AddressError(`${fqdn} 은 이미 쓰고 있는 이름이에요 (${records.map((r) => r.type).join(', ')}). 다른 이름을 골라 주세요.`)
  }

  const made = { tunnel: false, route: false, dns: false }
  let ingress: Ingress[] = []
  if (tunnel) {
    ingress = await ingressOf(env, account, tunnel)
    const others = hostsOf(ingress).filter((h) => h !== fqdn)
    if (others.length) throw new AddressError(`터널 ${name} 은 이미 다른 주소(${others.join(', ')})에 쓰이고 있어요. 손대지 않았어요.`)
    env.log(`터널이 이미 있어요: ${name} (그대로 써요)`)
  } else {
    tunnel = await env.cf.call<Tunnel>('POST', `/accounts/${account}/cfd_tunnel`, { name, config_src: 'cloudflare', tunnel_secret: secret() })
    made.tunnel = true
    env.log(`터널을 만들었어요: ${name}`)
  }

  const current = ingress.find((r) => r.hostname === fqdn)
  const port = opts.port ?? (current ? Number(new URL(current.service).port) || DEFAULT_PORT : DEFAULT_PORT)
  const service = `http://127.0.0.1:${port}`
  if (current?.service === service && ingress.at(-1)?.service === 'http_status:404') {
    env.log(`터널 경로가 이미 있어요: https://${fqdn} → 허브 ${service}`)
  } else {
    await env.cf.call('PUT', `/accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`, {
      config: { ingress: [{ hostname: fqdn, service }, { service: 'http_status:404' }] },
    })
    made.route = true
    env.log(`터널 경로: https://${fqdn} → 허브 ${service}`)
  }

  if (records.length) {
    env.log(`DNS가 이미 있어요: ${fqdn}`)
  } else {
    await env.cf.call('POST', `/zones/${zone.id}/dns_records`, {
      type: 'CNAME', name: fqdn, content: tunnelTarget(tunnel), proxied: true, comment: `Trina AX hub (${slug})`,
    })
    made.dns = true
    env.log(`DNS를 만들었어요: ${fqdn} → 터널 (Cloudflare 프록시)`)
  }

  const tokenFile = await saveToken(env, account, tunnel, slug, opts.outDir)
  return { url: `https://${fqdn}`, tunnelId: tunnel.id, tokenFile, made }
}

export async function issueToken(env: Env, rawSlug: string, outDir: string): Promise<string> {
  const slug = checkSlug(rawSlug)
  const zone = await zoneOf(env)
  const tunnel = await tunnelNamed(env, zone.account.id, TUNNEL_PREFIX + slug)
  if (!tunnel) throw new AddressError(`${slug} 의 터널이 없어요. 먼저 new ${slug} 를 실행해 주세요.`)
  return saveToken(env, zone.account.id, tunnel, slug, outDir)
}

const STATUS: Record<string, string> = {
  healthy: '켜짐', degraded: '불안정', down: '꺼짐', inactive: '아직 연결 전 (허브에 토큰을 설치하지 않았어요)',
}

export type Row = { tunnel: string; status: string; connections: number; hosts: string[] }

export async function listAddresses(env: Env): Promise<Row[]> {
  const zone = await zoneOf(env)
  const account = zone.account.id
  const tunnels = (await env.cf.call<Tunnel[]>('GET', `/accounts/${account}/cfd_tunnel?is_deleted=false&per_page=100`))
    .filter((t) => t.name.startsWith(TUNNEL_PREFIX))
    .sort((a, b) => a.name.localeCompare(b.name))
  const rows: Row[] = []
  for (const t of tunnels) {
    const hosts = hostsOf(await ingressOf(env, account, t).catch(() => []))
    rows.push({ tunnel: t.name, status: t.status ?? 'unknown', connections: t.connections?.length ?? 0, hosts })
  }
  if (!rows.length) env.log('아직 만든 고객 주소가 없어요.')
  for (const r of rows) {
    env.log(`${(r.hosts.map((h) => 'https://' + h).join(', ') || '(주소 없음)').padEnd(36)} ${r.tunnel}  ${STATUS[r.status] ?? r.status}${r.connections ? ` · 연결 ${r.connections}` : ''}`)
  }
  return rows
}

export type Probe = (url: string) => Promise<number | string>

const defaultProbe: Probe = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'manual' })
    return r.status
  } catch (e) {
    return (e as Error).message
  }
}

export async function checkAddress(env: Env, rawSlug: string, probe: Probe = defaultProbe): Promise<boolean> {
  const slug = checkSlug(rawSlug)
  const fqdn = `${slug}.${env.domain}`
  const zone = await zoneOf(env)
  const account = zone.account.id
  const tunnel = await tunnelNamed(env, account, TUNNEL_PREFIX + slug)
  const records = await recordsNamed(env, zone, fqdn)
  let ok = true
  const line = (good: boolean, text: string) => { ok &&= good; env.log(`${good ? '✓' : '✗'} ${text}`) }

  line(Boolean(tunnel), tunnel ? `터널 ${tunnel.name}` : `터널 ${TUNNEL_PREFIX + slug} 이 없어요 → new ${slug}`)
  line(isOurs(records, tunnel), isOurs(records, tunnel)
    ? `DNS ${fqdn} → 터널`
    : records.length ? `DNS ${fqdn} 이 이 터널을 가리키지 않아요 (${records.map((r) => `${r.type} ${r.content}`).join(', ')})` : `DNS ${fqdn} 이 없어요 → new ${slug}`)
  if (!tunnel) return false

  const ingress = await ingressOf(env, account, tunnel)
  const route = ingress.find((r) => r.hostname === fqdn)
  line(Boolean(route), route ? `터널 경로 https://${fqdn} → ${route.service}` : `터널 경로에 ${fqdn} 이 없어요 → new ${slug}`)

  const status = tunnel.status ?? 'unknown'
  line(status === 'healthy', `터널 상태: ${STATUS[status] ?? status}${tunnel.connections?.length ? ` · 연결 ${tunnel.connections.length}` : ''}`)

  const h = await probe(`https://${fqdn}/healthz`)
  line(h === 200, h === 200 ? `https://${fqdn}/healthz 응답 200` : `https://${fqdn}/healthz → ${h}` +
    (typeof h === 'string' ? ' (방금 만든 주소면 DNS가 퍼지는 데 몇 분 걸릴 수 있어요)' : h === 530 || h === 502 ? ' (허브나 터널 서비스가 꺼져 있어요: 허브 Mac에서 trina-ax status)' : ''))
  return ok
}

export async function removeAddress(env: Env, rawSlug: string, yes: boolean): Promise<void> {
  const slug = checkSlug(rawSlug)
  const fqdn = `${slug}.${env.domain}`
  const zone = await zoneOf(env)
  const account = zone.account.id
  const tunnel = await tunnelNamed(env, account, TUNNEL_PREFIX + slug)
  const records = await recordsNamed(env, zone, fqdn)
  if (records.length && !isOurs(records, tunnel)) {
    throw new AddressError(`${fqdn} 의 DNS가 ${TUNNEL_PREFIX + slug} 터널을 가리키지 않아요. 다른 곳에서 쓰는 이름일 수 있어 지우지 않았어요.`)
  }
  if (tunnel) {
    const others = hostsOf(await ingressOf(env, account, tunnel)).filter((h) => h !== fqdn)
    if (others.length) throw new AddressError(`터널 ${tunnel.name} 은 다른 주소(${others.join(', ')})도 쓰고 있어요. 지우지 않았어요.`)
  }
  if (!tunnel && !records.length) { env.log(`${fqdn} 은 이미 없어요.`); return }

  const plan = [records.length ? `DNS ${fqdn}` : '', tunnel ? `터널 ${tunnel.name}` : ''].filter(Boolean).join(', ')
  if (!yes) throw new AddressError(`지울 것: ${plan}. 이 주소로 연결된 PC와 Claude 커넥터가 모두 끊겨요. 정말 지우려면 --yes 를 붙여 주세요.`)

  for (const r of records) await env.cf.call('DELETE', `/zones/${zone.id}/dns_records/${r.id}`)
  if (records.length) env.log(`DNS를 지웠어요: ${fqdn}`)
  if (tunnel) {
    await env.cf.call('DELETE', `/accounts/${account}/cfd_tunnel/${tunnel.id}/connections`)
    await env.cf.call('DELETE', `/accounts/${account}/cfd_tunnel/${tunnel.id}`)
    env.log(`터널을 지웠어요: ${tunnel.name}`)
  }
  env.log('허브 Mac 쪽 터널 서비스는 거기서 지워요: bash deploy/macos/install-hub.sh --no-tunnel')
}

// CLI --------------------------------------------------------------------------------------------------------------

export function loadCfToken(file: string | undefined, env: Record<string, string | undefined> = process.env, home = homedir()): string {
  const read = (f: string) => {
    if (!existsSync(f)) throw new AddressError(`Cloudflare 토큰 파일이 없어요: ${f}`)
    const t = readFileSync(f, 'utf8').trim()
    if (!t) throw new AddressError(`Cloudflare 토큰 파일이 비었어요: ${f}`)
    return t
  }
  if (file) return read(file)
  const fromEnv = env.CLOUDFLARE_API_TOKEN?.trim()
  if (fromEnv) return fromEnv
  const def = join(home, '.config', 'trina-ax', 'cloudflare-token')
  if (existsSync(def)) return read(def)
  throw new AddressError('Cloudflare API 토큰이 없어요. --cf-token-file 로 알려 주거나 CLOUDFLARE_API_TOKEN 을 설정해 주세요 (기본 위치: ~/.config/trina-ax/cloudflare-token).')
}

const USAGE = `쓰는 법
  bun deploy/cloudflare/customer-address.ts new <회사> [--port 47900] [--out DIR]   주소·터널을 만들고 토큰 파일 저장
  bun deploy/cloudflare/customer-address.ts list                                     만든 고객 주소와 터널 상태
  bun deploy/cloudflare/customer-address.ts check <회사>                              DNS·터널·허브 응답 확인
  bun deploy/cloudflare/customer-address.ts token <회사> [--out DIR]                  터널 토큰 파일 다시 받기
  bun deploy/cloudflare/customer-address.ts remove <회사> --yes                       주소와 터널 지우기
공통: --domain trina.app · --cf-token-file FILE (없으면 CLOUDFLARE_API_TOKEN, ~/.config/trina-ax/cloudflare-token)`

export async function main(argv: string[], io: { log: (s: string) => void; err: (s: string) => void; fetchFn?: FetchFn; probe?: Probe; env?: Record<string, string | undefined>; home?: string } = { log: console.log, err: console.error }): Promise<number> {
  const args: string[] = []
  const opt: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--yes' || a === '-y') opt.yes = true
    else if (a === '-h' || a === '--help') opt.help = true
    else if (a.startsWith('--')) {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) { io.err(`${a} 다음에 값을 적어 주세요.`); return 2 }
      opt[a.slice(2)] = v
      i++
    } else args.push(a)
  }
  const [cmd, slug] = args
  if (opt.help || !cmd) { io.log(USAGE); return cmd || opt.help ? 0 : 2 }
  const known = new Set(['domain', 'cf-token-file', 'port', 'out', 'yes', 'help'])
  const unknown = Object.keys(opt).filter((k) => !known.has(k))
  if (unknown.length) { io.err(`모르는 옵션이에요: --${unknown[0]}\n${USAGE}`); return 2 }
  if (cmd !== 'list' && !slug) { io.err(`${cmd} 다음에 회사 이름을 적어 주세요 (예: ${cmd} jdr).`); return 2 }

  try {
    let port: number | undefined
    if (typeof opt.port === 'string') {
      port = Number(opt.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AddressError('--port 는 1~65535 사이 숫자로 적어 주세요.')
    }
    const domain = typeof opt.domain === 'string' ? opt.domain.toLowerCase() : DEFAULT_DOMAIN
    const outDir = typeof opt.out === 'string' ? opt.out : process.cwd()
    const env: Env = { cf: new Cloudflare(loadCfToken(opt['cf-token-file'] as string | undefined, io.env, io.home), io.fetchFn), domain, log: io.log }

    switch (cmd) {
      case 'new': {
        const r = await createAddress(env, slug!, { port, outDir })
        io.log('')
        io.log(`고객 주소: ${r.url}`)
        io.log('다음 순서 (고객 허브 Mac에서):')
        io.log(`  1. 토큰 파일을 허브 Mac으로 옮겨요: scp ${r.tokenFile} <허브 Mac>:~/tunnel-token.txt`)
        io.log(`  2. bash ~/src/trina-ax/deploy/macos/install-hub.sh --tunnel-token-file ~/tunnel-token.txt --public-url ${r.url}`)
        io.log('  3. rm ~/tunnel-token.txt   (토큰은 허브의 data/tunnel-token 에 저장돼요. 이 컴퓨터의 파일도 지워요)')
        io.log(`  4. 여기서 확인: bun deploy/cloudflare/customer-address.ts check ${checkSlug(slug!)}  → 모두 ✓ 이면 직원 연결`)
        return 0
      }
      case 'token': await issueToken(env, slug!, outDir); return 0
      case 'list': await listAddresses(env); return 0
      case 'check': return (await checkAddress(env, slug!, io.probe)) ? 0 : 1
      case 'remove': await removeAddress(env, slug!, opt.yes === true); return 0
      default: io.err(`모르는 명령이에요: ${cmd}\n${USAGE}`); return 2
    }
  } catch (e) {
    if (e instanceof AddressError) { io.err(e.message); return 1 }
    throw e
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
