## What and why

<!-- What does this change, and what problem does it solve? Link the issue: Fixes #123 -->

## Permissions, tokens and audit

<!-- Does this touch who can see or change what (src/policy/, src/auth/, src/oauth/, the relay)?
     If yes: which rule, and which test proves a hidden folder stays hidden? Write "no" if it does not. -->

## How it was tested

- [ ] `bun run typecheck`
- [ ] `bun test tests/unit`
- [ ] `bun run test:e2e` (if the installer, MCP, relay or telemetry changed; needs `claude` and `cloudflared`)
- [ ] new or changed behaviour has a test

## Checklist

- [ ] every commit is signed off (`git commit -s`, [DCO](../CONTRIBUTING.md)); contributions are Apache-2.0
- [ ] no secrets, real customer data or personal names in code, tests or screenshots
- [ ] docs updated (README, `docs/`) if behaviour, commands or settings changed
