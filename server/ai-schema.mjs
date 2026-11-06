/** Tables for the AI layer (cache + usage/cost log). Created by openDb. */
export const AI_SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_cache (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, cache_key)
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_usage_by_day ON ai_usage(day);
`;
