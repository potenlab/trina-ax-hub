// The office-document reader, run as its own process for every spreadsheet (xlsx / xls / ods) and Hangul document
// (hwp / hwpx): `bun office-worker.ts <kind> [limits JSON]`, the file on stdin, the text on stdout. extract.ts starts
// it isolated like pandoc (isolate.ts: no network, no reading of the team folder or the hub's data, a time limit and
// an output cap), so a crafted or simply huge file can only slow down this one process, never the hub.
// Exit 0 = text on stdout; exit 3 = a message for the person on stderr after MARK; anything else = it failed.
import { ToolError } from '../policy/errors'
import { hwpText, hwpxText } from './hwp'
import { DEFAULT_LIMITS, spreadsheetText, type OfficeLimits } from './office-parse'

export const MARK = 'TRINA-OFFICE-ERROR:'

async function main(): Promise<number> {
  const kind = process.argv[2] ?? ''
  let lim: OfficeLimits = DEFAULT_LIMITS
  try { lim = { ...DEFAULT_LIMITS, ...JSON.parse(process.argv[3] ?? '{}') } } catch {}
  const bytes = new Uint8Array(await Bun.stdin.arrayBuffer())
  try {
    let text: string
    if (kind === 'hwp') text = hwpText(bytes, lim)
    else if (kind === 'hwpx') text = hwpxText(bytes, lim)
    else if (kind === 'xlsx' || kind === 'xls' || kind === 'ods') text = spreadsheetText(bytes, kind, lim)
    else { process.stderr.write(`unknown kind '${kind}'\n`); return 2 }
    await Bun.write(Bun.stdout, text)
    return 0
  } catch (e) {
    if (e instanceof ToolError) { process.stderr.write(`${MARK}${e.message.replace(/\s+/g, ' ')}\n`); return 3 }
    process.stderr.write(String((e as Error)?.message ?? e).slice(0, 300) + '\n')
    return 1
  }
}

if (import.meta.main) process.exit(await main())
