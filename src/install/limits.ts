// Guessing limits for the enrollment API and the client address they are keyed by (shared helpers in the foundation).
//
// Only failed attempts count. A whole office usually shares one public address (and behind the Cloudflare tunnel every
// request arrives from 127.0.0.1), so counting successful enrollments would lock out the 11th person who installs in
// the same hour while doing nothing against someone guessing codes.
import type { C } from '../http/app'

export { FailureLimiter } from '../auth/rate-limit'

/** The client's address (Cloudflare's `cf-connecting-ip` for tunnelled requests; see `clientAddress` in http/app). */
export const clientAddress = (c: C): string => c.get('clientIp') || 'unknown'
