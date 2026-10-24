// POST /mcp over real HTTP: JSON-RPC 2.0 edge cases, auth, every tool through tools/call, audit rows.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import { makeWorld, type World } from './files-world'
import { issueToken, revokeToken } from '../../src/auth/tokens'
import { setUserGroups, updateUser } from '../../src/auth/users'
import { MCP_TOOL_NAMES, OUTPUT_MAX_CHARS, TOOL_NAMES } from '../../src/mcp/tools'
import { INSTRUCTIONS_MAX } from '../../src/mcp/instructions'

let W: World
let tok: { choi: string; park: string; admin: string }
beforeAll(async () => {
  W = await makeWorld()
  tok = { choi: W.hub.token(W.choi.id), park: W.hub.token(W.park.id), admin: W.hub.token(W.admin.id) }
})
afterAll(async () => { await W?.hub.stop() })

const post = (token: string | null, body: unknown, raw = false) => fetch(W.hub.url + '/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: raw ? (body as string) : JSON.stringify(body),
})
let nextId = 1
async function rpc(token: string, method: string, params?: unknown) {
  const r = await post(token, { jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) })
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toContain('application/json')
  return await r.json() as any
}
async function call(token: string, name: string, args: unknown) {
  const j = await rpc(token, 'tools/call', { name, arguments: args })
  if (j.error) throw new Error(JSON.stringify(j.error))
  return { text: (j.result.content.find((c: any) => c.type === 'text')?.text ?? '') as string, isError: !!j.result.isError, content: j.result.content as any[] }
}
const lastEvent = () => W.hub.ctx.db.query('SELECT * FROM tool_events ORDER BY id DESC LIMIT 1').get() as any

