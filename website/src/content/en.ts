// English copy for ax.trina.app. Words come from the launch copy deck (A0-A17); the Korean twin is ko.ts and must keep
// the same shape (it is declared `satisfies Copy`). "\n" in a heading becomes a line break (Lines.astro).
// Rules for this file: no money amounts here (prices come from PLANS in src/site.ts; test/site.test.ts), no customer
// names, no quotes, no features that are not in the hub today.
import type { Lang } from '../site'

const en = {
  lang: 'en' as Lang,
  skip: 'Skip to content',
  brand: 'Trina AX',

  meta: {
    title: 'Trina AX — Claude for your whole company',
    description:
      "Open-source hub that gives every employee's Claude your company's files, skills and usage, with per-person folder permissions. Self-host free, or let Trina host it.",
    ogImage: '/og.png',
    ogAlt: "Trina AX: your company, in every employee's Claude.",
    // One sentence for llms.txt and the SoftwareApplication JSON-LD.
    long:
      "Trina AX is an open-source (Apache-2.0) hub that connects every employee's own Claude to the company's files, with per-person folder permissions, company skills and per-person usage.",
  },

  nav: {
    label: 'Main',
    features: 'Features',
    how: 'How it works',
    security: 'Security',
    openSource: 'Open source',
    pricing: 'Pricing',
    faq: 'FAQ',
    github: 'GitHub',
    book: 'Book a call',
    theme: 'Switch between light and dark',
    menu: 'Menu',
    home: 'Trina AX home',
    switchLabel: 'Language',
    switchTo: '한국어',
    switchToLang: 'ko',
  },

  hero: {
    pill: 'Open source · Apache-2.0',
    title: 'Your company,',
    accent: "in every employee's Claude.",
    sub:
      "Trina AX connects your company's files, skills and usage to the Claude your team already uses: the desktop and phone apps, claude.ai and Claude Code. Each person's Claude opens only the folders that person may open.",
    primary: 'Book a 30-minute call',
    secondary: 'View on GitHub',
    note: 'Employees install Claude, open their invite and click Connect.',
  },

  // The product stage under the hero: three panels, all made up.
  stage: {
    label:
      "Example screens: a folder access list, two employees asking Claude about company files, and a usage table. Mina in Sales finds a quote template; Joon in Design finds no Finance folder because he can't open it.",
    caption: 'Example screens. The company, the people and the numbers are made up.',
    folders: {
      title: 'Folder access',
      col: 'Folder',
      who: 'Who can open it',
      rows: [
        { name: 'Shared', who: 'Everyone' },
        { name: 'Sales', who: 'Sales' },
        { name: 'Finance', who: 'Finance, CEO' },
        { name: 'People', who: 'HR' },
      ],
    },
    chats: {
      title: 'Claude',
      items: [
        {
          who: 'Mina',
          team: 'Sales',
          q: "Find last month's quote template",
          a: "Found Shared/Templates/Quote_2026.docx. It already has last month's new discount terms.",
          file: 'Quote_2026.docx',
        },
        {
          who: 'Joon',
          team: 'Design',
          q: "What's in the Finance folder?",
          a: 'There\'s no folder called "Finance" among the ones you can open.',
          file: '',
        },
      ],
    },
    usage: {
      title: 'Usage this month',
      cols: { person: 'Person', team: 'Team', requests: 'Requests', skill: 'Top skill' },
      rows: [
        { person: 'Mina', team: 'Sales', requests: '214', skill: 'Quote template' },
        { person: 'Joon', team: 'Design', requests: '96', skill: 'Weekly report' },
        { person: 'Seoyeon', team: 'Finance', requests: '158', skill: 'Expense summary' },
        { person: 'Hajun', team: 'HR', requests: '61', skill: 'Onboarding guide' },
      ],
    },
  },

  works: {
    title: 'Works with the Claude your team already has',
    items: ['Claude desktop app', 'claude.ai', 'Claude for iOS and Android', 'Claude Code', 'Cowork'],
    note:
      "Through Claude's custom connectors and Claude Code plugins. Claude is a trademark of Anthropic. Trina AX is made by Trina Inc. and is not affiliated with Anthropic.",
  },

  problem: {
    title: 'Claude on every desk.\nYour company in none of them.',
    body:
      'Everyone got an account. But each person pastes files in by hand and asks in their own way, nobody knows which folders are fine to share, and nobody can say what it all costs.',
  },

  features: {
    title: "What your team's Claude gets",
    items: [
      {
        id: 'files',
        title: "Company files, with each person's permissions",
        body:
          "Claude finds and reads documents in the company folders and saves its work there. Each person's Claude opens only the folders that person may open; the others don't even show up.",
        ui: {
          head: "What Mina's Claude sees",
          tree: [
            { kind: 'folder', name: 'Shared' },
            { kind: 'file', name: 'Templates/Quote_2026.docx' },
            { kind: 'folder', name: 'Sales' },
            { kind: 'file', name: 'Proposals/Company_A.docx' },
          ],
        },
      },
      {
        id: 'formats',
        title: 'Reads the files you actually have',
        body: 'PDF, Word, Excel, PowerPoint and Korean HWP/HWPX, as text.',
        ui: { head: 'Read as text', types: ['PDF', 'DOCX', 'XLSX', 'PPTX', 'HWP', 'HWPX'] },
      },
      {
        id: 'skills',
        title: 'The same way of working on every desk',
        body:
          'Write a skill once, like a quote template or a weekly report, and every employee\'s Claude has it. Change it and everyone gets the new version.',
        ui: {
          head: 'Company skills',
          rows: [
            { name: 'Quote template', state: 'Updated for everyone', fresh: true },
            { name: 'Weekly report', state: 'Installed', fresh: false },
            { name: 'Expense summary', state: 'Installed', fresh: false },
          ],
        },
      },
      {
        id: 'usage',
        title: 'Usage per person',
        body:
          'See who uses Claude, how much, with which model and skill, and export it as CSV. Set monthly limits for people on the company key.',
        ui: {
          head: 'This month',
          export: 'Export CSV',
          limit: 'Monthly limit',
          rows: [
            { name: 'Mina', w: 82 },
            { name: 'Seoyeon', w: 61 },
            { name: 'Joon', w: 37 },
            { name: 'Hajun', w: 24 },
          ],
        },
      },
      {
        id: 'log',
        title: 'A record of every file action',
        body:
          'Who read, changed or deleted which file is recorded. Overwritten and deleted files are kept for 90 days and can be restored.',
        ui: {
          head: 'Activity',
          rows: [
            { who: 'Mina', did: 'read', what: 'Sales/Proposals/Company_A.docx' },
            { who: 'Joon', did: 'edited', what: 'Shared/Templates/Quote_2026.docx' },
            { who: 'Seoyeon', did: 'deleted', what: 'Finance/Receipts/October.xlsx', restore: 'Restore' },
          ],
        },
      },
      {
        id: 'phone',
        title: 'On the phone, too',
        body: 'The same company files in the Claude mobile app, through the same connection.',
        ui: {
          q: "Find last month's quote template",
          a: 'Found Quote_2026.docx.',
        },
      },
    ],
  },

  how: {
    title: 'Set up once. Then just ask.',
    steps: [
      {
        title: 'We set up your hub',
        body:
          'At your-company.trina.app on our servers, or on a Mac mini or Linux server of yours. Files go in by upload in the browser or by copying a folder.',
      },
      {
        title: 'Connect your Claude organization',
        body:
          'On Claude Team or Enterprise, your admin adds the connector and pastes the settings the hub generates. Once, for everyone. Nothing to install on each PC.',
      },
      {
        title: 'Invite your team',
        body: "Each person gets a link, picks a password and clicks Connect in Claude. That's it.",
      },
    ],
    note:
      'On Pro or Max plans, each person adds the connector address once. People on the company API key connect Claude Code with one command.',
  },

  paying: {
    title: 'Own subscriptions, or one company key',
    body:
      "Each person can use their own Claude plan (Team, Pro or Max), or the company pays through one API key with a monthly limit per person. Either way nobody shares a login: sharing one subscription between people is against Claude's terms.",
    or: 'or',
    options: [
      { title: 'Own subscriptions', chips: ['Team', 'Pro', 'Max'] },
      { title: 'One company key', chips: ['Monthly limit per person'] },
    ],
  },

  security: {
    title: 'Permissions stay. Everything is recorded.',
    lead: 'What we promise, and where it stops, in plain words.',
    promises: [
      'Every request for a file is checked against the folder rules, from every app.',
      'The company API key stays on the hub. It never reaches a PC.',
      "Each PC and each app connection has its own token, stored hashed and revocable at any time.",
      'Uploaded documents are opened in a sandbox.',
      'Logs never contain tokens, keys, passwords or file contents.',
    ],
    limitsLabel: "What we don't promise",
    limits:
      "what Claude reads to answer a question goes to Anthropic under your Claude plan's terms. People with administrator access to the server can read the files; on a hub we host, that includes Trina's operators.",
    link: 'Read the security page',
  },

  openSource: {
    title: 'Open source, so you can check',
    body:
      'All of Trina AX is on GitHub under Apache-2.0. Read what it does with your files, run it yourself for free, and keep using it even if you stop working with us.',
    repo: 'potenlab/trina-ax',
    license: 'Apache-2.0',
    cmds: ['git clone https://github.com/potenlab/trina-ax', 'cd trina-ax && bun install && bun run dev'],
    cta: 'View on GitHub',
    copy: 'Copy',
    copied: 'Copied',
    copyLabel: 'Copy the commands',
  },

  // Plan numbers (price, people, server size) come from PLANS in src/site.ts; {from}, {n}, {cpu}, {mem} and {disk}
  // are filled in from there.
  pricing: {
    title: 'Free to run yourself.\nHosted by Trina from {from} a month',
    corner: 'What you get',
    cols: ['Self-host', 'Trina hosting'],
    rows: [
      { label: 'Price', a: 'Free · Apache-2.0', b: 'From {from} a month, by plan' },
      { label: 'Who runs it', a: 'You', b: 'Trina' },
      { label: 'Address', a: 'Your server or office Mac mini', b: 'your-company.trina.app' },
      { label: 'Updates and backups', a: 'You', b: 'Trina does them' },
      { label: 'Help', a: 'GitHub issues', b: 'A person at Trina' },
    ],
    startLabel: 'Start',
    startA: 'Install guide (GitHub)',
    startB: 'See the plans',
    plansTitle: 'Trina hosting plans',
    plans: { starter: 'Starter', team: 'Team', business: 'Business' },
    perMonth: '/ month',
    people: 'Up to {n} people',
    server: 'Your own server: {cpu} vCPU, {mem} GB memory, {disk} GB storage',
    planCta: 'Get started',
    custom: {
      name: 'Larger',
      price: 'Quoted',
      people: 'More than 40 people',
      body: "Your own AWS account, or a server or Mac mini in your office. Contracted directly with Trina.",
      cta: 'Book a call',
    },
    included:
      'Every plan: a server on AWS in Seoul for your company alone, your-company.trina.app, setup and connection, updates, backups, monitoring and help from a person at Trina.',
    fine:
      'Prices are in US dollars, before tax. Plans are sold by our reseller (Merchant of Record), Polar or Creem as shown at checkout, which adds any sales tax or VAT. A plan renews every month until you cancel. Cancel any time from the billing portal linked in your receipt; it runs to the end of the month you paid for. Ask within 14 days of your first payment for a full refund.',
    termsLink: 'Terms',
    refundLink: 'Refund policy',
    blocks: [
      {
        title: 'Priced from the server',
        body: "Each plan is your company's own AWS server, sized for its number of people. The price is that server plus Trina running it.",
      },
      {
        title: 'Who you pay for what',
        body: 'Claude usage goes to Anthropic, never through us. Only the hosting plan goes to Trina.',
      },
      {
        title: "When you don't need us",
        body: 'If you have a developer who runs servers, the open-source version is enough.',
      },
    ],
  },

  examples: {
    title: 'What people ask in a normal week',
    note: 'Examples.',
    asks: 'Asks',
    gets: 'Gets',
    items: [
      {
        role: 'CEO',
        q: "List this quarter's quotes that haven't had a reply",
        a: 'A list from the Quotes folder, oldest first.',
      },
      {
        role: 'Sales',
        q: 'Draft a proposal for B in the same format as the one for A',
        a: 'A draft in the company format, saved to the Sales folder.',
      },
      {
        role: 'Finance',
        q: 'Total the October expense receipts',
        a: 'Totals by category, read from the receipts in Finance.',
      },
      {
        role: 'People',
        q: 'Summarize the onboarding guide for new hires',
        a: 'A one-page summary of the guide in People.',
      },
    ],
  },

  service: {
    title: 'Not a one-off install',
    body:
      'We listen to how your team works, set up the hub and the folder permissions, and connect your Claude organization. After that, every month, we turn the tasks people repeat into skills.',
    // The same sentence, as a path: shown beside it.
    path: ['Listen to how your team works', 'Set up the hub and folder permissions', 'Connect your Claude organization', 'Every month, turn repeated tasks into skills'],
  },

  faq: {
    title: 'Questions, answered plainly',
    items: [
      {
        q: 'Do employees need to know anything technical?',
        a: 'No. They use the Claude they already know. We set up the hub and connect your Claude organization. Running it yourself needs a developer who has run a server before.',
      },
      {
        q: 'Is it really free?',
        a: 'The software is free (Apache-2.0). Only hosting by Trina is paid: a monthly plan by the number of people, setup included. Claude usage is paid to Anthropic separately.',
      },
      {
        q: 'Where do our files live?',
        a: "On the hub: on Trina's servers if we host it, or on your server or office Mac mini if you run it. File contents go to Anthropic only when Claude reads them to answer.",
      },
      {
        q: "Can someone see another team's folder?",
        a: "No. You set who can open each folder, and each person's Claude opens only those. A folder you can't open looks like it doesn't exist.",
      },
      {
        q: 'Which Claude plan do we need?',
        a: 'Claude Team or Enterprise is simplest: your admin sets it up once for everyone. Individual Pro and Max plans, or a company API key, work too.',
      },
      {
        q: 'What if we stop?',
        a: 'We hand your files back as they are, and you can keep running the same open-source software yourself.',
      },
      {
        q: 'Does it work with ChatGPT?',
        a: 'Not today. Trina AX works with Claude.',
      },
      {
        q: 'Are you part of Anthropic?',
        a: 'No. Trina AX is made by Trina Inc. (주식회사 트리나).',
      },
    ],
  },

  cta: {
    title: 'Start with a 30-minute call',
    sub: "Tell us how your team works today, and we'll show you where to start.",
    primary: 'Book a call',
    secondary: 'View on GitHub',
  },

  footer: {
    company: 'Trina Inc. (주식회사 트리나)',
    links: {
      company: 'trina.app',
      github: 'GitHub',
      security: 'Security',
      privacy: 'Privacy',
      terms: 'Terms',
      refund: 'Refunds',
    },
    trademark:
      "Claude is a trademark of Anthropic. Trina AX is made by Trina Inc. and is not affiliated with Anthropic.",
    langLabel: 'Language',
  },

  // /security
  secPage: {
    title: 'Security — Trina AX',
    description:
      'What Trina AX promises about your files, how each promise is kept, and where the promises stop. Plain words, no certifications claimed.',
    ogImage: '/og.png',
    h1: 'Permissions stay. Everything is recorded.',
    lead: 'What we promise, and where it stops, in plain words.',
    promisesTitle: 'Five promises',
    promises: [
      {
        title: 'Every request for a file is checked against the folder rules, from every app.',
        how:
          'Reading, searching, writing, moving and deleting all go through the same permission check on the hub. A folder you can\'t open is answered exactly like a folder that doesn\'t exist.',
      },
      {
        title: 'The company API key stays on the hub. It never reaches a PC.',
        how:
          "A PC talks to the hub with its own token. The hub adds the company key when it calls Anthropic, and it does not pass the PC's token on.",
      },
      {
        title: 'Each PC and each app connection has its own token, stored hashed and revocable at any time.',
        how:
          'Only a SHA-256 hash is stored, so the database holds nothing that works as a token. Tokens for Claude app connections last one hour and are renewed with refresh tokens that rotate.',
      },
      {
        title: 'Uploaded documents are opened in a sandbox.',
        how:
          'PDF, Office and HWP files are read by helper programs with no network access that can only write to an empty work folder: the macOS sandbox on a Mac mini, and bubblewrap on a Linux server where it is installed.',
      },
      {
        title: 'Logs never contain tokens, keys, passwords or file contents.',
        how:
          'The record of file actions says who did what to which path, not what was inside the file.',
      },
    ],
    limitsTitle: "What we don't promise",
    limitsLead: 'These are the places where the promises stop.',
    limits: [
      "What Claude reads to answer a question goes to Anthropic under your Claude plan's terms.",
      "People with administrator access to the server can read the files; on a hub we host, that includes Trina's operators.",
      'On an office network without https, traffic between PCs and the hub is plain http.',
      "In subscription mode, costs on the usage screen are estimates from Claude Code's own reports.",
    ],
    runsTitle: 'Where it runs',
    runs: [
      { title: 'Hosted by Trina', body: "Your hub at your-company.trina.app, on Trina's servers." },
      { title: 'Your server', body: 'A Linux server of yours. You are the administrator.' },
      { title: 'Office Mac mini', body: 'A Mac mini in your office. You are the administrator.' },
    ],
    reportTitle: 'Reporting a vulnerability',
    reportBody:
      'A bug that lets someone see, change or spend more than they should is a security bug. Email us with the subject "Security: Trina AX" and do not open a public issue. We reply within 72 hours, and fixes go out to everyone at the same time.',
    reportMail: 'contact@trina.app',
    reportLink: 'Read SECURITY.md on GitHub',
    back: 'Back to Trina AX',
    breadcrumb: 'Security',
  },

  notFound: {
    title: 'Page not found',
    body: 'That page does not exist. The pages we have are on the home page.',
    back: 'Back to Trina AX',
  },
}

export type Copy = typeof en
export default en
