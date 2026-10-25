-- company files in the browser (src/web/files.tsx, src/files/changes.ts)
--
-- Who changed a file last, for the /files list ("고친 사람"). One row per file, kept up to date by FileService on
-- every create, overwrite, edit, upload and move (any channel: the web, MCP tools, hub sessions). A delete removes the
-- row. `path` is the team-folder path in Unicode NFC. The list only trusts a row that is not older than the file's own
-- modified time, so a file changed some other way (copied onto the hub machine) shows no name instead of a wrong one.
--   source  'web' | 'mcp'
CREATE TABLE file_changes (
  path    TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  source  TEXT NOT NULL DEFAULT 'mcp',
  at      TEXT NOT NULL
) WITHOUT ROWID;
