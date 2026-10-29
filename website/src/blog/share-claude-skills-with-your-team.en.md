# How to share Claude skills with your whole team

A Claude skill is a folder with a `SKILL.md` file that teaches Claude one way of doing a task —
your quote format, your weekly report, your review checklist. A short one can take minutes to
write. Getting it to everyone who should use it is the harder part. There are three ways to do
it today: **commit it to a repository**, **share or publish it through Claude Team or
Enterprise**, or **keep it in a workspace on your company's own server, next to your company's
files**. Which one fits depends on two things: whether the people who need the skill write code,
and where the files the skill works on live.

## What a skill is, briefly

Anthropic's Claude Code documentation describes it this way: you create a `SKILL.md` file with
instructions, and Claude adds it to its toolkit. Claude uses a skill when it is relevant, or you
call it directly with `/skill-name`. The file starts with YAML frontmatter — every field is
optional, but `description` is the one Anthropic recommends, because Claude uses it to decide
when to apply the skill — followed by the instructions. A skill folder can also carry reference
files and scripts. [1]

## Why a skill ends up on one laptop

Claude Code loads skills from several places. The one people start with is the personal folder,
`~/.claude/skills/<skill-name>/SKILL.md`, which applies to all your projects on that machine. For
Cowork sessions and cloud sessions, Anthropic's documentation says to enable the skill for your
claude.ai account. [1]

So the first good skill on a team usually lives in one person's home directory. Everyone else
keeps asking Claude from scratch and corrects the answer by hand. Sharing the skill is what turns
one person's fix into the team's default.

## Way 1 — commit it to the repository

Claude Code also loads skills from a project's `.claude/skills/<skill-name>/SKILL.md`. Anthropic's
guidance is direct: commit it to a repository to share it with everyone who works there. [1]
For a whole organization, the same skill can go out through a plugin (where it is namespaced as
`/plugin-name:skill-name`) or through managed settings, which reach all users on machines where
the organization deploys them. When two skills share a name, enterprise wins over personal, and
personal wins over project. [1]

**Fits when** the people who need the skill already work in that repository with Claude Code.
Changes to the skill can go through the same review as the rest of the repository.

**Falls short when** the people who need the skill don't use a terminal. A sales lead who wants
the quote skill is not going to clone a repository.

## Way 2 — Claude Team or Enterprise

In the Claude apps, skills are available on Free, Pro, Max, Team and Enterprise plans, and a
skill is uploaded as a ZIP of its folder. Skills require code execution to be enabled. [2]

On Team and Enterprise, owners can provision skills for all users. Once an owner turns sharing
on, people can share skills they made with specific colleagues — and with groups on Enterprise —
or submit them to the organization's library. If the organization requires it, an owner or
someone with permission to review checks a skill before it is published, and chooses who gets
it. [2]

Skills you enable in your Claude settings also load in Claude Code in your terminal. That sync is
one-way, and it does not happen when Claude Code is signed in with an API key or runs on a cloud
provider such as Amazon Bedrock. [2]

**Fits when** everyone who needs the skill is on your organization's Claude Team or Enterprise
plan and signs in with a Claude account.

**Worth checking when** some people use Claude Code with an API key or through a cloud provider —
skills enabled in Claude settings don't sync there. [2]

## Way 3 — a workspace on your company's server, next to company files

The third way moves the skill to where the work is: a workspace on your company's own server —
one you run, or one run for you — where the skill is a file in a company folder and the AI that
follows it reads company files under each person's permissions.

