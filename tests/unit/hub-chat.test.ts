// Phone chat pages over HTTP against a real test hub whose sessions run the fake claude.
import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { fakeHub, get, jobRow, post, record, waitFor, type FakeHub } from './hub-fixtures'

const hubs: FakeHub[] = []
afterAll(async () => { for (const h of hubs) await h.stop() })
const make = async (o: Parameters<typeof fakeHub>[0] = {}) => { const h = await fakeHub(o); hubs.push(h); return h }

interface Sse { event: string; data: any }

/** Read an SSE stream until `until` says so (or it ends). */
async function sse(h: FakeHub, cookie: string, pathname: string, until: (evs: Sse[]) => boolean = (e) => e.some((x) => x.event === 'done' || x.event === 'failed'), timeoutMs = 10_000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const r = await fetch(h.t.url + pathname, { headers: { cookie, accept: 'text/event-stream' }, signal: ac.signal })
  const evs: Sse[] = []
  if (r.status !== 200 || !r.body) { clearTimeout(timer); return { status: r.status, type: r.headers.get('content-type'), evs } }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    while (!until(evs)) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i)
        buf = buf.slice(i + 2)
        let event = 'message', data = ''
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data += line.slice(5).trim()
        }
        if (data) evs.push({ event, data: JSON.parse(data) })
      }
    }
  } catch { /* aborted */ }
  clearTimeout(timer)
  ac.abort()
  return { status: r.status, type: r.headers.get('content-type'), evs }
}

const chatIdOf = (r: Response) => /\/app\/chats\/([a-z0-9]+)$/.exec(r.headers.get('location') ?? '')?.[1]

