// Small in-memory sliding-window limiter (login, enrollment). Restarting the server resets it, which is fine for
// slowing down guessing; codes and passwords are long enough on their own.
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
