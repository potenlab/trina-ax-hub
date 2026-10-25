// Telemetry sent with the org token is attributed to hub people by the email each event names.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { testHub } from '../lib/hub'
import { ingestLogs, ingestOrgLogs } from '../../src/telemetry/routes'
import { setUserModelAccess } from '../../src/auth/access-mode'
import { updateUser } from '../../src/auth/users'
import { rotateOrgToken } from '../../src/org/token'
import { UNKNOWN_EMAIL_CAP, listUnknownEmails, normalizeEmail, orgIngestStats, orgReportingPeople } from '../../src/org/telemetry'

const hub = await testHub({ access: 'subscription' })
afterAll(async () => { await hub.stop() })
const db = hub.ctx.db
let orgTokenId = ''
let orgToken = ''
beforeAll(() => { const r = rotateOrgToken(db, hub.owner.id); orgTokenId = r.id; orgToken = r.token })

const s = (key: string, v: string | number) => ({ key, value: typeof v === 'number' ? { intValue: String(v) } : { stringValue: v } })
type KV = ReturnType<typeof s>
interface Rec { name: string; attrs: KV[] }
let seq = 0
/** One OTLP logs body. `resource` = resource attributes; each record carries its own attributes. */
const batch = (records: Rec[], resource: KV[] = []) => ({
  resourceLogs: [{ resource: { attributes: [s('service.name', 'claude-code'), s('session.id', 'sess-' + ++seq), ...resource] },
    scopeLogs: [{ logRecords: records.map((r, i) => ({ timeUnixNano: String(Date.now() * 1e6), body: { stringValue: 'claude_code.' + r.name }, attributes: [s('event.name', r.name), s('event.sequence', i + 1), ...r.attrs] })) }] }],
})
const req = (n: number, email?: string): Rec => ({ name: 'api_request', attrs: [s('model', 'claude-opus-5-5'), s('input_tokens', n), s('output_tokens', 20), s('cost_usd', '0.01'), ...(email ? [s('user.email', email)] : [])] })
const org = (body: unknown) => ingestOrgLogs(hub.ctx, { tokenId: orgTokenId }, body)
const usageOf = (userId: string) => db.query('SELECT * FROM usage WHERE user_id = ? ORDER BY input_tokens').all(userId) as any[]

async function personWithEmail(username: string, email: string | null) {
  const u = await hub.user(username)
  if (email) updateUser(db, u.id, { email })
  return u
}

describe('email matching', () => {
  test('normalizeEmail: trimmed, lower case, one address', () => {
    expect(normalizeEmail('  Kim@Acme.CO ')).toBe('kim@acme.co')
    for (const bad of ['', 'kim', 'a@b c', 'a@@b', 'a,b@c.co', '<a@b.co>', 42, null, undefined, 'x'.repeat(300) + '@a.co']) expect(normalizeEmail(bad as any)).toBeNull()
  })

  test('an event is stored for the person whose email it names, ignoring case and spaces', async () => {
    const u = await personWithEmail('lee', 'Lee.Min@Acme.co')
    const r = org(batch([req(101, 'lee.min@acme.co'), req(102, ' LEE.MIN@ACME.CO '), req(103, 'Lee.Min@Acme.co')]))
    expect(r.requests).toBe(3)
    expect(r.unattributed).toBe(0)
    const rows = usageOf(u.id)
    expect(rows.map((x) => x.input_tokens)).toEqual([101, 102, 103])
    expect(rows[0].source).toBe('sub')
    expect(rows[0].token_id).toBe(orgTokenId)
  })

  test('the email may be a resource attribute or a record attribute; the record wins', async () => {
    const a = await personWithEmail('res', 'res@acme.co')
    const b = await personWithEmail('rec', 'rec@acme.co')
    // resource only
    expect(org(batch([req(201)], [s('user.email', 'res@acme.co')])).requests).toBe(1)
    expect(usageOf(a.id).map((x) => x.input_tokens)).toEqual([201])
    // record only
    expect(org(batch([req(202, 'rec@acme.co')])).requests).toBe(1)
    expect(usageOf(b.id).map((x) => x.input_tokens)).toEqual([202])
    // both: the record's own email is the event's
    expect(org(batch([req(203, 'rec@acme.co')], [s('user.email', 'res@acme.co')])).requests).toBe(1)
    expect(usageOf(b.id).map((x) => x.input_tokens)).toEqual([202, 203])
    expect(usageOf(a.id).map((x) => x.input_tokens)).toEqual([201])
    // one request, two people
    org(batch([req(204, 'res@acme.co'), req(205, 'rec@acme.co')]))
    expect(usageOf(a.id).map((x) => x.input_tokens)).toEqual([201, 204])
    expect(usageOf(b.id).map((x) => x.input_tokens)).toEqual([202, 203, 205])
  })

  test('only active people are matched: a disabled account is an unknown email', async () => {
    const u = await personWithEmail('gone', 'gone@acme.co')
    updateUser(db, u.id, { status: 'disabled' })
    const r = org(batch([req(301, 'gone@acme.co')]))
    expect(r.requests).toBe(0)
    expect(r.unattributed).toBe(1)
    expect(usageOf(u.id).length).toBe(0)
    expect(listUnknownEmails(db).find((x) => x.email === 'gone@acme.co')?.records).toBe(1)
  })

  test('two active people with the same email cannot be told apart: nothing is stored, the email is flagged', async () => {
    const a = await personWithEmail('twin1', 'twin@acme.co')
    const b = await personWithEmail('twin2', 'TWIN@acme.co')
    const r = org(batch([req(401, 'twin@acme.co')]))
    expect(r.requests).toBe(0)
    expect(usageOf(a.id).length + usageOf(b.id).length).toBe(0)
    expect(listUnknownEmails(db).find((x) => x.email === 'twin@acme.co')?.ambiguous).toBe(true)
  })
})