describe('hub chat pages', async () => {
  const h = await make()
  const kim = await h.t.user('kimchat')
  const lee = await h.t.user('leechat')
  const k = h.t.session(kim.id)
  const l = h.t.session(lee.id)
  const db = h.t.ctx.db

  test('login required', async () => {
    const r = await fetch(h.t.url + '/app', { redirect: 'manual', headers: { accept: 'text/html' } })
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/login?next=%2Fapp')
    const s = await fetch(h.t.url + '/app/chats/abc/events', { redirect: 'manual' })
    expect(s.status).toBe(302)
  })

  test('home and new chat pages render', async () => {
    const r = await get(h, k.cookie, '/app')
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('새 대화')
    expect(html).toContain('아직 대화가 없어요')
    expect(html).not.toContain('지금 실행 중') // members do not see job counts
    const n = await get(h, k.cookie, '/app/chats/new')
    expect(await n.text()).toContain('무엇을 도와드릴까요?')
  })

  test('posting without the CSRF field is refused', async () => {
    const r = await post(h, k.cookie, '/app/chats', { text: '안녕' })
    expect(r.status).toBe(403)
    const r2 = await post(h, k.cookie, '/app/chats', { text: '안녕', _csrf: 'wrong' })
    expect(r2.status).toBe(403)
    expect((db.query('SELECT COUNT(*) AS n FROM hub_chats').get() as any).n).toBe(0)
  })

  test('an empty message is refused with a message', async () => {
    const r = await post(h, k.cookie, '/app/chats', { text: '   ', _csrf: k.csrf })
    expect(r.status).toBe(400)
    expect(await r.text()).toContain('보낼 내용을 적어 주세요')
  })

  let chatId = ''
  test('a new chat runs, streams over SSE and shows the answer', async () => {
    const r = await post(h, k.cookie, '/app/chats', { text: '<b>회의록</b> 요약해 줘 [slow]', _csrf: k.csrf })
    expect(r.status).toBe(303)
    chatId = chatIdOf(r)!
    expect(chatId).toBeTruthy()
    const page = await (await get(h, k.cookie, `/app/chats/${chatId}`)).text()
    expect(page).toContain('&lt;b&gt;회의록&lt;/b&gt; 요약해 줘')
    expect(page).not.toContain('<b>회의록</b>')
    expect(page).toContain('id="live"')
    const job = /events\?job=([a-z0-9]+)/.exec(page)![1]!
    const s = await sse(h, k.cookie, `/app/chats/${chatId}/events?job=${job}`)
    expect(s.status).toBe(200)
    expect(s.type).toContain('text/event-stream')
    let text = ''
    for (const e of s.evs) if (e.event === 'text') text = e.data.full ? e.data.text : text + e.data.text
    const done = s.evs.find((e) => e.event === 'done')!
    expect(done.data.text).toBe('안녕하세요. 1번째 답이에요.')
    expect(done.data.html).toBe('<p>안녕하세요. 1번째 답이에요.</p>')
    expect(text).toBe('안녕하세요. 1번째 답이에요.')
    expect(s.evs.some((e) => e.event === 'status')).toBe(true)
    await h.hub.runner.wait(job)
    const after = await (await get(h, k.cookie, `/app/chats/${chatId}`)).text()
    expect(after).toContain('<div class="md"><p>안녕하세요. 1번째 답이에요.</p></div>')
    expect(after).not.toContain('id="live"')
    // listed on the home page, newest first
    const home = await (await get(h, k.cookie, '/app')).text()
    expect(home).toContain(`/app/chats/${chatId}`)
  }, 15_000)

  test('SSE after the job ended answers at once', async () => {
    const job = (db.query("SELECT id FROM hub_jobs WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1").get(chatId) as any).id
    const s = await sse(h, k.cookie, `/app/chats/${chatId}/events?job=${job}`)
    expect(s.evs.map((e) => e.event)).toEqual(['done'])
  })

  test('the second message resumes the chat session', async () => {
    const r = await post(h, k.cookie, `/app/chats/${chatId}/messages`, { text: '더 자세히 [slow]', _csrf: k.csrf })
    expect(r.status).toBe(303)
    const job = (db.query("SELECT id FROM hub_jobs WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1").get(chatId) as any).id
    // while it runs, another message is refused (one answer at a time per chat)
    const busy = await post(h, k.cookie, `/app/chats/${chatId}/messages`, { text: '하나 더', _csrf: k.csrf })
    expect(busy.headers.get('location')).toBe(`/app/chats/${chatId}?n=busy`)
    await h.hub.runner.wait(job)
    const sid = (db.query('SELECT session_id FROM hub_chats WHERE id = ?').get(chatId) as any).session_id
    expect(record(h.fake, job).args).toContain('--resume')
    expect(record(h.fake, job).args[record(h.fake, job).args.indexOf('--resume') + 1]).toBe(sid)
    expect(jobRow(h, job).result).toBe('안녕하세요. 2번째 답이에요.')
    const msgs = db.query('SELECT role, text FROM hub_messages WHERE chat_id = ? ORDER BY at, rowid').all(chatId) as any[]
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  }, 15_000)

  test('other people cannot see or change the chat', async () => {
    expect((await get(h, l.cookie, `/app/chats/${chatId}`)).status).toBe(404)
    expect((await get(h, l.cookie, `/app/chats/${chatId}/events`)).status).toBe(404)
    expect((await post(h, l.cookie, `/app/chats/${chatId}/messages`, { text: 'x', _csrf: l.csrf })).status).toBe(404)
    expect((await post(h, l.cookie, `/app/chats/${chatId}/delete`, { _csrf: l.csrf })).status).toBe(404)
    expect((await post(h, l.cookie, `/app/chats/${chatId}/cancel`, { _csrf: l.csrf })).status).toBe(404)
    expect(await (await get(h, l.cookie, '/app')).text()).not.toContain(chatId)
    // and one person's CSRF token does not work with another's session
    expect((await post(h, k.cookie, `/app/chats/${chatId}/messages`, { text: 'x', _csrf: l.csrf })).status).toBe(403)
  })

  test('deleting a chat removes its messages and its transcript on the hub', async () => {
    const sid = (db.query('SELECT session_id FROM hub_chats WHERE id = ?').get(chatId) as any).session_id
    const transcript = path.join(h.t.ctx.config.dataDir, 'hub', 'claude', kim.id, 'projects', '-fake-project', `${sid}.jsonl`)
    expect(fs.existsSync(transcript)).toBe(true)
    expect((await post(h, k.cookie, `/app/chats/${chatId}/delete`, {})).status).toBe(403)
    const r = await post(h, k.cookie, `/app/chats/${chatId}/delete`, { _csrf: k.csrf })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/app?n=deleted')
    expect(db.query('SELECT 1 FROM hub_chats WHERE id = ?').get(chatId)).toBeNull()
    expect((db.query('SELECT COUNT(*) AS n FROM hub_messages WHERE chat_id = ?').get(chatId) as any).n).toBe(0)
    expect(fs.existsSync(transcript)).toBe(false)
    expect((await get(h, k.cookie, `/app/chats/${chatId}`)).status).toBe(404)
  })

  test('admins see job counts', async () => {
    const o = h.t.session(h.t.owner.id)
    const html = await (await get(h, o.cookie, '/app')).text()
    expect(html).toContain('지금 실행 중')
    expect(html).toContain('오늘 끝난 작업')
  })

  test('people who must change their password go there first', async () => {
    const p = await h.t.user('newbie')
    db.query('UPDATE users SET must_change_password = 1 WHERE id = ?').run(p.id)
    const r = await get(h, h.t.session(p.id).cookie, '/app')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/me/password')
  })
})

