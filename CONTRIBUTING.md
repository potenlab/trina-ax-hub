# Contributing to Trina AX

Thanks for helping. Trina AX is the hub that sits between a company's people and Claude: it serves company files,
skills and a model relay, and it holds the company's Anthropic API key. Correctness and security come before features.
This page covers setup, tests, and what we look for in a pull request.

## Ground rules

- **Security issues go to contact@trina.app, not to public issues.** See [SECURITY.md](SECURITY.md).
- Be kind; we follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- For anything larger than a bug fix, open an issue first so we can agree on the approach.
- **License and sign-off.** Trina AX is licensed under [Apache-2.0](LICENSE), and contributions are accepted under
  the same license (Apache-2.0, section 5), with no separate agreement to sign. Sign off every commit with
  `git commit -s`, which adds `Signed-off-by: Your Name <you@example.com>` and certifies the
  [Developer Certificate of Origin](#developer-certificate-of-origin) below. Forgot? `git commit --amend -s` for
  the last commit, or `git rebase --signoff main` for all of them.
- Do not copy code from AGPL or GPL projects, and do not add a GPL or AGPL runtime dependency
  (see [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md)).

## Setup

Needs [Bun](https://bun.sh) 1.3.12, plus ripgrep, pandoc and poppler for searching and reading files
(`brew install ripgrep pandoc poppler` on macOS; `ripgrep pandoc poppler-utils bubblewrap` on Debian/Ubuntu).
`bun install` also downloads SheetJS (`xlsx`) from `cdn.sheetjs.com`, so that host must be reachable.

```sh
bun install
TRINA_AX_HOME=$PWD/.dev bun run dev      # http://127.0.0.1:47900/setup : create the owner account
TRINA_AX_HOME=$PWD/.dev bun src/cli.ts help
```

`.dev/` is ignored by git. Without `TRINA_AX_HOME` the hub uses `~/TrinaAX`, which is where a real install lives:
do not point a development hub at it. Product names (`Trina AX`, `trina-ax`, `tax_` tokens, the `trina` MCP name)
come from [`src/product.ts`](src/product.ts); never hard-code them.

## Tests

```sh
bun run typecheck       # tsc, strict
bun run test            # unit tests (bun test tests/unit); deploy scripts run for real against fake launchctl/sudo
bun run test:e2e        # real Claude Code against a hub behind a Cloudflare quick tunnel
```

The unit suite must pass and the typecheck must be clean before you open a pull request. The end-to-end tests need the
real `claude` CLI at `~/.local/bin/claude` and `cloudflared`; they skip themselves when either is missing. They use a
fake Anthropic upstream and a temporary `HOME`: nothing may reach `api.anthropic.com` or your own Claude login. Some
unit tests skip themselves when ripgrep, a worker sandbox (`sandbox-exec` on macOS, `bwrap` on Linux) or PowerShell is
missing, and the hub install script tests run only on macOS; install those tools to run everything.

Use `testHub()` from [`tests/lib/hub.ts`](tests/lib/hub.ts) to start a real hub on a random port with a temp folder.

## What makes a good pull request

1. **One way in for files.** Every path that comes from a client goes through `authorize()`
   ([`src/policy/authorize.ts`](src/policy/authorize.ts)). Never build a filesystem path from client input any other
   way.
2. **Hidden equals missing.** A path someone may not see answers exactly like one that does not exist. Add a case to
   `tests/unit/policy-rules.test.ts` or the file service tests when you touch this.
3. **Secrets stay secret.** Never log, audit or render a token, the company API key, a password or file contents.
   Tokens are stored as sha256 only.
4. **No shared logins.** Never share one person's Claude subscription login or OAuth token with another person. The
   relay only uses an API key the customer owns, and it refuses devices that use their own subscription.
5. **Fail closed.** If the hub cannot decide (a missing rule, an unknown model, a parse error), it refuses.
6. **Tests.** Every behavior change has one. Security-relevant changes get a test that fails without the fix.
7. **Docs.** Update the README, `docs/DESIGN.md` or `docs/OPERATOR.md` when commands, settings or behavior change.
8. **Small commits** with messages that say what changed and why.

## Code style

TypeScript strict, ES modules, no build step (Bun runs the sources), Hono with JSX for pages. Keep dependencies few
and pinned. Comments explain why, not what. Text that people read in the hub (pages, errors, CLI output) is Korean in
the polite 해요체: short and plain. English is fine for code, comments, tests and docs for developers.
See [CLAUDE.md](CLAUDE.md) for the short list of rules that AI coding tools also follow.

## Developer Certificate of Origin

By signing off a commit you certify the following ([developercertificate.org](https://developercertificate.org)):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```
