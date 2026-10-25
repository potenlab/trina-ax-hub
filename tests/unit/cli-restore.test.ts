// `trina-ax versions` / `trina-ax restore` against a real hub folder: a deleted file comes back where it was.
import { afterAll, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { testHub } from '../lib/hub'
import { FileService } from '../../src/files/service'

const CLI = path.resolve(import.meta.dir, '../../src/cli.ts')
const hub = await testHub()
afterAll(async () => { await hub.stop() })

const run = async (...args: string[]) => {
  const p = Bun.spawn(['bun', CLI, ...args], {
    env: { PATH: process.env.PATH!, HOME: hub.dir, TRINA_AX_HOME: hub.dir, TRINA_AX_DATA_DIR: hub.ctx.config.dataDir, TRINA_AX_TEAM_ROOT: hub.ctx.config.teamRoot },
    stdout: 'pipe', stderr: 'pipe',
  })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { code: await p.exited, out, err }
}

test('a deleted file is listed and restored to its place', async () => {
  const fsvc = FileService.forUser(hub.ctx, hub.owner.id)
  fsvc.write('shared/견적.md', '첫 견적')
  fsvc.remove('shared/견적.md')
  expect(fs.existsSync(path.join(hub.ctx.fx.root, 'shared/견적.md'))).toBe(false)
  const list = await run('versions', 'shared')
  expect(list.code).toBe(0)
  expect(list.out).toContain('shared/견적.md')
  expect(list.out).toContain('삭제')
  const id = list.out.trim().split('\n')[0]!.split(/\s+/)[0]!
  const r = await run('restore', id)
  expect(r.code).toBe(0)
  expect(r.out).toContain('되살렸어요')
  expect(fs.readFileSync(path.join(hub.ctx.fx.root, 'shared/견적.md'), 'utf8')).toBe('첫 견적')
})

test('an unknown number gives one plain line, no stack trace', async () => {
  const r = await run('restore', 'nope123')
  expect(r.code).not.toBe(0)
  expect(r.err + r.out).not.toContain('    at ')
})