describe('unknown and missing emails', () => {
  test('not stored; counted per distinct email, case-folded, with last seen', () => {
    const before = (db.query('SELECT COUNT(*) AS n FROM usage').get() as any).n
    const r = org(batch([req(1, 'Kim@Acme.co'), req(2, 'kim@acme.co'), req(3, 'park@acme.co')]))
    expect(r.requests).toBe(0)
    expect(r.unattributed).toBe(3)
    expect((db.query('SELECT COUNT(*) AS n FROM usage').get() as any).n).toBe(before)
    const list = listUnknownEmails(db)
    expect(list.find((x) => x.email === 'kim@acme.co')?.records).toBe(2)
    expect(list.find((x) => x.email === 'park@acme.co')?.records).toBe(1)
    // counts add up across requests
    org(batch([req(4, 'kim@acme.co')]))
    const kim = listUnknownEmails(db).find((x) => x.email === 'kim@acme.co')!
    expect(kim.records).toBe(3)
    expect(Date.parse(kim.lastSeen)).toBeGreaterThanOrEqual(Date.parse(kim.firstSeen))
  })

  test('a missing or malformed email stores nothing and is only counted in the total', () => {
    const before = orgIngestStats(db).missingEmail
    const unknownBefore = listUnknownEmails(db).length
    const r = org(batch([req(5), req(6, 'not an email'), { name: 'skill_activated', attrs: [s('skill.name', 'quote')] }]))
    expect(r.requests).toBe(0)
    expect(r.unattributed).toBe(3)
    expect(orgIngestStats(db).missingEmail).toBe(before + 3)
    expect(listUnknownEmails(db).length).toBe(unknownBefore)
  })

  test('a person given the email later drops off the list', async () => {
    org(batch([req(7, 'late@acme.co')]))
    expect(listUnknownEmails(db).some((x) => x.email === 'late@acme.co')).toBe(true)
    await personWithEmail('latecomer', 'LATE@acme.co')
    expect(listUnknownEmails(db).some((x) => x.email === 'late@acme.co')).toBe(false)
    expect(org(batch([req(8, 'late@acme.co')])).requests).toBe(1)
  })

  test(`only the latest ${UNKNOWN_EMAIL_CAP} distinct emails are kept`, async () => {
    db.query('DELETE FROM org_unknown_emails').run()
    // 60 different emails over time, oldest first (distinct timestamps)
    for (let i = 0; i < 60; i++) {
      org(batch([req(1000 + i, `cap${String(i).padStart(2, '0')}@acme.co`)]))
      if (i % 10 === 9) await Bun.sleep(3)
    }
    const list = listUnknownEmails(db)
    expect(list.length).toBe(UNKNOWN_EMAIL_CAP)
    const names = new Set(list.map((x) => x.email))
    expect(names.has('cap59@acme.co')).toBe(true)
    expect(names.has('cap00@acme.co')).toBe(false)
    // an old email that comes back replaces the oldest instead of growing the list
    org(batch([req(2000, 'cap59@acme.co'), req(2001, 'again@acme.co')]))
    expect(listUnknownEmails(db).length).toBe(UNKNOWN_EMAIL_CAP)
    expect(listUnknownEmails(db).find((x) => x.email === 'cap59@acme.co')?.records).toBe(2)
    // one request with 80 emails cannot grow it either
    org(batch(Array.from({ length: 80 }, (_, i) => req(3000 + i, `burst${i}@acme.co`))))
    expect(listUnknownEmails(db).length).toBe(UNKNOWN_EMAIL_CAP)
  })

  test('events we do not keep (prompts, MCP tool calls, odd models) are not counted as unknown', () => {
    db.query('DELETE FROM org_unknown_emails').run()
    const r = org(batch([
      { name: 'user_prompt', attrs: [s('user.email', 'ghost@acme.co'), s('prompt', 'secret')] },
      { name: 'tool_result', attrs: [s('user.email', 'ghost@acme.co'), s('tool_name', 'mcp__trina__list_files'), s('success', 'true')] },
      { name: 'api_request', attrs: [s('user.email', 'ghost@acme.co'), s('model', '<script>'), s('input_tokens', 1)] },
    ]))
    expect(r.unattributed).toBe(0)
    expect(listUnknownEmails(db).length).toBe(0)
  })
})

