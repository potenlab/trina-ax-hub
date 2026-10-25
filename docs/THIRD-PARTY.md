# Third-party software and licenses

Trina AX itself is licensed under the [Apache License 2.0](../LICENSE); the required notices are in
[NOTICE](../NOTICE). This page lists what it depends on or runs that is not ours, and the licenses involved.

Last scan: 2026-10-25, from the `license` field of every package in `node_modules/` and `bun.lock` at that commit.
Re-run it whenever `package.json` or `bun.lock` changes (see [How to re-scan](#how-to-re-scan)).

## Summary

- **Nothing is vendored.** The repository contains no third-party source files, fonts or images. npm packages are
  fetched by `bun install` and keep their own licenses.
- **Nothing GPL or AGPL is linked into Trina AX.** Every npm package, runtime and dev, is MIT or Apache-2.0.
- **GPL programs are separate processes, not linked, not shipped:** pandoc and poppler's `pdftotext`. Trina AX starts
  them as child processes from `PATH` (see `src/config.ts`, `src/files/extract.ts`). Whoever installs them (for
  example `deploy/macos/install-hub.sh` through Homebrew) gets them under their own licenses.
- **One dependency does not come from the npm registry:** `xlsx` (SheetJS Community Edition 0.20.3) is installed from
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, pinned with a hash in `bun.lock`. The npm registry copy
  is old and unmaintained, so do not "fix" this to a registry version.

## npm packages

| Package | Version | License | Used for | Shipped in |
|---|---|---|---|---|
| [croner](https://github.com/hexagon/croner) | 9.1.0 | MIT | cron schedules for hub jobs | runtime |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.2 | MIT | deterministic plugin zips | runtime |
| [hono](https://github.com/honojs/hono) | 4.13.13 | MIT | HTTP server and JSX pages | runtime |
| [zod](https://github.com/colinhacks/zod) | 4.6.7 | MIT | input validation | runtime |
| [xlsx](https://git.sheetjs.com/SheetJS/sheetjs) (SheetJS CE) | 0.20.3 | Apache-2.0 | text of spreadsheets, legacy CFB containers | runtime |
| [typescript](https://github.com/microsoft/TypeScript) | 5.9.3 | Apache-2.0 | typecheck only | dev |
| [@types/bun](https://github.com/DefinitelyTyped/DefinitelyTyped) (+ bun-types, @types/node, undici-types) | 1.3.12 | MIT | types only | dev |

## External programs (separate processes)

| Program | License | Used for | Where it is started |
|---|---|---|---|
| [Bun](https://bun.sh) | MIT | the runtime | everywhere |
| [ripgrep](https://github.com/BurntSushi/ripgrep) | MIT or Unlicense | `search_files` | `src/files/search.ts` |
| [pandoc](https://pandoc.org) | GPL-2.0-or-later | text of docx / pptx / odt | `src/files/extract.ts` |
| [poppler](https://poppler.freedesktop.org) `pdftotext` | GPL-2.0 or GPL-3.0 | text of PDFs | `src/files/extract.ts` |
| [bubblewrap](https://github.com/containers/bubblewrap) | LGPL-2.0-or-later | worker sandbox on Linux (macOS uses `sandbox-exec`) | `src/files/isolate.ts` |
| [cloudflared](https://github.com/cloudflare/cloudflared) | Apache-2.0 | public https address (tunnel) | `deploy/macos/install-hub.sh`, e2e tests |
| Claude Code | Anthropic proprietary | the AI on each PC and, for phone chat, on the hub | installed from Anthropic's installer by `installer/` and the operator |

Claude Code is not distributed with Trina AX. Using it is subject to Anthropic's terms. Trina AX never shares one
person's Claude login with another, and the model relay only uses an API key that the customer owns.

## Our own code adapted from elsewhere

| What | Origin | License here |
|---|---|---|
| `src/policy/` (access, names, resolve; the rule model in `rules-admin.ts`), `migrations/001_init.sql` (folder permission tables) | Team AX `server/src/policy/`, same owner (Trina Inc.) | Apache-2.0 (ours) |
| `src/files/extract.ts`, `hwp.ts`, `isolate.ts`, `search.ts`, `store.ts` | Team AX `server/src/files/*` and `server/src/tools/isolate.ts`, same owner | Apache-2.0 (ours) |
| `src/usage/budgets.ts`; ideas in `src/hub/stream.ts`, `src/hub/runner.ts` and the request checks in `src/relay/` | Team AX `server/src/engine/` and `server/src/proxy/model-proxy.ts`, same owner | Apache-2.0 (ours) |

Team AX has its own license (AGPL-3.0), held by the same owner. Offering our own code under Apache-2.0 in this
repository is the owner's decision and does not change how Team AX itself is licensed. Before accepting outside code,
check that it is not copied from AGPL or GPL projects.

## How to re-scan

```sh
bun install --frozen-lockfile
for d in node_modules/*/ node_modules/@*/*/; do
  bun -e "const p=require('./$d/package.json');console.log(p.name+'@'+p.version, p.license??JSON.stringify(p.licenses))"
done
```

Anything that is not MIT, ISC, BSD, Apache-2.0, 0BSD or similar needs a decision before it is merged: nothing GPL or
AGPL may become a runtime dependency.

## Product site (`website/`)

| Component | License | Where |
|---|---|---|
| Geist, Geist Mono (Vercel) | SIL Open Font License 1.1 | `website/src/assets/fonts/`, license text in `website/public/fonts/OFL-Geist.txt` |
| Pretendard (subset) | SIL Open Font License 1.1 | `website/src/assets/fonts/`, license text in `website/public/fonts/OFL-Pretendard.txt` |
| Astro | MIT | build-time dependency (`website/package.json`) |
