# Trina AX — design

This document began as the build plan for the hub and now records how it works: the shape of the system, the
conventions, and each module's contract. Dated sections at the end record later additions.

Trina AX lets a company of 10–60 people use Claude with the company's own files, skills and budget, without a
shared subscription and without running every session on one small server.

- **Claude runs on each employee's PC** (Claude Code CLI or the desktop app's Code tab). The PC carries the memory.
- **The hub** (this repo; a Mac mini in the office, or a Linux server) holds what the company shares:
  1. **Files** — the team folder, exposed to each PC's Claude as MCP tools, with per-folder permissions and an audit log.
  2. **Skills** — `skills/` in the team folder, packaged as a Claude Code plugin per person and served as a plugin
     marketplace. Claude Code installs and auto-updates it.
  3. **Model relay** — Claude Code's `ANTHROPIC_BASE_URL` points at the hub. The hub swaps the employee's device token
     for the company's Anthropic API key, enforces budgets and records usage per person, per model and per skill.
  4. **Hub sessions** — a few `claude -p` runs on the hub itself for phone chat and scheduled jobs (concurrency 2–3,
     queued), with built-in tools disabled so they can only touch files through the same MCP permissions.
  5. **Web pages** — setup, admin (people, groups, folders, budgets, usage, skills, settings, audit), personal page
     (install a PC, my usage), phone chat.
- **Tokens are billed to the customer's own Anthropic account.** No subscription is shared; no token is resold.

Verified end to end with Claude Code 2.1.309 (`tests/e2e/full-flow.test.ts`): installer → plugin with the person's
skills → PC model calls through the relay with the company key → company files over MCP (rules and skills reach the
model) → phone chat as a hub session. With an MCP server configured, Claude Code also fetches Anthropic's public MCP
registry from api.anthropic.com; that request carries none of our credentials.

Never share a Claude subscription login or OAuth token between people. The relay only ever uses an API key the
customer owns (`<dataDir>/secrets/anthropic-api-key`).

## Repository layout

| Path | What |
|---|---|
| `src/config.ts`, `src/db.ts`, `migrations/`, `src/context.ts`, `src/http/`, `src/auth/`, `src/policy/`, `src/secrets.ts`, `src/log.ts`, `src/audit.ts`, `src/ids.ts`, `src/product.ts`, `src/server.ts`, `src/main.ts` | foundation: config, database, HTTP app, sessions and tokens, folder permissions |
| `src/skills/catalog.ts`, `src/usage/budgets.ts`, `src/usage/report.ts`, `src/ui/` | shared services, page shell (`Page`, `Csrf`, `CopyBlock`, CSS) and formatters |
| `src/relay/` | model relay, pricing, skill counting |
| `src/mcp/`, `src/files/` | MCP endpoint, file service, text extraction, search |
| `src/skills/marketplace.ts`, `src/skills/zip.ts`, `src/skills/routes.ts`, `src/install/`, `installer/` | marketplace, PC installer, enrollment |
| `src/oauth/`, `src/telemetry/` | authorization server for Claude app connectors; OpenTelemetry ingest for usage |
| `src/hub/` | hub sessions: runner, chat, schedules, phone pages |
| `src/web/` | setup, login, invites, personal and admin pages |
| `deploy/` | hub install (macOS LaunchDaemon, Linux unit) and `deploy/cloudflare/customer-address.ts` (operator side: customer addresses) |
| `website/` | the product site, ax.trina.app (Astro, static) |
| `tests/unit/<area>*.test.ts`, `tests/e2e/<area>*.test.ts` | tests per area |

The schema in `migrations/001_init.sql` is the base; later changes are numbered migration files per area:
`migrations/1xx_<area>.sql` (relay 110–119, files 120–129, install 130–139, hub 140–149, web 150–159).

## Conventions

- Bun 1.3.12, TypeScript strict, Hono 4.13, zod 4, bun:sqlite. No Python, no Node-only APIs that Bun lacks.
- Every module exports `register: Register` (`(app, ctx) => void`, see `src/http/app.ts`). `src/server.ts` mounts them.
- Messages people read are Korean, plain and short (해요체). Error responses: `jsonError(status, code, message)`;
  relay errors in Anthropic's shape: `apiError(status, type, message)` (`src/http/errors.ts`).
