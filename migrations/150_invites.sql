-- Invite links: a person is added by name + email and gets a single-use link /join/<token> to choose their own
-- password (replaces temporary passwords). The same table holds password-reset links (kind 'reset').
-- Only a sha256 of the token is stored. A link is dead once used, revoked (reissued) or past its expiry (7 days).
CREATE TABLE invites (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  revoked_at TEXT
);
CREATE INDEX invites_user ON invites(user_id);

-- login by email: case-insensitive lookup (not unique: older rows may repeat an address; the app refuses new repeats)
CREATE INDEX users_email_lower ON users(lower(email));
