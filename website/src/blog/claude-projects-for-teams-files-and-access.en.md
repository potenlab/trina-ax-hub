# Claude Projects for teams: files and access

A Claude project is a self-contained workspace with its own chats and knowledge base: you upload
documents, add instructions, and Claude uses them in every chat in that project. [1][2] Someone has
to add those files, so for a team the useful question is less "what is a project" and more where the
shared files live and who may see which file. Here are four ways to give a team shared context with
Claude today: **a shared Claude project**, **a Cowork project**, **Ask Your Org**, and **company
folders on a server run for your company**.

## What a Claude project holds

- **Knowledge and instructions.** Files you add to a project's knowledge are used across all of its
  chats, and project instructions apply to every chat in it. Context from one chat isn't shared with
  the others unless it is in the project knowledge. [2]
- **Memory.** Each project also has its own memory, which you can keep separate from your account
  memory; on Team and Enterprise, owners decide whether memory is available. [2]
- **More room on paid plans.** On Pro, Max, Ultra, Team and Enterprise, a project switches to
  retrieval (RAG) when its knowledge approaches the context limit, expanding capacity by up to 10
  times. Free accounts can create up to five projects. [1]
- **A new version in beta.** A new version of projects is available in beta to some Pro, Max and
  Ultra users, starting with Claude Code, and some existing projects have started moving to it; chat,
  Cowork, Team and Enterprise are to follow. This post describes the current version. [1]

## Way 1 — a shared Claude project

On Team and Enterprise plans you can share a project with people in your organization, or make it
visible to everyone; owners can turn project sharing off, or on Enterprise turn it off for specific
roles. [1][2] People you invite get **Can view** (see the project's contents, knowledge and
instructions, and chat in it, but not edit it) or **Can edit** (change its instructions and knowledge,
add or remove members and contribute). [1] On Enterprise, sharing with a group is in beta, and access
follows group membership. [3] Even in a project shared with everyone, each person's chats stay
private unless they share them. [3]

- **Where the files come from.** People who can edit the project upload documents, text or code to
  its knowledge. [1][2] Google Docs added from Google Drive keep syncing with the latest version, but
  the Drive connector is only available when adding files to private projects and is disabled for
  shared ones; on Team and Enterprise an owner has to enable the Google connectors first. [5]
- **Who sees what.** Access is set per project: everyone with access can see all of its knowledge. [1]

**Fits when** the team works from the same reference documents that everyone may read, such as a
brand guide, a price list or a style sheet.

## Way 2 — a Cowork project

In Cowork, a project can start from scratch, from an existing Claude project or from a folder on your
computer, and it has its own instructions, scheduled tasks, context (a local folder, a linked chat
project or a URL) and memory. [4] On Team and Enterprise plans, Cowork projects are shared the same
way, with Can view or Can edit. [4] A project made from a local folder keeps its folders and files on
your computer; on Team and Enterprise, the project itself is saved to your Claude account only once
Chat and Cowork unified is turned on, and stays on that computer until then. [4] Cowork is available
on desktop on every paid plan. [4]

**Fits when** one person's work lives in folders on their own computer and repeats on a schedule,
like a weekly summary built from the same files.

## Way 3 — Ask Your Org (enterprise search)

Team and Enterprise plans include a pre-configured project, "Ask Your Org", for searching across the
company's tools, such as Slack, Microsoft 365 and Google, through connectors an owner sets up (at
least one for documents and one for chat). [6] It is permission-aware: each person authenticates with
their own account, and sees results only from data they may access in the original systems. A custom
connector set up with a shared credential returns what that credential can access instead. [6] It
searches the connected services when you ask rather than keeping an index, counts toward your usage
limits, and isn't available on Claude Mobile. [6]

**Fits when** your company's documents already live in Google Drive, Microsoft 365 or Slack, with
access already set there.

## Way 4 — company folders on a server run for your company

