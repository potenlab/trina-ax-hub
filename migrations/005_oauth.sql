-- Claude app connectors (claude.ai web, Claude Desktop, Claude mobile, Cowork) reach the hub's MCP server with OAuth:
-- dynamic client registration, authorization code + PKCE, short access tokens and rotating refresh tokens.
-- Access tokens are rows in `tokens` with kind 'connector' (the person approved the app themselves).

CREATE TABLE tokens_new (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('device', 'hub', 'connector')),
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT,
  created_by   TEXT,
  approved_at  TEXT,
  hub_url      TEXT
);
INSERT INTO tokens_new (id, user_id, kind, name, token_hash, prefix, created_at, expires_at, last_used_at, revoked_at, created_by, approved_at, hub_url)
  SELECT id, user_id, kind, name, token_hash, prefix, created_at, expires_at, last_used_at, revoked_at, created_by, approved_at, hub_url FROM tokens;
DROP TABLE tokens;
ALTER TABLE tokens_new RENAME TO tokens;
CREATE INDEX tokens_user ON tokens(user_id);

CREATE TABLE oauth_clients (
  client_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,          -- JSON array, exact URIs (loopback ports may differ, RFC 8252)
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);

CREATE TABLE oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource       TEXT,
  scope          TEXT,
  expires_at     TEXT NOT NULL,
  used_at        TEXT
);

CREATE TABLE oauth_refresh (
  token_hash      TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_id TEXT,
  resource        TEXT,
  scope           TEXT,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT
);
CREATE INDEX oauth_refresh_user ON oauth_refresh(user_id);
