# Claude Team plan: usage limits and unused seats

Claude's Team plan is sold by the seat. For teams of 2 to 150, a Standard seat costs $25 a month
billed monthly or $20 a month billed annually, and a Premium seat costs $125 or $100 (US prices before
tax, as listed on October 31, 2026). [1][2] Each seat belongs to one named person, its usage limits
are that person's alone, and unused usage on one seat can't be moved to someone else. [2][3] That makes
two costs easy to miss: the person who keeps hitting a limit, and the seat that is paid for but rarely
opened. Here is how Team seats and limits work, how to find the seats nobody uses, and three ways to
pay closer to what your team actually uses.

## How Team seats and usage limits work

- **Two seat types.** A Standard seat has the base features, usage limits and Claude Code access; a
  Premium seat has everything in Standard plus higher usage limits. You can mix them, for example
  Premium for the few people who need more capacity and Standard for everyone else. [3] On Team,
  Fable, Anthropic's top model, comes with Premium seats, up to 50% of weekly limits. [1]
- **How big the limits are.** A Standard seat includes 1.25 times the Pro plan's per-session usage
  allowance and a Premium seat 6.25 times; both also have a weekly limit that applies across all
  models. [2] The session limit resets five hours after your first message, and the weekly limit
  resets at a fixed time each week assigned to your account. [4]
- **One pool per person.** Your use of claude.ai, Claude Code and Claude Desktop counts toward the same
  limit. [4] Limits are per member, not per team: one person reaching a limit doesn't affect anyone
  else, and limits can't be transferred or shared between members. [2]
- **One person per seat.** Only the assigned person may sign in; people can't share login details or
  route their work through someone else's account to use its remaining usage. Reassigning a seat is
  meant for someone joining, leaving or changing roles, not for rotating one seat among several active
  users. [3]
- **When someone hits a limit.** They can wait for it to reset, an owner can move them to a Premium
  seat, or the organization can turn on usage credits, billed at standard API rates. [1][3][5]
  Anthropic also says it may limit usage in other ways, such as weekly and monthly caps. [1][4]
- **API credits are separate.** Team plans include monthly credits for the Claude API, for building
  Claude into your own apps and agents. They are pooled across seats and capped at $500 a month; a team
  with three Standard and two Premium seats receives $260. [6][7]

## What changes on the bill, and when

| Change | When it hits the bill |
| --- | --- |
| Add a seat, or upgrade Standard to Premium | Prorated and charged right away [3][6] |
| Remove a member | No immediate credit or refund; the seat stays free for someone else [3][6] |
| Reduce the total number of seats | At your next renewal (the annual renewal date on an annual plan), with no prorated refund [3] |
| Move someone from Premium to Standard | At your next renewal, with no prorated refund [3] |

Anthropic's own example: ten Standard seats cost $2,400 paid up front for the year on an annual plan,
or $250 a month on a monthly plan. [6] The annual price is lower, but the year is paid up front, so
seats you cut mid-year aren't refunded; the smaller count starts at the renewal date. [3][6]

## Find the seats nobody uses

Team plan Owners and Primary Owners can open **Analytics** from the menu under their initials. It
shows weekly active members, a chart of **active members and assigned seats**, the member list, and how
people use Claude, including adoption level and skills. [8] If usage credits are on, the spend limits
list in **Organization settings > Usage** has a month-to-date spend column per member, which Anthropic
suggests using to "track members' usage patterns and optimize seat assignments." [5]

When you cut seats, four details in Anthropic's seat article matter: [3]

1. To move several people from Premium to Standard, set the Premium and Standard totals in one
   change; people above the new Premium total move to Standard at renewal. The Standard total can't be
   lower than your current billable members.
2. **No seat assigned** keeps a person in the organization without counting toward your seat limit.
   They can't use Claude until they get a seat again.
3. Pending invitations do count toward the seat limit.
4. Only one scheduled seat change can be pending at a time. Submitting another change, adding seats or
   a new member accepting an invite replaces it, so check it again before the renewal date.

## Three ways to pay closer to what your team uses

### Way 1 — keep Team, and size it to the people

Put most people on Standard and only the people who keep hitting limits on Premium. [3] For occasional
overflow, an owner can pre-purchase usage credits, turn them on for specific people or the whole
organization, and set a monthly spend limit for the organization and for each person. [5] When someone
reaches their own spend limit, their usage credits pause until the end of the month. [5]

**Fits when** most of the team uses Claude every week and wants Anthropic's own apps, connectors and
admin tools, such as single sign-on, usage analytics and organization-wide skills. [1]

### Way 2 — pay Anthropic for usage instead of included allowances

- **Usage-based Enterprise.** The seat fee covers access only, and all usage across Claude, Claude
  Code and Cowork is billed at standard API rates, with no per-seat usage limits. Admins can set spend
  limits for the organization and for individual users. [9] The seat price is $20 a month, billed
  annually. [1] Self-serve plans start at 20 seats and buy usage as prepaid credits; when the balance
  runs out, usage stops for the whole organization until an owner buys more. Sales-assisted plans start
  at 50 seats and bill usage monthly in arrears. Seats can't be removed mid-term on self-serve plans. [9]
  At the self-serve minimum, the seats alone come to 20 × $20 × 12 months = $4,800 a year. [1][9]
- **Claude Code on the Claude Console.** For organizations that prefer API-based billing, an admin
  invites people to the Claude Console and they sign in to Claude Code with their Console account. [16]
  Anthropic creates a Claude Code workspace the first time a member signs in this way, and it is the only
  Console workspace that supports per-user monthly spend limits. [11] The Claude Desktop app needs a
  paid subscription, so this route leaves the desktop app out. [10]

