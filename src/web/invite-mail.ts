// The seam for sending invite links by email. The hub has no mail service yet, so the default mailer sends nothing and
// the admin copies the link or the ready-made message. A future mail module calls setInviteMailer(ctx, mailer); every
// place that creates an invite already calls `deliverInvite`, so nothing else has to change.
export interface InviteMail {
  to: string
  name: string
  company: string
  link: string
  /** the same Korean text the admin would copy */
  message: string
  expiresAt: string
  kind: 'invite' | 'reset'
}

export interface InviteMailer {
  /** false = nothing is ever sent (the page then tells the admin to copy the link) */
  readonly available: boolean
  send(mail: InviteMail): Promise<{ sent: boolean }>
}

export const noMailer: InviteMailer = { available: false, send: async () => ({ sent: false }) }

// one mailer per hub (per Ctx): a mail module registers itself with setInviteMailer(ctx, mailer) at startup
const mailers = new WeakMap<object, InviteMailer>()
export const setInviteMailer = (ctx: object, mailer: InviteMailer | null) => { if (mailer) mailers.set(ctx, mailer); else mailers.delete(ctx) }
export const mailerFor = (ctx: object): InviteMailer => mailers.get(ctx) ?? noMailer

/** Hand a new link to the mailer. Never throws: a failed mail must not lose the link the admin is about to see. */
export async function deliverInvite(mailer: InviteMailer, mail: InviteMail): Promise<boolean> {
  if (!mailer.available) return false
  try { return (await mailer.send(mail)).sent } catch { return false }
}
