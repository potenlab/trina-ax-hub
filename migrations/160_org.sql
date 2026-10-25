-- Claude 조직 설정 (web area, 150-159 is taken by the onboarding work, so this one is 160).
--
-- 1. A fourth token kind, 'org': the one token the admin pastes into the Claude admin console (Claude Code managed
--    settings and the Cowork OTLP form). It belongs to the hub, not to a person, so `user_id` is NULL for it and only
--    for it. With no person behind it, no code path can load it as a user, however it is reached. It may send
--    telemetry and read the org-wide skills marketplace, nothing else (src/org/token.ts).
--    The tokens table is rebuilt the way 005_oauth.sql does it; every existing row is kept as it is.
-- 2. At most one active org token (a partial unique index). Rotating revokes the old one in the same transaction.
-- 3. org_unknown_emails: telemetry that arrived with the org token and named an email no active person has. Only the
--    latest 50 distinct emails are kept (src/org/telemetry.ts), so the admin page can say whose email to add.

CREATE TABLE tokens_new (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('device', 'hub', 'connector', 'org')),
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT,
  created_by   TEXT,
  approved_at  TEXT,
  hub_url      TEXT,
  CHECK ((kind = 'org') = (user_id IS NULL))
);
INSERT INTO tokens_new (id, user_id, kind, name, token_hash, prefix, created_at, expires_at, last_used_at, revoked_at, created_by, approved_at, hub_url)
  SELECT id, user_id, kind, name, token_hash, prefix, created_at, expires_at, last_used_at, revoked_at, created_by, approved_at, hub_url FROM tokens;
DROP TABLE tokens;
ALTER TABLE tokens_new RENAME TO tokens;
CREATE INDEX tokens_user ON tokens(user_id);
CREATE UNIQUE INDEX tokens_one_org ON tokens(kind) WHERE kind = 'org' AND revoked_at IS NULL;

CREATE TABLE org_unknown_emails (
  email      TEXT PRIMARY KEY,   -- lower case
  records    INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
