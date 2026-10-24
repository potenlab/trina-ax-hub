# Trina AX

Company Claude without a shared login: Claude runs on each employee's PC; this hub (a Mac mini in the office or a
server) serves the company's files (MCP), skills (a Claude Code plugin marketplace), a model relay that bills the
company's own Anthropic API key with per-person budgets and usage, and a few hub sessions for phone chat and schedules.

- Design and module contracts: [docs/DESIGN.md](docs/DESIGN.md)
- Run locally: `bun install && bun run dev`, then open http://127.0.0.1:47900/setup
- Tests: `bun test tests/unit`, `bun run test:e2e`
