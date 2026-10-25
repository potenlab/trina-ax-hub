// Shapes shared by the invite pages and the one-time flash store (kit.tsx). No imports, so nothing cycles.

/** One line of a bulk invite after it was checked (preview) or made (result). */
export interface BulkRow {
  line: number
  name: string
  email: string
  /** new = will be / was created; skip = left out, `reason` says why */
  status: 'new' | 'skip'
  reason?: string
  /** after creation only */
  userId?: string
  token?: string
  expiresAt?: string
  /** the mailer sent it (never, until the hub has a mail service) */
  mailed?: boolean
}
