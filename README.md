<p align="center">
  <b>Trina AX: your company, in every employee's Claude.</b><br>
  One small hub keeps what the company shares (files with per-person permissions, skills, usage) and connects it to the
  Claude your team already uses: the desktop and phone apps, claude.ai, Claude Code and Cowork.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="https://github.com/potenlab/trina-ax/actions/workflows/ci.yml"><img src="https://github.com/potenlab/trina-ax/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="#self-host"><img src="https://img.shields.io/badge/hub-macOS%20%7C%20Linux-555" alt="Hub: macOS | Linux"></a>
</p>

<p align="center">
  <a href="https://ax.trina.app"><b>Website</b></a> ·
  <a href="#self-host"><b>Self-host</b></a> ·
  <a href="#hosted-by-trina"><b>Hosted by Trina</b></a> ·
  <a href="#security-model"><b>Security model</b></a> ·
  <a href="docs/DESIGN.md"><b>Design</b></a> ·
  <a href="docs/OPERATOR.md"><b>Operator guide (Korean)</b></a>
  <br><sub><a href="README.ko.md">한국어</a></sub>
</p>

## What it is

Trina AX is a hub for companies whose people use Claude and want it to work with the company's own files and ways of
working, **without sharing one login**.

- Each person keeps their own Claude: their own Team, Pro or Max seat, or the company's API key through the hub.
- The **hub** (this repository) runs at `https://<company>.trina.app` when Trina hosts it, or on your own Mac mini or
  Linux server. It holds the team folder, the company skills and the usage records.
- Claude usage is billed by Anthropic to **your** account. Nobody shares a subscription, and Trina does not resell tokens.

## What employees do

On **Claude Team or Enterprise**, nothing is installed on a PC:

1. The admin adds the hub once as an organization connector and pastes the managed settings the hub generates
   (**Admin › Claude 조직 설정** in the hub).
2. Each employee opens their invite link, picks a password, and clicks **Connect** on the company connector in Claude.
3. They ask Claude about company files, on the desktop app, claude.ai, the phone app, Cowork or Claude Code.

On **Pro or Max**, each person adds the connector address once (Claude › Customize › Connectors › Add custom connector).
People on the **company API key** connect Claude Code with one command from their hub page.

## Features

- **Company files with each person's permissions.** The team folder reaches Claude as tools (`list_files`, `read_file`,
  `search_files`, `write_file`, `edit_file`, `move_file`, `delete_file`, ...). Permissions are set per folder, for people
  and groups; a folder someone may not open answers exactly like one that does not exist. Reads PDF, Word, PowerPoint,
  Excel and Korean HWP/HWPX as text. Files can also be uploaded, downloaded and organised in the browser.
- **History and restore.** Every change keeps the previous version; deleted files go to a trash. Both are kept for 90
  days and can be restored.
- **Company skills.** Skills in the team folder's `skills/` are packed into a Claude Code plugin and kept up to date, and
  Claude apps can read them through the connector.
- **Two ways to pay for Claude, per person.** Own subscription (the default; usage arrives from Claude Code's telemetry,
  attributed by the Claude login email) or the **company API key** through the hub's model relay, with monthly limits per
  person, group and company. The key never leaves the hub.
- **Usage.** By person, group, model and skill, with CSV export.
- **Invites.** Admins invite people one by one or by pasting a list; each person gets a single-use link instead of a
  temporary password.
- **Phone chat and scheduled jobs** (optional, company API key): the hub runs a few Claude sessions itself, with
  built-in tools off, so they only touch files through the same permissions.
- **Web pages in Korean** for setup, admin (people, groups, folder permissions, budgets, usage, skills, Claude
  organization setup, settings, audit log, restore) and each person's first-run page.
- **Operations.** A `trina-ax` command (`status`, `doctor`, `backup`, `restore`, `users`, `logs`, ...), an always-on
  macOS LaunchDaemon installer, a Linux systemd unit, `deploy/cloudflare/customer-address.ts` for `<company>.trina.app`
  addresses, and a [Korean operator guide](docs/OPERATOR.md).

## How it works

```
  Claude apps (desktop · claude.ai · phone · Cowork)        Hub  https://<company>.trina.app        Anthropic
  └── organization connector, OAuth per person ──────────►  ┌─────────────────────────────────┐
                                                             │ authorize() on every file path   │
  Claude Code (signed in with the company account)           │ team folder, versions, trash     │
  ├── same connector                                         │ company skills (plugin, tool)    │
  └── managed settings: telemetry + skills ──────────────►  │ usage per person (telemetry)     │
                                                             │ web pages, invites, audit log    │
  Claude Code on the company API key (optional)              │ model relay + budgets            │ ──► api.anthropic.com
  └── one-line installer: relay + MCP + skills ──────────►  └─────────────────────────────────┘     (company key)
```

