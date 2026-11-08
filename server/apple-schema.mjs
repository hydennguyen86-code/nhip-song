/** Tables for sleep detail pushed from Apple Health (see apple-health.mjs). Kept separate so db.mjs can create them without an import cycle. */
export const APPLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS apple_sleep (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  bed_start TEXT,
  bed_end TEXT,
  sleep_start TEXT,
  sleep_end TEXT,
  in_bed_min REAL,
  asleep_min REAL,
  deep_min REAL,
  core_min REAL,
  rem_min REAL,
  unspecified_min REAL,
  awake_min REAL,
  awakenings INTEGER,
  efficiency REAL,
  nap_min REAL,
  sleep_score REAL,
  sources TEXT,
  samples INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS ingest_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS apple_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  hrv REAL,
  hrv_n INTEGER,
  hrv_method TEXT,
  rhr REAL,
  sleep_hr REAL,
  avg_hr REAL,
  resp REAL,
  spo2 REAL,
  steps INTEGER,
  kcal_active REAL,
  walk_hr REAL,
  wrist_temp REAL,
  sources TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS apple_workouts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_key TEXT NOT NULL,
  date TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  name TEXT,
  minutes REAL,
  avg_hr REAL,
  max_hr REAL,
  kcal REAL,
  trimp REAL,
  source TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, workout_key)
);
CREATE INDEX IF NOT EXISTS apple_workouts_by_date ON apple_workouts(user_id, date);
`;
