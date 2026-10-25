-- Two ways to use Claude, per person (null = the company default, setting `defaultModelAccess`):
--   subscription  the person signs in to Claude Code / the Claude apps with their own Claude subscription (Team seat,
--                 Pro, Max). The hub never sees or relays that login; usage arrives as Claude Code telemetry.
--   company_key   model calls go through the hub's relay and are billed to the company's Anthropic API key.
ALTER TABLE users ADD COLUMN model_access TEXT CHECK (model_access IN ('subscription', 'company_key'));

-- usage gets a third source, 'sub' (telemetry from a subscription PC), and an external id so a telemetry batch that is
-- sent twice is counted once. Rebuilt with the same rowids, so the daily rollup's read position stays valid.
CREATE TABLE usage_new (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  token_id       TEXT,
  source         TEXT NOT NULL CHECK (source IN ('pc', 'hub', 'sub')),
  job_id         TEXT,
  model          TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read     INTEGER NOT NULL DEFAULT 0,
  cache_write    INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  status         INTEGER NOT NULL,
  started_at     TEXT NOT NULL,
  duration_ms    INTEGER,
  ext_id         TEXT UNIQUE
);
INSERT INTO usage_new (rowid, id, user_id, token_id, source, job_id, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, status, started_at, duration_ms)
  SELECT rowid, id, user_id, token_id, source, job_id, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, status, started_at, duration_ms FROM usage;
DROP TABLE usage;
ALTER TABLE usage_new RENAME TO usage;
CREATE INDEX usage_user_time ON usage(user_id, started_at);
CREATE INDEX usage_time ON usage(started_at);
