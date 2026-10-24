// In-memory limiters. Restarting the server resets them, which is fine for slowing down guessing; codes and
// passwords are long enough on their own.

/** Sliding-window limiter that counts every attempt. */
export class RateLimiter {
  private hits = new Map<string, number[]>()
  constructor(private max: number, private windowMs: number) {}
  /** true = allowed (and counted) */
  take(key: string, now = Date.now()): boolean {
    const xs = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs)
    if (xs.length >= this.max) { this.hits.set(key, xs); return false }
    xs.push(now)
    this.hits.set(key, xs)
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => t > now - this.windowMs)) this.hits.delete(k)
    return true
  }
}

/**
 * Counts failures only: check `blocked` before trying, call `fail` when the attempt was wrong. A whole office shares
 * one public address (and the Cloudflare tunnel), so counting successes would lock out honest people.
 */
export class FailureLimiter {
  private fails = new Map<string, number[]>()
  constructor(private max: number, private windowMs: number) {}
  private live(key: string, now: number) { return (this.fails.get(key) ?? []).filter((t) => t > now - this.windowMs) }
  blocked(key: string, now = Date.now()): boolean {
    const xs = this.live(key, now)
    if (xs.length) this.fails.set(key, xs)
    else this.fails.delete(key)
    return xs.length >= this.max
  }
  fail(key: string, now = Date.now()) {
    const xs = this.live(key, now)
    xs.push(now)
    this.fails.set(key, xs)
    if (this.fails.size > 10_000) for (const [k] of this.fails) if (!this.live(k, now).length) this.fails.delete(k)
  }
  clear(key: string) { this.fails.delete(key) }
}
