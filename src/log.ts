// JSON-lines log to stdout/stderr (the LaunchAgent sends both to <dataDir>/logs). Never log tokens, keys or file text.
export interface Log {
  info(msg: string, f?: Record<string, unknown>): void
  warn(msg: string, f?: Record<string, unknown>): void
  error(msg: string, f?: Record<string, unknown>): void
}

export function consoleLog(quiet = false): Log {
  const line = (level: string, msg: string, f?: Record<string, unknown>) => JSON.stringify({ t: new Date().toISOString(), level, msg, ...f })
  return {
    info: (m, f) => { if (!quiet) console.log(line('info', m, f)) },
    warn: (m, f) => { if (!quiet) console.warn(line('warn', m, f)) },
    error: (m, f) => console.error(line('error', m, f)),
  }
}

export const silentLog: Log = { info() {}, warn() {}, error() {} }
