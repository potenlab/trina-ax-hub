# Claude Code for people who don't code

Anthropic describes Claude Code as "an agentic coding tool that reads your codebase, edits files, runs
commands, and integrates with your development tools." [1] It no longer needs a terminal: the Claude
Desktop app includes it. [1] So for people who don't write code, the question is less about the
terminal and more about which version of that agent fits work that isn't software — a spreadsheet, a
report, a draft built from the team's files. Here are three ways: **the Code tab in Claude Desktop**,
**Cowork**, and **a team workspace on a server run for your company**.

## What you need for any of them

Claude Code runs in the terminal, in IDE extensions, in a desktop app and on the web. Most of those
surfaces need a Claude subscription or an Anthropic Console account, and the desktop app needs a paid
subscription. [1] The free claude.ai plan does not include Claude Code. [2] Cowork is available on
paid plans: Pro, Max, Team and Enterprise. [5]

## Way 1 — the Code tab in Claude Desktop

In the Claude Desktop app, Claude Code is the **Code** tab, so there is nothing else to install. [1][3]
The app runs on macOS and Windows, with Linux in beta. [3]

Each conversation in the Code tab is a session with its own project folder. Around the chat you get a
diff view to review changes, a browser pane to preview a running app, a terminal, a file editor and
pull request status, and a permission mode decides how much Claude may do without asking. [3] A
session can run on your computer, in the cloud, or over SSH on a remote machine such as your own
server, and Remote Control lets you follow a local session from your phone or a browser. [3] On Team
and Enterprise plans, admins manage the app through the admin console, managed settings and device
management policies. [3]

**Fits when** your work lives in a project folder and you are comfortable reviewing changes as diffs —
building an internal tool, cleaning up a data script, editing a website.

**Not designed for** a quote, a weekly report or an email. The Code tab is built around a codebase,
and when Anthropic's Dispatch routes tasks, research, document editing and spreadsheet work stay in
Cowork. [3]

## Way 2 — Cowork, in the same app

Anthropic's own answer for non-coding work is Cowork: it "uses the same agentic architecture that
powers Claude Code, accessible within Claude Desktop without opening the terminal." [4] You describe an
outcome and come back to finished work, including Excel spreadsheets with working formulas,
PowerPoint presentations and formatted documents. [4] Connectors bring in your tools and data sources,
and skills and plugins work in Cowork too. [4]

- **Where it runs.** Cowork sessions run in the cloud by default, on Anthropic's servers, with
  sessions and files saved to your Claude account; local execution remains for existing desktop
  deployments. [6] On Pro and Max, new tasks have run in the cloud since October 6, 2026. [5] On Team
  plans, cloud sessions are on by default; on Enterprise they are off until an owner turns them on,
  and sessions run on the member's computer. [7]
- **Your files.** A cloud session reaches files on your computer only through the Claude Desktop app,
  only in folders you have connected, and only while the app is open. [5][6] What it opens that way is
  processed on Anthropic's servers; on Team and Enterprise that data is handled under Anthropic's
  commercial commitments and isn't used to train Claude. [6]
- **Where you use it.** Desktop on every paid plan; web and mobile on Pro, Max and Team (in beta on
  Team), and on Enterprise when an owner enables it. Scheduled tasks run with no device online. [5]
- **For an organization.** Owners can turn Cowork off, decide whether sessions may run in the cloud,
  publish plugins through an organization marketplace — including plugins that install for every
  member and can't be removed — and stream Cowork activity to their monitoring tools. [7]

**Fits when** each person works on their own documents with a paid Claude plan, and, on Team or
Enterprise, the company wants central controls over what everyone gets.

**Worth checking when** the files people need sit in shared company folders with different access
for different people. Cowork reaches the folders each member connects on their own computer, and
other tools and data through connectors. [4][6]

## Way 3 — a team workspace on a server run for your company