Design and module contracts: [docs/DESIGN.md](docs/DESIGN.md).

## Self-host

### Try it on your computer

Needs [Bun](https://bun.sh) 1.3.12. ripgrep, pandoc and poppler are optional; they add file search and text from
documents.

```bash
git clone https://github.com/potenlab/trina-ax && cd trina-ax
bun install
bun run dev                 # http://127.0.0.1:47900/setup : create the owner (data in ~/TrinaAX; set TRINA_AX_HOME to change)
bun run typecheck
bun test tests/unit
bun run test:e2e            # the whole flow with a real Claude Code (needs `claude` and `cloudflared`)
bun src/cli.ts help         # admin commands
```

### Run the hub on a Mac mini

Use a dedicated macOS administrator account for the hub. No `sudo` up front: the script asks only at the steps that
need it, and says why.

```bash
git clone https://github.com/potenlab/trina-ax ~/src/trina-ax && cd ~/src/trina-ax
bash deploy/macos/install-hub.sh                     # system service; sudo is asked per step, with the reason
trina-ax status                                      # shows the first-run setup address: create the owner there
bash deploy/macos/install-hub.sh --tunnel-token-file ~/tunnel-token.txt --public-url https://hub.example.com
trina-ax doctor --live                               # when everything is green, invite people
```

- The hub needs a public https address for the Claude apps and for skills. A Cloudflare tunnel works without opening a
  port: create one for your own domain (docs/OPERATOR.md, chapter 4), or run
  `bun deploy/cloudflare/customer-address.ts new <name> --domain example.com` with your own Cloudflare API token.
- Set the public address **before** people connect.
- Update: `git pull && bash deploy/macos/install-hub.sh` (settings stay). Remove: `--uninstall` (`data/` and `team/` stay).
- Linux: see the header of [deploy/linux/trina-ax.service](deploy/linux/trina-ax.service).

## Hosted by Trina

Self-hosting is free. If you'd rather not run it, **Trina hosts it for you**: your hub at `https://<company>.trina.app`
on Trina's servers, set up with your folders and permissions, connected to your Claude organization, and kept updated
and backed up. Trina can also run the rollout and, every month, turn the tasks people repeat into skills.

Pricing is quoted (it depends on people, files and how much operation you want): [ax.trina.app](https://ax.trina.app) ·
[contact@trina.app](mailto:contact@trina.app?subject=Trina%20AX). Hosted or not, the software is the same and it is all in
this repository. Claude usage is always billed by Anthropic to you.

## Security model

- **One door for files.** Every path from any client goes through `authorize()` (`src/policy/`). Rules are per person and
  per group; a path someone may not see looks the same as one that does not exist.
- **Tokens per PC, per app connection, per person, revocable.** Stored hashed (sha256), shown once. Connector tokens are
  short-lived with rotating refresh tokens and can never use the model relay. The organization token (for telemetry and
  the org-wide skills plugin) can do nothing else.
- **The company API key stays on the hub.** A 0600 file, never shown again, never logged. The relay swaps the device
  token for the key, refuses requests that would run code or attach MCP servers on Anthropic's side, and applies budgets
  and in-flight caps.
- **Untrusted files are parsed in isolation** (`sandbox-exec` on macOS, `bwrap` on Linux) with time, size and cell limits.
- **Web hardening.** CSRF tokens on every form, `__Host-` cookies on https (customer hubs share a parent domain), login
  lockout per name and address, single-use invite links, exactly one owner.
- **Nothing sensitive in logs.** Logs, audit rows and errors never contain a token, the API key, a password or file
  contents.

What we do **not** promise: what Claude reads to answer goes to Anthropic under the terms of the plan that pays for it.
Anyone with administrator access to the server can read the team folder and `data/`; on a hub Trina hosts, that includes
Trina's operators. On an office network without https, traffic between PCs and the hub is plain http. In subscription
mode, costs are estimates from Claude Code's own telemetry. Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Language

The hub's pages, messages and the operator guide are in Korean; code, comments and this README are in English.
Translations of the pages are welcome.

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are accepted under Apache-2.0
with a DCO sign-off (`git commit -s`). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Apache-2.0, see [LICENSE](LICENSE). Copyright 2026 Trina Inc. (주식회사 트리나); notices in [NOTICE](NOTICE), third-party
components in [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md). "Trina" and "Trina AX" are trademarks of Trina Inc. and are not
licensed by Apache-2.0.

---

<p align="center">
  <sub>Made by <a href="https://trina.app">Trina Inc.</a> (주식회사 트리나) · <a href="mailto:contact@trina.app">contact@trina.app</a><br>
  Claude, Claude Code and Cowork are trademarks of Anthropic. Trina AX is not affiliated with Anthropic.</sub>
</p>
