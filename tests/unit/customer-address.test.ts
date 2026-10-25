// deploy/cloudflare/customer-address.ts against an in-memory Cloudflare (no network).
import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  AddressError, Cloudflare, RESERVED, checkSlug, loadCfToken, main, type Env, createAddress, removeAddress,
} from '../../deploy/cloudflare/customer-address'

const CF_API_TOKEN = 'cf-api-token-SECRET-123'
const TUNNEL_TOKEN = (id: string) => `eyJTUNNEL-SECRET-${id}-${'x'.repeat(24)}`

type Rec = { id: string; type: string; name: string; content: string; proxied?: boolean; comment?: string }
type Tun = { id: string; name: string; status: string; connections: unknown[] }

class FakeCloudflare {
  zones = [{ id: 'z1', name: 'trina.app', account: { id: 'a1' } }]
  dns: Rec[] = [
    { id: 'd-www', type: 'CNAME', name: 'www.trina.app', content: 'cname.vercel-dns.com' },
    { id: 'd-shop', type: 'A', name: 'acmeshop.trina.app', content: '76.76.21.21' },
  ]
  tunnels: Tun[] = []
  configs = new Map<string, { ingress: { hostname?: string; service: string }[] }>()
  calls: string[] = []
  denied = new Set<string>()
  n = 0

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    expect(String((init.headers as Record<string, string>).authorization)).toBe(`Bearer ${CF_API_TOKEN}`)
    const u = new URL(url)
    const p = u.pathname.replace('/client/v4', '')
    const m = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    this.calls.push(`${m} ${p}`)
    const ok = (result: unknown) => Response.json({ success: true, errors: [], result })
    const fail = (status: number, code: number, message: string) => Response.json({ success: false, errors: [{ code, message }], result: null }, { status })
    for (const d of this.denied) if (p.includes(d)) return fail(403, 10000, 'Authentication error')
    let r: RegExpMatchArray | null
    if (m === 'GET' && p === '/zones') return ok(this.zones.filter((z) => z.name === u.searchParams.get('name')))
    if ((r = p.match(/^\/zones\/z1\/dns_records(?:\/([^/]+))?$/))) {
      if (m === 'GET') return ok(this.dns.filter((d) => d.name === u.searchParams.get('name')))
      if (m === 'POST') { const rec = { id: `d${++this.n}`, ...body }; this.dns.push(rec); return ok(rec) }
      if (m === 'DELETE') { this.dns = this.dns.filter((d) => d.id !== r![1]); return ok({ id: r![1] }) }
    }
    if ((r = p.match(/^\/accounts\/a1\/cfd_tunnel(?:\/([^/]+))?(?:\/(configurations|token|connections))?$/))) {
      const [, id, sub] = r
      const t = this.tunnels.find((x) => x.id === id)
      if (!id && m === 'GET') {
        const name = u.searchParams.get('name')
        return ok(this.tunnels.filter((x) => !name || x.name === name))
      }
      if (!id && m === 'POST') {
        expect(body.config_src).toBe('cloudflare')
        expect(String(body.tunnel_secret).length).toBeGreaterThanOrEqual(40)
        const tun = { id: `tun${++this.n}`, name: body.name, status: 'inactive', connections: [] }
        this.tunnels.push(tun)
        return ok(tun)
      }
      if (!t) return fail(404, 1003, 'tunnel not found')
      if (sub === 'configurations' && m === 'GET') return ok({ config: this.configs.get(t.id) ?? null })
      if (sub === 'configurations' && m === 'PUT') { this.configs.set(t.id, body.config); return ok({ config: body.config }) }
      if (sub === 'token' && m === 'GET') return ok(TUNNEL_TOKEN(t.id))
      if (sub === 'connections' && m === 'DELETE') { t.connections = []; return ok(null) }
      if (!sub && m === 'DELETE') { this.tunnels = this.tunnels.filter((x) => x !== t); this.configs.delete(t.id); return ok(t) }
    }
    return fail(404, 7003, `no route ${m} ${p}`)
  }

  writes = () => this.calls.filter((c) => !c.startsWith('GET'))
}

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'trina-addr-')); dirs.push(d); return d }

