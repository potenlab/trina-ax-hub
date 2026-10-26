# Trina AX

> **Structure (2026-10-26):** Trina AX is becoming a fork of the Team AX core (`potenlab/team-ax`), where Claude runs on
> the server and people use our own Claude-like app. This repository's current code (a hub for Claude running on each
> employee's PC) will be renamed `trina-ax-hub` and archived. Read `~/.claude/team-ax-family-rule.md` before working here:
> generic fixes go to the core first; Trina-only code goes in `editions/trina/`; never push customer data.

Read `docs/DESIGN.md` first: what the hub does, the conventions, and each module's contract.

- Bun 1.3.12 + TypeScript strict + Hono + bun:sqlite. `bun run typecheck` and `bun test tests/unit` must pass.
- People-facing text is Korean (해요체), short and plain.
- Never log, audit or render a token, the company API key, a password or file contents.
- Client paths always go through `authorize()` (`src/policy/authorize.ts`).
- Never share a Claude subscription login or OAuth token between people; the relay only uses the customer's own API key.