- Never log or audit a token, the API key, a password or file contents. Tokens are stored as sha256 only.
- Times in the DB are ISO UTC strings (`nowIso()`); "today"/"this month" use the server's local calendar.
- Paths from clients are team-folder relative and always go through `authorize()` (`src/policy/authorize.ts`).
  Never build a filesystem path from client input any other way.
- Tests: `bun test tests/unit` must pass and `bun run typecheck` must be clean before you report done. Use
  `tests/lib/hub.ts` (`testHub()`) to run a real hub on a random port with a temp folder.

## Foundation API

- `Ctx` (`src/context.ts`): `config`, `db`, `fx` (`{ root, caseInsensitive }`), `rules()`, `rulesChanged()`,
  `secrets.getApiKey()/setApiKey()/apiKeyHint()`, `log`, `events` (EventEmitter: `'job'`, `'skills'`).
- Auth (`src/http/app.ts`): `requireToken(ctx, 'json' | 'anthropic')` sets `c.get('tokenAuth')` =
  `{ token: TokenRow, user: Principal }`; `sessionMiddleware(ctx)` sets `c.get('session')` = `{ user, csrf, idHash }`
  or null; `requireSession`, `requireAdmin`. Forms must post `_csrf` and be checked with `csrfOk(session, value)`.
- Tokens (`src/auth/tokens.ts`): `issueToken(db, userId, 'device' | 'hub', name, ttlMs?)`, `verifyToken`,
  `tokenFromHeaders`, `listTokens`, `revokeToken`. Enroll codes (`src/auth/enroll.ts`): `makeEnrollCode`,
  `redeemEnrollCode(db, code, deviceName)` → `{ userId, tokenId, token }`.
- People (`src/auth/users.ts`): `createUser`, `getUser`, `listUsers`, `updateUser`, `setPassword`, `verifyPassword`,
  `listGroups`, `createGroup`, `deleteGroup`, `setUserGroups`. Sessions (`src/auth/sessions.ts`).
- Permissions (`src/policy/*`, adapted from Team AX, an earlier Trina product): `authorize(fx, rules, user, input, 'read'|'write'|'list', opts)`,
  `visiblePath`, `siblingVisible`, `RuleSet.access/canList`, `loadPrincipal`. Rules admin: `listRules`, `setRule`,
  `initTeamFolder` (`src/policy/rules-admin.ts`). Personal folders: `users/<userId>/` (only that person).
- Skills (`src/skills/catalog.ts`): `scanSkills(root)`, `skillsFor(root, rules, user)`, `rulesFor(root, rules, user)`,
  `skillFiles(root, skill)`, `readFrontMatter`.
- Usage (`src/usage/*`): `budgetBlock(db, userId)`, `checkBudgets`, `listBudgets`, `createBudget`, `deleteBudget`,
  `usageReport`, `skillReport`, `toolReport`, `activeDays`, `usageCsv`.
- Settings: `getSetting(db, key, fallback)` / `setSetting(db, key, value)` (`src/db.ts`).
- Audit: `audit(db, { actor, action, target, detail })`.

## Module contracts

### relay (`src/relay/`)

Claude Code on a PC runs with `ANTHROPIC_BASE_URL=<hub>` and `ANTHROPIC_AUTH_TOKEN=<device token>` (sent as
`Authorization: Bearer`). Hub sessions use the same with a `hub` token over loopback.

- Routes: `POST /v1/messages`, `POST /v1/messages/count_tokens`, `GET /v1/models` (answer from the upstream with the
  company key, or a small static list), `HEAD /api/hello` and `GET /api/hello` (200). Everything else under `/v1/` → 404.
- Auth: `requireToken(ctx, 'anthropic')`. Budget: `budgetBlock(db, user.id)` → **403** `permission_error` with the
  Korean message (403, not 429: Claude Code retries 429 by itself). No API key set → 503 with a message telling the
  person to ask the admin.
