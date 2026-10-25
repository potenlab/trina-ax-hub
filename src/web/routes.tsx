/** @jsxImportSource hono/jsx */
// Web pages: first-run setup, login, the personal page and the admin console (docs/DESIGN.md "web pages").
//
//   GET  /                      → /setup (no users yet), /admin (owner/admin), /me (member), /login
//   GET  /setup  POST /setup    first owner + company name (+ API key); only while there are no users
//   GET  /login  POST /login    failures limited per (username + address) and per address; POST /logout
//   GET  /me/password  POST     change password (forced when must_change_password)
//   /me                         my PCs (enroll code + install commands, approve one an admin set up, revoke), my usage, budgets, skills
//   /files                      회사 파일: the company's files in the browser (upload, download, folders, rename, move, delete)
//   /admin, /admin/users, /admin/groups, /admin/folders, /admin/budgets, /admin/usage (+ /admin/usage.csv),
//   /admin/skills, /admin/settings, /admin/audit
//
// Pages are server-rendered (Hono JSX) and call the foundation services directly. Every POST checks `_csrf`
// (session secret; a double-submit cookie before login).
import type { Register } from '../http/app'
import { sessionMiddleware } from '../http/app'
import { makeWeb, pageGuard } from './kit'
import { applySavedSettings } from './settings'
import { mountAuth } from './auth'
import { mountMe } from './me'
import { mountDashboard } from './admin/dashboard'
import { mountUsers } from './admin/users'
import { mountGroups } from './admin/groups'
import { mountFolders } from './admin/folders'
import { mountBudgets } from './admin/budgets'
import { mountUsage } from './admin/usage'
import { mountSkills } from './admin/skills'
import { mountSettings } from './admin/settings'
import { mountAudit } from './admin/audit'
import { mountVersions } from './admin/versions'
import { mountFiles } from './files'

export { effectiveUrls, companyName, hubConcurrency, applySavedSettings, installCommands } from './settings'

export const register: Register = (app, ctx) => {
  applySavedSettings(ctx)
  const web = makeWeb(ctx)

  const session = sessionMiddleware(ctx)
  for (const p of ['/', '/setup', '/login', '/logout', '/me/*', '/admin/*']) app.use(p, session)
  // guards before any page handler (Hono runs handlers in registration order)
  app.use('/me/*', pageGuard(web))
  app.use('/admin/*', pageGuard(web, { admin: true }))
  for (const p of ['/', '/setup', '/login', '/logout', '/me/*', '/admin/*']) {
    app.use(p, async (c, next) => { await next(); c.header('cache-control', 'no-store') })
  }

  mountAuth(app, web)
  mountMe(app, web)
  mountDashboard(app, web)
  mountUsers(app, web)
  mountGroups(app, web)
  mountFolders(app, web)
  mountBudgets(app, web)
  mountUsage(app, web)
  mountSkills(app, web)
  mountSettings(app, web)
  mountAudit(app, web)
  mountVersions(app, web)
  mountFiles(app, web)
}
