// Entry point: `bun src/main.ts` (the LaunchAgent / systemd unit runs this).
import path from 'node:path'
import { loadConfig, hubUrl } from './config'
import { openDb } from './db'
import { fileSecrets } from './secrets'
import { consoleLog } from './log'
import { makeCtx } from './context'
import { serve } from './server'
import { initTeamFolder } from './policy/rules-admin'
import { countUsers } from './auth/users'
import { PRODUCT } from './product'

const config = loadConfig()
const log = consoleLog()
const db = openDb(path.join(config.dataDir, 'hub.db'))
const ctx = makeCtx({ config, db, secrets: fileSecrets(config.dataDir), log })
initTeamFolder(db, ctx.fx.root)
const running = serve(ctx)
log.info(`${PRODUCT.displayName} ${PRODUCT.version} listening`, { url: running.url, hub: hubUrl(config), teamRoot: config.teamRoot })
if (countUsers(db) === 0) log.warn('no owner yet: open the web page and finish setup, or run `bun src/cli.ts init`', { url: running.url + '/setup' })

const shutdown = async () => { await running.stop(); db.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
