import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const APP_TZ = 'Asia/Ho_Chi_Minh';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  pw_hash TEXT NOT NULL,
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  icu_athlete_id TEXT,
  icu_key_cipher TEXT,
  last_sync_at TEXT,
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wellness (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  resting_hr REAL,
  hrv_rmssd REAL,
  hrv_sdnn REAL,
  sleep_secs REAL,
  sleep_score REAL,
  steps INTEGER,
  weight REAL,
  avg_sleeping_hr REAL,
  kcal_consumed REAL,
  readiness REAL,
  spo2 REAL,
  respiration REAL,
  source TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS activities (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  start_date_local TEXT NOT NULL,
  name TEXT,
  type TEXT,
  moving_time REAL,
  elapsed_time REAL,
  distance REAL,
  elevation REAL,
  avg_hr REAL,
  max_hr REAL,
  avg_watts REAL,
  normalized_watts REAL,
  training_load REAL,
  rpe REAL,
  intensity REAL,
  source TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, activity_id)
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('ok','tired','sick','serious')),
  symptoms TEXT,
  red_flag INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS checkins_by_user ON checkins(user_id, local_date);

CREATE TABLE IF NOT EXISTS exclusions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dataset TEXT NOT NULL CHECK (dataset IN ('wellness','activity')),
  row_key TEXT NOT NULL,
  field TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, dataset, row_key, field)
);

CREATE TABLE IF NOT EXISTS advice_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rhr_on INTEGER NOT NULL DEFAULT 1,
  hrv_on INTEGER NOT NULL DEFAULT 1,
  sleep_on INTEGER NOT NULL DEFAULT 1,
  rhr_z REAL NOT NULL DEFAULT 1.0,
  hrv_z REAL NOT NULL DEFAULT 1.0,
  sleep_z REAL NOT NULL DEFAULT 1.0,
  strong_z REAL NOT NULL DEFAULT 2.0
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'nhip-song.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // Migrations for databases created before these columns existed.
  try { db.exec('ALTER TABLE wellness ADD COLUMN respiration REAL'); } catch { /* already there */ }
  try { db.exec('ALTER TABLE checkins ADD COLUMN tags TEXT'); } catch { /* already there */ }
  return db;
}

export function getConfig(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setConfig(db, key, value) {
  db.prepare('INSERT INTO app_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

function keyFile(dir) {
  return path.join(dir, 'secret.key');
}

/** The API key never sits in the database as plaintext. The symmetric key lives
 * beside the database, so a leaked SQLite file alone is not a leaked key. */
export function dataKey(dir) {
  const file = keyFile(dir);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function encrypt(secret, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(secret, packed) {
  const [ivHex, tagHex, dataHex] = String(packed).split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Dữ liệu mã hoá không hợp lệ.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

/** Local calendar date in the app timezone, so "today" matches the phone. */
export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Local ISO-8601 timestamp in app timezone, sortable as text. */
export function localIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    era: 'short',
  }).formatToParts(now).reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  // en-GB uses "PM" mapped to hour 24 at midnight; force 00.
  let hh = parts.hour;
  if (hh === '24') hh = '00';
  return `${parts.year}-${parts.month}-${parts.day}T${hh}:${parts.minute}:${parts.second}`;
}
