-- Trina AX hub schema. Times are ISO-8601 UTC strings. Ids are short random strings (src/ids.ts).

-- people ---------------------------------------------------------------------------------------------------------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  email         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  password_hash TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

-- web sessions (admin and personal pages, phone chat) ------------------------------------------------------------
CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);

-- tokens: one per PC (kind 'device') or one per hub job (kind 'hub', short-lived) -----------------------------------
-- The same token authenticates the model relay (Authorization: Bearer / x-api-key) and the MCP endpoint.
CREATE TABLE tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('device', 'hub')),
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX tokens_user ON tokens(user_id);

-- one-time codes that turn into a device token when the PC installer runs ------------------------------------------
CREATE TABLE enroll_codes (
  code_hash  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  token_id   TEXT
);

-- folder permissions (ported from Team AX) -------------------------------------------------------------------------
CREATE TABLE folders (
  id   TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE  -- actual names joined by '/', '' = the team root
);
CREATE TABLE folder_rules (
  folder_id    TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('everyone', 'role', 'group', 'user')),
  subject_id   TEXT,
  access       TEXT NOT NULL CHECK (access IN ('none', 'read', 'write')),
  PRIMARY KEY (folder_id, subject_type, subject_id)
);

-- money and usage ----------------------------------------------------------------------------------------------------
CREATE TABLE budgets (
  id           TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('team', 'group', 'user')),
  subject_id   TEXT,
  period       TEXT NOT NULL CHECK (period IN ('day', 'month')),
  limit_usd    REAL NOT NULL DEFAULT 0,       -- 0 = no money limit
  limit_tokens INTEGER,                       -- null = no token limit
  action       TEXT NOT NULL DEFAULT 'block' CHECK (action IN ('block', 'warn'))
);

-- one row per model request that went through the relay
CREATE TABLE usage (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  token_id       TEXT,
  source         TEXT NOT NULL CHECK (source IN ('pc', 'hub')),
  job_id         TEXT,                        -- hub job that made the request
  model          TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read     INTEGER NOT NULL DEFAULT 0,
  cache_write    INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  status         INTEGER NOT NULL,            -- upstream HTTP status (0 = never reached it)
  started_at     TEXT NOT NULL,
  duration_ms    INTEGER
);
CREATE INDEX usage_user_time ON usage(user_id, started_at);
CREATE INDEX usage_time ON usage(started_at);

-- skills the model invoked (seen in the relay's response stream) and skill files read through MCP
CREATE TABLE skill_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  skill   TEXT NOT NULL,
  source  TEXT NOT NULL,                      -- 'relay' | 'mcp'
  at      TEXT NOT NULL
);
CREATE INDEX skill_events_time ON skill_events(at);

-- every MCP tool call (who, what, which path, ok or not)
CREATE TABLE tool_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  token_id TEXT,
  tool    TEXT NOT NULL,
  summary TEXT NOT NULL,
  ok      INTEGER NOT NULL,
  at      TEXT NOT NULL
);
CREATE INDEX tool_events_time ON tool_events(at);

-- admin actions and security events
CREATE TABLE audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  actor  TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  at     TEXT NOT NULL
);
CREATE INDEX audit_time ON audit(at);

-- file versions kept before an overwrite / trash (files live under .trina/versions, .trina/trash)
CREATE TABLE file_versions (
  id         TEXT PRIMARY KEY,
  path       TEXT NOT NULL,
  stored_as  TEXT NOT NULL,
  size       INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  user_id    TEXT,
  reason     TEXT NOT NULL CHECK (reason IN ('overwrite', 'trash', 'move')),
  created_at TEXT NOT NULL
);
CREATE INDEX file_versions_path ON file_versions(path);

-- settings (non-secret). Secrets (the company API key) live in <data>/secrets, never in the database.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- hub sessions: phone chat and schedules run `claude -p` on this machine ------------------------------------------
CREATE TABLE hub_chats (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  session_id TEXT,                            -- Claude Code session to --resume
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE hub_messages (
  id      TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES hub_chats(id) ON DELETE CASCADE,
  role    TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
  text    TEXT NOT NULL,
  job_id  TEXT,
  at      TEXT NOT NULL
);
CREATE INDEX hub_messages_chat ON hub_messages(chat_id, at);

CREATE TABLE schedules (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  cron        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  output_dir  TEXT,                           -- team-folder path where each run's result is saved (user must write there)
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE hub_jobs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('chat', 'schedule')),
  user_id     TEXT NOT NULL,
  chat_id     TEXT,
  schedule_id TEXT,
  prompt      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  result      TEXT,
  error       TEXT,
  cost_usd    REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX hub_jobs_status ON hub_jobs(status, created_at);
