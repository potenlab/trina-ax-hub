# Security policy

Trina AX sits between a company's people and Claude: it decides which company files each person's Claude may read,
holds the company's Anthropic API key, and counts what everyone spends. A bug that lets someone see, change or spend
more than they should is a security bug, and we want to hear about it.

## Reporting a vulnerability

**Email contact@trina.app** with the subject "Security: Trina AX". Please do not open a public issue, pull request or
discussion for a vulnerability.

Include what you can:

- the version (`trina-ax status`, or the commit you built from) and how it runs (macOS Mac mini install, Linux
  systemd, from source);
- steps to reproduce, ideally against a fresh hub with test data (`bun run dev` with a temporary `TRINA_AX_HOME`);
- what an attacker gains. For example: a device token reads a file outside its person's folder rules, a hidden path
  can be told apart from a missing one, a person on their own subscription can use the company key, the company API
  key or a token shows up in a log, a page or an audit row, a budget can be skipped, a connector token reaches the
  relay, or the PC installer can be made to write something it should not.

Please do not test against hubs you do not own, and do not access, change or keep other people's data. Never put a
real API key or token in a report; a redacted prefix is enough.

## What to expect

| | |
|---|---|
| First response | within **72 hours** |
| Assessment and severity | within 7 days |
| Fix | as fast as severity requires; critical issues are prioritized over all other work |
| Disclosure | coordinated with you; we credit you in the release notes unless you prefer otherwise |

Security fixes are released to everyone at the same time, self-hosted and Trina-hosted alike. We will not take legal
action against good-faith research that follows this policy.

## Scope

In scope: the hub (`src/`), its web pages and APIs (`/mcp`, `/v1/*`, `/oauth/*`, `/api/enroll`, `/plugins/*`,
`/otel/*`, the admin pages), the PC installers (`installer/`, served as `/install.sh` and `/install.ps1`), the
hub install and operator scripts (`deploy/`), and the migrations.

The parts that matter most: folder permissions (`src/policy/`), the model relay and its budgets (`src/relay/`,
`src/usage/`), token and session handling (`src/auth/`, `src/http/`), the Claude app connector login (`src/oauth/`)
and the isolated workers that read untrusted PDF, Office and HWP files (`src/files/`).

Out of scope: weaknesses that need a person with administrator access to the hub computer (they can read the team
folder and `data/` by design; see "What we do not promise" in the [README](README.md#security-model)), vulnerabilities in
Claude Code, Anthropic's API, Cloudflare or other software we only run next to (report those upstream), and missing
hardening on a hub the operator chose to expose without a public https address.

## Supported versions

Before 1.0, only the latest release (or `main`, if there is no release yet) receives security fixes.
