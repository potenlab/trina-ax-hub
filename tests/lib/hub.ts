// Test harness: a real hub (HTTP server, SQLite in a temp folder) with an owner account.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig, type Config } from '../../src/config'
import { openDb } from '../../src/db'
import { makeCtx, type Ctx } from '../../src/context'
import { memorySecrets } from '../../src/secrets'
import { silentLog, consoleLog } from '../../src/log'
import { serve } from '../../src/server'
import { initTeamFolder } from '../../src/policy/rules-admin'
import { createUser, createGroup, setUserGroups, type Role, type User } from '../../src/auth/users'
import { issueToken } from '../../src/auth/tokens'
import { createSession } from '../../src/auth/sessions'
import { PRODUCT } from '../../src/product'

export interface TestHub {
  ctx: Ctx
  url: string
  dir: string
  owner: User
  user(username: string, o?: { role?: Role; groups?: string[] }): Promise<User>
  group(name: string): { id: string; name: string }
  token(userId: string, kind?: 'device' | 'hub'): string
  /** cookie header + csrf for a logged-in session */
  session(userId: string): { cookie: string; csrf: string }
  write(rel: string, text: string): void
  stop(): Promise<void>
}

export async function testHub(o: { upstream?: string; apiKey?: string | null; config?: Partial<Config>; background?: boolean; verbose?: boolean } = {}): Promise<TestHub> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trina-ax-test-')))
  const config: Config = {
    ...loadConfig({ TRINA_AX_HOME: dir }),
    host: '127.0.0.1', port: 0,
    dataDir: path.join(dir, 'data'), teamRoot: path.join(dir, 'team'),
    publicUrl: null, lanUrl: null,
    upstreamBaseUrl: o.upstream ?? 'http://127.0.0.1:9',
    claudeBin: null, hubConcurrency: 2,
    ...o.config,
  }
  fs.mkdirSync(config.dataDir, { recursive: true })
  const db = openDb(path.join(config.dataDir, 'hub.db'))
  const ctx = makeCtx({ config, db, secrets: memorySecrets(o.apiKey === undefined ? 'sk-ant-test-key' : o.apiKey), log: o.verbose ? consoleLog() : silentLog })
  initTeamFolder(db, ctx.fx.root)
  const owner = await createUser(db, { username: 'owner', name: '대표', role: 'owner', password: 'password123' })
  const running = serve(ctx, { background: o.background ?? false })
  return {
    ctx, url: running.url, dir, owner,
    async user(username, uo = {}) {
      const u = await createUser(db, { username, name: username, role: uo.role ?? 'member', password: 'password123' })
      if (uo.groups?.length) setUserGroups(db, u.id, uo.groups)
      return u
    },
    group: (name) => createGroup(db, name),
    token: (userId, kind = 'device') => issueToken(db, userId, kind, 'test', kind === 'hub' ? 3600_000 : undefined).token,
    session(userId) { const s = createSession(db, userId); return { cookie: `${PRODUCT.sessionCookie}=${s.id}`, csrf: s.csrf } },
    write(rel, text) { const p = path.join(ctx.fx.root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text) },
    async stop() { await running.stop(); db.close(); fs.rmSync(dir, { recursive: true, force: true }) },
  }
}
