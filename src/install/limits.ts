// Guessing limits for the enrollment API and the client address they are keyed by.
//
// Only failed attempts count. A whole office usually shares one public address (and behind the Cloudflare tunnel every
// request arrives from 127.0.0.1), so counting successful enrollments would lock out the 11th person who installs in
// the same hour while doing nothing against someone guessing codes.
import type { C } from '../http/app'

export class FailureLimiter {
  private fails = new Map<string, number[]>()
  constructor(private max: number, private windowMs: number) {}

  /** true when `key` already has `max` failures inside the window */
  blocked(key: string, now = Date.now()): boolean {
    const xs = this.recent(key, now)
    if (xs.length) this.fails.set(key, xs)
    else this.fails.delete(key)
    return xs.length >= this.max
  }

  fail(key: string, now = Date.now()) {
    const xs = this.recent(key, now)
    xs.push(now)
    this.fails.set(key, xs)
    if (this.fails.size > 10_000) {
      for (const [k] of this.fails) if (!this.recent(k, now).length) this.fails.delete(k)
    }
  }

  private recent(key: string, now: number): number[] {
    return (this.fails.get(key) ?? []).filter((t) => t > now - this.windowMs)
  }
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/
const IP_TEXT = /^[0-9A-Fa-f:.]{2,45}$/

/** The client's address. When the request comes from this machine (cloudflared runs next to the hub), the address
 *  Cloudflare saw is in `cf-connecting-ip`; a remote client cannot set that header to fake another address. */
export function clientAddress(c: C): string {
  const peer = c.get('clientIp') || ''
  if (!peer || LOOPBACK.test(peer)) {
    const cf = c.req.header('cf-connecting-ip')?.trim()
    if (cf && IP_TEXT.test(cf)) return cf
  }
  return peer || 'unknown'
}
