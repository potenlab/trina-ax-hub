// Secrets on disk under <dataDir>/secrets (folder 0700, files 0600). The company Anthropic API key never goes into the
// database, a log line, an audit detail or a page; the admin page only shows whether one is set and its last 4 chars.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface Secrets {
  getApiKey(): string | null
  setApiKey(key: string | null): void
  apiKeyHint(): string | null
  /** one-time token that opens /setup from another computer (null when none) */
  setupToken(): string | null
  /** make (or return) the setup token; called at startup while there are no users */
  ensureSetupToken(): string
  clearSetupToken(): void
}

export function fileSecrets(dataDir: string): Secrets {
  const dir = path.join(dataDir, 'secrets')
  const keyFile = path.join(dir, 'anthropic-api-key')
  const setupFile = path.join(dir, 'setup-token')
  let cache: { mtime: number; value: string | null } | null = null
  const read = (): string | null => {
    try {
      const st = fs.statSync(keyFile)
      if (cache && cache.mtime === st.mtimeMs) return cache.value
      const v = fs.readFileSync(keyFile, 'utf8').trim() || null
      cache = { mtime: st.mtimeMs, value: v }
      return v
    } catch { cache = null; return null }
  }
  return {
    getApiKey: read,
    setApiKey(key) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      if (key === null) { fs.rmSync(keyFile, { force: true }); cache = null; return }
      const tmp = keyFile + '.tmp'
      fs.writeFileSync(tmp, key.trim() + '\n', { mode: 0o600 })
      fs.renameSync(tmp, keyFile)
      cache = null
    },
    apiKeyHint() { const k = read(); return k ? '…' + k.slice(-4) : null },
    setupToken() { try { return fs.readFileSync(setupFile, 'utf8').trim() || null } catch { return null } },
    ensureSetupToken() {
      const cur = this.setupToken()
      if (cur) return cur
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      const t = crypto.randomBytes(18).toString('base64url')
      fs.writeFileSync(setupFile, t + '\n', { mode: 0o600 })
      return t
    },
    clearSetupToken() { fs.rmSync(setupFile, { force: true }) },
  }
}

/** In-memory secrets for tests */
export function memorySecrets(initial: string | null = null): Secrets {
  let k = initial
  let setup: string | null = null
  return {
    getApiKey: () => k, setApiKey: (v) => { k = v }, apiKeyHint: () => (k ? '…' + k.slice(-4) : null),
    setupToken: () => setup,
    ensureSetupToken: () => (setup ??= crypto.randomBytes(18).toString('base64url')),
    clearSetupToken: () => { setup = null },
  }
}