function run(fake: FakeCloudflare, argv: string[], extra: { probe?: (u: string) => Promise<number | string> } = {}) {
  const out: string[] = []
  const err: string[] = []
  const home = tmp()
  return main(argv, {
    log: (s) => out.push(s), err: (s) => err.push(s), fetchFn: fake.fetch, probe: extra.probe,
    env: { CLOUDFLARE_API_TOKEN: CF_API_TOKEN }, home,
  }).then((code) => ({ code, out: out.join('\n'), err: err.join('\n') }))
}

const envFor = (fake: FakeCloudflare): { env: Env; lines: string[] } => {
  const lines: string[] = []
  return { env: { cf: new Cloudflare(CF_API_TOKEN, fake.fetch), domain: 'trina.app', log: (s) => lines.push(s) }, lines }
}

describe('customer names', () => {
  test('a company name becomes a lowercase one-level name', () => {
    expect(checkSlug('jdr')).toBe('jdr')
    expect(checkSlug(' JDR ')).toBe('jdr')
    expect(checkSlug('acme-korea')).toBe('acme-korea')
    expect(checkSlug('lg')).toBe('lg')
    expect(checkSlug('3m')).toBe('3m')
  })

  test.each([
    ['', '비었어요'], ['a', '길이'], ['x'.repeat(41), '길이'], ['acme.co', '쓸 수 없어요'], ['ax.acme', '쓸 수 없어요'],
    ['제이디알', '쓸 수 없어요'], ['acme_co', '쓸 수 없어요'], ['-acme', '하이픈'], ['acme-', '하이픈'], ['xn--hq1b', '두 번'],
    ['www', '트리나가 쓰거나'], ['Console', '트리나가 쓰거나'], ['drive', '트리나가 쓰거나'], ['ax-demo', '트리나가 쓰거나'],
  ])('refuses %p', (name, why) => {
    expect(() => checkSlug(name)).toThrow(AddressError)
    expect(() => checkSlug(name)).toThrow(why)
  })

  test('every subdomain trina.app already uses is reserved', () => {
    for (const s of ['www', 'console', 'drive', 'local', 'staging', 'send', 'cloud', 'ax-demo', 'ax', 'api', 'admin', 'mail']) {
      expect(RESERVED.has(s)).toBe(true)
    }
  })
})

