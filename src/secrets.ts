// Secrets on disk under <dataDir>/secrets (folder 0700, files 0600). The company Anthropic API key never goes into the
// database, a log line, an audit detail or a page; the admin page only shows whether one is set and its last 4 chars.
import fs from 'node:fs'
import path from 'node:path'

export interface Secrets {
  getApiKey(): string | null
  setApiKey(key: string | null): void
  apiKeyHint(): string | null
}

export function fileSecrets(dataDir: string): Secrets {
  const dir = path.join(dataDir, 'secrets')
  const keyFile = path.join(dir, 'anthropic-api-key')
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
  }
}

/** In-memory secrets for tests */
export function memorySecrets(initial: string | null = null): Secrets {
  let k = initial
  return { getApiKey: () => k, setApiKey: (v) => { k = v }, apiKeyHint: () => (k ? '…' + k.slice(-4) : null) }
}
