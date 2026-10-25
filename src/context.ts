// Everything a module needs, passed around explicitly (no globals).
import type { Database } from 'bun:sqlite'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { Config } from './config'
import type { Secrets } from './secrets'
import type { Log } from './log'
import { RuleSet } from './policy/access'
import { detectCaseInsensitive } from './policy/resolve'
import type { FsCtx } from './policy/authorize'
import { PRODUCT } from './product'

export interface Ctx {
  config: Config
  db: Database
  fx: FsCtx
  /** folder rules, loaded once and reloaded after any change (call rulesChanged()) */
  rules(): RuleSet
  rulesChanged(): void
  secrets: Secrets
  log: Log
  /** in-process events: 'job' (hub job progress), 'skills' (skills folder changed) */
  events: EventEmitter
}

export function makeCtx(o: { config: Config; db: Database; secrets: Secrets; log: Log }): Ctx {
  fs.mkdirSync(o.config.teamRoot, { recursive: true })
  fs.mkdirSync(path.join(o.config.teamRoot, PRODUCT.systemDir), { recursive: true, mode: 0o700 })
  let rules: RuleSet | null = null
  const events = new EventEmitter()
  events.setMaxListeners(1000)
  const fx: FsCtx = { root: fs.realpathSync(o.config.teamRoot), caseInsensitive: detectCaseInsensitive(o.config.teamRoot) }
  return {
    config: o.config,
    db: o.db,
    fx,
    // rules compare folder names the way this file system does (case-insensitive here or not)
    rules: () => (rules ??= RuleSet.load(o.db, { caseInsensitive: fx.caseInsensitive })),
    rulesChanged: () => { rules = null; events.emit('skills') },
    secrets: o.secrets,
    log: o.log,
    events,
  }
}
