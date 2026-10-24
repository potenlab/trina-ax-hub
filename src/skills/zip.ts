// Deterministic zip archives: the same entries always give byte-identical output, so the archive's sha256 can serve
// as the plugin version (Claude Code treats a new sha256 as an update and an unchanged one as "nothing to do").
//
// What makes it deterministic: entries are sorted by path (code-unit order, not locale), every entry gets the same
// timestamp (1980-01-01 00:00, the earliest DOS date, written from local-time fields so the time zone does not
// matter), the Unix mode is fixed to 0644 / 0755, no extra fields or comments, and one pinned fflate version.
import { deflateSync, zipSync, type Zippable } from 'fflate'

export interface ZipEntry {
  /** path inside the archive, '/'-separated, no leading slash */
  path: string
  data: Uint8Array
  /** keep the executable bit (scripts that skills run) */
  executable?: boolean
}

/** 1980-01-01 00:00 in local time: fflate encodes the DOS timestamp from local-time getters. */
const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0)
/** Unix "made by" so the mode bits below are honoured by unzip tools */
const OS_UNIX = 3
const MODE_FILE = 0o100644
const MODE_EXEC = 0o100755

const LEVEL = 6
// Already-compressed formats are stored as-is (deflating them again only costs time).
const STORED = /\.(png|jpe?g|gif|webp|avif|heic|zip|gz|tgz|bz2|xz|7z|rar|pdf|docx|xlsx|pptx|hwpx|odt|ods|odp|mp3|mp4|m4a|mov|woff2?)$/i
// Claude Code refuses archives that expand more than 50x (zip-bomb guard); a very repetitive file is stored instead.
const MAX_RATIO = 40

function levelFor(e: ZipEntry): 0 | 6 {
  if (STORED.test(e.path)) return 0
  if (e.data.length >= 100 && deflateSync(e.data, { level: LEVEL }).length * MAX_RATIO < e.data.length) return 0
  return LEVEL
}

/** Build a zip from `entries`. Throws on duplicate or unsafe paths (callers make paths unique first). */
export function deterministicZip(entries: ZipEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const files: Zippable = {}
  let prev: string | null = null
  for (const e of sorted) {
    if (!safeZipPath(e.path)) throw new Error(`unsafe zip path: ${e.path}`)
    if (e.path === prev) throw new Error(`duplicate zip path: ${e.path}`)
    prev = e.path
    // Insertion order is kept for every key that is not integer-like (ours all contain '/' or '.'); either way
    // the order only depends on the paths, so the output stays deterministic.
    files[e.path] = [e.data, {
      level: levelFor(e),
      mtime: FIXED_MTIME,
      os: OS_UNIX,
      attrs: (e.executable ? MODE_EXEC : MODE_FILE) << 16,
    }]
  }
  return zipSync(files)
}

/** Relative, '/'-separated, no empty / '.' / '..' segments, no backslashes or drive letters. */
export function safeZipPath(p: string): boolean {
  if (!p || p.length > 1024 || p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p)) return false
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..')
}