Some of the API rates listed on October 31, 2026: Sonnet 5.5 at $2 per million input tokens and $10 per
million output tokens, Opus 5.5 at $4 and $20, and Haiku 5.5 at $0.10 and $0.50 for prompts up to
100,000 tokens. [1]

**Fits when** use is uneven across an organization of 20 or more, or when the people who need Claude
work in Claude Code and don't need the desktop app.

### Way 3 — a team workspace on your company's server, with a company API key

This is what we built [Trina AX](https://ax.trina.app/) to do, so here is how it works there. Claude
Code runs on a server for the company: an office Mac mini or Linux server the company runs, or a
server for the company alone on AWS in Seoul that Trina hosts. People use it in the Trina AX app on
the web, desktop or phone. [12]

- **One company key.** The owner adds a company Claude API key and chooses who uses it: the whole team,
  or chosen groups and people. [13]
- **A monthly limit per person.** Admins set a token limit per person per month and, for API key
  costs, a spending limit in US dollars, then choose whether reaching it only warns or blocks. Costs
  shown are estimates at list prices and may differ from the provider's bill. [14]
- **Usage you can see.** Usage by person, model and skill, with CSV export. [12]
- **Who bills what.** Claude usage is billed by Anthropic, not by Trina; on an API key that is the
  tokens used, at API rates. [1][12]

**What it doesn't do.** Someone has to run a server: your own, which needs someone who has run a server
before, or Trina's hosted plan, where Trina's operators administer the server and so can read stored
files and chats. [12] What the AI reads to answer goes to Anthropic under your Claude plan's terms. [12]
People work in the Trina AX app rather than in Claude's own apps. [12] Trina AX is new: its security
page describes it as a pre-release with no security certification yet. [15] The software is free to
install yourself (AGPL-3.0); Trina hosting is $39 a month for up to 5 people, $69 for up to 15 and $129
for up to 40, before tax and with setup included, and larger teams get a quote. [12]

## Side by side

| | Team | Usage-based Enterprise | Claude Console (Claude Code) | Trina AX (company API key) |
| --- | --- | --- | --- | --- |
| What you pay Anthropic | $25 / $125 per seat a month, or $20 / $100 billed annually [1] | $20 per seat a month, billed annually, plus usage at API rates [1][9] | Usage at API rates, pay as you go [1][16] | Usage at API rates [1][12] |
| Smallest size | 2 members [2] | 20 seats self-serve, 50 sales-assisted [9] | No seats [1][16] | Your own server, or a hosted plan for up to 5 people [12] |
| A seat someone barely uses | Paid in full; its usage can't move to someone else [2][3] | Seat fee only, no included usage; seats can't be removed mid-term on self-serve [9] | No seats [1][16] | No Anthropic seat on an API key; Trina hosting is priced by team size (up to 5, 15 or 40 people) [1][12] |
| Heavy users | Premium seat or usage credits [3][5] | Spend limits per user [9] | Per-user monthly spend limit [11] | Per-person monthly token or spending limit, warn or block [14] |
| Who it is for | Everyone, in Claude's apps [1] | Everyone, in Claude's apps [1][9] | People who work in Claude Code, without the desktop app [10][16] | Everyone, in the Trina AX app [12] |
| Other costs | Usage credits if you turn them on; on an annual plan, the year up front [5][6] | Annual commitment; prepaid usage credits on self-serve [1][9] | — | A server you run, or Trina hosting [12] |

## How to choose

1. **Most of the team uses Claude every week** → Team. Standard for most, Premium for the few who hit
   limits, usage credits with spend limits for the rest, and seat cuts made before the renewal date.
2. **Twenty or more people, and use is uneven** → usage-based Enterprise, where the seat fee buys access
   and usage is metered at API rates.
3. **Only the people who work in Claude Code need it** → Claude Code on the Claude Console, with a
   monthly spend limit per person.
4. **Many people use it now and then, and the work runs on shared company files** → a team workspace on
   a company server, with one company API key and a monthly limit per person.

## Questions people ask

### How much is the Claude Team plan?

A Standard seat is $25 a month billed monthly or $20 billed annually; a Premium seat is $125 or $100.
Those are US prices before tax, listed on October 31, 2026, for teams of 2 to 150. [1][2]

### Are Claude Team usage limits shared across the team?

No. Each member has their own limits, and limits can't be transferred or shared between members; each
seat is for one named person. [2][3]

### What happens when a Team member hits their usage limit?

They can wait for the five-hour session limit or the weekly limit to reset, an owner can move them to a
Premium seat, or the organization can turn on usage credits at API rates, with spend limits. [3][4][5]

### Do I get money back when I remove someone from a Team plan?

No. Removing someone frees the seat for someone else but doesn't refund it. To lower the bill, reduce
the total number of seats; that takes effect at your next renewal, with no prorated refund. [3][6]

## Try it

- On a Team plan: open **Analytics** and compare active members with assigned seats, then change seat
  totals in **Organization settings > Organization and access** before your renewal date. [3][8]
- In Trina AX: [Connect a company API key](https://ax.trina.app/guide/ai-connection) and
  [Set monthly usage limits](https://ax.trina.app/guide/usage-limits).
- Install guide and source: [github.com/trina-app/trina-ax](https://github.com/trina-app/trina-ax).
  Hosting plans: [ax.trina.app/#pricing](https://ax.trina.app/#pricing).

*Claude is a trademark of Anthropic. Trina AX is made by Trina Inc. and is not affiliated with
Anthropic.*
