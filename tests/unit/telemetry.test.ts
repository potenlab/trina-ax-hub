import { afterAll, describe, expect, test } from 'bun:test'
import { testHub } from '../lib/hub'
import { ingestLogs } from '../../src/telemetry/routes'
import { setUserModelAccess } from '../../src/auth/access-mode'

const hub = await testHub({ access: 'subscription' })
afterAll(async () => { await hub.stop() })

const s = (key: string, v: string | number) => ({ key, value: typeof v === 'number' ? { intValue: String(v) } : { stringValue: v } })
const batch = (records: { name: string; attrs: ReturnType<typeof s>[] }[]) => ({
  resourceLogs: [{ resource: { attributes: [s('service.name', 'claude-code'), s('session.id', 'sess-1')] },
    scopeLogs: [{ logRecords: records.map((r, i) => ({ timeUnixNano: String(Date.now() * 1e6), body: { stringValue: 'claude_code.' + r.name }, attributes: [s('event.name', r.name), s('event.sequence', i + 1), ...r.attrs] })) }] }],
})
const req = (n: number) => ({ name: 'api_request', attrs: [s('model', 'claude-opus-5-5'), s('input_tokens', n), s('output_tokens', 20), s('cache_read_tokens', 500), s('cache_creation_tokens', 30), s('cost_usd', '0.0123'), s('duration_ms', 900)] })

describe('telemetry ingest', () => {
  test('api_request → usage row once, even when the batch is sent again', async () => {
    const u = await hub.user('t1')
    const b = batch([req(100), req(200)])
    expect(ingestLogs(hub.ctx, { userId: u.id, tokenId: 'tk' }, b).requests).toBe(2)
    ingestLogs(hub.ctx, { userId: u.id, tokenId: 'tk' }, b)
    const rows = hub.ctx.db.query("SELECT * FROM usage WHERE user_id = ? ORDER BY input_tokens").all(u.id) as any[]
    expect(rows.length).toBe(2)
    expect(rows[0].source).toBe('sub')
    expect(rows[0].cost_usd).toBeCloseTo(0.0123, 6)
    expect(rows[1].cache_read).toBe(500)
  })

  test('a person on the company key is not counted twice (the relay counts them)', async () => {
    const u = await hub.user('t2')
    setUserModelAccess(hub.ctx.db, u.id, 'company_key')
    const r = ingestLogs(hub.ctx, { userId: u.id, tokenId: 'tk' }, batch([req(100)]))
    expect(r.requests).toBe(0)
    expect((hub.ctx.db.query('SELECT COUNT(*) AS n FROM usage WHERE user_id = ?').get(u.id) as any).n).toBe(0)
  })

  test('skills and PC tools are counted; placeholders and MCP calls are not', async () => {
    const u = await hub.user('t3')
    ingestLogs(hub.ctx, { userId: u.id, tokenId: 'tk' }, batch([
      { name: 'skill_activated', attrs: [s('skill.name', 'company:quote-draft')] },
      { name: 'skill_activated', attrs: [s('skill.name', 'custom_skill')] },
      { name: 'tool_result', attrs: [s('tool_name', 'Bash'), s('success', 'true')] },
      { name: 'tool_result', attrs: [s('tool_name', 'mcp_tool'), s('success', 'true')] },
      { name: 'user_prompt', attrs: [s('prompt', 'secret text')] },
    ]))
    expect((hub.ctx.db.query('SELECT skill FROM skill_events WHERE user_id = ?').all(u.id) as any[]).map((r) => r.skill)).toEqual(['quote-draft'])
    expect((hub.ctx.db.query('SELECT tool FROM tool_events WHERE user_id = ?').all(u.id) as any[]).map((r) => r.tool)).toEqual(['pc:Bash'])
  })

  test('odd input is ignored, not stored', async () => {
    const u = await hub.user('t4')
    const r = ingestLogs(hub.ctx, { userId: u.id, tokenId: 'tk' }, batch([{ name: 'api_request', attrs: [s('model', '<script>'), s('input_tokens', 5)] }]))
    expect(r.requests).toBe(0)
    expect(ingestLogs(hub.ctx, { userId: u.id, tokenId: 'tk' }, { nope: 1 }).requests).toBe(0)
  })

  test('the endpoint needs a device token and JSON', async () => {
    expect((await fetch(hub.url + '/otel/v1/logs', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(401)
    const u = await hub.user('t5')
    const t = hub.token(u.id)
    const r = await fetch(hub.url + '/otel/v1/logs', { method: 'POST', body: JSON.stringify(batch([req(77)])), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t } })
    expect(r.status).toBe(200)
    expect((hub.ctx.db.query('SELECT COUNT(*) AS n FROM usage WHERE user_id = ?').get(u.id) as any).n).toBe(1)
    expect((await fetch(hub.url + '/otel/v1/logs', { method: 'POST', body: 'x', headers: { 'content-type': 'application/x-protobuf', authorization: 'Bearer ' + t } })).status).toBe(415)
  })
})

describe('budgets count only the company key', () => {
  test('subscription usage is shown but never fills a company budget', async () => {
    const { createBudget, budgetBlock } = await import('../../src/usage/budgets')
    const u = await hub.user('t6')
    createBudget(hub.ctx.db, { subjectType: 'team', subjectId: null, period: 'month', limitUsd: 0.01, limitTokens: null, action: 'block' })
    ingestLogs(hub.ctx, { userId: u.id, tokenId: 'tk' }, batch([req(100), req(200), req(300)]))
    expect(budgetBlock(hub.ctx.db, u.id)).toBeNull()
  })
})
