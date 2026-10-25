-- relay + usage (src/usage/rollup.ts): usage summed per local day, person, source and model, so budget checks and
-- reports read a few hundred rows instead of every request of the period. Kept up to date in the same transaction as
-- each usage row; rows inserted any other way are picked up on the next read (see usage_rollup_state).
--   day      the server's local calendar day of started_at, YYYY-MM-DD (computed by JavaScript, like periodStart)
--   last_at  the latest started_at summed into the row
CREATE TABLE usage_daily (
  day         TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  source      TEXT NOT NULL,
  model       TEXT NOT NULL,
  requests    INTEGER NOT NULL DEFAULT 0,
  input       INTEGER NOT NULL DEFAULT 0,
  output      INTEGER NOT NULL DEFAULT 0,
  cache_read  INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  last_at     TEXT,
  PRIMARY KEY (day, user_id, source, model)
) WITHOUT ROWID;
CREATE INDEX usage_daily_user ON usage_daily(user_id, day);

-- how far the rollup has read the usage table (its rowid) and the time zone its days were computed in
CREATE TABLE usage_rollup_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  last_rowid INTEGER NOT NULL DEFAULT 0,
  time_zone  TEXT
);
INSERT INTO usage_rollup_state (id, last_rowid) VALUES (1, 0);
