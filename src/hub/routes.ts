// Hub sessions: phone chat and schedules under /app (session auth), plus the background job runner and scheduler.
//   GET  /app                        chat list (newest first); admins also see job counts
//   GET  /app/chats/new              new chat (composer)
//   POST /app/chats                  start a chat with its first message
//   GET  /app/chats/:id              messages, live progress, composer
//   POST /app/chats/:id/messages     next message (resumes the chat's Claude session)
//   GET  /app/chats/:id/events       live progress (SSE)
//   POST /app/chats/:id/cancel       stop the waiting/running answer
//   POST /app/chats/:id/delete       delete the chat (and its transcript on the hub)
//   GET  /app/schedules              schedules + create form
//   POST /app/schedules              create
//   POST /app/schedules/:id/run      run now
//   POST /app/schedules/:id/toggle   enable / disable
//   POST /app/schedules/:id/delete   delete
//   GET  /app/files?path=…           download a team-folder file the person may read (a schedule's saved result)
// Everything is personal: a chat or schedule is only found for the person who made it (404 for anyone else).
import { streamSSE } from 'hono/streaming'
import { authorize } from '../policy/authorize'
import { Denied, ToolError } from '../policy/errors'
import { verifyChain } from '../policy/resolve'
import { readRegular } from '../files/store'
import type { Context } from 'hono'
import type { AppEnv, C, Register } from '../http/app'
import { requireSession, sessionMiddleware } from '../http/app'
import { HttpError } from '../http/errors'
import type { Ctx } from '../context'
import { csrfOk, type SessionAuth } from '../auth/sessions'
import { getUser } from '../auth/users'
import { renderMarkdown } from './markdown'
import { hubFor } from './service'
import type { JobEvent, JobRow } from './runner'
import {
  activeChatJob, activeJobCount, addMessage, chatMessages, createChat, deleteChat, getChat, listChats, messageText,
} from './chats'
import {
  activeRun, createSchedule, deleteSchedule, getSchedule, lastRun, listSchedules, runSchedule, setEnabled,
} from './schedules'
import { ChatPage, HomePage, MessagePage, NewChatPage, SchedulesPage, type LiveJob, type ScheduleForm, type ScheduleView } from './pages'

/** largest file /app/files hands out */
export const DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024
/** sent as plain UTF-8 text (a phone shows or saves it; Markdown has no viewer there) */
const TEXT_FILE = /\.(md|markdown|txt|csv|tsv|log|json)$/i

/** `attachment` with an ASCII fallback name and the real (Korean) name in filename*. */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%;]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** queued + running jobs one person may have from chat and run-now (the hub runs only 2–3 at once) */
export const PER_PERSON_ACTIVE = 3
const HEARTBEAT_MS = 15_000

type Html = { toString(): string | Promise<string> }
const page = async (c: Context<AppEnv>, el: Html, status = 200) => c.html('<!doctype html>' + (await el.toString()), status as any)

const sessionOf = (c: C) => c.get('session') as SessionAuth

async function form(c: C): Promise<Record<string, string>> {
  const body = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v
  return out
}

const notFound = (c: C) => page(c, MessagePage({ user: c.get('session')?.user ?? null, title: '찾을 수 없어요', message: '없는 대화이거나 볼 수 없는 페이지예요.' }), 404)
const badCsrf = (c: C) => page(c, MessagePage({ user: c.get('session')?.user ?? null, title: '다시 시도해 주세요', message: '보안 확인에 실패했어요. 페이지를 새로 고친 뒤 다시 해 주세요.' }), 403)

const isAdmin = (s: SessionAuth) => s.user.role === 'owner' || s.user.role === 'admin'

