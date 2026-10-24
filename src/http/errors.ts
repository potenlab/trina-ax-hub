// Errors that carry an HTTP status. Messages are shown to people (Korean); `code` is for programs.
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fields?: Record<string, string>) { super(message) }
}

export const jsonError = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

/** Error body in the Anthropic API's shape (the relay answers Claude Code with these). */
export const apiError = (status: number, type: string, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json', ...extra } })