This is what we built [Trina AX](https://ax.trina.app/) to do, so here is how it works there. Claude
Code runs on a server for the company, and people use it in the Trina AX app on the web, desktop or
phone. [7]

- **Folders with access per person.** An admin decides who can open each team, group and project
  folder; a personal folder is its owner's alone. The AI sees only the files the person asking can
  open, and the rest don't show up even by name. [7]
- **Rules you can preview.** A rule applies to everyone, a role, a group or a person, with No access,
  Read, or Read & write; before saving, "Who sees what" shows access after saving and who loses
  access, and a subfolder without its own rules follows its parent. [8]
- **Common office files.** It reads PDF, Word, Excel, PowerPoint and Hangul (HWP/HWPX) files. [7]

**What it doesn't do.** Removing someone's access stops the AI reading that folder for them, but
doesn't erase what an earlier answer already quoted. [8] Owners and admins have management access to
team folders. [8] Someone has to run a server: your own, or Trina's hosted plan, where Trina's
operators administer the server and so can read stored files and chats. [7] What the AI reads to
answer goes to the model provider (Anthropic, and OpenAI if Codex is turned on) under your plan's
terms. [9] Trina AX is new: its security page describes it as a pre-release with no security
certification yet. [9] The software is free to install yourself (AGPL-3.0). Trina hosting has a free
plan for up to 3 members, with one answer running at a time and 5 GB of storage, limited spots and a
pause when unused for a long time, and paid plans from $50 a month. Claude usage is billed by
Anthropic, not by Trina. [7]

## Side by side

| | Where the files live | Who sees which file | Plans |
| --- | --- | --- | --- |
| Shared Claude project | Uploaded to the project's knowledge; Google Docs can be added from Drive only in private projects [2][5] | Everyone the project is shared with sees all of its knowledge; editors manage members [1] | Sharing on Team and Enterprise [1] |
| Cowork project | A folder on your computer, plus linked chat projects and URLs [4] | Shared as Claude projects are; the folder's files stay on your computer [4] | Desktop on every paid plan; sharing on Team and Enterprise [4] |
| Ask Your Org | In Slack, Microsoft 365, Google and other connected apps [6] | Each person sees what they may access in those apps, or what a shared credential can access [6] | Team and Enterprise [6] |
| Company folders (Trina AX) | Folders on your company's server [7] | Set per folder by person, group or role; the AI sees only what the asker may open [7][8] | Free to install, or Trina hosting [7] |

## How to choose

1. **The team shares a set of reference documents everyone may read** → a shared Claude project.
2. **One person's work runs from their own folders, often on a schedule** → a Cowork project.
3. **Your documents already live in Google, Microsoft 365 or Slack, with access set there** → Ask
   Your Org.
4. **The files are kept in folders your company runs itself, and access differs by person** →
   company folders on a server run for your company.

These can sit side by side: a shared project for the brand guide, Ask Your Org for Slack, and
company folders for files only some people may open.

## Questions people ask

### What is a Claude project?

A self-contained workspace with its own chats and knowledge base. You upload documents, add
instructions, and Claude uses them in every chat in the project. [1][2]

### Can I share a Claude project with my team?

Yes, on Team and Enterprise plans: with chosen people, as Can view or Can edit, or with the whole
organization. Each person's chats in the project stay private unless they share them. [1][3]

### Does a Claude project sync with Google Drive?

Google Docs added from Drive sync with the latest version, but the Drive connector is only available
when adding files to private projects; it is disabled for shared ones. [5]

### Can a shared project show different files to different people?

Access is set per project, so everyone with access sees all of its knowledge. [1] For access that
differs by person, Claude's Google connectors mirror each person's Google permissions in their own
chats [5], Ask Your Org follows each person's permissions in the connected apps [6], and company
folders on a server can be set per folder and per person. [7][8]

## Try it

- Claude: create a project at claude.ai/projects and use **Share project**; set up **Ask Your Org**
  from the sidebar if you are an owner on Team or Enterprise. [2][6]
- Trina AX: [Set folder permissions](https://ax.trina.app/guide/folder-permissions) and
  [Work with team files](https://ax.trina.app/guide/team-files).
- Install guide and source: [github.com/trina-app/trina-ax](https://github.com/trina-app/trina-ax).
  Hosting plans: [ax.trina.app/#pricing](https://ax.trina.app/#pricing).

*Claude is a trademark of Anthropic. Trina AX is made by Trina Inc. and is not affiliated with
Anthropic.*
