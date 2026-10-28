/**
 * RFC-4180 CSV parser. Handles quoted fields, escaped "" quotes, CRLF,
 * and optional UTF-8 BOM. Returns an array of objects keyed by the header row.
 *
 * The importer below is intentionally conservative: it previews before commit,
 * refuses to invent zeros for missing values, and de-dupes by primary key.
 */

export function parseCsv(text) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inQuotes) {
      if (c === '"') {
        if (body[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { cur.push(field); field = ''; continue; }
    if (c === '\r') { continue; }
    if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; continue; }
    field += c;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  const header = rows.shift();
  if (!header) return [];
  const out = [];
  for (const row of rows) {
    if (row.length === 1 && row[0] === '') continue;
    const obj = {};
    header.forEach((h, idx) => {
      obj[String(h || '').trim()] = row[idx] === undefined ? '' : row[idx];
    });
    out.push(obj);
  }
  return out;
}

const WELLNESS_ALIASES = {
  date: ['Date', 'date'],
  restingHR: ['restingHR', 'Resting HR', 'resting_hr'],
  hrv: ['hrv', 'HRV', 'hrvRMSSD', 'hrv_rMSSD', 'HRV rMSSD'],
  hrvSDNN: ['hrvSDNN', 'HRVSDNN', 'hrv_sdnn', 'HRV SDNN'],
  sleepSecs: ['sleepSecs', 'Sleep Secs', 'sleep_secs'],
  sleepScore: ['sleepScore', 'Sleep Score', 'sleep_score'],
  steps: ['steps', 'Steps'],
  weight: ['weight', 'Weight'],
  avgSleepingHR: ['avgSleepingHR', 'Average Sleeping HR'],
  kcalConsumed: ['kcalConsumed', 'kcal_consumed', 'Calories Consumed'],
  readiness: ['readiness', 'Readiness'],
  spO2: ['spO2', 'SpO2', 'spo2'],
  respiration: ['respiration', 'Respiration', 'Respiratory Rate', 'resp'],
};

const ACTIVITY_ALIASES = {
  id: ['id', 'Id', 'ID'],
  start_date_local: ['start_date_local', 'Start Date Local', 'start date local'],
  name: ['name', 'Name'],
  type: ['type', 'Type'],
  moving_time: ['moving_time', 'Moving Time'],
  elapsed_time: ['elapsed_time', 'Elapsed Time'],
  distance: ['distance', 'Distance'],
  total_elevation_gain: ['total_elevation_gain', 'Elevation Gain'],
  average_heartrate: ['average_heartrate', 'Average HR'],
  max_heartrate: ['max_heartrate', 'Max HR'],
  average_watts: ['average_watts', 'Average Watts'],
  icu_training_load: ['icu_training_load', 'Training Load', 'load'],
  icu_intensity: ['icu_intensity', 'Intensity'],
  rpe: ['rpe', 'RPE'],
};

function buildIndex(header) {
  const map = {};
  for (const key of header) map[String(key).trim().toLowerCase()] = key;
  return map;
}

function resolveField(index, aliases) {
  for (const a of aliases) {
    const hit = index[String(a).toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

export function detectWellnessColumns(headerRow) {
  const idx = buildIndex(headerRow);
  const out = {};
  for (const [canonical, aliases] of Object.entries(WELLNESS_ALIASES)) {
    const found = resolveField(idx, aliases);
    if (found) out[canonical] = found;
  }
  return out;
}

export function detectActivityColumns(headerRow) {
  const idx = buildIndex(headerRow);
  const out = {};
  for (const [canonical, aliases] of Object.entries(ACTIVITY_ALIASES)) {
    const found = resolveField(idx, aliases);
    if (found) out[canonical] = found;
  }
  return out;
}

function toNumber(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normDate(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Preview without writing anything to the DB. */
export function previewWellness(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { kind: 'wellness', total: 0, recognised: {}, dates: null, sample: [], error: 'File trống hoặc không có dòng tiêu đề.' };
  const cols = detectWellnessColumns(Object.keys(rows[0]));
  if (!cols.date) return { kind: 'wellness', total: rows.length, recognised: cols, dates: null, sample: [], error: 'CSV không có cột date — không thể nhập.' };
  const mapped = [];
  for (const r of rows) {
    const d = normDate(r[cols.date]);
    if (!d) continue;
    mapped.push({
      date: d,
      restingHR: cols.restingHR ? toNumber(r[cols.restingHR]) : null,
      hrv: cols.hrv ? toNumber(r[cols.hrv]) : null,
      hrvSDNN: cols.hrvSDNN ? toNumber(r[cols.hrvSDNN]) : null,
      sleepSecs: cols.sleepSecs ? toNumber(r[cols.sleepSecs]) : null,
      sleepScore: cols.sleepScore ? toNumber(r[cols.sleepScore]) : null,
      steps: cols.steps ? toNumber(r[cols.steps]) : null,
      weight: cols.weight ? toNumber(r[cols.weight]) : null,
      avgSleepingHR: cols.avgSleepingHR ? toNumber(r[cols.avgSleepingHR]) : null,
      kcalConsumed: cols.kcalConsumed ? toNumber(r[cols.kcalConsumed]) : null,
      readiness: cols.readiness ? toNumber(r[cols.readiness]) : null,
      spO2: cols.spO2 ? toNumber(r[cols.spO2]) : null,
      respiration: cols.respiration ? toNumber(r[cols.respiration]) : null,
    });
  }
  const dates = mapped.length ? { oldest: mapped.reduce((a, b) => (a.date < b.date ? a : b)).date, newest: mapped.reduce((a, b) => (a.date > b.date ? a : b)).date } : null;
  return {
    kind: 'wellness',
    total: mapped.length,
    recognised: cols,
    dates,
    sample: mapped.slice(0, 3),
    error: mapped.length ? null : 'CSV có dòng nhưng không đọc được cột date hợp lệ.',
  };
}

export function previewActivities(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { kind: 'activities', total: 0, recognised: {}, dates: null, sample: [], error: 'File trống.' };
  const cols = detectActivityColumns(Object.keys(rows[0]));
  if (!cols.id && !cols.start_date_local) return { kind: 'activities', total: rows.length, recognised: cols, dates: null, sample: [], error: 'CSV activities cần ít nhất cột id hoặc start_date_local.' };
  const mapped = rows.map((r) => ({
    id: cols.id ? String(r[cols.id] || '').trim() : '',
    start_date_local: cols.start_date_local ? String(r[cols.start_date_local] || '').trim() : '',
    name: cols.name ? String(r[cols.name] || '').trim() : '',
    type: cols.type ? String(r[cols.type] || '').trim() : '',
    moving_time: cols.moving_time ? toNumber(r[cols.moving_time]) : null,
    elapsed_time: cols.elapsed_time ? toNumber(r[cols.elapsed_time]) : null,
    distance: cols.distance ? toNumber(r[cols.distance]) : null,
    total_elevation_gain: cols.total_elevation_gain ? toNumber(r[cols.total_elevation_gain]) : null,
    average_heartrate: cols.average_heartrate ? toNumber(r[cols.average_heartrate]) : null,
    max_heartrate: cols.max_heartrate ? toNumber(r[cols.max_heartrate]) : null,
    average_watts: cols.average_watts ? toNumber(r[cols.average_watts]) : null,
    icu_training_load: cols.icu_training_load ? toNumber(r[cols.icu_training_load]) : null,
    icu_intensity: cols.icu_intensity ? toNumber(r[cols.icu_intensity]) : null,
    rpe: cols.rpe ? toNumber(r[cols.rpe]) : null,
  })).filter((a) => a.id || a.start_date_local);
  const dates = mapped.length ? {
    oldest: mapped.reduce((a, b) => (a.start_date_local < b.start_date_local ? a : b)).start_date_local.slice(0, 10),
    newest: mapped.reduce((a, b) => (a.start_date_local > b.start_date_local ? a : b)).start_date_local.slice(0, 10),
  } : null;
  return { kind: 'activities', total: mapped.length, recognised: cols, dates, sample: mapped.slice(0, 3), error: mapped.length ? null : 'CSV không đọc được dòng activity nào.' };
}