- Forward to `ctx.config.upstreamBaseUrl + path` with `x-api-key: <company key>`, `anthropic-version` and
  `anthropic-beta` **unchanged**, plus `content-type`, `accept`, `user-agent`, `x-app`. Drop every other request header
  (the device token must never reach Anthropic). `redirect: 'manual'`; a redirect is a 502.
- Request checks (the idea of Team AX's `checkProxyRequest`, lighter): POST only on the two message paths; body a
  JSON object; `model` matches `^claude-[a-z0-9][a-z0-9.-]{0,79}$`; refuse `mcp_servers` and `container` keys (403).
  Re-serialize the parsed body before sending. Do not filter content blocks or betas.
- Stream: pass SSE through **unbuffered** (`highWaterMark: 0` ReadableStream), cancel upstream when the client hangs
  up, forward error bodies unmodified. Read usage from `message_start` (input, cache read/write, model) and
  `message_delta` (output, running total). Record one `usage` row per request (also on abort with what was seen):
  `source` = 'hub' for hub tokens else 'pc', `job_id` from header `x-trina-job` only when the token is a hub token.
- Skill counting: while streaming, detect `content_block_start` with `content_block.type === 'tool_use'` and
  `name === 'Skill'`; collect its `input_json_delta` partial JSON until `content_block_stop`, parse, take
  `input.skill` (or `input.command`/`input.name` as fallback) and insert a `skill_events` row (source 'relay').
  Non-streaming responses: scan `content[]` the same way.
- Pricing (`src/relay/pricing.ts`): USD per million tokens, matched by model id, overridable through setting
  `pricing` (array of `{ match: string (regex), input, output, cacheWrite5m, cacheWrite1h, cacheRead }`). Defaults
  (from platform.claude.com pricing, 2026-10-25): fable-5-1 / mythos-5-1: 10 / 50, cache write 12.5 (5m) 20 (1h),
  read 0.25 · fable-5 / mythos-5: 10 / 50, 12.5 / 20, read 1 · opus-5-5: 4 / 20, 5 / 8, read 0.20 · opus-5, opus-4-5…4-8:
  5 / 25, 6.25 / 10, read 0.5 · opus-4, opus-4-1: 15 / 75, 18.75 / 30, 1.5 · sonnet-5-5: 2 / 10, 2.5 / 4, read 0.10 ·
  sonnet-5: 2 / 10, 2.5 / 4, 0.20 · sonnet-4-x: 3 / 15, 3.75 / 6, 0.30 · haiku-5-5: 0.10 / 0.50, 0.125 / 0.20, 0.01 —
  but when the prompt (input + cache read + cache write) is over 100,000 tokens: 0.50 / 2.50, 0.625 / 1, 0.05 ·
  haiku-4-5: 1 / 5, 1.25 / 2, 0.10. Unknown model → the most expensive entry. `cache_creation` in usage may carry
  `ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`; use them when present, else price
  `cache_creation_input_tokens` as 5-minute writes.
- Tests: a fake upstream (`Bun.serve`) that checks it received the company key and not the device token, streams SSE
  with usage and a Skill tool_use, and returns errors; cover budget block, missing key, abort mid-stream, count_tokens,
  non-streaming, header stripping, pricing math (incl. the Haiku 5.5 tier).

### files + MCP (`src/files/`, `src/mcp/`)

The PC's Claude Code registers the hub as an HTTP MCP server named `trina` (`claude mcp add --transport http trina
<hub>/mcp --header "Authorization: Bearer <token>"`). Tools appear as `mcp__trina__<tool>`.

- Endpoint `POST /mcp`: MCP Streamable HTTP, JSON-RPC 2.0. Answer with `application/json` (no SSE needed). Support
  `initialize` (echo the client's protocolVersion when it is one we know, else `2025-06-18`; `capabilities: { tools: {} }`;
  `serverInfo: { name: 'trina-ax', version }`; **`instructions`**), `notifications/initialized` (202, no body), `ping`,
  `tools/list`, `tools/call`. Batches (array bodies) too. `GET /mcp` → 405. `DELETE /mcp` → 200. Unknown method →
  JSON-RPC error -32601. Auth: `requireToken(ctx, 'json')`. Load the person again on every call (`loadPrincipal`).
- `instructions` (≤ 3,500 chars; Claude Code cuts at 4,096): who they are (name, groups), that company files are
  reached only through these tools with team-folder paths, their personal folder `users/<id>/`, `skills/RULES.md`
  text (`rulesFor`, trimmed), and the list of their skills (`skillsFor`: `- name: description`, trimmed to fit) with a
  note that the skills are installed on their PC as the "company" plugin and their files live under `skills/…`.
- Tools (names and schemas are a contract; descriptions in English for the model, results may contain Korean):
  - `list_files { path?: string, depth?: 1..3 }` — folders and files the person can see (name, type, size, mtime).
  - `read_file { path: string, offset?: number, limit?: number }` — text with line numbers like Claude's Read
    (cap ~2,000 lines / 256 KB per call; say how to continue). Office/PDF/HWP files: extracted text (`extract.ts`,
    adapted from Team AX's extractor and HWP reader: pandoc for docx/pptx/odt, SheetJS for xlsx/xls/ods,
    pdftotext for pdf, the HWP/HWPX readers). Images: return MCP `image` content (base64) up to 5 MB.
  - `search_files { query: string, path?: string, mode?: 'content' | 'name', glob?: string, limit?: number }` —
    ripgrep on the server over the folders the person can read (as in Team AX's search: allowed roots + excludes,
    `--no-follow`, size caps) plus filename matching; results filtered again with `visiblePath`.
  - `write_file { path: string, content: string, overwrite?: boolean }` — create or replace a text file; the old
    version is kept (`file_versions`, stored under `.trina/versions/`). Refuse to overwrite unless `overwrite: true`.
  - `edit_file { path: string, old_string: string, new_string: string, replace_all?: boolean }` — exact string
    replacement like Claude's Edit (must match once unless replace_all); keeps a version.
  - `make_folder { path: string }`
  - `move_file { from: string, to: string }` — write access on both sides.
  - `delete_file { path: string }` — moves to `.trina/trash/<date>/` (version row reason 'trash'), never unlinks.
  - `read_skill { name: string }` — the SKILL.md (and file list) of a skill the person may use; records a
    `skill_events` row (source 'mcp'). Lets hub sessions (no plugin there) use skills too.
- Every call writes a `tool_events` row (user, token id, tool, short summary with the path, ok). Denied paths answer
  exactly like missing ones (the policy code already does this — keep it that way).
- Writes: atomic (temp file in the same folder, prefix `PRODUCT.tmpPrefix`, then rename), `verifyChain` right
  before the rename, size cap 20 MB.
- Tests: permission matrix (member vs admin vs other group, users/<id>/ privacy), every tool, instructions content and
  length, JSON-RPC edge cases, extraction of docx/xlsx/pdf when the tools exist (skip otherwise).

### skills marketplace + PC install (`src/skills/marketplace.ts`, `src/skills/zip.ts`, `src/skills/routes.ts`, `src/install/`, `installer/`)

Per Claude Code docs (plugins/marketplace-reference, host-marketplace, install, org):

- `GET /plugins/marketplace.json` (token auth via `Authorization: Bearer`, which Claude Code sends from the
  marketplace source's `headers`). Body:
  ```json
  { "name": "trina-ax", "owner": { "name": "<company name or 'Trina AX'>" }, "description": "...",
    "plugins": [ { "name": "company", "description": "...", "source": { "source": "archive",
      "url": "<hub public https url>/plugins/company-<sha12>.zip", "sha256": "<64 hex>" } } ] }
  ```
  One plugin `company` per person = all skills they can read (`skillsFor`). Plugin name and manifest name must match.
  No `version` anywhere (the archive's sha256 becomes the version, so a new zip = an update).
- `GET /plugins/company-<sha12>.zip` (token auth): the person's zip. Layout at the zip root:
  `.claude-plugin/plugin.json` (`{ "name": "company", "description": ... }`), `skills/<skill-dir>/SKILL.md` + the skill's
  files (`skillFiles`). If two packs have the same skill folder name, prefix the later one with `<pack>-`.
  Deterministic zip (sorted entries, fixed mtime 1980-01-01, fflate) so the same content always has the same sha256.
  Cache by content hash; refuse a sha that does not match what this person would get now (404).
- Archive URLs must be `https://` and not loopback (Claude Code refuses others). Use `config.publicUrl`. If there is
  none, still serve the JSON (with the local URL) but the personal page must warn that skills need the public address.
- Enrollment API `POST /api/enroll { code, deviceName, os }` (rate-limited per IP, 10/hour): redeem the code →
  `{ token, hubUrl, mcpUrl, marketplaceUrl, marketplaceName: 'trina-ax', plugin: 'company@trina-ax', user: { name } }`.
- Installers, served rendered with the hub URL baked in (no secrets in them):
  - `GET /install.sh` (macOS/Linux, bash): `curl -fsSL <hub>/install.sh | bash -s -- <CODE>`.
  - `GET /install.ps1` (Windows PowerShell 5.1+): `& ([scriptblock]::Create((irm <hub>/install.ps1))) <CODE>`.
  - Steps: (1) install Claude Code if `claude` is missing (official `https://claude.ai/install.sh` /
    `https://claude.ai/install.ps1`); (2) redeem the code; (3) merge into `~/.claude/settings.json` without losing
    existing keys: `env.ANTHROPIC_BASE_URL`, `env.ANTHROPIC_AUTH_TOKEN`, `extraKnownMarketplaces["trina-ax"] =
    { source: { source: "url", url: <marketplace url>, headers: { Authorization: "Bearer <token>" } }, autoUpdate: true }`,
    `enabledPlugins["company@trina-ax"] = true` (back up the old file first); (4) `claude mcp remove trina --scope user`
    (ignore errors) then `claude mcp add --transport http trina --scope user <hub>/mcp --header "Authorization: Bearer
    <token>"`; (5) print what was done and how to undo it. JSON merge: macOS with `/usr/bin/osascript -l JavaScript`
    (always present), Linux with `python3` or `node`, Windows with `ConvertFrom-Json`/`ConvertTo-Json -Depth 20`.
  - `--uninstall` removes exactly those keys and the MCP entry.
- Tests: zip determinism + layout, marketplace JSON shape, permission-filtered contents, sha mismatch 404, enroll API,
  installer script syntax (`bash -n`), the JSON merge on a sample settings file (macOS JXA path), and an e2e that runs the
  real `claude plugin marketplace add`/`install` against the hub over HTTPS when a public URL is available (e.g.
  `cloudflared tunnel --url`), skipped otherwise.

### hub sessions (`src/hub/`)

- `start(ctx, selfUrl)`: a job runner (concurrency `config.hubConcurrency`, FIFO) and a scheduler (croner). Jobs
  left `running`/`queued` at startup become `failed` ("서버가 다시 시작되어 중단됐어요").
- A job runs `claude -p <prompt> --output-format stream-json --verbose --tools "" --strict-mcp-config --mcp-config
  <json file> --allowedTools <every mcp__trina__ tool name> --permission-mode dontAsk --setting-sources ""
  --append-system-prompt <short system text>` (+ `--resume <session_id>` for a chat's later turns), cwd = an empty
  per-job folder under `<dataDir>/hub/work/`, env: `PATH` minimal, `HOME` and `CLAUDE_CONFIG_DIR` =
  `<dataDir>/hub/claude/<userId>` (keeps sessions per person, never the Mac's own login), `ANTHROPIC_BASE_URL=selfUrl`,
  `ANTHROPIC_AUTH_TOKEN=<hub token for that person, 2 h>`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
  `ANTHROPIC_CUSTOM_HEADERS=x-trina-job: <jobId>`. The MCP config points at `selfUrl + '/mcp'` with the same token.
  Kill after 15 minutes. Parse stream-json: assistant text deltas → progress events (`ctx.events.emit('job', …)`),
  final `result` → job result, `session_id` → chat. Revoke the hub token when the job ends.
- Phone chat pages under `/app` (session auth, mobile-first, Korean): chat list, a chat (messages + composer), live
  progress over SSE (`GET /app/chats/:id/events`), new chat, delete chat. Schedules under `/app/schedules`: list,
  create (name, cron with presets like 매일 9시 / 평일 9시 / 매주 월요일, prompt, output folder), enable/disable,
  run now, last result. A schedule's result is saved as Markdown into its output folder through the same permission
  checks (the person must have write access), file name `YYYY-MM-DD HHmm <name>.md`.
- Tests: a fake `claude` script (bash) that prints stream-json lines and echoes its args/env to a file; check the exact
  flags and env, concurrency and queueing, timeout kill, restart recovery, chat resume with session id, schedule
  next-run computation and result saving, permissions on schedule output folders.

### web pages (`src/web/`)

Server-rendered with Hono JSX, one small CSS file inline, a little vanilla JS. Korean. Works on a phone.
`sessionMiddleware(ctx)` on all page routes.

- `/setup` (only while there are no users): company name, owner account (username, name, password), optional API key
  → creates the owner, `initTeamFolder`, logs in.
- `/login`, `/logout` (POST). Rate-limit login per IP and per username. `must_change_password` → `/me/password`.
- `/` → `/admin` for admins, else `/me`.
- `/me`: my PCs (devices = device tokens: name, last used, revoke), **"PC 연결하기"** → makes an enroll code and shows
  the one-line install command for Mac and Windows (copy buttons) with the hub URL, plus a warning when no public URL
  is set (skills need it); my usage this month (cost, requests, by day), my skills (`skillsFor`), link to `/app`.
- `/admin` dashboard: this month's cost and requests, active people (`activeDays`) vs total, top people, top skills,
  budgets near or over the limit, whether the API key and public URL are set.
- `/admin/users`: list, add (temp password shown once, must change), edit role/name/status/groups, reset password,
  make an enroll code for someone, see/revoke their devices.
- `/admin/groups`, `/admin/folders` (rules: folder path, subject, access; show the team-folder tree top two levels),
  `/admin/budgets`, `/admin/usage` (date range, group by user/day/model/group/source, skills and tools tables, CSV
  export at `/admin/usage.csv`), `/admin/skills` (catalog by pack, who can use each pack, RULES.md preview),
  `/admin/settings` (company name, public URL, LAN URL, hub concurrency, API key set/replace/remove — write-only,
  shows hint and a "연결 확인" button that calls the upstream `/v1/models` with the key), `/admin/audit`.
- Every POST checks `_csrf`. Only owner may change the API key and owner-level settings; admins manage the rest.
- Tests: page renders (200 + key text) for each role, CSRF refusal, setup flow, login rate limit, enroll-code flow
  from `/me`, usage CSV.

## Added after review (2026-10-25)

- **Usage rollup**: `usage_daily` (local day × person × source × model) is updated in the same transaction as each
  `usage` row; budgets, reports and `activeDays` read it (`src/usage/rollup.ts`, `ensureUsageRollup` at startup).
  Budget checks stay under 1 ms at 800k usage rows. Token limits count input + output + cache writes, not cache reads.
- **Relay caps**: at most 6 model requests in flight per person and 40 per company (429 + `retry-after`, settings
  `relayMaxInflightPerUser` / `relayMaxInflight`); output on an early hang-up is estimated from streamed characters;
  server tools that run code (`code_execution*`, `mcp_toolset`, …) are refused; Anthropic's refusals of the company key
  show on the dashboard (`src/relay/health.ts`).
- **Devices**: `tokens.created_by`, `approved_at`, `hub_url`. A PC someone else enrolled (an admin) works for the model
  and team folders but cannot open the person's own `users/<id>/` until they approve it on `/me`. Archive links in the
  marketplace use the https origin the PC actually used, so a hub address change does not break updates.
- **Files**: spreadsheets and HWP/HWPX are parsed in an isolated worker process with time, size and cell caps; folder
  rules compare names NFC- and (on case-insensitive disks) case-folded; `move_file` cannot turn text into a binary
  kind; deleted/overwritten files are kept 90 days and restored from `/admin/versions` or `trina-ax versions|restore`.
- **Setup lock**: `/setup` opens only on the hub machine itself or with the one-time token from the server log /
  `trina-ax status`. One owner is enforced by a unique index.
- **Operations**: `deploy/macos/install-hub.sh` installs LaunchDaemons (always on after a power cut), sleep/restart
  settings and log rotation; `trina-ax doctor|backup|users|versions|restore`; operator guide in `docs/OPERATOR.md`.

## Two ways to use Claude (2026-10-25)

Per person, with a company default (setting `defaultModelAccess`, initially **subscription**; `users.model_access`
overrides; `src/auth/access-mode.ts`):

| | subscription (default) | company_key |
|---|---|---|
| Model calls | the person's own Claude login (Team seat, Pro, Max), straight to Anthropic | through the hub relay, billed to the company API key |
| Installer writes | MCP + plugin + telemetry env (`CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_*` → `<hub>/otel/v1/logs`) | MCP + plugin + `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` |
| Usage on the hub | Claude Code OpenTelemetry events → `usage` rows with source `sub` (estimated cost) | relay → `usage` rows with source `pc` |
| Budgets | shown, never blocking; not counted in company budgets | enforced (403) |
| Relay | refuses this person's device tokens | allowed |

The enroll response carries `mode`, `env` (exact keys to set) and `envOwned` (every key the installer manages), so
the scripts apply whatever the hub says and switching modes is a re-install.

**Claude apps (web, desktop, mobile, Cowork)**: each person adds `<public>/mcp` as a custom connector in their own
Claude app (Team: the Claude org owner adds it once; members press Connect). The hub is an OAuth authorization
server for that (`src/oauth/routes.tsx`: RFC 9728 protected-resource metadata, RFC 8414 metadata, RFC 7591 DCR
limited to Claude's callbacks, code + PKCE S256, RFC 8707 resource, 1-hour access tokens of kind `connector`,
rotating 60-day refresh tokens, code-replay revocation). `/mcp` answers 401 with
`WWW-Authenticate: Bearer resource_metadata=…`. Connector tokens can never use the relay. Claude connects from
Anthropic's cloud, so the public https address must reach `/mcp`, `/oauth/*` and `/.well-known/*` unchallenged.

**Hub sessions** (phone chat in `/app`, schedules) run on the hub and always use the company key, so they need one;
without it the phone path is the Claude app connector.

Verified with real Claude Code 2.1.309 over a Cloudflare quick tunnel: `tests/e2e/full-flow-subscription.test.ts`
(no relay, MCP + skills, telemetry usage, connector discovery) and `tests/e2e/full-flow.test.ts` (company key).

## Customer addresses: `<company>.trina.app` (2026-10-25)

Every customer hub gets `https://<company>.trina.app` by default (a customer-owned domain stays possible, by hand).
`deploy/cloudflare/customer-address.ts` runs on a Trina operator's computer, never on the customer's Mac, so the
Cloudflare API token never leaves us. `new <company>` checks the name (lowercase letters, digits, hyphens, 2–40;
reserved names such as `www`, `console`, `drive` and any name that already has DNS are refused), then creates the
remotely managed tunnel `trina-ax-<company>`, its one route `https://<company>.trina.app → http://127.0.0.1:<port>`
(then `http_status:404`), a proxied CNAME to `<tunnel>.cfargotunnel.com`, and writes the tunnel token to a 0600 file
that is carried to the hub (`install-hub.sh --tunnel-token-file`). It never prints a secret and is safe to re-run:
it finishes a half-made address, keeps an existing route's port, and refuses to repoint a tunnel or DNS record that
serves another address. `check`, `list`, `token` and `remove --yes` cover the rest of the life cycle.
One level only: Universal SSL covers `*.trina.app` but not `*.ax.trina.app`.

Shared parent domain → **`__Host-` cookies on https** (`src/http/cookies.ts`). All customer hubs are siblings under
trina.app, so without the prefix one hub could set `tax_session=…; Domain=trina.app` (or a known `tax_pre` form
token) and another hub would read it. On https the hub only sets and reads `__Host-tax_session` / `__Host-tax_pre`
(Secure, Path=/, no Domain), which a browser accepts only from that exact host. Plain http on the office LAN keeps
the bare names (the prefix needs Secure); that is a different host anyway. trina.app's own site and console set no
cookie Domain in their code (checked 2026-10-25), so their sessions stay host-only and are not sent to customer hubs.