describe('JSON-RPC', () => {
  test('initialize echoes a known protocol version, else 2025-06-18; carries instructions', async () => {
    const a = await rpc(tok.choi, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(a.result.protocolVersion).toBe('2025-03-26')
    expect(a.result.capabilities).toEqual({ tools: {} })
    expect(a.result.serverInfo).toEqual({ name: 'trina-ax', version: expect.any(String) })
    expect(a.result.instructions).toContain('choi')
    expect(a.result.instructions.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX)
    expect((await rpc(tok.choi, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-06-18')
    expect((await rpc(tok.choi, 'initialize', {})).result.protocolVersion).toBe('2025-06-18')
  })
  test('notifications get 202 with no body; ping answers {}', async () => {
    const n = await post(tok.choi, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(n.status).toBe(202)
    expect(await n.text()).toBe('')
    expect((await rpc(tok.choi, 'ping')).result).toEqual({})
  })
  test('tools/list: the nine tools with JSON Schemas', async () => {
    const r = await rpc(tok.choi, 'tools/list')
    const tools = r.result.tools as any[]
    expect(tools.map((t) => t.name)).toEqual(['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'make_folder', 'move_file', 'delete_file', 'read_skill'])
    expect(TOOL_NAMES).toEqual(tools.map((t) => t.name))
    expect(MCP_TOOL_NAMES[0]).toBe('mcp__trina__list_files')
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(40)
      expect(t.inputSchema.type).toBe('object')
      expect(t.inputSchema.$schema).toBeUndefined()
    }
    const by = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]))
    expect(by.read_file.required).toEqual(['path'])
    expect(Object.keys(by.read_file.properties)).toEqual(['path', 'offset', 'limit'])
    expect(by.list_files.required).toBeUndefined()
    expect(by.list_files.properties.depth).toMatchObject({ type: 'integer', minimum: 1, maximum: 3 })
    expect(by.search_files.properties.mode.enum).toEqual(['content', 'name'])
    expect(by.search_files.required).toEqual(['query'])
    expect(by.write_file.required).toEqual(['path', 'content'])
    expect(by.edit_file.required).toEqual(['path', 'old_string', 'new_string'])
    expect(by.move_file.required).toEqual(['from', 'to'])
    expect(by.read_skill.required).toEqual(['name'])
  })
  test('unknown method -32601, unknown tool -32602, bad params -32602', async () => {
    expect((await rpc(tok.choi, 'resources/list')).error.code).toBe(-32601)
    const u = await rpc(tok.choi, 'tools/call', { name: 'rm_rf', arguments: {} })
    expect(u.error.code).toBe(-32602)
    expect(lastEvent()).toMatchObject({ tool: 'rm_rf', ok: 0, user_id: W.choi.id })
    expect((await rpc(tok.choi, 'tools/call', {})).error.code).toBe(-32602)
  })
  test('parse errors -32700 (400); invalid requests -32600', async () => {
    const p = await post(tok.choi, '{"jsonrpc": "2.0", "id": 1, "method": ', true)
    expect(p.status).toBe(400)
    expect((await p.json() as any).error.code).toBe(-32700)
    for (const bad of [{ id: 1, method: 'ping' }, { jsonrpc: '1.0', id: 2, method: 'ping' }, { jsonrpc: '2.0', id: 3 }, 'ping', 42, { jsonrpc: '2.0', id: { x: 1 }, method: 'ping' }]) {
      const r = await post(tok.choi, bad)
      expect((await r.json() as any).error.code).toBe(-32600)
    }
    // a response object from the client (to a request we never sent) is ignored
    expect((await post(tok.choi, { jsonrpc: '2.0', id: 9, result: {} })).status).toBe(202)
  })
  test('batches: answers in order, notifications skipped; all-notification batch 202; empty batch -32600', async () => {
    const r = await post(tok.choi, [
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'b', method: 'tools/call', params: { name: 'write_file', arguments: { path: 'shared/batch.md', content: 'batch!' } } },
      { jsonrpc: '2.0', id: 'c', method: 'tools/call', params: { name: 'read_file', arguments: { path: 'shared/batch.md' } } },
      { jsonrpc: '2.0', id: 'd', method: 'nope' },
    ])
    expect(r.status).toBe(200)
    const out = await r.json() as any[]
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(out[2].result.content[0].text).toContain('batch!')
    expect(out[3].error.code).toBe(-32601)
    expect((await post(tok.choi, [{ jsonrpc: '2.0', method: 'notifications/initialized' }])).status).toBe(202)
    const e = await post(tok.choi, [])
    expect(e.status).toBe(400)
    expect((await e.json() as any).error.code).toBe(-32600)
  })
  test('GET is 405, DELETE is 200', async () => {
    const g = await fetch(W.hub.url + '/mcp', { headers: { accept: 'text/event-stream', authorization: `Bearer ${tok.choi}` } })
    expect(g.status).toBe(405)
    expect((await fetch(W.hub.url + '/mcp', { method: 'DELETE', headers: { authorization: `Bearer ${tok.choi}` } })).status).toBe(200)
  })
})

describe('auth', () => {
  test('no token, a wrong token, a revoked token and an expired hub token get 401', async () => {
    expect((await post(null, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect((await post('tax_wrong', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    const t = issueToken(W.hub.ctx.db, W.choi.id, 'device', 'old-pc')
    expect((await post(t.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
    revokeToken(W.hub.ctx.db, t.id)
    const r = await post(t.token, { jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(r.status).toBe(401)
    expect((await r.json() as any).error.code).toBe('unauthorized')
    const h = issueToken(W.hub.ctx.db, W.choi.id, 'hub', 'job', -1000)
    expect((await post(h.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
  })
  test('a disabled account gets 401, also when its tokens were not revoked', async () => {
    const u = await W.hub.user('leaver')
    const t1 = W.hub.token(u.id)
    W.hub.ctx.db.query("UPDATE users SET status = 'disabled' WHERE id = ?").run(u.id)
    expect((await post(t1, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_files', arguments: {} } })).status).toBe(401)
    W.hub.ctx.db.query("UPDATE users SET status = 'active' WHERE id = ?").run(u.id)
    updateUser(W.hub.ctx.db, u.id, { status: 'disabled' })
    expect((await post(t1, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
  })
  test('a changed group applies from the next call', async () => {
    const before = await call(tok.park, 'read_file', { path: 'sales/plan.md' })
    expect(before.text).toContain('CANARY-SALES')
    setUserGroups(W.hub.ctx.db, W.park.id, [])
    const after = await call(tok.park, 'read_file', { path: 'sales/plan.md' })
    expect(after.isError).toBe(true)
    expect(after.text).not.toContain('CANARY')
    setUserGroups(W.hub.ctx.db, W.park.id, [W.sales.id])
    expect((await call(tok.park, 'read_file', { path: 'sales/plan.md' })).isError).toBe(false)
  })
})

describe('tools through MCP', () => {
  test('read_file: numbered lines and an audit row with the path and token', async () => {
    const r = await call(tok.choi, 'read_file', { path: 'shared/hello.md' })
    expect(r.isError).toBe(false)
    expect(r.text).toBe('     1\t# 안녕하세요\n     2\t첫 줄\n     3\t둘째 줄')
    const ev = lastEvent()
    const tokenId = (W.hub.ctx.db.query("SELECT id FROM tokens WHERE user_id = ? AND kind = 'device' ORDER BY created_at LIMIT 1").get(W.choi.id) as any).id
    expect(ev).toMatchObject({ user_id: W.choi.id, token_id: tokenId, tool: 'read_file', ok: 1 })
    expect(ev.summary).toContain('shared/hello.md')
    expect(ev.summary.length).toBeLessThanOrEqual(300)
  })
  test('read_file continuation note', async () => {
    W.hub.write('shared/long.md', Array.from({ length: 30 }, (_, i) => `L${i + 1}`).join('\n'))
    const r = await call(tok.choi, 'read_file', { path: 'shared/long.md', limit: 10 })
    expect(r.text).toContain('Showing lines 1-10 of 30')
    expect(r.text).toContain('offset=11')
  })
  test('long files page by characters; every page stays inline-sized; paging covers every line', async () => {
    const n = 3000
    W.hub.write('shared/long-ko.md', Array.from({ length: n }, (_, i) => `가나다라마바사아자차카타파하 회의록 ${i + 1}번째 줄입니다`).join('\n'))
    const seen = new Set<number>()
    let offset = 1, pages = 0
    for (;;) {
      const r = await call(tok.choi, 'read_file', { path: 'shared/long-ko.md', offset })
      expect(r.text.length).toBeLessThanOrEqual(OUTPUT_MAX_CHARS)
      for (const m of r.text.matchAll(/^ *(\d+)\t/gm)) seen.add(Number(m[1]))
      pages++
      const next = /offset=(\d+)/.exec(r.text)
      if (!next) break
      offset = Number(next[1])
    }
    expect(seen.size).toBe(n)
    expect(pages).toBeGreaterThan(1)
  })
  test('list and search results are cut to the same size with a note', async () => {
    for (let i = 0; i < 400; i++) W.hub.write(`shared/bulk/${'아주 긴 파일 이름 '.repeat(6)}${i}.md`, `${'needle-q '.repeat(40)}\n`.repeat(3))
    const s = await call(tok.choi, 'search_files', { query: 'needle-q', limit: 500 })
    expect(s.text.length).toBeLessThanOrEqual(OUTPUT_MAX_CHARS)
    expect(s.text).toContain('[Output cut at 40,000 characters')
    const l = await call(tok.choi, 'list_files', { path: 'shared/bulk' })
    expect(l.text.length).toBeLessThanOrEqual(OUTPUT_MAX_CHARS)
  })
  test('denied and missing answer the same, as an isError result, audited ok=0', async () => {
    const hidden = await call(tok.choi, 'read_file', { path: 'finance/budget.md' })
    const missing = await call(tok.choi, 'read_file', { path: 'nosuch/budget.md' })
    expect(hidden.isError).toBe(true)
    expect(hidden.text.replace('finance', 'X')).toBe(missing.text.replace('nosuch', 'X'))
    expect(hidden.text).toContain('Check the path')
    expect(lastEvent()).toMatchObject({ ok: 0, tool: 'read_file' })
  })
  test('invalid input is a readable tool error', async () => {
    const r = await call(tok.choi, 'read_file', { path: 42 })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('Invalid input')
    expect(r.text).toContain('path')
    expect((await call(tok.choi, 'list_files', { depth: 9 })).text).toContain('depth')
  })
  test('write, overwrite flag, edit, make_folder, move, delete, list, search', async () => {
    expect((await call(tok.choi, 'write_file', { path: 'shared/mcp/a.md', content: 'SECRET-CONTENT v1' })).text).toContain('Created shared/mcp/a.md')
    expect(lastEvent().summary).not.toContain('SECRET-CONTENT')
    const again = await call(tok.choi, 'write_file', { path: 'shared/mcp/a.md', content: 'v2' })
    expect(again.isError).toBe(true)
    expect(again.text).toContain('overwrite: true')
    expect((await call(tok.choi, 'write_file', { path: 'shared/mcp/a.md', content: 'SECRET-CONTENT v2', overwrite: true })).text).toContain('previous version is kept')
    expect((await call(tok.choi, 'edit_file', { path: 'shared/mcp/a.md', old_string: 'v2', new_string: 'v3' })).text).toContain('1 replacement')
    expect(lastEvent().summary).not.toContain('v3')
    expect(W.read('shared/mcp/a.md')).toBe('SECRET-CONTENT v3')
    expect((await call(tok.choi, 'make_folder', { path: 'shared/mcp/sub' })).text).toContain('Created folder')
    expect((await call(tok.choi, 'move_file', { from: 'shared/mcp/a.md', to: 'shared/mcp/sub/b.md' })).text).toContain('Moved shared/mcp/a.md to shared/mcp/sub/b.md')
    const list = await call(tok.choi, 'list_files', { path: 'shared/mcp', depth: 2 })
    expect(list.text).toContain('Team folder: shared/mcp/')
    expect(list.text).toContain('shared/mcp/sub/')
    expect(list.text).toMatch(/shared\/mcp\/sub\/b\.md {2}17 B {2}\d{4}-\d\d-\d\d \d\d:\d\d/)
    const s = await call(tok.choi, 'search_files', { query: 'SECRET-CONTENT', path: 'shared/mcp' })
    expect(s.text).toContain('shared/mcp/sub/b.md:1: SECRET-CONTENT v3')
    expect(lastEvent().summary).not.toContain('SECRET')
    expect((await call(tok.choi, 'search_files', { query: 'b.md', mode: 'name', path: 'shared' })).text).toContain('shared/mcp/sub/b.md')
    expect((await call(tok.choi, 'delete_file', { path: 'shared/mcp/sub/b.md' })).text).toContain("hub's trash")
    expect(fs.existsSync(W.abs('shared/mcp/sub/b.md'))).toBe(false)
    const reasons = (W.hub.ctx.db.query("SELECT reason FROM file_versions WHERE path LIKE 'shared/mcp/%' ORDER BY created_at, rowid").all() as any[]).map((r) => r.reason)
    expect(reasons).toEqual(['overwrite', 'overwrite', 'trash'])
    expect((await call(tok.choi, 'delete_file', { path: 'shared/mcp/sub' })).text).toContain('empty folder')
  })
  test('images come back as image content', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    fs.writeFileSync(W.abs('shared/logo.png'), png)
    const r = await call(tok.choi, 'read_file', { path: 'shared/logo.png' })
    expect(r.content[0]).toEqual({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' })
  })
  test('read_skill records a skill_events row (source mcp)', async () => {
    const r = await call(tok.park, 'read_skill', { name: 'pitch' })
    expect(r.text).toContain('Skill: pitch (skills/sales-pack/pitch/)')
    expect(r.text).toContain('--- SKILL.md ---')
    expect(W.hub.ctx.db.query("SELECT skill, source FROM skill_events WHERE user_id = ?").all(W.park.id)).toEqual([{ skill: 'pitch', source: 'mcp' }])
    expect((await call(tok.choi, 'read_skill', { name: 'pitch' })).isError).toBe(true)
    expect(W.hub.ctx.db.query("SELECT COUNT(*) AS n FROM skill_events WHERE user_id = ?").get(W.choi.id)).toEqual({ n: 0 })
  })
  test('20 parallel edits of one file: none is lost, each keeps a version', async () => {
    W.hub.write('shared/race.md', 'line0\n')
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call(i % 2 ? tok.choi : tok.park, 'edit_file', { path: 'shared/race.md', old_string: 'line0\n', new_string: `line0\nMARK-${i}\n` })))
    expect(rs.filter((r) => r.isError)).toEqual([])
    const final = W.read('shared/race.md')
    for (let i = 0; i < 20; i++) expect(final).toContain(`MARK-${i}\n`)
    expect((W.hub.ctx.db.query("SELECT COUNT(*) AS n FROM file_versions WHERE path = 'shared/race.md'").get() as any).n).toBe(20)
  })
  test('every tools/call leaves exactly one tool_events row', async () => {
    const n0 = (W.hub.ctx.db.query('SELECT COUNT(*) AS n FROM tool_events').get() as any).n
    await call(tok.admin, 'list_files', {})
    await call(tok.admin, 'read_file', { path: 'nope.md' })
    await rpc(tok.admin, 'tools/call', { name: 'nope', arguments: {} })
    expect((W.hub.ctx.db.query('SELECT COUNT(*) AS n FROM tool_events').get() as any).n).toBe(n0 + 3)
  })
})
