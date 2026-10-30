// Product 0.2.2 / 5c15812. UI labels checked against web/src/i18n/en.ts.
// Share evidence and article identities with Korean; do not reuse Korean UI screenshots.
import { GUIDES, type Guide } from './guides'

type Translation = Omit<Guide, 'sources' | 'image'>
const articles: Translation[] = [
  {
    slug: 'hosting', group: 'start', title: 'Prepare for Trina hosting',
    description: 'What Trina sets up, and what your company decides about files, AI connections and access.',
    audience: 'Business owners and the person coordinating your rollout.',
    before: ['Choose how many people will use it and one task to try first.', 'Name someone at your company who can decide who should see each folder.'],
    steps: [
      { title: 'Outline your first task', body: 'Email Trina with your team size, the file formats you use and the task you want to try. Start with one small folder before moving all your files.' },
      { title: 'Check your server and address', body: 'Trina prepares a dedicated AWS server in Seoul and your company address. Sign in at the address you receive and check that your account has the Owner role.' },
      { title: 'Decide who can use what', body: 'Open Admin → Folder permissions to choose who can see your files. Decide how to connect the AI, then invite employees from Members & invites. Trina runs the server; your company decides who can access the content.' },
      { title: 'Try one real task', body: 'Ask one employee to open New chat and try a small task. Check that they can see the right folders and that the answer is useful before inviting more people.' },
    ],
    problems: [
      { title: 'Not sure which files to bring in?', body: 'Start with the files you need this week. Set permissions before adding restricted material such as payroll.' },
      { title: 'Is AI usage included?', body: 'Hosting covers the server and its operation. Claude subscriptions or usage through a company API key are paid separately.' },
    ], next: 'folder-permissions',
  },
  {
    slug: 'folder-permissions', group: 'admin', title: 'Set folder permissions',
    description: 'Choose who can read or edit a folder, and preview how access will change before saving.',
    audience: 'Owners and admins who manage access to team files.',
    before: ['For people who need the same access, create a group in Admin → Groups → New group.', 'Use your actual folder paths. For example, groups/Finance is a folder for your Finance group.'],
    steps: [
      { title: 'Choose a folder', body: 'Open Admin → Folder permissions. Select Edit for a listed folder, or Add folder to choose another one.' },
      { title: 'Add a rule', body: 'Select Add rule. Under Applies to, choose Everyone, Role, Group or Person. Set Who and Access. The access options are No access, Read and Read & write.' },
      { title: 'Preview the change', body: 'Select Who sees what and review After saving and People losing access. A subfolder without its own rules inherits the rules of its parent.' },
      { title: 'Save and check', body: 'Select Save when the access is right. Ask an affected employee to open Files and check that the folders they need are visible.' },
    ],
    problems: [
      { title: 'An admin still sees the folder', body: 'Owners and admins have management access to team folders, except other people’s personal folders. Check ordinary employee access separately.' },
      { title: 'An old answer still quotes the folder', body: 'The AI can no longer read the folder after access is removed. Changing permissions does not erase content already quoted in an earlier answer.' },
    ], next: 'invite',
  },
  {
    slug: 'invite', group: 'admin', title: 'Invite people with a link',
    description: 'Create a single-use invitation so an employee can choose their own username and password.',
    audience: 'Owners and admins inviting employees. Only the owner can invite someone as an admin.',
    before: ['Decide the employee’s role and groups.', 'Have a way to share the link yourself. Trina AX does not send invitation emails.'],
    steps: [
      { title: 'Open invitations', body: 'Go to Admin → Members & invites and select Invite link.' },
      { title: 'Set access and expiry', body: 'Choose the Role, groups and Valid for period, then select Create link. Include only the groups the employee needs.' },
      { title: 'Copy the link now', body: 'In Invite link created, select Copy link. You cannot see the link again after closing this window.' },
      { title: 'Check that they joined', body: 'Send the link directly to the employee. They choose Create account and join. When they appear in Members & invites, check their role and groups.' },
    ],
    problems: [
      { title: 'No invitation email arrived', body: 'Invitations are not emailed automatically. The person who created the link must share it.' },
      { title: 'The link has expired or was already used', body: 'Each link works once for one person. Create a new link if necessary, and use Revoke for invitations you no longer need.' },
    ], next: 'first-question',
  },
  {
    slug: 'ai-connection', group: 'admin', title: 'Connect a company API key',
    description: 'Give employees access to a company Claude API key and understand which connection their questions use.',
    audience: 'The owner adding a company AI connection. Admins can view connections and check them again.',
    before: ['Prepare a company-managed Claude API key and a team address that starts with https.', 'One team connection can serve the whole team, with subscription sharing on by default. A personal connection added in Settings → AI connections takes priority. Each AI provider’s plan terms apply. This guide covers the company API key option.'],
    steps: [
      { title: 'Add the company connection', body: 'Open Admin → AI connections → Add connection. Under What do you want to connect?, choose Claude API key.' },
      { title: 'Enter its name and key', body: 'Enter a recognizable Name and paste the key in API key. If asked for Your password again, enter your own password. Do not paste the key into a chat or document.' },
      { title: 'Choose who uses it', body: 'Under Used by, select Whole team or Chosen groups and people. Include the employees who need it, then select Connect.' },
      { title: 'Check the status and limits', body: 'Check the connection status, using Check again if needed. Set monthly limits per person in Admin → AI engines → Usage limits. Ask an employee to test a short question in New chat.' },
    ],
    problems: [
      { title: 'You cannot add a connection', body: 'Only the owner can add a company connection. Adding AI connections also requires https. Reopen the secure company address if you are using http.' },
      { title: 'A different connection answers first', body: 'Connections are tried in this order: personal, assigned to a person, assigned to a group, then whole team. An employee’s personal connection takes priority for their questions.' },
      { title: 'Employees want to use their own subscriptions', body: 'Enable Let members add their own AI connection. Employees can then open Settings → AI connections → Add connection, choose Claude subscription (Pro, Max, Team) and follow the instructions. Their personal connection takes priority over the team connection. Team subscription sharing is on by default; a company API key is another option.' },
    ], next: 'usage-limits',
  },
  {
    slug: 'usage-limits', group: 'admin', title: 'Set monthly usage limits',
    description: 'Review usage and limit each person’s monthly tokens or estimated spending through company API keys.',
    audience: 'Owners and admins managing AI usage and company API costs.',
    before: ['Costs are estimated at list prices for API key connections only. They may differ from the provider’s bill.', 'Use token limits for subscription connections. Only API key usage counts toward spending limits.'],
    steps: [
      { title: 'Review current usage', body: 'Open Admin → Usage. Set Group by to Person and choose the date range. Review Answers and Tokens; use Download CSV if you need a copy.' },
      { title: 'Add a limit', body: 'Open Admin → AI engines, find Usage limits and select Add limit.' },
      { title: 'Choose the person and period', body: 'Set Applies to to Person and choose the employee. Set Period to Per month. Enter a Token limit and, for API key costs, a Spending limit (USD).' },
      { title: 'Choose what happens at the limit', body: 'Under When exceeded, choose Warn only or Block, then Save. A spending limit of 0 means no spending cap. Check the saved person, period and limits.' },
    ],
    problems: [
      { title: 'The cost stays at zero', body: 'Subscription connections do not accumulate a per-request cost. In Usage, group by AI connection to see which connection was used.' },
      { title: 'Answers continue after the limit', body: 'Check whether the rule is set to Warn only. Choose Block to stop usage when the limit is reached.' },
    ], next: 'schedules',
  },
  {
    slug: 'review-skills', group: 'admin', title: 'Review and register a team skill',
    description: 'Review an employee’s suggested workflow before making it available as a reusable team skill.',
    audience: 'Owners, admins and people allowed to manage team skills in the destination folder.',
    before: ['An employee must have used Suggest as skill on a chat answer or a file in their personal folder.', 'Check who can read the destination folder and which source files the skill expects to use.'],
    steps: [
      { title: 'Open a suggestion', body: 'Open Team skills → To review, choose a suggestion and select Review.' },
      { title: 'Read and edit it', body: 'In Review a suggested skill, check the File name and content. Use Edit to refine the steps and output format, then Preview to read it again. Remove personal details and any keys.' },
      { title: 'Register or turn it down', body: 'Select Register when the skill is ready. The AI of teammates who can see that folder can follow it. Otherwise choose Turn down; you can leave a reason for the person who suggested it.' },
      { title: 'Check the registered skill', body: 'Ask an employee to type / in chat and select the skill. Owners and admins can also check Team skills → Recent changes.' },
    ],
    problems: [
      { title: 'You cannot see a suggestion', body: 'Check that its Folder is one you manage. Permission to manage team skills can differ by folder.' },
      { title: 'You want to undo registration', body: 'A newly registered skill has no earlier version. To remove it, open Files → skills and delete the file; it goes to Trash. If the skill was edited after registration, use its Version history to restore an earlier version.' },
    ], next: 'use-skills',
  },
  {
    slug: 'backup', group: 'admin', title: 'Create your first backup',
    description: 'Use the owner account to create a backup and check that it completed.',
    audience: 'The team owner. Backup actions are not available to ordinary admins.',
    before: ['Backups include personal folders and chats as well as team files. Restrict access to the server and backup storage.', 'Check that there is enough disk space for a backup.'],
    steps: [
      { title: 'Open the backup list', body: 'Open Admin → System and find Backups. The list includes automatic daily backups.' },
      { title: 'Start a manual backup', body: 'Select Back up now and wait for it to finish. Manual backups include both the database and team files.' },
      { title: 'Confirm completion', body: 'Look for Backup created. and the latest Manual entry. A backup marked Incremental includes only changed team files. The server normally makes a Full backup at least every seven days; it can make one sooner if the backup chain needs rebuilding. Record the completion time in your company’s operations notes.' },
    ],
    problems: [
      { title: 'The backup button is missing', body: 'Check that you are signed in as the owner. Admins can view storage, but only the owner can back up or restore the system.' },
      { title: 'You only need to restore one file', body: 'Use the file’s Version history or Trash. Restore in System restores the database, including chats, settings and accounts, and restarts the server. It leaves team files as they are.' },
      { title: 'The backup fails', body: 'Check available storage and whether another maintenance job is running. On Trina hosting, send your contact the time and error message.' },
    ], next: 'restore-file',
  },
  {
    slug: 'restore-file', group: 'admin', title: 'Restore an earlier file version',
    description: 'Find the version you need and restore it without losing the content you are replacing.',
    audience: 'Employees and admins with read and write access to the file.',
    before: ['Find the file and decide which earlier point you want to return to.', 'Retention depends on Admin → Team settings → Keep file versions (days).'],
    steps: [
      { title: 'Open the history', body: 'Find the file in Files and choose Version history from its menu.' },
      { title: 'Choose a version', body: 'Check the version number, author and time. Use Download to inspect a version before selecting the one you want.' },
      { title: 'Restore it', body: 'Select Restore and read the confirmation, such as Restore v3? for version 3. The current content is kept as a new version when you confirm.' },
      { title: 'Check the file', body: 'Open it again to check the content. If you chose the wrong version, Version history lets you return to the content you just replaced.' },
    ],
    problems: [
      { title: 'You cannot restore', body: 'Read-only access does not let you change the file. Ask someone with write access to restore it.' },
      { title: 'The file is missing', body: 'For a deleted file, check Files → Trash. If folder permissions changed, ask an admin to check your access first.' },
    ], next: 'team-files',
  },
  {
    slug: 'first-question', group: 'members', title: 'Ask your first question',
    description: 'Check which company folders the AI can read, then start with a small, specific task.',
    audience: 'Anyone who has a company address and an account.',
    before: ['Sign in at the address your admin gave you. If you have a temporary password, choose a new password first.', 'Your personal AI connection or a company connection must be ready.'],
    steps: [
      { title: 'Start a chat', body: 'Select New chat. On your first visit, Folders your AI can see shows the files you can work with.' },
      { title: 'Describe the task and output', body: 'Name the folder or file, what you want done and the output format. Summarizing one document is a useful first task.' },
      { title: 'Send your question', body: 'Select Send. If you made a mistake, use Stop answering. Read the answer and check the files it used.' },
      { title: 'Refine the answer', body: 'Continue in the same chat: “Make a table of owners and deadlines. Mark any deadline missing from the source as undecided.” Check important names and numbers against the original.' },
    ],
    prompt: 'Read the weekly notes in shared and summarize this week’s tasks in three lines. Do not guess anything that is missing from the files.',
    problems: [
      { title: 'A folder you need is missing', body: 'The AI cannot read a folder you cannot open. Tell an admin which folder you need and why.' },
      { title: 'An AI connection is required', body: 'Check Settings → AI connections. If your team uses a company connection, ask an admin to check whether you can use it.' },
    ], next: 'team-files',
  },
  {
    slug: 'team-files', group: 'members', title: 'Work with team files',
    description: 'Attach files you can access, explain what you need and choose where the result should be saved.',
    audience: 'Employees working with company documents and spreadsheets.',
    before: ['Check in Files that you can open the source material.', 'You need write access to the destination folder. An attachment points to the current team file; it is not a separate copy. Photos and scans are read for text, not visual content. Check the extracted text against the original.'],
    steps: [
      { title: 'Attach your sources', body: 'In New chat, select Attach files → Add from team files. Use Search files by name or browse the folders, select your files and choose Attach.' },
      { title: 'Specify the result and location', body: 'For example: “Turn the attached meeting notes into a table of tasks, owners and deadlines. Leave missing deadlines undecided and save an Excel file in my folder.” Select Send.' },
      { title: 'Review any sharing confirmation', body: 'Safety check by the team server can appear if the AI tries to save content somewhere more people can see. Check the source and destination, then decide yourself whether to allow it.' },
      { title: 'Check the saved file', body: 'Open the file from the answer and compare it with the source. Check dates, owners and missing items. Ask for corrections in the same chat.' },
    ],
    problems: [
      { title: 'File no longer available', body: 'The file may have moved or your access may have changed since you attached it. Find it again in Files and attach it again.' },
      { title: 'The result cannot be saved', body: 'Check your write access to the destination. You can save it in your own folder first and decide how to share it later.' },
    ], next: 'use-skills',
  },
  {
    slug: 'use-skills', group: 'members', title: 'Use a team skill in chat',
    description: 'Select a registered skill with / to give the AI your team’s workflow and standards.',
    audience: 'Employees using team skills for recurring work.',
    before: ['The skill must be registered in a skills folder you can read.', 'You also need access to the source files. A skill does not grant extra folder permissions.'],
    steps: [
      { title: 'Open the skill menu', body: 'Type / in the message box in New chat. Find the skill in Team skills.' },
      { title: 'Choose a skill', body: 'Select it, or use the arrow keys and Enter. Press Esc to close the list.' },
      { title: 'Add this task’s details', body: 'Name the files, folders and date range, then select Send. For meeting notes, attach the notes for this meeting.' },
      { title: 'Review the result', body: 'Check that the output follows your team’s standards. Tell the skill’s maintainer about any rule you repeatedly need to correct.' },
    ],
    problems: [
      { title: 'The skill is missing', body: 'Check Team skills → My suggestions to see whether it is still Waiting for review. Even after registration, you need read access to its folder.' },
      { title: 'You want to save your own workflow', body: 'Select Suggest as skill below an answer. Fill in Skill name, Description (one sentence), Steps and Folder, then select Suggest. A person who manages that folder must register it before the team can use it.' },
    ], next: 'review-skills',
  },
  {
    slug: 'schedules', group: 'members', title: 'Schedule a weekly summary',
    description: 'Choose the Weekly summary template, set a folder and time, and review the result after it runs.',
    audience: 'Employees who want a regular summary of changes in a folder.',
    before: ['Choose a source folder and a report folder inside your personal folder. The template creates a new Markdown report.', 'Each run uses your AI connection and usage limits. The team server must be running.'],
    steps: [
      { title: 'Choose the template', body: 'Open Settings → Scheduled tasks. Under Create a scheduled task, set Task to Weekly summary.' },
      { title: 'Set the source and destination', body: 'Under Folder to read, select Choose a folder. Check that My report folder is inside your own personal folder.' },
      { title: 'Check the time and create it', body: 'Set Weekday and Run time. Check Time zone, then select Create scheduled task. Creating the schedule does not run the AI immediately.' },
      { title: 'Review a run', body: 'After the scheduled time, open Last run to review its new chat and result. Use Pause to stop future runs or Resume to enable them again.' },
    ],
    problems: [
      { title: 'Usage limit prevented the run', body: 'Check your AI connection and token or spending limits. Scheduled tasks use the same limits as your other requests.' },
      { title: 'The time is not what you expected', body: 'Check Next run and Time zone. The team server’s time zone may differ from your phone’s.' },
      { title: 'You need another report format', body: 'After checking the basic summary, ask in chat for the format and repeat time you need. Saving to your own folder reduces the chance of a sharing confirmation blocking an unattended run.' },
    ], next: 'use-cases/weekly-report',
  },
  {
    slug: 'external-services', group: 'members', title: 'Connect an external service',
    description: 'Connect your own service account and decide whether the AI can only look things up or also make changes.',
    audience: 'Employees using services with supported connections, such as Notion or GitHub, in their own chats.',
    before: ['Get the connection address and sign-in instructions or API key from the service. Its ordinary website address is not necessarily its connection address.', 'Your admin must allow personal connections. Complete service sign-in on a computer, in a browser or the desktop app.'],
    steps: [
      { title: 'Add a connection', body: 'Open Settings → External services → Add connection. Under Type, choose MCP server or API as instructed by the service. An MCP server tells the AI which tools the service offers.' },
      { title: 'Set the address and sign-in method', body: 'Enter a Name and an https Address. For an MCP server, Sign-in method can be Sign in (OAuth), API key or None. For an API, choose API key or None. Put a key only in Key, never in the address or notes.' },
      { title: 'Limit changes', body: 'Under Writing, deleting and sending, start with Block writing or Ask every time. Choose Block writing if you only need lookups. For an API, describe the paths and restrictions in Usage notes.' },
      { title: 'Finish connecting', body: 'For OAuth, choose Save and sign in and complete authentication in the window that opens. For a key, select Save. Check for Connected, then name the service and the material you need in chat.' },
    ],
    problems: [
      { title: 'Personal connections are off', body: 'Your team has disabled personal connections. Explain your task to an admin and ask whether a team connection is available.' },
      { title: 'The sign-in window does not open', body: 'Select Open sign-in window. If the service does not support this sign-in method, check whether it offers an API key. Office-network addresses and http addresses cannot be connected.' },
      { title: 'You want to connect Google Drive', body: 'Use Settings → Google Drive separately. This version supports searching, listing and reading files. It cannot upload to or edit Google Drive.' },
    ], next: 'team-files',
  },
  {
    slug: 'desktop-app', group: 'members', title: 'Connect with the desktop app',
    description: 'Download the Mac or Windows app supplied by your team and connect it to your company address.',
    audience: 'Employees who want to use a separate desktop app.',
    before: ['Have your company address and sign-in details ready.', 'Download buttons appear only when installers have been added to your team server.'],
    steps: [
      { title: 'Open the app instructions', body: 'Sign in on the web and open Settings → Apps → Desktop app.' },
      { title: 'Choose your installer', body: 'Use Download for macOS or Download for Windows if available. On a Mac, also check which Mac models the listed installer supports.' },
      { title: 'Install and connect', body: 'On a Mac, open the .dmg and drag the app into Applications. On Windows, open the installer. On the app’s first screen, enter your company address in Team address and select Connect, then sign in.' },
    ],
    problems: [
      { title: 'There is no download button', body: 'No installer has been added to your team server yet. Ask the owner to add one and use the web app in the meantime.' },
      { title: 'Installation or connection does not work', body: 'Ask your company contact to check the installer, supported computer and company address. Use the web app while they resolve the problem.' },
    ], next: 'phone-app',
  },
  {
    slug: 'phone-app', group: 'members', title: 'Add Trina AX to your phone',
    description: 'Open your company address in a mobile browser and add it to your home screen.',
    audience: 'Employees who want to use the company AI away from their desk.',
    before: ['Your company address must be reachable from your phone. If it works only in the office, ask your contact how to connect from outside.', 'These instructions use the browser’s home-screen installation, not an app-store download.'],
    steps: [
      { title: 'Sign in at your company address', body: 'Use Safari on iPhone or Chrome on Android to open your company address and sign in.' },
      { title: 'Add it to the home screen', body: 'Open Settings → Apps and read Install as an app. On iPhone, choose Share → Add to Home Screen in Safari. In Chrome on Android, choose Install app or Add to Home screen from the browser menu. The menu location can vary by OS version.' },
      { title: 'Open the installed shortcut', body: 'Open the home-screen icon. You may need to sign in again. Use Open menu to reach New chat or Files.' },
    ],
    problems: [
      { title: 'The company address will not open', body: 'Check whether it is reachable outside the company network. The team server must be running for phone access too.' },
      { title: 'External service sign-in does not return to the app', body: 'Finish connecting the service in a computer browser first. Returning from external sign-in on mobile has limited support in this version.' },
    ], next: 'first-question',
  },
  {
    slug: 'use-cases/weekly-report', group: 'use-cases', roleId: 'ceo', title: 'A weekly report every Monday',
    description: 'Turn changes in Sales and Finance into a regular report saved in your own folder.',
    audience: 'Business owners and team leads reviewing the week.',
    before: ['You need read access to Sales and Finance and write access to your own folder.', 'Prepare the real folder paths and reporting rules. If you use a weekly-report skill, check that you can read it.'],
    steps: [
      { title: 'Check the sources and scope', body: 'Open the source folders in Files. Define what “last week” means, the report sections and the destination inside your personal folder.' },
      { title: 'Ask for a schedule in chat', body: 'Paste the request above into New chat, adding the actual folder paths and destination. For a Word report, ask for a .docx file. Include all instructions in the scheduled task: each run starts a new chat.' },
      { title: 'Review the schedule and result', body: 'Open Settings → Scheduled tasks and check Next run and Time zone. After it runs, open Last run and compare the report’s figures with its source files.' },
    ],
    followUp: 'Add a source file and date beneath each item. Leave out unverified figures, and finish with a list of decisions I need to make this week.',
    skill: 'Suggest the report sections, date-range rules and source references as a weekly-report skill. Check the repeat time separately in Scheduled tasks.',
    problems: [{ title: 'The report was not created', body: 'Check Settings → Scheduled tasks. For Usage limit prevented the run, review your limits. Otherwise open Last run to check connections and folder access in the chat. Nobody can answer confirmation cards during an unattended run, so save the result in your own folder first.' }], next: 'schedules',
  },
  {
    slug: 'use-cases/sales-quote', group: 'use-cases', roleId: 'sales', title: 'Draft a quote from an earlier one',
    description: 'Use a previous quote and your price sheet to draft a new Excel quote for another customer.',
    audience: 'Sales staff who regularly prepare quotes.',
    before: ['You need read access to A-Corp-quote.xlsx and price-sheet-2026.xlsx, and write access to Sales/Quotes.', 'Confirm the customer, items, quantities, delivery date and discount rules. The names and dates shown here are fictional.'],
    steps: [
      { title: 'Attach the reference files', body: 'Open New chat → Attach files → Add from team files and choose the previous quote and price sheet.' },
      { title: 'Request the new quote', body: 'Paste the request above, adding the items and actual save location. The previous quote is a reference for columns, line items and writing rules.' },
      { title: 'Check the draft', body: 'Open the result and check unit prices, quantities, totals and delivery dates. Check the company layout yourself: this does not reproduce a complex workbook’s formatting or formulas.' },
    ],
    followUp: 'Give the source for each unit price. Flag items with a delivery date different from the one requested, and do not apply any unconfirmed discount.',
    skill: 'Suggest column order, the price-sheet location, discount approval rules and review checks as a quote skill. Keep customer-specific details in each request.',
    problems: [{ title: 'The layout differs from the original', body: 'This version creates a new Excel workbook from tables. It does not copy the original workbook’s formatting, formulas or print settings. Review the output and finish any required formatting yourself.' }], next: 'use-skills',
  },
  {
    slug: 'use-cases/expense-summary', group: 'use-cases', roleId: 'finance', title: 'Organize company-card expenses',
    description: 'Combine monthly spreadsheets, group spending by team and category, and flag receipts that need checking.',
    audience: 'Finance and operations staff preparing expense records.',
    before: ['You need read access to the July, August and September card files, and write access to Finance/Summaries.', 'Include a receipt-status column or a receipt list to compare against. Card transactions alone cannot establish whether a receipt exists.'],
    steps: [
      { title: 'Attach the sources', body: 'Open New chat → Attach files → Add from team files. Choose all three monthly spreadsheets and the receipt records.' },
      { title: 'Describe the grouping', body: 'Paste the request above. Ask for separate tables by team, by category and for missing receipts, saved as three sheets in one workbook.' },
      { title: 'Reconcile with the originals', body: 'Check row counts and totals against the source files. Review duplicates, missing team names and refunds. Save a new file instead of overwriting the originals.' },
    ],
    followUp: 'Compare the combined row count and totals with all three source files. Show possible duplicates and items whose receipt status cannot be determined in a separate table.',
    skill: 'Suggest consistent team names, categories, duplicate rules and receipt checks as an expense skill. Do not include individual employees’ transaction details in the skill.',
    problems: [{ title: 'Too many items are marked as missing receipts', body: 'The receipt records may be absent or use different column names. Ask the AI to distinguish “missing” from “unknown” and check which source column it used.' }], next: 'use-skills',
  },
  {
    slug: 'use-cases/official-letter', group: 'use-cases', roleId: 'people', title: 'Draft a reply to a Hangul letter',
    description: 'Read an official HWP or HWPX letter, identify what needs doing and draft a Word reply using verified facts.',
    audience: 'HR and operations staff preparing an official response.',
    before: ['You need read access to the HWP or HWPX in HR/Letters and write access to the destination folder.', 'Prepare verified dates, headcounts and supporting documents. Do not use the example figures as facts about your company.'],
    steps: [
      { title: 'Attach the incoming letter', body: 'Open New chat → Attach files → Add from team files and attach the letter. Paste the request above and select Send.' },
      { title: 'Check the obligations', body: 'Compare the requested actions, reply deadline and recipient with the original. Ask the AI to separate what the letter requires from what your company has actually done.' },
      { title: 'Save a Word draft', body: 'Ask for a .docx containing only verified facts, saved in your own folder or HR/Letters. Have the responsible person review the text and attachments before sending it through your company’s usual process.' },
    ],
    followUp: 'Leave unconfirmed dates and headcounts blank and list what I need to check. Quote the original lines that specify the reply deadline and recipient.',
    skill: 'Suggest the recipient, subject, body and attachment order, plus fact-checking steps, as a letter-format skill. Keep sensitive details from a specific letter out of shared skills.',
    problems: [{ title: 'The Hangul file cannot be read fully', body: 'Password protection or distribution restrictions may prevent reading the whole document. Ask its owner for a readable copy. Reading HWP or HWPX does not mean saving in HWP: the reply is created as a Word document.' }], next: 'team-files',
  },
]

export const EN_GUIDES: Guide[] = articles.map(article => ({
  ...article,
  sources: [...GUIDES.find(g => g.slug === article.slug)!.sources, 'web/src/i18n/en.ts'],
}))
