// Model relay routes (Claude Code's ANTHROPIC_BASE_URL points at the hub) — see docs/DESIGN.md "relay".
import { requireToken, type Register } from '../http/app'
import { apiError } from '../http/errors'
import { PRODUCT } from '../product'
import { MSG, relayMessages } from './proxy'
import { listModels } from './models'

export const register: Register = (app, ctx) => {
  const token = requireToken(ctx, 'anthropic')
  // connectivity check; answers without a token
  app.on(['GET', 'HEAD'], '/api/hello', (c) => c.json({ message: 'hello', product: PRODUCT.id }))
  app.post('/v1/messages', token, (c) => relayMessages(ctx, c, '/v1/messages'))
  app.post('/v1/messages/count_tokens', token, (c) => relayMessages(ctx, c, '/v1/messages/count_tokens'))
  app.get('/v1/models', token, (c) => listModels(ctx, c))
  app.all('/v1/*', () => apiError(404, 'not_found_error', MSG.notFound))
}
