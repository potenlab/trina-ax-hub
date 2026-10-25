// Request body limits. Bun has one limit for the whole server, so it is set to the largest any route needs and this
// guard applies the real one per route: most routes take bodies up to `default`; the few that stream their body to
// disk (the file upload) take more. A body that declares its size is refused up front; one that does not (chunked) is
// counted as it is read and fails with a 413 once it passes the limit.
import { HttpError, jsonError } from './errors'

export interface BodyLimits {
  /** bytes for every route not listed */
  default: number
  /** bytes per exact path */
  routes: Record<string, number>
}

export interface BodyGuard {
  /** pass to Bun.serve({ maxRequestBodySize }) */
  max: number
  /** the request to handle, or a 413 answer */
  apply(req: Request): Request | Response
}

const pathOf = (url: string) => /^[a-z]+:\/\/[^/]+(\/[^?#]*)?/i.exec(url)?.[1] ?? '/'

export function bodyGuard(o: BodyLimits): BodyGuard {
  const max = Math.max(o.default, ...Object.values(o.routes))
  return {
    max,
    apply(req) {
      if (!req.body || req.method === 'GET' || req.method === 'HEAD') return req
      const limit = o.routes[pathOf(req.url)] ?? o.default
      const declared = Number(req.headers.get('content-length') ?? NaN)
      if (declared > limit) return jsonError(413, 'too_large', '요청이 너무 커요.')
      if (Number.isFinite(declared) || limit >= max) return req
      let n = 0
      const counted = req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          n += chunk.byteLength
          if (n > limit) ctrl.error(new HttpError(413, 'too_large', '요청이 너무 커요.'))
          else ctrl.enqueue(chunk)
        },
      }))
      return new Request(req.url, { method: req.method, headers: req.headers, body: counted, duplex: 'half' } as RequestInit)
    },
  }
}
