// hub routes (phone chat, schedules) — see docs/DESIGN.md. Placeholder until the module lands.
import type { Register } from '../http/app'
import type { Ctx } from '../context'

export const register: Register = () => {}

/** Start background work (job runner, scheduler). `selfUrl` = this server's loopback URL. Returns a stop function. */
export function start(_ctx: Ctx, _selfUrl: string): () => Promise<void> {
  return async () => {}
}
