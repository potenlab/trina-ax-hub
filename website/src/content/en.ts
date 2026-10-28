// English copy for ax.trina.app. The Korean twin is ko.ts and must keep the same shape (it is declared `satisfies Copy`;
// test/seo.test.ts compares the two key by key). "\n" in a heading becomes a line break (Lines.astro).
// Rules for this file: no money amounts here (prices come from PLANS in src/site.ts and are filled in where a string says
// {from}; test/site.test.ts), no customer names, no quotes, no features that are not in trina-app/trina-ax today.
// The product (2026-10-28): Claude (Claude Code, optionally Codex) runs on the company's server; people use the Trina AX
// app on the web, desktop and phone; every file tool checks the permissions of the person who asks. AGPL-3.0.
// Example screens use the app's own words (trina-app/trina-ax web/src/i18n, shared/src/step-labels.ts) and made-up data.
import type { Lang } from '../site'

const en = {
  lang: 'en' as Lang,
  skip: 'Skip to content',
  brand: 'Trina AX',

  meta: {
    title: "Trina AX — your company's own AI workspace",
    description:
      "Claude runs on your company's server; your team uses it on the web, desktop and phone with only the files each person may open. Open source (AGPL-3.0). Self-host free, or let Trina host it.",
    ogImage: '/og.png',
    ogAlt: "Trina AX: your company's own AI workspace.",
    // One sentence for llms.txt and the SoftwareApplication JSON-LD.
    long:
      "Trina AX is an open-source (AGPL-3.0) AI workspace for companies: Claude runs on the company's own server, and employees use it on the web, desktop and phone with per-person folder permissions, team skills, schedules and per-person usage.",
  },

  nav: {
    label: 'Main',
    examples: 'Examples',
    start: 'How to start',
    guide: 'Guide',
    security: 'Security',
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
    pill: 'Open source · AGPL-3.0',
    title: "Your company's own",
    accent: 'AI workspace',
    sub:
      "Claude runs on your company's server. Your team asks it to write, search and organize from the web, desktop or phone, and it opens only the company files the person asking may open.",
    primary: 'Book a 30-minute call',
    primaryNote: 'Hosted by Trina, from {from} a month',
    secondary: 'Start free',
    secondaryNote: 'Install it yourself: open source, free',
  },

  // The scripted demo under the hero: one chat in the real app's words, with made-up data. The text of the final
  // screen is in the page; the script only reveals it step by step (src/scripts/demo.ts).
  demo: {
    label:
      'Example screen of the Trina AX app. Mina from Sales asks the AI to turn the Sales weekly meeting notes into a to-do spreadsheet in the Shared folder. The AI reads the team skill and the notes, the server asks before saving Sales content where more people can see it, Mina chooses Save, and the AI saves the spreadsheet and lists the three to-dos due this week.',
    caption: 'Example screen. The company, the people and the files are made up.',
    replay: 'Replay',
    pause: 'Pause',
    resume: 'Play',
    app: {
      nav: ['New chat', 'Search', 'Files', 'Projects', 'Team skills'],
      recentsTitle: 'Recents',
      recents: ['Sales weekly to-dos', 'Quote for B Corp.', 'October results', 'Trade show checklist'],
      user: 'Mina Kim',
      team: 'Sales',
      chatTitle: 'Sales weekly to-dos',
      engine: 'Claude',
      q: 'Pull the to-dos out of the Sales weekly meeting notes into a spreadsheet with owner and due date, and put it in Shared.',
      thinking: 'Thinking…',
      stepsRunning: 'Running',
      stepsDone: '4 steps',
      steps: [
        { verb: 'Read', path: 'skills/meeting-notes.md' },
        { verb: 'Find files', path: 'Sales/Meetings' },
        { verb: 'Read', path: 'Sales/Meetings/2026-10-27-weekly.md' },
        { verb: 'Make file', path: 'Shared/To-dos/sales-weekly-to-dos.xlsx' },
      ],
      confirm: {
        title: 'Safety check by the team server',
        body: 'The AI read content fewer people can see (Sales) and now wants to save to Shared/To-dos, which 12 people can see. Save it?',
        allow: 'Save',
        deny: 'Don’t save',
      },
      answer: 'I put the 7 to-dos in a spreadsheet, by owner and due date. Three are due this week:',
      list: ['Send the quote to B Corp. (Mina, Oct 30)', 'Confirm the trade show booth (Doyun, Oct 31)', 'Wrap up October results (Joon, Oct 31)'],
      saved: '1 file saved',
      savedState: 'Created',
      file: 'sales-weekly-to-dos.xlsx',
      filePath: 'Shared/To-dos',
      preview: {
        title: 'File preview',
        cols: ['To-do', 'Owner', 'Due'],
        rows: [
          ['Send the quote to B Corp.', 'Mina', 'Oct 30'],
          ['Confirm the trade show booth', 'Doyun', 'Oct 31'],
          ['Wrap up October results', 'Joon', 'Oct 31'],
          ['Call C Corp. about the renewal', 'Mina', 'Nov 3'],
          ['Update the price sheet', 'Seoyeon', 'Nov 5'],
          ['Book the client visit to D Corp.', 'Doyun', 'Nov 7'],
          ['Draft the November plan', 'Joon', 'Nov 10'],
        ],
      },
      composer: 'Ask anything',
      footer: 'AI can make mistakes. Check important information. Only you can see your chats.',
    },
  },

  works: {
    title: 'The same company AI on every screen',
    items: ['Web browser', 'Mac and Windows app', 'Phone', 'Claude Code on the server'],
    note:
      'Claude is a trademark of Anthropic. Trina AX is made by Trina Inc. and is not affiliated with Anthropic.',
  },

  // "Same question, different answers": the permission story, shown instead of told.
  same: {
    title: 'Same question,\ndifferent answers',
    body:
      "The AI sees only what the person asking may open. A folder you can't open doesn't show up even by name, and the files the AI read stay on the record.",
    q: 'Summarize the first-half performance reviews',
    rule: 'HR folder: HR team only',
    people: [
      {
        name: 'Hajun Choi',
        team: 'HR',
        scope: 'Can open: Shared, HR',
        steps: [
          { verb: 'Search', path: 'performance review' },
          { verb: 'Read', path: 'HR/Reviews/2026-H1-results.xlsx' },
        ],
        a: '24 people were reviewed: 2 rated S, 7 A, 13 B and 2 C. Sales and Design had the most A ratings.',
        file: '2026-H1-results.xlsx',
      },
      {
        name: 'Joon Park',
        team: 'Sales',
        scope: 'Can open: Shared, Sales',
        steps: [{ verb: 'Search', path: 'performance review' }],
        a: "There are no performance reviews in the folders you can open. Ask HR if you need them.",
        file: '',
      },
    ],
    record: {
      title: 'Admin › Activity log · AI tool',
      cols: ['Time', 'Who', 'Did', 'What'],
      rows: [
        ['10:02', 'Hajun Choi', 'Search', '—'],
        ['10:02', 'Hajun Choi', 'Read', 'HR/Reviews/2026-H1-results.xlsx'],
        ['10:03', 'Joon Park', 'Search', '—'],
      ],
      note: 'The log shows the files the AI read and wrote. It never shows search terms or the conversation.',
    },
    caption: 'Example screens. The people and the files are made up.',
    link: 'See how permissions are checked, in the code',
  },

  // Role tabs: one real piece of office work per role, with what the AI used and what came back.
  roles: {
    title: 'What each role hands to the AI',
    body: "Everyday office work, done with the files each person may open. Pick a role.",
    tabsLabel: 'Roles',
    asks: 'Asks',
    used: 'What the AI used',
    result: 'What comes back',
    scope: 'Searches only the folders {name} may open',
    moreTitle: 'Also handed off',
    items: [
      {
        id: 'ceo',
        role: 'CEO',
        who: 'Daeho Kim',
        q: 'Every Monday at 9, write a weekly report from last week’s changes in Sales and Finance. Save a new Word file in my folder and include the source files.',
        used: [
          { kind: 'schedule', text: 'Schedule · every Monday 9:00' },
          { kind: 'folder', text: 'Folders · Sales, Finance' },
          { kind: 'skill', text: 'Team skill · weekly report' },
          { kind: 'save', text: 'Saved to · my folder' },
        ],
        doc: {
          kind: 'doc',
          file: 'weekly-report-oct-w4.docx',
          title: 'Weekly report · October, week 4',
          blocks: [
            { h: 'Sales', p: '5 new quotes, 2 contracts signed (C Corp., D Corp.). B Corp. has not replied yet.' },
            { h: 'Finance', p: 'October card expenses are sorted. 4 items have no receipt.' },
            { h: 'To decide this week', p: 'Trade show booth budget, new hire posting.' },
          ],
          toast: 'Your scheduled task has finished.',
        },
        more: ['List this quarter’s quotes with no reply, oldest first', 'Draft the board pack in last quarter’s format', 'On a trip: the key terms of this contract, on my phone'],
      },
      {
        id: 'sales',
        role: 'Sales',
        who: 'Mina Kim',
        q: 'Draft an Excel quote for B Corp. using the columns and items in the A Corp. quote and our current price sheet. 120 units, delivery by November 20.',
        used: [
          { kind: 'skill', text: 'Team skill · quote' },
          { kind: 'file', text: 'Read · A-Corp-quote.xlsx, price-sheet-2026.xlsx' },
          { kind: 'save', text: 'Saved to · Sales/Quotes' },
        ],
        doc: {
          kind: 'sheet',
          file: 'B-Corp-quote-2026-10.xlsx',
          title: 'Quote · B Corp.',
          cols: ['Item', 'Spec', 'Qty', 'Delivery'],
          rows: [
            ['Industrial sensor S-200', 'Standard', '120', 'Nov 20'],
            ['Mounting kit', 'S-200', '120', 'Nov 20'],
            ['Installation support', '1 set', '1', 'Nov 24'],
          ],
          foot: 'Prices and the volume discount follow price-sheet-2026.xlsx and the quote skill.',
        },
        more: ['A follow-up email from today’s meeting notes with C Corp.', 'Last month’s proposal, rewritten for D Corp. as slides', 'A table of open quotes by client'],
      },
      {
        id: 'finance',
        role: 'Finance',
        who: 'Seoyeon Lee',
        q: 'Merge the three Q3 company-card spreadsheets and group them by team and category. Check the receipt records, and mark missing and unknown receipts separately.',
        used: [
          { kind: 'file', text: 'Read · card-jul.xlsx, card-aug.xlsx, card-sep.xlsx' },
          { kind: 'skill', text: 'Team skill · expense rules' },
          { kind: 'save', text: 'Saved to · Finance/Summaries' },
        ],
        doc: {
          kind: 'sheet',
          file: 'Q3-company-card.xlsx',
          title: 'Q3 company card · by team',
          cols: ['Team', 'Items', 'No receipt'],
          rows: [
            ['Sales', '86', '3'],
            ['Marketing', '54', '1'],
            ['Engineering', '31', '0'],
            ['Operations', '47', '2'],
          ],
          foot: 'Sheets: by team · by category · no receipt',
        },
        more: ['Unpaid invoices by client', 'Before the VAT filing: purchases with no tax invoice', 'Budget against spending, by team'],
      },
      {
        id: 'people',
        role: 'People',
        who: 'Hajun Choi',
        q: 'Read the official letter from the Ministry of Employment (it is a Hangul file), tell me what we have to do, and draft our reply.',
        used: [
          { kind: 'file', text: 'Read · HR/Letters/2026-10-ministry.hwp' },
          { kind: 'skill', text: 'Team skill · official letter format' },
          { kind: 'save', text: 'Saved to · HR/Letters' },
        ],
        doc: {
          kind: 'letter',
          file: 'reply-ministry-2026-10.docx',
          title: 'Reply to the regional labour office',
          lines: [
            'To: Head of the regional labour office',
            'Subject: Results of the workplace harassment prevention training',
            '1. This replies to your letter of October 14, 2026.',
            '2. We held the training on October 24, 2026 for all 32 employees, and send the results as attached.',
            'Attached: training results, 1 copy. End.',
          ],
        },
        more: ['This year’s job posting from last year’s Hangul file', 'A one-page welcome for the new hire, from the onboarding guide', 'Answer leave questions with the rule book as the source'],
      },
    ],
    note: 'Examples. Results depend on your files and on how you ask.',
    link: 'More use cases in the guide',
  },

  features: {
    title: 'An AI workspace made for company work',
    items: [
      {
        id: 'files',
        title: "Company files, opened by each person's permissions",
        body:
          "Decide who can see each team, group and project folder; a personal folder is its owner's alone. The AI sees only the files the person asking can open; the rest don't show up even by name.",
        ui: {
          head: "What Mina's AI can see",
          tree: [
            { kind: 'folder', name: 'Shared' },
            { kind: 'folder', name: 'Sales' },
            { kind: 'file', name: 'Quotes/A-Corp-quote.xlsx' },
            { kind: 'folder', name: 'Projects/Trade show' },
            { kind: 'folder', name: 'My folder' },
          ],
        },
      },
      {
        id: 'formats',
        title: 'Reads Korean Hangul files, too',
        body: 'Reads PDF, Word, Excel, PowerPoint and Hangul (HWP/HWPX), and makes Excel, Word, PowerPoint and PDF files.',
        ui: { head: 'Reads', types: ['PDF', 'DOCX', 'XLSX', 'PPTX', 'HWP', 'HWPX'], makeHead: 'Makes', makes: ['XLSX', 'DOCX', 'PPTX', 'PDF'] },
      },
      {
        id: 'skills',
        title: 'The same way of working on every desk',
        body: 'Save the tasks people repeat, like a quote or a weekly report, as team skills. Anyone can suggest one; a person who manages the skill folder reviews it before teammates with access can use it.',
        ui: {
          head: 'Team skills',
          rows: [
            { name: 'Quote', state: 'Registered', fresh: false },
            { name: 'Weekly report', state: 'Registered', fresh: false },
            { name: 'Meeting notes', state: 'Waiting for review', fresh: true },
          ],
        },
      },
      {
        id: 'schedule',
        title: 'Work that runs on a schedule',
        body: 'Set a time, like Monday 9:00 for the weekly report, and the AI runs it for you, saves the result to your folder and lets you know.',
        ui: {
          head: 'Scheduled tasks',
          rows: [
            { name: 'Weekly report', when: 'Every Monday 9:00' },
            { name: "Today's quotes", when: 'Weekdays (Mon–Fri) 18:00' },
          ],
          next: 'Next run Nov 3, 9:00',
          toast: 'Your scheduled task has finished.',
        },
      },
      {
        id: 'connections',
        title: 'Your other services, connected',
        body: 'Connect services like Notion, Linear or GitHub, or your own company API, with your account or the team’s. Lookups run right away; you choose whether changes are blocked, ask each time or run without asking.',
        ui: {
          head: 'External services',
          rows: [
            { name: 'Notion', kind: 'My connection', state: 'Connected' },
            { name: 'GitHub', kind: 'Team connection', state: 'Connected' },
            { name: 'Company API', kind: 'Team connection', state: 'Asks before writing' },
          ],
        },
      },
      {
        id: 'usage',
        title: 'Usage per person',
        body:
          'See usage by person, model and skill, and export it as CSV. Set a monthly limit for people on the company API key.',
        ui: {
          head: 'This month',
          export: 'Download CSV',
          limit: 'Monthly limit',
          rows: [
            { name: 'Mina', w: 82 },
            { name: 'Seoyeon', w: 61 },
            { name: 'Joon', w: 37 },
            { name: 'Hajun', w: 24 },
          ],
        },
      },
    ],
  },

  // Two ways to start, equal weight: hosted by Trina, or installed yourself. Then the first week as a checklist (the
  // owner's checklist in the app: AI connection, invite, folder permissions, first backup).
  start: {
    title: 'Two ways to start',
    body: 'The same software either way. You only choose who runs the server.',
    paths: [
      {
        id: 'hosted',
        name: 'Hosted by Trina',
        price: 'From {from} a month',
        caption: 'Trina sets up and runs the server. Updates, backups and help from a person included.',
        steps: [
          { title: 'A 30-minute call', body: 'Tell us how many people you are and how you work. We pick the plan and the first team skill together.' },
          { title: 'Your own server, ready', body: 'We set up a server for your company alone on AWS in Seoul, at your-company.trina.app.' },
          { title: 'Invite your team', body: 'Set the folder permissions and send invite links. People sign in on the web or in the apps.' },
        ],
        cta: 'Book a 30-minute call',
      },
      {
        id: 'self',
        name: 'Install it yourself',
        price: 'Free · AGPL-3.0',
        caption: 'On an office Mac mini or a Linux server. You need someone who has run a server before.',
        steps: [
          { title: 'A server', body: 'One Mac mini in the office, or a Linux server.' },
          { title: 'Install', body: 'Follow the install guide on GitHub and create your team.' },
          { title: 'Invite your team', body: 'Set the folder permissions and send invite links. People sign in on the web or in the apps.' },
        ],
        cta: 'Read the install guide',
      },
    ],
    week: {
      title: 'The first week, as a checklist',
      items: [
        { who: 'Admin', title: 'Set folder permissions', body: 'Shared and team folders, and who can see each one.' },
        { who: 'Owner / each person', title: 'Connect the AI', body: 'One company API key, or each person connects their own Claude plan.' },
        { who: 'Admin', title: 'Invite your team', body: 'Send each person an invite link.' },
        { who: 'Everyone', title: 'Make the first team skill', body: 'The task people repeat most, like a quote.' },
        { who: 'Owner', title: 'Make the first backup', body: 'Then check usage at the end of the week.' },
      ],
      link: 'The first week, step by step',
    },
  },

  paying: {
    title: 'Own subscriptions, or one company key',
    body:
      "Each person can connect their own Claude plan (Pro, Max or Team), or the company pays through one API key with a monthly limit per person. A person's own plan answers only that person's questions: sharing one subscription between people is against Claude's terms.",
    or: 'or',
    options: [
      { title: 'Own subscriptions', chips: ['Pro', 'Max', 'Team'] },
      { title: 'One company key', chips: ['Monthly limit per person'] },
    ],
  },

  // Security as the questions a buyer asks, plus where the data lives. Facts from trina-app/trina-ax docs/PERMISSIONS.md
  // and README "Data and privacy". No certifications claimed.
  security: {
    title: 'Security, as the questions\nbuyers ask',
    lead: 'Where your files live and what leaves the server, in plain words.',
    flow: {
      label:
        "Where data goes: your team signs in from the web, desktop or phone to your company's server. On the server a permission check sits in front of the AI engine and the files, chats and records, which stay there. Only what an answer needs, from what the asker may read, goes to Anthropic's Claude.",
      people: { title: 'Your team', body: 'Web, desktop, phone' },
      session: 'Signed-in session',
      server: {
        title: "Your company's server",
        hosted: 'Hosted by Trina: your own AWS server in Seoul',
        self: 'Installed yourself: an office Mac mini or your server',
        parts: ['Permission check', 'AI engine (Claude Code)', 'Files, chats, records'],
        stays: 'Stays on the server',
      },
      out: 'Only what the answer needs, from what the asker may read',
      model: { title: 'Anthropic (Claude)', body: "Handled under your Claude plan's terms" },
    },
    qa: [
      {
        q: 'Can an admin read my chats?',
        a: 'Not in the app. Chats are visible only to the person who had them; the admin activity log shows only what the AI did, such as the files it read and wrote, never the conversation. People with access to the server itself are another matter (see below).',
      },
      {
        q: 'Can Trina see our files?',
        a: "On a hosted plan Trina's operators administer the server, so we don't promise that. If that matters, install the same software on your own server and only your people are administrators.",
      },
      {
        q: 'What goes to Anthropic?',
        a: "To write an answer, the parts it needs of what the asker may read go to the Claude model. Whether that is used for training follows your Claude plan's terms. Trina does not train anything on your files.",
      },
      {
        q: "Is our data mixed with other companies'?",
        a: "No. On a hosted plan each company has a server of its own, on AWS in Seoul.",
      },
      {
        q: 'What happens when someone leaves?',
        a: 'Switch their account off and they lose files and AI at once. Deleting the account also deletes the services they connected for themselves and moves their personal folder to the owner.',
      },
      {
        q: 'What if the AI overwrites or deletes a file?',
        a: 'Every file keeps a version history you can roll back (7 days by default; an admin can change it), and deleted files stay in the trash for 30 days.',
      },
    ],
    limitsLabel: "What we don't promise",
    limits:
      "people with administrator access to the server can read the stored files and chats; on a hosted plan that includes Trina's operators. What the AI reads to answer goes to Anthropic under your Claude plan's terms. We hold no security certification yet.",
    link: 'The security page for your IT lead',
  },

  openSource: {
    title: 'Open source, so you can check',
    body:
      "Trina AX is open source under AGPL-3.0. That doesn't mean you have to run it yourself: let Trina run it, and read the code whenever you like.",
    benefits: [
      { title: 'Code you can check', body: 'How permissions are checked, what is recorded and what is sent to the AI are all in the code. Your IT lead can review it.' },
      { title: 'Free to leave', body: 'Stop the hosting and we hand your files back; the same software keeps running on your own server.' },
      { title: 'Nothing held back', body: 'Folder permissions, usage, records and team skills are all in the free version. What you pay Trina for is running it.' },
    ],
    repo: 'trina-app/trina-ax',
    license: 'AGPL-3.0',
    cta: 'View on GitHub',
    itCta: 'Send this to your IT lead',
  },

  // Plan numbers (price, people, server size) come from PLANS in src/site.ts; {from}, {n}, {cpu}, {mem} and {disk}
  // are filled in from there.
  pricing: {
    title: 'Free to run yourself.\nHosted by Trina from {from} a month',
    corner: 'What you get',
    cols: ['Self-host', 'Trina hosting'],
    rows: [
      { label: 'Price', a: 'Free · AGPL-3.0', b: 'From {from} a month, by plan' },
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

  faq: {
    title: 'Questions, answered plainly',
    items: [
      {
        q: 'Do employees have to install anything?',
        a: 'No. They open your company address in a browser. If they like, there are desktop apps for Mac and Windows, and on a phone they can add it to the home screen like an app.',
      },
      {
        q: 'Is it really free?',
        a: 'The software is free (AGPL-3.0). Only hosting by Trina is paid: a monthly plan by the number of people, setup included. Claude usage is paid to Anthropic separately.',
      },
      {
        q: 'Which Claude plan do we need?',
        a: "Each person can connect their own Claude plan (Pro, Max or Team), or the company uses one API key with a monthly limit per person. Sharing one subscription between people is off by default, and we don't recommend it.",
      },
      {
        q: 'Where do our files live?',
        a: "On your company's server: your own AWS server in Seoul if Trina hosts it, or your server or office Mac mini if you run it. File contents go to Anthropic only when the AI reads them to answer.",
      },
      {
        q: "Can someone see another team's folder?",
        a: "No. You set who can open each folder, and the AI works only inside what the person asking can open. A folder you can't open looks like it doesn't exist.",
      },
      {
        q: 'Does it work with ChatGPT?',
        a: 'Claude is the default. An admin can also turn on Codex, which works with a ChatGPT plan or an OpenAI API key.',
      },
      {
        q: 'What if we stop?',
        a: 'We hand your files back as they are, and you can keep running the same open-source software yourself.',
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
    secondary: 'Start free',
  },

  footer: {
    company: 'Trina Inc. (주식회사 트리나)',
    links: {
      company: 'trina.app',
      github: 'GitHub',
      guide: 'Guide',
      security: 'Security',
      privacy: 'Privacy',
      terms: 'Terms',
      refund: 'Refunds',
    },
    biz: { ceo: 'CEO', bizNo: 'Business registration no.', address: 'Address', phone: 'Phone', hosting: 'Website hosting' },
    trademark:
      "Claude is a trademark of Anthropic. Trina AX is made by Trina Inc. and is not affiliated with Anthropic.",
    langLabel: 'Language',
  },

  // /security: the page an owner forwards to the IT lead. Facts from trina-app/trina-ax docs/PERMISSIONS.md and README.
  secPage: {
    title: 'Security and how it works — Trina AX',
    description:
      'For your IT lead: how Trina AX keeps each person to their own folders, what leaves the server, where the promises stop, and how to try the code.',
    ogImage: '/og.png',
    h1: 'Permissions stay. Everything is recorded.',
    lead: 'Written for the person who reviews new software for your company. The code is on GitHub, so every line here can be checked.',
    promisesTitle: 'Five promises',
    promises: [
      {
        title: 'One permission function on the server decides who sees what.',
        how:
          "The file screens, the AI, search, previews, version history and the trash all follow the same rules. A folder you can't open is answered exactly like a folder that doesn't exist.",
      },
      {
        title: 'The AI cannot touch company files directly.',
        how:
          'The AI engine (Claude Code, or Codex) runs without shell or file tools and reaches files only through the server’s own tools, which check the person every time. A production install adds a dedicated account, a sandbox and a firewall around the engine.',
      },
      {
        title: 'Before saving where more people can see, the server asks.',
        how:
          'If the AI read something few people may see and then tries to save it where more people can, the server shows a card to the person. The AI cannot answer it for them, and nothing is saved without a yes.',
      },
      {
        title: 'Nobody can read an AI key or token back.',
        how:
          'Tokens and keys are sealed in the browser with the server’s public key and stored encrypted. The AI engine gets a stand-in token that changes every turn, never the real one.',
      },
      {
        title: 'Chats belong to the person who had them.',
        how:
          'The activity log shows what the AI did, such as the files it read and wrote, not the conversation. Personal folders are closed to admins and the owner, too; when an account is deleted, its personal folder moves to the owner.',
      },
    ],
    limitsTitle: "What we don't promise",
    limitsLead: 'These are the places where the promises stop.',
    limits: [
      'What the AI reads to answer goes to the model provider (Anthropic, and OpenAI if Codex is on) under your plan’s terms.',
      "People with administrator access to the server can read the stored data; on a hosted plan that includes Trina's operators.",
      'Development mode has no OS isolation. Use the production install for company files.',
      'This is a pre-release with no security certification yet. The install guide on GitHub shows the status of each part.',
    ],
    runsTitle: 'Where it runs',
    runs: [
      { title: 'Hosted by Trina', body: 'Your own AWS server in Seoul, at your-company.trina.app.' },
      { title: 'Office Mac mini', body: 'A Mac mini in your office. You are the administrator.' },
      { title: 'Linux server', body: 'A Linux server of yours. You are the administrator.' },
    ],
    tryTitle: 'Try it on one Mac',
    tryBody: 'Development mode, to try it out. It needs Bun and Go, and chats need Claude Code signed in on this Mac; the install guide covers the production setup.',
    cmds: ['git clone https://github.com/trina-app/trina-ax', 'cd trina-ax && bun install && bun run build:native && bun run dev'],
    copy: 'Copy',
    copied: 'Copied',
    copyLabel: 'Copy the commands',
    licenseTitle: 'License',
    licenseBody:
      'AGPL-3.0-only. If you run a changed version as a network service, you must offer its source code to its users (AGPL section 13); the app shows a source link on the sign-in screen.',
    repoLink: 'Source code on GitHub',
    permLink: 'Permission model (docs/PERMISSIONS.md, Korean)',
    reportTitle: 'Reporting a vulnerability',
    reportBody:
      'A bug that lets someone see, change or spend more than they should is a security bug. Email us with the subject "Security: Trina AX" and do not open a public issue. We reply within 72 hours, and fixes go out to everyone at the same time.',
    reportMail: 'contact@trina.app',
    back: 'Back to Trina AX',
    breadcrumb: 'Security',
  },

  // /guide: the hub. An item's `to` names where it goes (see GuidePage.astro); '' means not written yet.
  guide: {
    title: 'Guide — Trina AX',
    description: 'How to start with Trina AX, guides for admins and employees, and use cases by role.',
    h1: 'Trina AX guide',
    lead: 'From what an admin sets up in the first week to what employees hand to the AI every day.',
    breadcrumb: 'Guide',
    ready: 'Read',
    soon: 'Coming soon',
    notice: 'Start with one task. Each guide lists what you need, the steps to follow and what to check if you get stuck.',
    sections: [
      {
        id: 'start',
        title: 'Getting started',
        body: 'Pick who runs the server, then follow the first week.',
        items: [
          { title: 'The first week, step by step', to: 'firstWeek' },
          { title: 'Hosted by Trina: what we do and what you do', to: 'hosting' },
          { title: 'Install it yourself (Mac mini, Linux)', to: 'install' },
        ],
      },
      {
        id: 'admin',
        title: 'For admins',
        body: 'Owners and admins: folders, people, AI connections and limits.',
        items: [
          { title: 'Folders and permissions', to: 'folder-permissions' },
          { title: 'Inviting people', to: 'invite' },
          { title: 'Connecting the AI: own plans or a company key', to: 'ai-connection' },
          { title: 'Usage and monthly limits', to: 'usage-limits' },
          { title: 'Reviewing and registering team skills', to: 'review-skills' },
          { title: 'Backups and rolling back files', to: 'backup' },
        ],
      },
      {
        id: 'members',
        title: 'For employees',
        body: 'Everyone: asking, working with team files, skills and schedules.',
        items: [
          { title: 'Your first question', to: 'first-question' },
          { title: 'Working with team files', to: 'team-files' },
          { title: 'Using team skills (type /)', to: 'use-skills' },
          { title: 'Scheduling a task', to: 'schedules' },
          { title: 'Connecting Notion, GitHub and other services', to: 'external-services' },
          { title: 'Desktop app and phone home screen', to: 'desktop-app' },
        ],
      },
      {
        id: 'use-cases',
        title: 'Use cases',
        body: 'One task per page: what to ask, which folder it needs, what comes back and how to save it as a skill.',
        items: [
          { title: 'CEO: a weekly report every Monday', to: 'use-cases/weekly-report' },
          { title: 'Sales: a quote in your format', to: 'use-cases/sales-quote' },
          { title: 'Finance: tidying up spreadsheets', to: 'use-cases/expense-summary' },
          { title: 'People: replying to an official Hangul letter', to: 'use-cases/official-letter' },
        ],
      },
      {
        id: 'trust',
        title: 'Security and billing',
        body: 'For the person who signs off.',
        items: [
          { title: 'Security and how it works', to: 'security' },
          { title: 'Plans and prices', to: 'pricing' },
        ],
      },
    ],
    forIt: {
      title: 'For your IT lead',
      body: 'How permissions are kept, what leaves the server and how to try the code, on one page.',
      cta: 'Open the security page',
    },
    back: 'Back to Trina AX',
  },

  // /guide/first-week: the first example page of the guide.
  firstWeek: {
    title: 'The first week — Trina AX guide',
    description: 'What to prepare, what to do each day of the first week with Trina AX, who does it, and a notice to send your team.',
    h1: 'The first week, step by step',
    lead: 'What to do in the first five days, who does it and how long it takes. On a hosted plan Trina does the server part with you.',
    breadcrumb: 'The first week',
    beforeTitle: 'Before you start',
    before: [
      'How many people, and in which teams',
      'Where the company files are today (PCs, a shared folder, a NAS)',
      'Which Claude plans people have, or whether the company will use one API key',
      'One person to look after folders and permissions',
    ],
    daysTitle: 'Day by day',
    whoLabel: 'Who',
    timeLabel: 'Time',
    days: [
      { day: 'Day 1', title: 'Set folder permissions', who: 'Admin', time: '30 minutes', body: 'Open Admin → Folder permissions and set access to Shared and each team folder. Use Who sees what to preview access before selecting Save.' },
      { day: 'Day 1', title: 'Connect the AI', who: 'Owner or each person', time: '10 minutes', body: 'The owner adds a company key in Admin → AI connections. If personal connections are enabled, each employee can add their own in Settings → AI connections.' },
      { day: 'Day 2', title: 'Bring the files in', who: 'Admin', time: 'Depends on the files', body: 'Upload files from the Files screen, several at a time. On a server you run yourself, the owner can also link a shared folder or NAS mounted on that computer as a connected folder.' },
      { day: 'Day 3', title: 'Invite your team', who: 'Admin', time: '10 minutes', body: 'Open Admin → Members & invites → Invite link. Choose the role, groups and expiry, then Create link and Copy link. Share it with the notice below; invitations are not emailed automatically.' },
      { day: 'Day 4', title: 'Make the first team skill', who: 'Admin with one employee', time: '30 minutes', body: 'Choose a recurring task, such as a quote or weekly report. Use Suggest as skill below a useful answer. A person who manages the folder reviews it in Team skills → To review and selects Register.' },
      { day: 'Day 5', title: 'Look back', who: 'Owner and admin', time: '15 minutes', body: 'The owner selects Back up now in Admin → System and checks completion. Review Admin → Usage together and collect questions that got stuck as ideas for the next skills.' },
    ],
    hostedTitle: 'On a hosted plan',
    hostedBody: 'Trina sets up the server and the address, keeps it updated and backed up, and goes through day 1 with you on the call.',
    noticeTitle: 'A notice to send your team',
    noticeBody: 'Copy it, change the address and the name, and send it in your messenger.',
    noticeText:
      "[Notice] From today we use Trina AX, our company's AI workspace\n\n- Address: https://your-company.trina.app\n- First: open the invite link you got and set a password.\n- What it does: hand writing, searching and organizing to the AI, with company files. The AI sees only the folders you can see.\n- Your chats are yours alone. The admin activity log never shows your conversations.\n- Stuck? Ask (name).",
    copy: 'Copy',
    copied: 'Copied',
    copyLabel: 'Copy the notice',
    back: 'All guides',
  },

  notFound: {
    title: 'Page not found',
    body: 'That page does not exist. The pages we have are on the home page.',
    back: 'Back to Trina AX',
  },
}

export type Copy = typeof en
export default en