describe('the current rules still hold', () => {
  test('the same batch sent twice counts once (ext_id)', async () => {
    const u = await personWithEmail('dup', 'dup@acme.co')
    const b = batch([req(501, 'dup@acme.co'), req(502, 'dup@acme.co')])
    expect(org(b).requests).toBe(2)
    org(b)
    expect(usageOf(u.id).length).toBe(2)
    expect(usageOf(u.id)[0].ext_id).toMatch(/^otel:/)
  })

  test('a person on the company key is not counted (the relay counts them), and is not an unknown email', async () => {
    const u = await personWithEmail('keyed', 'keyed@acme.co')
    setUserModelAccess(db, u.id, 'company_key')
    const r = org(batch([req(601, 'keyed@acme.co')]))
    expect(r.requests).toBe(0)
    expect(r.unattributed).toBe(0)
    expect(usageOf(u.id).length).toBe(0)
    expect(listUnknownEmails(db).some((x) => x.email === 'keyed@acme.co')).toBe(false)
  })

  test('skills and PC tools are recorded for the named person; placeholders and MCP calls are not', async () => {
    const u = await personWithEmail('skiller', 'skiller@acme.co')
    org(batch([
      { name: 'skill_activated', attrs: [s('user.email', 'skiller@acme.co'), s('skill.name', 'company-all:quote-draft')] },
      { name: 'skill_activated', attrs: [s('user.email', 'skiller@acme.co'), s('skill.name', 'company:memo')] },
      { name: 'skill_activated', attrs: [s('user.email', 'skiller@acme.co'), s('skill.name', 'custom_skill')] },
      { name: 'tool_result', attrs: [s('user.email', 'skiller@acme.co'), s('tool_name', 'Bash'), s('success', 'true')] },
      { name: 'tool_result', attrs: [s('user.email', 'skiller@acme.co'), s('tool_name', 'mcp_tool'), s('success', 'true')] },
      { name: 'tool_result', attrs: [s('user.email', 'skiller@acme.co'), s('tool_name', 'Read'), s('success', 'false')] },
    ]))
    expect((db.query('SELECT skill FROM skill_events WHERE user_id = ? ORDER BY id').all(u.id) as any[]).map((r) => r.skill)).toEqual(['quote-draft', 'memo'])
    const tools = db.query('SELECT tool, ok, token_id FROM tool_events WHERE user_id = ? ORDER BY id').all(u.id) as any[]
    expect(tools.map((t) => [t.tool, t.ok])).toEqual([['pc:Bash', 1], ['pc:Read', 0]])
    expect(tools[0].token_id).toBe(orgTokenId)
  })

  test('per-device token ingest ignores the email attribute: the events are the token owner\'s', async () => {
    const owner = await personWithEmail('devowner', 'devowner@acme.co')
    const other = await personWithEmail('someone', 'someone@acme.co')
    const r = ingestLogs(hub.ctx, { userId: owner.id, tokenId: 'dev-token' }, batch([req(701, 'someone@acme.co'), req(702)]))
    expect(r.requests).toBe(2)
    expect(usageOf(owner.id).length).toBe(2)
    expect(usageOf(other.id).length).toBe(0)
  })
})

describe('over HTTP with the org token', () => {
  test('a batch is attributed, "last received" and the reporting count follow', async () => {
    const u = await personWithEmail('http', 'http@acme.co')
    const r = await fetch(hub.url + '/otel/v1/logs', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + orgToken }, body: JSON.stringify(batch([req(801, 'http@acme.co')])) })
    expect(r.status).toBe(200)
    expect(usageOf(u.id).map((x) => x.input_tokens)).toEqual([801])
    const st = orgIngestStats(db)
    expect(Date.now() - Date.parse(st.lastAt!)).toBeLessThan(10_000)
    expect(st.lastStored).toBe(1)
    expect(orgReportingPeople(db)).toBeGreaterThanOrEqual(1)
  })

  test('unreadable bodies are 400/415 like for a device token', async () => {
    const h = { authorization: 'Bearer ' + orgToken }
    expect((await fetch(hub.url + '/otel/v1/logs', { method: 'POST', headers: { ...h, 'content-type': 'application/x-protobuf' }, body: 'x' })).status).toBe(415)
    expect((await fetch(hub.url + '/otel/v1/logs', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{nope' })).status).toBe(400)
  })

  test('a device token still works the old way over HTTP', async () => {
    const u = await personWithEmail('olddev', null)
    const t = hub.token(u.id)
    const r = await fetch(hub.url + '/otel/v1/logs', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(batch([req(901)])) })
    expect(r.status).toBe(200)
    expect(usageOf(u.id).map((x) => x.input_tokens)).toEqual([901])
  })
})
