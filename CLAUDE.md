# Trina AX

Read `docs/DESIGN.md` first: what the hub does, the conventions, and each module's contract.

- Bun 1.3.12 + TypeScript strict + Hono + bun:sqlite. `bun run typecheck` and `bun test tests/unit` must pass.
- People-facing text is Korean (해요체), short and plain.
- Never log, audit or render a token, the company API key, a password or file contents.
- Client paths always go through `authorize()` (`src/policy/authorize.ts`).
- Never share a Claude subscription login or OAuth token between people; the relay only uses the customer's own API key.