describe('new', () => {
  test('creates the tunnel, its route, a proxied CNAME and a 0600 token file, and never prints a secret', async () => {
    const fake = new FakeCloudflare()
    const out = tmp()
    const r = await run(fake, ['new', 'JDR', '--out', out])
    expect(r.code).toBe(0)
    expect(fake.writes()).toEqual([
      'POST /accounts/a1/cfd_tunnel',
      'PUT /accounts/a1/cfd_tunnel/tun1/configurations',
      'POST /zones/z1/dns_records',
    ])
    expect(fake.tunnels.map((t) => t.name)).toEqual(['trina-ax-jdr'])
    expect(fake.configs.get('tun1')).toEqual({ ingress: [{ hostname: 'jdr.trina.app', service: 'http://127.0.0.1:47900' }, { service: 'http_status:404' }] })
    const rec = fake.dns.find((d) => d.name === 'jdr.trina.app')!
    expect(rec).toMatchObject({ type: 'CNAME', content: 'tun1.cfargotunnel.com', proxied: true })

    const file = path.join(out, 'jdr-tunnel-token.txt')
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(TUNNEL_TOKEN('tun1'))
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)

    expect(r.out).toContain('고객 주소: https://jdr.trina.app')
    expect(r.out).toContain('--tunnel-token-file ~/tunnel-token.txt --public-url https://jdr.trina.app')
    expect(r.out + r.err).not.toContain('TUNNEL-SECRET')
    expect(r.out + r.err).not.toContain(CF_API_TOKEN)
  })

  test('--port points the route at another hub port', async () => {
    const fake = new FakeCloudflare()
    expect((await run(fake, ['new', 'acme', '--port', '47910', '--out', tmp()])).code).toBe(0)
    expect(fake.configs.get('tun1')!.ingress[0]).toEqual({ hostname: 'acme.trina.app', service: 'http://127.0.0.1:47910' })
  })

  test('running it again changes nothing in Cloudflare and just rewrites the token file', async () => {
    const fake = new FakeCloudflare()
    const out = tmp()
    await run(fake, ['new', 'acme', '--port', '47910', '--out', out])
    fake.calls = []
    fs.rmSync(path.join(out, 'acme-tunnel-token.txt'))
    const r = await run(fake, ['new', 'acme', '--out', out])
    expect(r.code).toBe(0)
    expect(fake.writes()).toEqual([])
    expect(fake.tunnels).toHaveLength(1)
    expect(fake.dns.filter((d) => d.name === 'acme.trina.app')).toHaveLength(1)
    // the port it already had is kept when --port isn't given
    expect(fake.configs.get('tun1')!.ingress[0]!.service).toBe('http://127.0.0.1:47910')
    expect(fs.existsSync(path.join(out, 'acme-tunnel-token.txt'))).toBe(true)
    expect(r.out).toContain('이미 있어요')
  })

  test('finishes a half-made address (tunnel there, no route or DNS) with the same tunnel', async () => {
    const fake = new FakeCloudflare()
    fake.tunnels.push({ id: 'old', name: 'trina-ax-acme', status: 'inactive', connections: [] })
    const r = await run(fake, ['new', 'acme', '--out', tmp()])
    expect(r.code).toBe(0)
    expect(fake.writes()).toEqual(['PUT /accounts/a1/cfd_tunnel/old/configurations', 'POST /zones/z1/dns_records'])
    expect(fake.dns.find((d) => d.name === 'acme.trina.app')!.content).toBe('old.cfargotunnel.com')
  })

  test('refuses a name that already has DNS records and creates nothing', async () => {
    const fake = new FakeCloudflare()
    const r = await run(fake, ['new', 'acmeshop', '--out', tmp()])
    expect(r.code).toBe(1)
    expect(r.err).toContain('acmeshop.trina.app 은 이미 쓰고 있는 이름이에요 (A)')
    expect(fake.writes()).toEqual([])
  })

  test('refuses to repoint a tunnel that already serves another address', async () => {
    const fake = new FakeCloudflare()
    fake.tunnels.push({ id: 't9', name: 'trina-ax-acme', status: 'healthy', connections: [{}] })
    fake.configs.set('t9', { ingress: [{ hostname: 'other.trina.app', service: 'http://127.0.0.1:47900' }, { service: 'http_status:404' }] })
    const r = await run(fake, ['new', 'acme', '--out', tmp()])
    expect(r.code).toBe(1)
    expect(r.err).toContain('다른 주소(other.trina.app)')
    expect(fake.writes()).toEqual([])
  })

  test('a token without DNS permission is told exactly which permission to add', async () => {
    const fake = new FakeCloudflare()
    fake.denied.add('/dns_records')
    const r = await run(fake, ['new', 'acme', '--out', tmp()])
    expect(r.code).toBe(1)
    expect(r.err).toContain('Zone · DNS · Edit')
    expect(r.err).not.toContain(CF_API_TOKEN)
  })
})