This is what we built [Trina AX](https://ax.trina.app/) to do, so here is how it works there.

- **Agent Skills folders work, with stricter rules.** Team skills live in the workspace's
  `skills/` folder, either as a folder with a `SKILL.md` entry point or as a single Markdown file
  with a `name` header. A `SKILL.md` needs both `name` (lowercase letters, numbers and hyphens,
  matching its folder) and `description`, and every other field must be plain text. A Claude Code
  skill that sets something like `disable-model-invocation: true`, or lists `allowed-tools` as a
  YAML list, is skipped until those lines are changed. Skill text past 16,000 characters is cut
  off. [3]
- **Anyone suggests, a folder manager registers.** Under a useful answer, an employee selects
  *Suggest as skill*. A person allowed to manage team skills in the destination folder opens
  *Team skills → To review*, edits it if needed, and selects *Register* or *Turn down*. Changes
  under `skills/` are logged, and once a registered skill has been edited, earlier versions can be
  restored from its version history (kept 7 days by default; an admin can change it). [4][6]
- **Permissions don't move.** A member can use a registered skill if they can read the folder it
  is in. A skill does not grant extra folder permissions — if the quote skill reads the price
  sheet, the person using it still needs access to the price sheet. Every file tool checks the
  permissions of the person who asked. [5][6]
- **Not just for developers.** Claude Code runs on the company's server; people use the Trina AX
  app on the web, desktop or phone and pick a skill by typing `/` in a chat. When a request
  clearly matches a skill, the AI is instructed to read it, follow it and name the skill it used.
  [6][7][3]
- **Usage you can see.** Admins see usage by person, model and skill, and can export it as CSV.
  Claude access comes from each person's own Claude plan or from one company API key with a
  monthly limit per person. [6]

**What it doesn't do.** The runtime does not execute scripts bundled inside a skill, and a skill's
`allowed-tools` metadata does not grant tools or change permissions. [3] If your skills depend on
running bundled scripts, or on frontmatter fields Trina AX doesn't accept, Way 1 or Way 2 is the
better home for them. Trina AX is also new: its own security page describes it as a pre-release
with no security certification yet. [8]

The software is open source under AGPL-3.0 and free to install yourself; Trina also hosts it on a
monthly plan by team size. Either way, Claude usage is billed by Anthropic, not by Trina. [6][9]

## Side by side

| | Repository | Claude Team / Enterprise | Your company's server (Trina AX) |
| --- | --- | --- | --- |
| Who uses the skill | People working in that repo with Claude Code | People on the organization's Claude plan | Members who can read the skill's folder, in the web, desktop or phone app |
| How it is shared | Commit · plugin · managed settings | Owner provisioning · share with people (groups on Enterprise) · org library | Saved in a company `skills/` folder |
| Who approves it | Your repository's review process | Owner provisions; library submissions can require review by an owner or permitted reviewer | A person who manages that folder registers it |
| Company files | Files the developer's Claude Code session can reach | Not covered in the skills documentation | Read on the company server, under each person's folder permissions |
| Bundled scripts | Supported | Requires code execution | Not executed |
| Skill format | Claude Code `SKILL.md` | Claude `SKILL.md`, uploaded as a ZIP | `SKILL.md` with plain-text fields only, or a Markdown file with a `name` header |

## How to choose

1. **Everyone who needs the skill writes code in the same repository** → commit it to
   `.claude/skills/`. It adds no cost beyond the Claude Code access they already have, and it is
   already where they work.
2. **Everyone who needs the skill is on Claude Team or Enterprise and signs in with a Claude
   account** → provision it, share it, or publish it to the organization's library.
3. **The skill is only useful with company files, and the people who need it aren't developers**
   → put the skill next to the files, behind folder permissions, with a folder manager who
   registers it.

Many teams will use more than one. Engineers keep their repository skills; the quote skill and the
weekly report skill go where sales and operations can reach them.

## Try it

- Write the skill first, wherever you are: Anthropic's guide covers the file format. [1]
- For a team-wide skill in Trina AX: [Use a team skill in chat](https://ax.trina.app/guide/use-skills)
  and [Review and register a team skill](https://ax.trina.app/guide/review-skills).
- Install guide and source: [github.com/trina-app/trina-ax](https://github.com/trina-app/trina-ax).
  Hosting plans: [ax.trina.app/#pricing](https://ax.trina.app/#pricing).

*Claude is a trademark of Anthropic. Trina AX is made by Trina Inc. and is not affiliated with
Anthropic.*