export const register: Register = (app, ctx) => {
  const hub = () => hubFor(ctx)
  const claudeReady = () => !!ctx.config.claudeBin

  // session auth for every /app page; people who must change their password go there first (web module)
  const gate = [sessionMiddleware(ctx), requireSession, async (c: C, next: () => Promise<void>) => {
    if (getUser(ctx.db, sessionOf(c).user.id)?.mustChangePassword) return c.redirect('/me/password')
    await next()
  }] as const
  app.use('/app', ...gate)
  app.use('/app/*', ...gate)

  // chats -------------------------------------------------------------------------------------------------------------

  app.get('/app', (c) => {
    const s = sessionOf(c)
    return page(c, HomePage({ user: s.user, chats: listChats(ctx, s.user.id), notice: c.req.query('n'), claudeReady: claudeReady(), stats: isAdmin(s) ? hub().stats() : null }))
  })

  app.get('/app/chats/new', (c) => {
    const s = sessionOf(c)
    return page(c, NewChatPage({ user: s.user, csrf: s.csrf, claudeReady: claudeReady() }))
  })

  app.post('/app/chats', async (c) => {
    const s = sessionOf(c)
    const f = await form(c)
    if (!csrfOk(s, f._csrf)) return badCsrf(c)
    let text: string
    try { text = messageText(f.text) } catch (e) {
      return page(c, NewChatPage({ user: s.user, csrf: s.csrf, claudeReady: claudeReady(), error: (e as Error).message, text: f.text }), 400)
    }
    if (activeJobCount(ctx, s.user.id) >= PER_PERSON_ACTIVE) {
      return page(c, NewChatPage({ user: s.user, csrf: s.csrf, claudeReady: claudeReady(), error: '이미 진행 중인 작업이 많아요. 끝난 뒤 다시 보내 주세요.', text }), 429)
    }
    const chat = createChat(ctx, s.user.id, text)
    const jobId = hub().runner.enqueue({ kind: 'chat', userId: s.user.id, chatId: chat.id, prompt: text })
    addMessage(ctx, chat.id, 'user', text, jobId)
    return c.redirect(`/app/chats/${chat.id}`, 303)
  })

  const liveJob = (chatId: string): LiveJob | null => {
    const j = activeChatJob(ctx, chatId)
    if (!j) return null
    const r = hub().runner
    const pos = r.position(j.id)
    if (j.status === 'queued' || pos !== null) {
      return { id: j.id, state: 'queued', status: pos ? `앞에 ${pos}개 작업이 있어요.` : '곧 시작해요.', text: '' }
    }
    return { id: j.id, state: 'running', status: '답을 쓰고 있어요…', text: r.liveText(j.id) ?? '' }
  }

  app.get('/app/chats/:id', (c) => {
    const s = sessionOf(c)
    const chat = getChat(ctx, c.req.param('id'), s.user.id)
    if (!chat) return notFound(c)
    return page(c, ChatPage({ user: s.user, csrf: s.csrf, chat, messages: chatMessages(ctx, chat.id), live: liveJob(chat.id), notice: c.req.query('n'), claudeReady: claudeReady() }))
  })

  app.post('/app/chats/:id/messages', async (c) => {
    const s = sessionOf(c)
    const chat = getChat(ctx, c.req.param('id'), s.user.id)
    if (!chat) return notFound(c)
    const f = await form(c)
    if (!csrfOk(s, f._csrf)) return badCsrf(c)
    let text: string
    try { text = messageText(f.text) } catch (e) {
      return page(c, ChatPage({ user: s.user, csrf: s.csrf, chat, messages: chatMessages(ctx, chat.id), live: liveJob(chat.id), error: (e as Error).message, claudeReady: claudeReady() }), 400)
    }
    if (activeChatJob(ctx, chat.id)) return c.redirect(`/app/chats/${chat.id}?n=busy`, 303)
    if (activeJobCount(ctx, s.user.id) >= PER_PERSON_ACTIVE) return c.redirect(`/app/chats/${chat.id}?n=limit`, 303)
    const jobId = hub().runner.enqueue({ kind: 'chat', userId: s.user.id, chatId: chat.id, prompt: text })
    addMessage(ctx, chat.id, 'user', text, jobId)
    return c.redirect(`/app/chats/${chat.id}`, 303)
  })

  app.post('/app/chats/:id/cancel', async (c) => {
    const s = sessionOf(c)
    const chat = getChat(ctx, c.req.param('id'), s.user.id)
    if (!chat) return notFound(c)
    if (!csrfOk(s, (await form(c))._csrf)) return badCsrf(c)
    const j = activeChatJob(ctx, chat.id)
    if (j) hub().runner.cancel(j.id)
    return c.redirect(`/app/chats/${chat.id}${j ? '?n=cancelled' : ''}`, 303)
  })

  app.post('/app/chats/:id/delete', async (c) => {
    const s = sessionOf(c)
    const chat = getChat(ctx, c.req.param('id'), s.user.id)
    if (!chat) return notFound(c)
    if (!csrfOk(s, (await form(c))._csrf)) return badCsrf(c)
    const j = activeChatJob(ctx, chat.id)
    if (j) {
      hub().runner.cancel(j.id)
      await hub().runner.wait(j.id)
    }
    deleteChat(ctx, getChat(ctx, chat.id, s.user.id) ?? chat)
    return c.redirect('/app?n=deleted', 303)
  })

  app.get('/app/chats/:id/events', (c) => {
    const s = sessionOf(c)
    const chat = getChat(ctx, c.req.param('id'), s.user.id)
    if (!chat) return notFound(c)
    const wanted = c.req.query('job') ?? null
    return streamSSE(c, async (stream) => {
      type Out = { event: string; data: string }
      const pending: Out[] = []
      let wake: (() => void) | null = null
      let open = true
      const push = (o: Out) => { pending.push(o); wake?.() }
      const send = (event: string, data: Record<string, unknown>) => push({ event, data: JSON.stringify(data) })
      const forward = (e: JobEvent) => {
        if (e.chatId !== chat.id) return
        if (e.type === 'done') send('done', { jobId: e.jobId, text: e.text, html: renderMarkdown(e.text) })
        else if (e.type === 'error') send('failed', { jobId: e.jobId, text: e.text })
        else send(e.type, { jobId: e.jobId, text: e.text, state: e.state, ...(e.position === undefined ? {} : { position: e.position }) })
      }
      // listener and snapshot in the same tick: no event can fall between them or be counted twice
      ctx.events.on('job', forward)
      const r = hub().runner
      const active = activeChatJob(ctx, chat.id)
      if (active) {
        const pos = r.position(active.id)
        if (pos !== null || active.status === 'queued') send('status', { jobId: active.id, state: 'queued', text: pos ? `앞에 ${pos}개 작업이 있어요.` : '곧 시작해요.', position: pos ?? 0 })
        else {
          send('status', { jobId: active.id, state: 'running', text: '답을 쓰고 있어요…' })
          send('text', { jobId: active.id, text: r.liveText(active.id) ?? '', full: true })
        }
      } else if (wanted) {
        // the job finished between the page and this connection
        const j = ctx.db.query('SELECT * FROM hub_jobs WHERE id = ? AND chat_id = ?').get(wanted, chat.id) as JobRow | null
        if (j?.status === 'done') {
          const text = j.result ?? ''
          send('done', { jobId: j.id, text, html: renderMarkdown(text) })
        } else if (j) send('failed', { jobId: j.id, text: j.error ?? '답하지 못했어요.' })
      }
      const beat = setInterval(() => push({ event: '', data: '' }), HEARTBEAT_MS)
      stream.onAbort(() => { open = false; wake?.() })
      try {
        while (open) {
          while (open && pending.length) {
            const o = pending.shift()!
            if (!o.event) { await stream.write(': ping\n\n'); continue }
            await stream.writeSSE(o)
            if (o.event === 'done' || o.event === 'failed') open = false
          }
          if (!open) break
          await new Promise<void>((res) => { wake = res })
          wake = null
        }
      } finally {
        clearInterval(beat)
        ctx.events.off('job', forward)
      }
    })
  })

  // files -------------------------------------------------------------------------------------------------------------
  // A download of one file the person may read (the same permission check as their Claude's file tools). Missing and
  // not allowed answer the same 404.

  const noFile = (c: C) => page(c, MessagePage({ user: sessionOf(c).user, title: '파일을 찾을 수 없어요', message: '지워졌거나 옮겨졌거나, 볼 권한이 없는 파일이에요.', back: '/app/schedules' }), 404)

  app.get('/app/files', (c) => {
    const s = sessionOf(c)
    const input = c.req.query('path') ?? ''
    let f
    try {
      f = authorize(ctx.fx, ctx.rules(), s.user, input, 'read')
      if (!f.exists || !f.st?.isFile()) return noFile(c)
      if (f.st.size > DOWNLOAD_MAX_BYTES) {
        return page(c, MessagePage({ user: s.user, title: '파일이 너무 커요', message: `휴대폰으로는 ${DOWNLOAD_MAX_BYTES / 1024 / 1024}MB까지 받을 수 있어요. PC의 Claude에게 열어 달라고 해 주세요.`, back: '/app/schedules' }), 413)
      }
      verifyChain(ctx.fx.root, f.segs)
      const { bytes } = readRegular(f.abs, DOWNLOAD_MAX_BYTES)
      const name = f.segs[f.segs.length - 1]!
      return new Response(new Blob([new Uint8Array(bytes)]), {
        headers: {
          'content-type': TEXT_FILE.test(name) ? 'text/plain; charset=utf-8' : 'application/octet-stream',
          'content-disposition': attachment(name),
          'content-length': String(bytes.length),
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      })
    } catch (e) {
      if (e instanceof Denied || e instanceof ToolError) return noFile(c)
      throw e
    }
  })

  // schedules ---------------------------------------------------------------------------------------------------------

  const schedulesPage = (c: C, o: { form?: ScheduleForm; error?: string | null; status?: number } = {}) => {
    const s = sessionOf(c)
    const views: ScheduleView[] = listSchedules(ctx, s.user.id).map((x) => ({ ...x, last: lastRun(ctx, x.id), active: activeRun(ctx, x.id)?.status ?? null }))
    return page(c, SchedulesPage({ user: s.user, csrf: s.csrf, schedules: views, form: o.form ?? {}, notice: c.req.query('n'), error: o.error, claudeReady: claudeReady() }), o.status ?? 200)
  }

  app.get('/app/schedules', (c) => schedulesPage(c))

  app.post('/app/schedules', async (c) => {
    const s = sessionOf(c)
    const f = await form(c)
    if (!csrfOk(s, f._csrf)) return badCsrf(c)
    const values: ScheduleForm = { name: f.name, when: f.when, cron: f.cron, prompt: f.prompt, outputDir: f.outputDir }
    try {
      createSchedule(ctx, s.user, values)
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) return schedulesPage(c, { form: values, error: e.message, status: 400 })
      throw e
    }
    return c.redirect('/app/schedules?n=created', 303)
  })

  const scheduleAction = (fn: (c: C, s: SessionAuth, sched: NonNullable<ReturnType<typeof getSchedule>>) => string) => async (c: C) => {
    const s = sessionOf(c)
    const sched = getSchedule(ctx, c.req.param('id') ?? '', s.user.id)
    if (!sched) return notFound(c)
    if (!csrfOk(s, (await form(c))._csrf)) return badCsrf(c)
    return c.redirect(`/app/schedules?n=${fn(c, s, sched)}`, 303)
  }

  app.post('/app/schedules/:id/run', scheduleAction((_c, s, sched) => {
    if (activeJobCount(ctx, s.user.id) >= PER_PERSON_ACTIVE) return 'running'
    return runSchedule(ctx, (o) => hub().runner.enqueue(o), sched) ? 'started' : 'running'
  }))

  app.post('/app/schedules/:id/toggle', scheduleAction((_c, _s, sched) => {
    setEnabled(ctx, sched, !sched.enabled)
    return sched.enabled ? 'off' : 'on'
  }))

  app.post('/app/schedules/:id/delete', scheduleAction((_c, _s, sched) => {
    const a = activeRun(ctx, sched.id)
    if (a) hub().runner.cancel(a.id)
    deleteSchedule(ctx, sched)
    return 'removed'
  }))
}

/** Start background work (job runner, scheduler). `selfUrl` = this server's loopback URL. Returns a stop function. */
export function start(ctx: Ctx, selfUrl: string): () => Promise<void> {
  const h = hubFor(ctx)
  h.start(selfUrl)
  return () => h.stop()
}
