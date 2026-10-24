// Phone chats: a chat is a Claude Code session on the hub (resumed turn after turn) plus the messages people see.
// Only the person who started a chat can see or change it (every query is scoped by user id).
import fs from 'node:fs'
import path from 'node:path'
import type { Ctx } from '../context'
import { nowIso } from '../db'
import { newId } from '../ids'
import { HttpError } from '../http/errors'
import { buildSystemPrompt } from './prompt'
import { isSessionId, type JobStatus, type KindHooks } from './runner'

export const MESSAGE_MAX = 20_000
const TITLE_MAX = 40

export interface Chat { id: string; user_id: string; title: string; session_id: string | null; model: string | null; created_at: string; updated_at: string }
export interface Message { id: string; chat_id: string; role: 'user' | 'assistant' | 'error'; text: string; job_id: string | null; at: string }
export interface ChatSummary extends Chat { last_text: string | null; last_role: Message['role'] | null; active_status: JobStatus | null }
export interface ActiveJob { id: string; status: 'queued' | 'running' }

/** The message text from a form, or a 400 with a Korean message. */
export function messageText(v: unknown): string {
  const t = typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim() : ''
  if (!t) throw new HttpError(400, 'validation', '보낼 내용을 적어 주세요.')
  if (t.length > MESSAGE_MAX) throw new HttpError(400, 'validation', `한 번에 ${MESSAGE_MAX.toLocaleString('ko-KR')}자까지 보낼 수 있어요.`)
  return t
}

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > TITLE_MAX ? line.slice(0, TITLE_MAX) + '…' : line
}

export function createChat(ctx: Ctx, userId: string, firstText: string): Chat {
  const id = newId()
  const now = nowIso()
  ctx.db.query('INSERT INTO hub_chats (id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)').run(id, userId, titleFrom(firstText), now, now)
  return getChat(ctx, id, userId)!
}

export function getChat(ctx: Ctx, id: string, userId: string): Chat | null {
  return ctx.db.query('SELECT * FROM hub_chats WHERE id = ? AND user_id = ?').get(id, userId) as Chat | null
}

/** Newest first, with the last message and whether a job is waiting or running. */
export function listChats(ctx: Ctx, userId: string, limit = 100): ChatSummary[] {
  return ctx.db.query(`SELECT c.*,
      (SELECT text FROM hub_messages m WHERE m.chat_id = c.id ORDER BY m.at DESC, m.rowid DESC LIMIT 1) AS last_text,
      (SELECT role FROM hub_messages m WHERE m.chat_id = c.id ORDER BY m.at DESC, m.rowid DESC LIMIT 1) AS last_role,
      (SELECT status FROM hub_jobs j WHERE j.chat_id = c.id AND j.status IN ('queued','running') LIMIT 1) AS active_status
    FROM hub_chats c WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.rowid DESC LIMIT ?`).all(userId, limit) as ChatSummary[]
}

export function chatMessages(ctx: Ctx, chatId: string): Message[] {
  return ctx.db.query('SELECT * FROM hub_messages WHERE chat_id = ? ORDER BY at, rowid').all(chatId) as Message[]
}

export function addMessage(ctx: Ctx, chatId: string, role: Message['role'], text: string, jobId: string | null) {
  const now = nowIso()
  ctx.db.query('INSERT INTO hub_messages (id, chat_id, role, text, job_id, at) VALUES (?,?,?,?,?,?)').run(newId(), chatId, role, text, jobId, now)
  ctx.db.query('UPDATE hub_chats SET updated_at = ? WHERE id = ?').run(now, chatId)
}

export function activeChatJob(ctx: Ctx, chatId: string): ActiveJob | null {
  return ctx.db.query("SELECT id, status FROM hub_jobs WHERE chat_id = ? AND status IN ('queued','running') ORDER BY created_at LIMIT 1").get(chatId) as ActiveJob | null
}

/** queued + running jobs of a person (chat and run-now; limits how much of the small hub one person can take) */
export function activeJobCount(ctx: Ctx, userId: string): number {
  return (ctx.db.query("SELECT COUNT(*) AS n FROM hub_jobs WHERE user_id = ? AND status IN ('queued','running')").get(userId) as { n: number }).n
}

/** Delete a chat and its Claude Code transcript on the hub (the caller cancels its job first). */
export function deleteChat(ctx: Ctx, chat: Chat) {
  ctx.db.query('DELETE FROM hub_chats WHERE id = ? AND user_id = ?').run(chat.id, chat.user_id)
  if (chat.session_id) forgetSession(ctx, chat.user_id, chat.session_id)
}

/** Remove a session's transcript from the person's Claude Code folder (<home>/projects/<cwd slug>/<id>.jsonl). */
export function forgetSession(ctx: Ctx, userId: string, sessionId: string) {
  if (!isSessionId(sessionId) || !/^[a-z0-9]+$/.test(userId)) return
  const projects = path.join(ctx.config.dataDir, 'hub', 'claude', userId, 'projects')
  let dirs: string[] = []
  try { dirs = fs.readdirSync(projects) } catch { return }
  for (const d of dirs) {
    const dir = path.join(projects, d)
    try {
      fs.rmSync(path.join(dir, `${sessionId}.jsonl`), { force: true })
      fs.rmSync(path.join(dir, sessionId), { recursive: true, force: true })
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
    } catch { /* not a folder */ }
  }
}

export function chatHooks(ctx: Ctx): KindHooks {
  return {
    prepare(job, user) {
      const chat = job.chat_id ? (ctx.db.query('SELECT session_id, model FROM hub_chats WHERE id = ?').get(job.chat_id) as Pick<Chat, 'session_id' | 'model'> | null) : null
      return {
        systemPrompt: buildSystemPrompt(ctx, user, { kind: 'chat' }),
        resume: chat?.session_id ? { sessionId: chat.session_id, model: chat.model } : null,
        persist: true,
        finalText: 'all',
      }
    },
    finish(job, out) {
      if (!job.chat_id) return out
      const exists = ctx.db.query('SELECT 1 FROM hub_chats WHERE id = ?').get(job.chat_id)
      if (!exists) return out // deleted meanwhile
      if (out.sessionId) {
        if (out.newSession) ctx.db.query('UPDATE hub_chats SET session_id = ?, model = ? WHERE id = ?').run(out.sessionId, out.model, job.chat_id)
        else ctx.db.query('UPDATE hub_chats SET session_id = ? WHERE id = ?').run(out.sessionId, job.chat_id)
      }
      if (out.status === 'done') addMessage(ctx, job.chat_id, 'assistant', out.text || '(빈 답이 왔어요.)', job.id)
      else addMessage(ctx, job.chat_id, 'error', out.error || '답하지 못했어요.', job.id)
      return out
    },
  }
}
