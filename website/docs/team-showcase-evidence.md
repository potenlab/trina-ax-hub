# Team showcase evidence

Checked 2026-10-29 against the read-only product checkout `trina-app/trina-ax` at
`5c15812aef8d5bb3f11875f03ce41ef574e2a1ce`, and `guide-evidence.md`.
Website base: `34bf68351814548cc9ed73d74a634b1fb5997bd6`.

The home section keeps `#roles`. Its six chapters and 18 requests are in
`src/content/teams.ts`, rendered by `Roles.astro`. Existing detailed role guides
keep their original examples in `en.ts` / `ko.ts` and `RoleDocument.astro`.
The named skills, people, paths and results are illustrative, not installed defaults.
The section labels every request as an example and explains that results depend on
registered skills and source material. No real customer data is used.

| Claim | Product evidence / boundary |
| --- | --- |
| Team skills apply company writing rules | `web/src/i18n/ko.ts`: `skills.desc`, `skills.registerWarn`, `suggest.desc`; reviewed skills in `skills/` guide the team's AI. Does not promise identical or error-free results. |
| Knowledge from the asking person's accessible folders | `docs/PERMISSIONS.md`; `server/src/tools/make-file.ts` uses `authorize` on source and destination. The scope statement appears once at section level. |
| Read HWP/HWPX; produce Word replies | `docs/OFFICE.md` document-reading section; `server/src/tools/index.ts` `make_file`. No HWP/HWPX output. |
| DOCX/PPTX with team document styles | `server/src/tools/make-file.ts` `template`: matching `.docx`/`.pptx` under `skills/`, passed to Pandoc `--reference-doc`. No promise of exact slide-layout copying. |
| XLSX tables and PDF reports | `server/src/tools/index.ts`, `make-file.ts`: Markdown/CSV conversion; each Markdown table becomes a sheet. Spreadsheet previews explicitly say values, no formulas. No existing workbook-format replication. |
| Web search | `docs/OFFICE.md`: web search via Anthropic; `server/src/tools/web-fetch.ts` for public-page text. Marketing example requests news and source checks, not automatic publication. |
| Scheduled weekly report | `server/src/tools/schedules.ts`: self-contained prompt, new chat, user's access, team time zone. The source folders and private output are specified; unattended confirmation-dependent writes do not proceed. Preview says it is a completed-run example. |
| Generic external work-service read | `docs/INTEGRATIONS.md`: configured MCP and HTTP API connections with access rules on every call. Example explicitly requires a configured read API and shows no named/preinstalled CRM. Korean copy uses customer-facing “외부 서비스” and “API 연결”. |
| Save confirmation before broader audience | `docs/PERMISSIONS.md`; `make-file.ts` `checkWidening`; `web/src/i18n/{ko,en}.ts` `ask.serverTitle`. The preview stays pending; no simulated approval control or claim of completed shared-folder save. |
| Draft email and customer reply | File creation only. Copy tells the person to review and send it themselves. |
| Finance counts and missing-receipt review | Counts are fictional and explicitly based on files, not live bank data. An absent register entry means “확인 필요”, not a missing receipt finding. |

Intentionally omitted: visual image interpretation, Excel formulas, native phone
apps, built-in CRM integrations, automatic email/message delivery, automatic
publishing, HWP/HWPX generation and financial/legal advice.

## Interaction and verification

All 18 examples and previews are present in HTML. Jump links are native anchors
and preserve keyboard focus on chapter headings. A first-party IntersectionObserver
adds one 320 ms entrance per card; it never hides content, has no timer or autoplay,
and respects `prefers-reduced-motion` both initially and after changes. The section
has a pause toggle. Without JavaScript the toggle is hidden and all examples remain.
Colors and fonts reuse existing theme tokens, including dark mode.

`test/teams.test.ts` checks the built content, per-example skills/sources, previews,
links, confirmation status and capability boundaries. Existing guide-link, CSP,
SEO, Korean-copy and font coverage checks also run.

## QA result (2026-10-29)

- `bun run test` in `website/`: 248 pass, 0 fail (8 files).
- `bun run build`: 32 static pages built.
- Connected `playwright` desktop (1440 px) and `playwright_phone` (390 × 844):
  `/ko/` and `/`, system light and dark, all six chapters scrolled. No console/page
  errors or horizontal overflow; all 18 cards readable. Desktop chapter captures
  use 1440 × 1100; overview captures use 1440 × 1000.
- Keyboard Enter on a team jump focuses its heading after native navigation;
  Space toggles scroll effects off/on. Dynamic reduced-motion preference disables
  effects and hides the control. Mobile touch jumps also land on a visible heading.
- JavaScript disabled: both languages × both themes at 390 px show all 18 examples,
  hide the inactive motion control and have no horizontal overflow.
- Screenshot directory:
  `/Users/potenlab/trina-qa/QA-2026-10-28/results/screenshots/SITE-TEAMS/`.
  Names: `{desktop|phone}-{ko|en}-{light|dark}-{overview|sales|marketing|finance|people|operations|leadership}.png`;
  plus phone confirmation, desktop reduced-motion and no-JavaScript captures.
- `scripts/verify.mjs` was updated for team navigation, motion and no-JavaScript
  checks. Its standalone Chromium launch is blocked by this sandbox's macOS
  process permissions; browser verification above used the connected sessions.

The sandbox makes the original clone's `.git` read-only. Work was isolated at
`/Users/potenlab/trina-qa/site-teams`, based on the requested production commit,
with Git metadata at `/private/tmp/trina-site-teams-git`. No original worktree was
modified. The branch is `feat/site-team-showcase`; a portable Git bundle is provided
in the QA results directory so the reviewer can fetch the commit into their clone.
