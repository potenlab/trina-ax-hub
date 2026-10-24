import crypto from 'node:crypto'

const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789'

/** Short random id (lowercase, no look-alike characters). 12 chars ≈ 60 bits. */
export function newId(len = 12): string {
  const bytes = crypto.randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHA[bytes[i]! % ALPHA.length]
  return s
}

export const sha256 = (s: string | Uint8Array) => crypto.createHash('sha256').update(s).digest('hex')

/** URL-safe random secret */
export const secret = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')

/** Constant-time string compare */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