describe('hub chat: waiting in line, cancel, failures', async () => {
  const h = await make({ concurrency: 1 })
  const u = await h.t.user('lineup')
  const s = h.t.session(u.id)
  const db = h.t.ctx.db

  test('a waiting answer shows its place in the queue, and cancel stops the running one', async () => {
    const a = chatIdOf(await post(h, s.cookie, '/app/chats', { text: '오래 걸리는 일 [hang]', _csrf: s.csrf }))!
    const ja = (db.query('SELECT id FROM hub_jobs WHERE chat_id = ?').get(a) as any).id
    await waitFor(() => h.hub.runner.isRunning(ja), 5000, 'first job running')
    const b = chatIdOf(await post(h, s.cookie, '/app/chats', { text: '두 번째 대화', _csrf: s.csrf }))!
    const page = await (await get(h, s.cookie, `/app/chats/${b}`)).text()
    expect(page).toContain('앞에 1개 작업이 있어요.')
    // its SSE starts with the queue position
    const jb = (db.query('SELECT id FROM hub_jobs WHERE chat_id = ?').get(b) as any).id
    const first = await sse(h, s.cookie, `/app/chats/${b}/events?job=${jb}`, (e) => e.length > 0)
    expect(first.evs[0]).toMatchObject({ event: 'status', data: { state: 'queued', position: 1, text: '앞에 1개 작업이 있어요.' } })
    // the running one shows what it wrote so far after a reconnect
    await waitFor(() => h.hub.runner.liveText(ja), 5000, 'first delta')
    const live = await sse(h, s.cookie, `/app/chats/${a}/events?job=${ja}`, (e) => e.some((x) => x.event === 'text'))
    expect(live.evs.find((e) => e.event === 'text')!.data).toMatchObject({ full: true, text: '생각하는 중' })
    // cancel the first: the second runs
    const c = await post(h, s.cookie, `/app/chats/${a}/cancel`, { _csrf: s.csrf })
    expect(c.headers.get('location')).toBe(`/app/chats/${a}?n=cancelled`)
    await h.hub.runner.wait(ja)
    expect(jobRow(h, ja).status).toBe('cancelled')
    await h.hub.runner.wait(jb)
    expect(jobRow(h, jb).status).toBe('done')
    const pa = await (await get(h, s.cookie, `/app/chats/${a}?n=cancelled`)).text()
    expect(pa).toContain('작업을 취소했어요.')
    expect(pa).toContain('<div class="msg error">취소했어요.</div>')
  }, 20_000)

  test('a failure shows in the chat and over SSE', async () => {
    const a = chatIdOf(await post(h, s.cookie, '/app/chats', { text: '한도 [fail]', _csrf: s.csrf }))!
    const ja = (db.query('SELECT id FROM hub_jobs WHERE chat_id = ?').get(a) as any).id
    const ev = await sse(h, s.cookie, `/app/chats/${a}/events?job=${ja}`)
    expect(ev.evs.at(-1)).toMatchObject({ event: 'failed', data: { text: '이번 달 사용 한도를 넘었어요. 관리자에게 문의해 주세요.' } })
    const page = await (await get(h, s.cookie, `/app/chats/${a}`)).text()
    expect(page).toContain('이번 달 사용 한도를 넘었어요.')
  }, 15_000)

  test('one person cannot fill the queue', async () => {
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(chatIdOf(await post(h, s.cookie, '/app/chats', { text: `대기 ${i} [hang]`, _csrf: s.csrf }))!)
    const r = await post(h, s.cookie, '/app/chats', { text: '네 번째', _csrf: s.csrf })
    expect(r.status).toBe(429)
    expect(await r.text()).toContain('이미 진행 중인 작업이 많아요')
    for (const id of ids) await post(h, s.cookie, `/app/chats/${id}/delete`, { _csrf: s.csrf })
    expect((db.query("SELECT COUNT(*) AS n FROM hub_jobs WHERE status IN ('queued','running')").get() as any).n).toBe(0)
  })
})

describe('hub chat without claude', async () => {
  const h = await make({ claude: false })
  const u = await h.t.user('nobin')
  const s = h.t.session(u.id)
  test('pages say so and the composer is off', async () => {
    const html = await (await get(h, s.cookie, '/app/chats/new')).text()
    expect(html).toContain('휴대폰 채팅을 쓸 수 없어요')
    expect(html).toMatch(/<textarea[^>]*disabled/)
  })
})