Claude Code itself can already run on infrastructure your company controls: over SSH from the Code
tab, or as cloud sessions routed to a self-hosted environment, in public beta on Team and Enterprise.
[3][12] What a team workspace adds is an app for people who don't code, on top of the company's files
and folder permissions. This is what we built [Trina AX](https://ax.trina.app/) to do, so here is how
it works there.

- **Where it runs.** Claude Code runs on a server for the company: an office Mac mini or Linux server
  the company runs, or a server for the company alone on AWS in Seoul that Trina hosts. [8]
- **Where people use it.** In a browser; in desktop apps for Mac and Windows once an admin has added
  them; or on a phone by adding the company address to the home screen, where that address can be
  reached. Employees don't have to install anything to start. [8][9]
- **Company files, by each person's permissions.** An admin decides who can open each team, group and
  project folder, and the product is designed so the AI sees only the files the person asking can
  open. [8]
- **Shared ways of working.** Repeated tasks, like a quote or a weekly report, are saved as team
  skills that a folder manager reviews before teammates use them, and tasks can run on a schedule. [8]
- **Usage.** The company can give people one Claude API key with a monthly limit per person, and
  admins see usage by person, model and skill. [8]

**What it doesn't do.** Someone has to run a server — your own, or Trina's hosted plan, where Trina's
operators administer it and so can read stored files and chats. [8] What the AI reads to answer is
sent to Anthropic under your Claude plan's terms. [8] Trina AX is also new: its own security page
describes it as a pre-release with no security certification yet. [10] The software is open source
under AGPL-3.0 and free to install yourself, and Trina's hosting is a monthly plan by team size. [8][11]
Claude usage is billed by Anthropic, not by Trina. [8]

## Side by side

| | Code tab (Claude Desktop) | Cowork | Team workspace (Trina AX) |
| --- | --- | --- | --- |
| Built for | Software in a project folder | Documents, files and research | Company files and team workflows |
| Where the agent runs | Your computer, the cloud, or over SSH on a machine such as your own server | Anthropic's servers by default; the member's computer where cloud sessions are off | A server for your company, yours or one Trina hosts; the model is Claude, at Anthropic |
| Files it works on | The session's project folder | Folders you connect on your computer, your Claude account, and connected tools | Folders on the company server |
| Who decides access | The file access of the computer or server it runs on | Each member, by the folders they connect | An admin, per folder; server administrators can read stored data |
| Shared workflows | Skills and settings, plus plugins your organization manages | Skills and plugins; owners can require plugins for everyone | Team skills a folder manager reviews |
| Where you use it | Desktop app; follow sessions from a phone or browser with Remote Control | Desktop, web, mobile, Chrome side panel | Browser, Mac and Windows apps, phone home screen |
| Scheduled tasks | Yes | Yes | Yes |
| What you pay for | A paid Claude plan | A paid Claude plan | Claude usage, billed by Anthropic, plus a server you run or Trina hosts |

## How to choose

1. **You are building or fixing something made of code**, even a small internal tool → the Code tab.
   It is Claude Code with a window instead of a terminal, and it can run on your own server over SSH.
2. **Each person works on their own documents and has a paid Claude plan** → Cowork. It is
   Anthropic's agent for non-coding work, and on Team and Enterprise owners get central controls,
   required plugins and monitoring.
3. **The work depends on shared company files that not everyone may open, and people who don't code
   need to reach them through one app** → a team workspace on a server run for your company, with
   folder permissions and reviewed team skills.

These aren't exclusive: developers can keep Claude Code while the quote and the weekly report go
where sales and operations already work.

## Questions people ask

### Do I need to know how to code to use Claude Code?

No terminal is needed: Claude Desktop includes Claude Code as its Code tab. [1][3] The Code tab is
still organized around a project folder and reviewing diffs, so it suits work that is close to
software. [3] For documents and files, Anthropic offers Cowork in the same app. [4]

### Is Cowork the same as Claude Code?

It uses the same agentic architecture without the terminal, and it is aimed at outcomes like
documents, organized files and research. [4] It loads the skills and plugins enabled for your
claude.ai account rather than reading Claude Code's `~/.claude` folder. [4]

### Can a team use Claude on files in a shared company folder?

Cowork reaches the folders each member connects on their own computer while the desktop app is open,
and shared tools and data through connectors. [4][5][6] Claude Code can also run over SSH on a company
server. [3] A team workspace on a company server keeps the files there and is designed to check each
person's folder permissions before the AI reads anything. [8]

### Does Trina AX replace Claude?

No. It runs Claude Code on your company's server, and Claude usage is billed by Anthropic, not by
Trina. [8]

## Try it

- Code tab and Cowork: download Claude Desktop and choose **Code**, or **Cowork** (if your app no
  longer shows a Cowork option, just describe the task). [3][5]
- A team workspace in Trina AX: [Ask your first question](https://ax.trina.app/guide/first-question),
  [Work with team files](https://ax.trina.app/guide/team-files) and
  [Connect with the desktop app](https://ax.trina.app/guide/desktop-app).
- Install guide and source: [github.com/trina-app/trina-ax](https://github.com/trina-app/trina-ax).
  Hosting plans: [ax.trina.app/#pricing](https://ax.trina.app/#pricing).

*Claude is a trademark of Anthropic. Trina AX is made by Trina Inc. and is not affiliated with
Anthropic.*