describe('list, check, token', () => {
  test('list shows each customer address with its tunnel state', async () => {
    const fake = new FakeCloudflare()
    await run(fake, ['new', 'acme', '--out', tmp()])
    await run(fake, ['new', 'jdr', '--out', tmp()])
    fake.tunnels.find((t) => t.name === 'trina-ax-jdr')!.status = 'healthy'
    fake.tunnels.find((t) => t.name === 'trina-ax-jdr')!.connections = [{}, {}, {}, {}]
    fake.tunnels.push({ id: 'x', name: 'someone-else', status: 'healthy', connections: [] })
    const r = await run(fake, ['list'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/https:\/\/acme\.trina\.app\s+trina-ax-acme {2}아직 연결 전/)
    expect(r.out).toMatch(/https:\/\/jdr\.trina\.app\s+trina-ax-jdr {2}켜짐 · 연결 4/)
    expect(r.out).not.toContain('someone-else')
  })

  test('check passes only when DNS, route, tunnel and the hub all answer', async () => {
    const fake = new FakeCloudflare()
    await run(fake, ['new', 'acme', '--out', tmp()])
    const before = await run(fake, ['check', 'acme'], { probe: async () => 530 })
    expect(before.code).toBe(1)
    expect(before.out).toContain('✗ 터널 상태: 아직 연결 전')
    expect(before.out).toContain('허브나 터널 서비스가 꺼져 있어요')

    fake.tunnels[0]!.status = 'healthy'
    const probed: string[] = []
    const after = await run(fake, ['check', 'acme'], { probe: async (u) => { probed.push(u); return 200 } })
    expect(after.code).toBe(0)
    expect(probed).toEqual(['https://acme.trina.app/healthz'])
    expect(after.out).not.toContain('✗')
  })

  test('token re-issues the file for an existing address and refuses an unknown one', async () => {
    const fake = new FakeCloudflare()
    await run(fake, ['new', 'acme', '--out', tmp()])
    const out = tmp()
    expect((await run(fake, ['token', 'acme', '--out', out])).code).toBe(0)
    expect(fs.readFileSync(path.join(out, 'acme-tunnel-token.txt'), 'utf8').trim()).toBe(TUNNEL_TOKEN('tun1'))
    const none = await run(fake, ['token', 'nobody', '--out', out])
    expect(none.code).toBe(1)
    expect(none.err).toContain('먼저 new nobody')
  })
})

describe('remove', () => {
  test('asks for --yes, then removes DNS, connections and the tunnel', async () => {
    const fake = new FakeCloudflare()
    await run(fake, ['new', 'acme', '--out', tmp()])
    fake.calls = []
    const ask = await run(fake, ['remove', 'acme'])
    expect(ask.code).toBe(1)
    expect(ask.err).toContain('--yes')
    expect(fake.writes()).toEqual([])

    const r = await run(fake, ['remove', 'acme', '--yes'])
    expect(r.code).toBe(0)
    expect(fake.writes()).toEqual([
      expect.stringMatching(/^DELETE \/zones\/z1\/dns_records\/d\d+$/),
      'DELETE /accounts/a1/cfd_tunnel/tun1/connections',
      'DELETE /accounts/a1/cfd_tunnel/tun1',
    ])
    expect(fake.dns.some((d) => d.name === 'acme.trina.app')).toBe(false)
    expect(fake.tunnels).toEqual([])
    expect(fake.dns.map((d) => d.name)).toEqual(['www.trina.app', 'acmeshop.trina.app'])
  })

  test('never deletes a DNS record that is not this customer’s tunnel', async () => {
    const fake = new FakeCloudflare()
    const { env } = envFor(fake)
    await expect(removeAddress(env, 'acmeshop', true)).rejects.toThrow('지우지 않았어요')
    expect(fake.writes()).toEqual([])
    expect(fake.dns).toHaveLength(2)
  })

  test('the demo address (ax-demo) cannot be created or removed through a customer name', async () => {
    const fake = new FakeCloudflare()
    const { env } = envFor(fake)
    await expect(createAddress(env, 'ax-demo', { outDir: tmp() })).rejects.toThrow('트리나가 쓰거나')
    await expect(removeAddress(env, 'ax-demo', true)).rejects.toThrow('트리나가 쓰거나')
  })
})

describe('cli', () => {
  test('usage errors exit 2', async () => {
    const fake = new FakeCloudflare()
    expect((await run(fake, ['new'])).code).toBe(2)
    expect((await run(fake, ['new', 'acme', '--bogus', '1'])).code).toBe(2)
    expect((await run(fake, ['new', 'acme', '--out'])).code).toBe(2)
    expect((await run(fake, ['frobnicate', 'acme'])).code).toBe(2)
    expect((await run(fake, [])).code).toBe(2)
    expect((await run(fake, ['--help'])).code).toBe(0)
    expect((await run(fake, ['new', 'acme', '--port', '0'])).code).toBe(1)
  })

  test('the Cloudflare token comes from --cf-token-file, then CLOUDFLARE_API_TOKEN, then ~/.config/trina-ax', () => {
    const home = tmp()
    const f = path.join(tmp(), 'tok')
    fs.writeFileSync(f, ' from-file \n')
    expect(loadCfToken(f, { CLOUDFLARE_API_TOKEN: 'from-env' }, home)).toBe('from-file')
    expect(loadCfToken(undefined, { CLOUDFLARE_API_TOKEN: 'from-env' }, home)).toBe('from-env')
    expect(() => loadCfToken(undefined, {}, home)).toThrow('~/.config/trina-ax/cloudflare-token')
    fs.mkdirSync(path.join(home, '.config', 'trina-ax'), { recursive: true })
    fs.writeFileSync(path.join(home, '.config', 'trina-ax', 'cloudflare-token'), 'from-default\n')
    expect(loadCfToken(undefined, {}, home)).toBe('from-default')
    expect(() => loadCfToken(path.join(home, 'missing'), {}, home)).toThrow('없어요')
  })
})
