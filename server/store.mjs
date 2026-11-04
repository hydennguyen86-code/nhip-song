/**
 * Data access for the app. Everything is scoped by user_id — no function here
 * accepts a caller-supplied user id from a request; the caller must pass the
 * authenticated account.
 */
import { localDate, localIso, encrypt, decrypt, MANUAL_COLUMNS } from './db.mjs';
import { hashPassword } from './auth.mjs';
import { plausible } from './signals.mjs';

const NULLIF = (v) => (v === undefined || v === null || v === '' ? null : v);

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function listUsers(db) {
  return db
    .prepare(
      `SELECT id, username, display_name, role, icu_athlete_id,
              (icu_key_cipher IS NOT NULL) AS has_key,
              last_sync_at, last_sync_error, must_change_pw
       FROM users ORDER BY id`,
    )
    .all();
}

export function findUser(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).toLowerCase());
}

export function getUser(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function createUser(db, { username, displayName, password, role = 'member', mustChangePw = 0 }) {
  const clean = String(username).toLowerCase().trim();
  if (!/^[a-z0-9._-]{3,32}$/.test(clean)) throw new Error('Tên đăng nhập 3–32 ký tự, chỉ chữ thường, số, . _ -');
  if (String(password).length < 6) throw new Error('Mật khẩu cần tối thiểu 6 ký tự (số cũng được).');
  const info = db
    .prepare(
      `INSERT INTO users(username, display_name, role, pw_hash, must_change_pw, created_at, icu_athlete_id)
       VALUES(?,?,?,?,?,?,?)`,
    )
    .run(clean, String(displayName).trim() || clean, role, hashPassword(password), mustChangePw ? 1 : 0, localIso(), null);
  return Number(info.lastInsertRowid);
}

export function setPassword(db, userId, password) {
  if (String(password).length < 6) throw new Error('Mật khẩu cần tối thiểu 6 ký tự (số cũng được).');
  db.prepare('UPDATE users SET pw_hash = ?, must_change_pw = 0 WHERE id = ?').run(hashPassword(password), userId);
}

export function saveIcuKey(db, userId, { athleteId, apiKey, dataKeyHex }) {
  const cipher = encrypt(dataKeyHex, String(apiKey).trim());
  db.prepare('UPDATE users SET icu_athlete_id = ?, icu_key_cipher = ? WHERE id = ?').run(String(athleteId).trim(), cipher, userId);
}

export function clearIcuKey(db, userId) {
  db.prepare('UPDATE users SET icu_key_cipher = NULL, icu_athlete_id = NULL WHERE id = ?').run(userId);
}

export function getIcuKey(db, userId, dataKeyHex) {
  const row = db.prepare('SELECT icu_athlete_id AS athleteId, icu_key_cipher AS cipher FROM users WHERE id = ?').get(userId);
  if (!row || !row.cipher) return null;
  try {
    return { athleteId: row.athleteId, apiKey: decrypt(dataKeyHex, row.cipher) };
  } catch {
    return null;
  }
}

export function markSync(db, userId, { ok, error }) {
  if (ok) {
    db.prepare('UPDATE users SET last_sync_at = ?, last_sync_error = NULL WHERE id = ?').run(localIso(), userId);
  } else {
    db.prepare('UPDATE users SET last_sync_error = ? WHERE id = ?').run(String(error).slice(0, 500), userId);
  }
}

const MANUAL_FLAG_COLUMNS = MANUAL_COLUMNS.flatMap((c) => [`${c}_manual`, `${c}_manual_at`]).join(',');
// How each hand-enterable column is named on incoming sync and CSV records.
const REC_KEY = Object.freeze({ resting_hr: 'restingHR', sleep_secs: 'sleepSecs', sleep_score: 'sleepScore', steps: 'steps', spo2: 'spO2', weight: 'weight' });

/** Upstream wins when it has a value. Without one, only a manual reading survives. */
function keepManual(c) {
  return `${c}=CASE WHEN excluded.${c} IS NOT NULL OR wellness.${c}_manual = 0 THEN excluded.${c} ELSE wellness.${c} END,
       ${c}_manual=CASE
         WHEN excluded.${c} IS NOT NULL THEN excluded.${c}_manual
         WHEN excluded.${c}_manual = 1 THEN 1
         ELSE wellness.${c}_manual END,
       ${c}_manual_at=CASE
         WHEN excluded.${c} IS NOT NULL THEN excluded.${c}_manual_at
         WHEN excluded.${c}_manual = 1 THEN excluded.${c}_manual_at
         ELSE wellness.${c}_manual_at END`;
}

/**
 * Upsert a wellness record from Intervals.icu. The API sometimes sends both
 * `hrv` (rMSSD) and `hrvSDNN` — they are stored in separate columns and never
 * coalesced into one field.
 *
 * Manual readings are a fallback for days the upstream source cannot provide them: a NULL upstream value must not erase them, while a real upstream
 * value always takes over and clears the manual flag.
 */
export function upsertWellness(db, userId, rec) {
  // Intervals.icu returns the wellness day as `id` (a date string); CSV rows use `date`.
  const date = String(rec.date || rec.id || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const manual = rec.hrvManual ? 1 : 0;
  const manualAt = manual ? rec.hrvManualAt || localIso() : null;
  const respManual = rec.respirationManual ? 1 : 0;
  const respManualAt = respManual ? rec.respirationManualAt || localIso() : null;
  const stmt = db.prepare(
    `INSERT INTO wellness(user_id,date,resting_hr,hrv_rmssd,hrv_sdnn,sleep_secs,sleep_score,steps,
       weight,avg_sleeping_hr,kcal_consumed,readiness,spo2,respiration,hrv_manual,hrv_manual_at,respiration_manual,respiration_manual_at,${MANUAL_FLAG_COLUMNS},source,raw_json,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${'?,'.repeat(MANUAL_COLUMNS.length * 2)}?,?,?,?)
     ON CONFLICT(user_id,date) DO UPDATE SET
       ${keepManual('resting_hr')},
       hrv_rmssd=CASE WHEN excluded.hrv_rmssd IS NOT NULL THEN excluded.hrv_rmssd ELSE wellness.hrv_rmssd END,
       hrv_manual=CASE
         WHEN excluded.hrv_rmssd IS NOT NULL THEN excluded.hrv_manual
         WHEN excluded.hrv_manual = 1 THEN 1
         ELSE wellness.hrv_manual END,
       hrv_manual_at=CASE
         WHEN excluded.hrv_rmssd IS NOT NULL THEN excluded.hrv_manual_at
         WHEN excluded.hrv_manual = 1 THEN excluded.hrv_manual_at
         ELSE wellness.hrv_manual_at END,
       hrv_sdnn=excluded.hrv_sdnn,
       ${keepManual('sleep_secs')},
       ${keepManual('sleep_score')},
       ${keepManual('steps')},
       ${keepManual('weight')},
       avg_sleeping_hr=excluded.avg_sleeping_hr,
       kcal_consumed=excluded.kcal_consumed,
       readiness=excluded.readiness,
       ${keepManual('spo2')},
       respiration=CASE WHEN excluded.respiration IS NOT NULL THEN excluded.respiration ELSE wellness.respiration END,
       respiration_manual=CASE
         WHEN excluded.respiration IS NOT NULL THEN excluded.respiration_manual
         WHEN excluded.respiration_manual = 1 THEN 1
         ELSE wellness.respiration_manual END,
       respiration_manual_at=CASE
         WHEN excluded.respiration IS NOT NULL THEN excluded.respiration_manual_at
         WHEN excluded.respiration_manual = 1 THEN excluded.respiration_manual_at
         ELSE wellness.respiration_manual_at END,
       source=excluded.source,
       raw_json=excluded.raw_json,
       updated_at=excluded.updated_at`,
  );
  stmt.run(
    userId,
    date,
    num(rec.restingHR),
    num(rec.hrv),
    num(rec.hrvSDNN),
    num(rec.sleepSecs),
    num(rec.sleepScore),
    num(rec.steps),
    num(rec.weight),
    num(rec.avgSleepingHR),
    num(rec.kcalConsumed),
    num(rec.readiness),
    num(rec.spO2),
    num(rec.respiration),
    manual,
    manualAt,
    respManual,
    respManualAt,
    ...MANUAL_COLUMNS.flatMap((c) => {
      const on = rec.manualFields?.[c]?.manual ? 1 : 0;
      return [on, on ? rec.manualFields[c].at || localIso() : null];
    }),
    NULLIF(rec.source) || 'intervals.icu',
    JSON.stringify(rec),
    localIso(),
  );
  return true;
}

/** CSV import: never silently overwrite — merge non-null fields so a partial
 * CSV export does not erase API-synced columns. A CSV value is upstream data,
 * so it clears a manual fallback just like API sync does. */
export function mergeWellness(db, userId, rec, source) {
  const date = String(rec.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const existing = db.prepare('SELECT * FROM wellness WHERE user_id = ? AND date = ?').get(userId, date);
  const pick = (a, b) => (a === null || a === undefined ? b : a);
  const incomingHrv = num(rec.hrv);
  const hrvManual = incomingHrv != null ? 0 : (existing?.hrv_manual || 0);
  const hrvManualAt = incomingHrv != null ? null : (existing?.hrv_manual_at || null);
  const incomingResp = num(rec.respiration);
  const respManual = incomingResp != null ? 0 : (existing?.respiration_manual || 0);
  const respManualAt = incomingResp != null ? null : (existing?.respiration_manual_at || null);
  const extraFlags = MANUAL_COLUMNS.flatMap((c) => (
    num(rec[REC_KEY[c]]) != null ? [0, null] : [existing?.[`${c}_manual`] || 0, existing?.[`${c}_manual_at`] || null]
  ));
  const merged = {
    resting_hr: pick(num(rec.restingHR), existing?.resting_hr),
    hrv_rmssd: pick(incomingHrv, existing?.hrv_rmssd),
    hrv_sdnn: pick(num(rec.hrvSDNN), existing?.hrv_sdnn),
    sleep_secs: pick(num(rec.sleepSecs), existing?.sleep_secs),
    sleep_score: pick(num(rec.sleepScore), existing?.sleep_score),
    steps: pick(num(rec.steps), existing?.steps),
    weight: pick(num(rec.weight), existing?.weight),
    avg_sleeping_hr: pick(num(rec.avgSleepingHR), existing?.avg_sleeping_hr),
    kcal_consumed: pick(num(rec.kcalConsumed), existing?.kcal_consumed),
    readiness: pick(num(rec.readiness), existing?.readiness),
    spo2: pick(num(rec.spO2), existing?.spo2),
    respiration: pick(incomingResp, existing?.respiration),
  };
  if (!existing) {
    db.prepare(
      `INSERT INTO wellness(user_id,date,resting_hr,hrv_rmssd,hrv_sdnn,sleep_secs,sleep_score,steps,
         weight,avg_sleeping_hr,kcal_consumed,readiness,spo2,respiration,hrv_manual,hrv_manual_at,respiration_manual,respiration_manual_at,${MANUAL_FLAG_COLUMNS},source,raw_json,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${'?,'.repeat(MANUAL_COLUMNS.length * 2)}?,?,?,?)`,
    ).run(
      userId, date,
      merged.resting_hr, merged.hrv_rmssd, merged.hrv_sdnn, merged.sleep_secs, merged.sleep_score, merged.steps,
      merged.weight, merged.avg_sleeping_hr, merged.kcal_consumed, merged.readiness, merged.spo2, merged.respiration,
      hrvManual, hrvManualAt, respManual, respManualAt, ...extraFlags,
      NULLIF(source) || 'csv', JSON.stringify(rec), localIso(),
    );
    return true;
  }
  db.prepare(
    `UPDATE wellness SET resting_hr=?, hrv_rmssd=?, hrv_sdnn=?, sleep_secs=?, sleep_score=?, steps=?,
       weight=?, avg_sleeping_hr=?, kcal_consumed=?, readiness=?, spo2=?, respiration=?,
       hrv_manual=?, hrv_manual_at=?, respiration_manual=?, respiration_manual_at=?,
       ${MANUAL_COLUMNS.map((c) => `${c}_manual=?, ${c}_manual_at=?`).join(', ')}, updated_at=?
     WHERE user_id=? AND date=?`,
  ).run(
    merged.resting_hr, merged.hrv_rmssd, merged.hrv_sdnn, merged.sleep_secs, merged.sleep_score, merged.steps,
    merged.weight, merged.avg_sleeping_hr, merged.kcal_consumed, merged.readiness, merged.spo2, merged.respiration,
    hrvManual, hrvManualAt, respManual, respManualAt, ...extraFlags, localIso(),
    userId, date,
  );
  return true;
}

export function upsertActivity(db, userId, act, source = 'intervals.icu') {
  const id = String(act.id ?? act.activity_id ?? '');
  if (!id) return false;
  const start = String(act.start_date_local || act.start_date || '').slice(0, 19);
  if (!start) return false;
  db.prepare(
    `INSERT INTO activities(user_id,activity_id,start_date_local,name,type,moving_time,elapsed_time,
       distance,elevation,avg_hr,max_hr,avg_watts,normalized_watts,training_load,rpe,intensity,
       source,raw_json,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id,activity_id) DO UPDATE SET
       start_date_local=excluded.start_date_local,
       name=excluded.name, type=excluded.type,
       moving_time=excluded.moving_time, elapsed_time=excluded.elapsed_time,
       distance=excluded.distance, elevation=excluded.elevation,
       avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
       avg_watts=excluded.avg_watts, normalized_watts=excluded.normalized_watts,
       training_load=excluded.training_load, rpe=excluded.rpe, intensity=excluded.intensity,
       source=excluded.source, raw_json=excluded.raw_json, updated_at=excluded.updated_at`,
  ).run(
    userId, id, start,
    NULLIF(act.name), NULLIF(act.type),
    num(act.moving_time ?? act.duration), num(act.elapsed_time ?? act.elapsed),
    num(act.distance), num(act.total_elevation_gain ?? act.elevation),
    num(act.average_heartrate ?? act.avg_hr), num(act.max_heartrate ?? act.max_hr),
    num(act.average_watts ?? act.avg_watts), num(act.icu_normalised_watts ?? act.normalized_watts),
    num(act.icu_training_load ?? act.training_load), num(act.rpe ?? act.perceived_exertion),
    num(act.icu_intensity ?? act.intensity),
    source, JSON.stringify(act), localIso(),
  );
  return true;
}

function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
}

/**
 * Store (or clear) one manually entered reading. Manual values are only a
 * fallback: a later upstream sync with a real value overwrites them and clears
 * the flag. Columns come from the constant specs below, never from input.
 */
function setManualField(db, userId, { date, value }, spec) {
  const day = String(date || '').slice(0, 10);
  if (!isIsoDate(day)) throw new Error('Ngày không hợp lệ.');
  if (day > localDate()) throw new Error(`Không nhập ${spec.label} cho ngày trong tương lai.`);

  const { column, manualColumn, manualAtColumn, key } = spec;
  const row = db.prepare(`SELECT ${manualColumn} AS manual FROM wellness WHERE user_id = ? AND date = ?`).get(userId, day);
  const empty = value === null || value === undefined || String(value).trim() === '';

  if (empty) {
    if (row?.manual !== 1) throw new Error(`Ngày này không có số ${spec.label} nhập tay để xoá.`);
    db.prepare(
      `UPDATE wellness SET ${column} = NULL, ${manualColumn} = 0, ${manualAtColumn} = NULL, updated_at = ? WHERE user_id = ? AND date = ?`,
    ).run(localIso(), userId, day);
    return { date: day, [key]: null, manual: false, manualAt: null };
  }

  const n = Number(value);
  if (!spec.valid(n)) throw new Error(spec.rangeError);

  const now = localIso();
  if (!row) {
    db.prepare(
      `INSERT INTO wellness(user_id,date,${column},${manualColumn},${manualAtColumn},source,updated_at)
       VALUES(?,?,?,1,?,?,?)`,
    ).run(userId, day, n, now, 'manual', now);
  } else {
    db.prepare(
      `UPDATE wellness SET ${column} = ?, ${manualColumn} = 1, ${manualAtColumn} = ?, updated_at = ? WHERE user_id = ? AND date = ?`,
    ).run(n, now, now, userId, day);
  }
  return { date: day, [key]: n, manual: true, manualAt: now };
}

const MANUAL_HRV = {
  key: 'hrv', label: 'HRV', column: 'hrv_rmssd', manualColumn: 'hrv_manual', manualAtColumn: 'hrv_manual_at',
  valid: (n) => Number.isFinite(n) && n >= 1 && n <= 300,
  rangeError: 'HRV phải trong khoảng 1–300 ms.',
};

// Same range the baseline accepts, so a saved value is never silently ignored.
const MANUAL_RESPIRATION = {
  key: 'respiration', label: 'nhịp thở', column: 'respiration', manualColumn: 'respiration_manual', manualAtColumn: 'respiration_manual_at',
  valid: (n) => plausible('respiration', n),
  rangeError: 'Nhịp thở phải trong khoảng 6–30 lần/phút. Nếu đo lại vẫn ngoài khoảng này lúc nghỉ, hãy hỏi bác sĩ.',
};

export const setManualHrv = (db, userId, entry) => setManualField(db, userId, entry, MANUAL_HRV);
export const setManualRespiration = (db, userId, entry) => setManualField(db, userId, entry, MANUAL_RESPIRATION);

function manualSpec(column, label, valid, rangeError) {
  return { key: column, label, column, manualColumn: `${column}_manual`, manualAtColumn: `${column}_manual_at`, valid, rangeError };
}
const between = (lo, hi) => (n) => Number.isFinite(n) && n >= lo && n <= hi;

/** Every metric the "nhập tay" card can write. Keys are wellness columns. */
const MANUAL_SPECS = Object.freeze({
  hrv_rmssd: MANUAL_HRV,
  respiration: MANUAL_RESPIRATION,
  resting_hr: manualSpec('resting_hr', 'nhịp tim nghỉ', (n) => plausible('resting_hr', n), 'Nhịp tim nghỉ phải trong khoảng 30–110 bpm.'),
  sleep_secs: manualSpec('sleep_secs', 'giờ ngủ', (n) => Number.isFinite(n) && n > 0 && n <= 16 * 3600, 'Giờ ngủ phải lớn hơn 0 và không quá 16 giờ.'),
  sleep_score: manualSpec('sleep_score', 'điểm ngủ', between(0, 100), 'Điểm ngủ phải trong khoảng 0–100.'),
  steps: manualSpec('steps', 'số bước', (n) => Number.isInteger(n) && n >= 0 && n <= 200000, 'Số bước phải là số nguyên từ 0 đến 200.000.'),
  spo2: manualSpec('spo2', 'SpO2', between(70, 100), 'SpO2 phải trong khoảng 70–100%.'),
  weight: manualSpec('weight', 'cân nặng', between(20, 300), 'Cân nặng phải trong khoảng 20–300 kg.'),
});

/**
 * Save one day of hand-entered readings. All values are checked before anything
 * is written. A value equal to the stored one changes nothing, so re-saving a
 * synced number never marks it manual. A blank clears a manual value and leaves
 * a synced one alone. Returns the columns that changed.
 */
export function saveManualDay(db, userId, { date, values }) {
  const day = String(date || '').slice(0, 10);
  if (!isIsoDate(day)) throw new Error('Ngày không hợp lệ.');
  if (day > localDate()) throw new Error('Không nhập cho ngày trong tương lai.');
  const row = db.prepare('SELECT * FROM wellness WHERE user_id = ? AND date = ?').get(userId, day);
  const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

  const writes = [];
  for (const [column, value] of Object.entries(values || {})) {
    if (!Object.hasOwn(MANUAL_SPECS, column)) throw new Error('Chỉ số không hợp lệ.');
    const spec = MANUAL_SPECS[column];
    if (isBlank(value)) {
      if (row?.[spec.manualColumn] === 1) writes.push({ spec, value: null });
      continue;
    }
    const n = Number(value);
    if (!spec.valid(n)) throw new Error(spec.rangeError);
    if (row?.[column] !== n) writes.push({ spec, value: n });
  }
  for (const { spec, value } of writes) setManualField(db, userId, { date: day, value }, spec);
  return { date: day, changed: writes.map((w) => w.spec.column) };
}

export function listWellnessRange(db, userId, oldest, newest) {
  return db
    .prepare('SELECT * FROM wellness WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date')
    .all(userId, oldest, newest);
}

export function listActivitiesRange(db, userId, oldest, newest) {
  return db
    .prepare('SELECT * FROM activities WHERE user_id = ? AND substr(start_date_local,1,10) BETWEEN ? AND ? ORDER BY start_date_local DESC')
    .all(userId, oldest, newest);
}

function tagsValue(tags) {
  if (!Array.isArray(tags) || !tags.length) return null;
  const clean = tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  return clean.length ? JSON.stringify(clean) : null;
}

function withTags(row) {
  if (!row) return row;
  let tags = [];
  try { tags = row.tags ? JSON.parse(row.tags) : []; } catch { tags = []; }
  return { ...row, tags: Array.isArray(tags) ? tags : [] };
}

export function addCheckin(db, userId, { level, symptoms, redFlag, note, tags }) {
  const now = new Date();
  const info = db
    .prepare(
      `INSERT INTO checkins(user_id, local_date, level, symptoms, red_flag, note, tags, created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(userId, localDate(now), level, NULLIF(symptoms), redFlag ? 1 : 0, NULLIF(note), tagsValue(tags), localIso(now));
  return Number(info.lastInsertRowid);
}

export function latestCheckin(db, userId, localDay) {
  return withTags(db
    .prepare('SELECT * FROM checkins WHERE user_id = ? AND local_date = ? ORDER BY id DESC LIMIT 1')
    .get(userId, localDay));
}

export function listCheckins(db, userId, limit = 60) {
  return db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit).map(withTags);
}

export function excludeField(db, userId, { dataset, rowKey, field, reason }) {
  db.prepare(
    `INSERT INTO exclusions(user_id,dataset,row_key,field,reason,created_at)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(user_id,dataset,row_key,field) DO UPDATE SET reason=excluded.reason`,
  ).run(userId, dataset, String(rowKey), field, NULLIF(reason) || 'user-flagged', localIso());
}

export function includeField(db, userId, { dataset, rowKey, field }) {
  db.prepare('DELETE FROM exclusions WHERE user_id=? AND dataset=? AND row_key=? AND field=?').run(
    userId, dataset, String(rowKey), field,
  );
}

export function listExclusions(db, userId, dataset = null) {
  return dataset
    ? db.prepare('SELECT * FROM exclusions WHERE user_id = ? AND dataset = ?').all(userId, dataset)
    : db.prepare('SELECT * FROM exclusions WHERE user_id = ?').all(userId);
}

export const DEFAULT_ADVICE_SETTINGS = Object.freeze({
  rhr_on: 1, hrv_on: 1, sleep_on: 1,
  rhr_z: 1.0, hrv_z: 1.0, sleep_z: 1.0, strong_z: 2.0,
});

export function getAdviceSettings(db, userId) {
  const row = db.prepare('SELECT * FROM advice_settings WHERE user_id = ?').get(userId);
  return { ...DEFAULT_ADVICE_SETTINGS, ...(row || {}) };
}

export function setAdviceSettings(db, userId, patch) {
  const cur = getAdviceSettings(db, userId);
  const next = { ...cur };
  for (const k of Object.keys(DEFAULT_ADVICE_SETTINGS)) {
    if (patch[k] === undefined) continue;
    if (k.endsWith('_on')) next[k] = patch[k] ? 1 : 0;
    else {
      const n = Number(patch[k]);
      if (!Number.isFinite(n) || n < 0.2 || n > 5) throw new Error('Ngưỡng z phải nằm trong khoảng 0.2 – 5.');
      next[k] = n;
    }
  }
  db.prepare(
    `INSERT INTO advice_settings(user_id,rhr_on,hrv_on,sleep_on,rhr_z,hrv_z,sleep_z,strong_z)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       rhr_on=excluded.rhr_on, hrv_on=excluded.hrv_on, sleep_on=excluded.sleep_on,
       rhr_z=excluded.rhr_z, hrv_z=excluded.hrv_z, sleep_z=excluded.sleep_z, strong_z=excluded.strong_z`,
  ).run(userId, next.rhr_on, next.hrv_on, next.sleep_on, next.rhr_z, next.hrv_z, next.sleep_z, next.strong_z);
  return getAdviceSettings(db, userId);
}

/** Wellness rows with the excluded fields nulled out so baselines ignore them. */
export function effectiveWellness(db, userId, oldest, newest) {
  const rows = listWellnessRange(db, userId, oldest, newest);
  const excluded = listExclusions(db, userId, 'wellness');
  if (!excluded.length) return rows;
  const byDate = new Map();
  for (const e of excluded) {
    if (!byDate.has(e.row_key)) byDate.set(e.row_key, new Set());
    byDate.get(e.row_key).add(e.field);
  }
  return rows.map((r) => {
    const set = byDate.get(r.date);
    if (!set) return r;
    const copy = { ...r };
    for (const f of set) if (f in copy) copy[f] = null;
    return copy;
  });
}
