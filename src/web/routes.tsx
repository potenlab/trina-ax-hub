/** @jsxImportSource hono/jsx */
// Web pages: first-run setup, login, the personal page and the admin console (docs/DESIGN.md "web pages").
//
//   GET  /                      → /setup (no users yet), /admin (owner/admin), /me (member), /login
//   GET  /setup  POST /setup    first owner + company name (+ API key); only while there are no users
//   GET  /login  POST /login    failures limited per (username + address) and per address; POST /logout
//   GET  /join/:token  POST     invite / password-reset link: choose a password, get logged in (src/web/join.tsx)
//   GET  /me/password  POST     change password (forced when must_change_password)
//   /me                         first-run page: the next step for this person (Claude app connector or PC), my PCs, connected Claude apps,
//                               usage / budgets / skills once there is something; /me/status.json (polled), POST /me/enroll
//   /files                      회사 파일: the company's files in the browser (upload, download, folders, rename, move, delete)
//   /admin, /admin/users, /admin/groups, /admin/folders, /admin/budgets, /admin/usage (+ /admin/usage.csv),
//   /admin/skills, /admin/settings, /admin/claude (Claude 조직 설정), /admin/audit
//
// Pages are server-rendered (Hono JSX) and call the foundation services directly. Every POST checks `_csrf`
// (session secret; a double-submit cookie before login).
import type { Register } from '../http/app'
import { sessionMiddleware } from '../http/app'
import { makeWeb, pageGuard, noteChatReady } from './kit'
import { applySavedSettings } from './settings'
import { mountAuth } from './auth'
import { mountJoin } from './join'
import { mountMe } from './me'
import { mountDashboard } from './admin/dashboard'
import { mountUsers } from './admin/users'
import { mountGroups } from './admin/groups'
import { mountFolders } from './admin/folders'
import { mountBudgets } from './admin/budgets'
import { mountUsage } from './admin/usage'
import { mountSkills } from './admin/skills'
import { mountSettings } from './admin/settings'
import { mountClaudeOrg } from './admin/claude'
import { mountAudit } from './admin/audit'
import { mountVersions } from './admin/versions'
import { mountFiles } from './files'

export { effectiveUrls, companyName, hubConcurrency, applySavedSettings, installCommands } from './settings'

export const register: Register = (app, ctx) => {
  applySavedSettings(ctx)
  const web = makeWeb(ctx)

  const session = sessionMiddleware(ctx)
  for (const p of ['/', '/setup', '/login', '/logout', '/me/*', '/admin/*']) app.use(p, session)
  // the navigation shows "채팅" only where hub chat can run
  for (const p of ['/', '/setup', '/login', '/logout', '/me/*', '/admin/*', '/join/*']) app.use(p, async (c, next) => { noteChatReady(c, ctx); await next() })
  // guards before any page handler (Hono runs handlers in registration order)
  app.use('/me/*', pageGuard(web))
  app.use('/admin/*', pageGuard(web, { admin: true }))
  for (const p of ['/', '/setup', '/login', '/logout', '/me/*', '/admin/*', '/join/*']) {
    app.use(p, async (c, next) => { await next(); c.header('cache-control', 'no-store') })
  }

  mountAuth(app, web)
  mountJoin(app, web)
  mountMe(app, web)
  mountDashboard(app, web)
  mountUsers(app, web)
  mountGroups(app, web)
  mountFolders(app, web)
  mountBudgets(app, web)
  mountUsage(app, web)
  mountSkills(app, web)
  mountSettings(app, web)
  mountClaudeOrg(app, web)
  mountAudit(app, web)
  mountVersions(app, web)
  mountFiles(app, web)
}
