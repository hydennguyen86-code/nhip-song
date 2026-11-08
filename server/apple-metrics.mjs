/**
 * Apple Health → Nhịp Sống: every metric, not only sleep.
 *
 * Two input formats reach the same internal samples:
 *
 *  1. The iPhone Shortcut. One line per Health sample:
 *       "type|start|end|value|unit|source"
 *     type is the sample type as the iPhone names it (Vietnamese or English:
 *     "Biến thiên nhịp tim" / "Heart Rate Variability", "Nhịp tim lúc nghỉ",
 *     "Nhịp tim", "Nhịp thở", "Độ bão hòa oxy trong máu", "Số bước",
 *     "Phân tích giấc ngủ", …). The old sleep-only line "start|end|value|source"
 *     still works.
 *  2. The JSON that the Health Auto Export app posts to a REST endpoint
 *     ({ data: { metrics: [...], workouts: [...] } }), for anyone who prefers
 *     that app to a hand-built Shortcut.
 *
 * Per wake-up date the samples become one apple_daily row:
 *   - HRV, breathing rate, SpO2: mean of the samples inside the main sleep
 *     (the night that ends that morning); without sleep data, 21:00 the evening
 *     before to 11:00. Daytime spot checks are ignored.
 *   - Average heart rate for the day: only when heart rate covers ≥ 18 hours.
 *   - Heart rate during sleep: mean of heart-rate samples inside the sleep.
 *   - Resting HR, walking HR, wrist temperature: the day's latest sample.
 *   - Steps, active energy: summed per source, the largest source kept (iPhone
 *     and watch both count the same steps), and never lowered by a later push
 *     that only covered part of the day.
 * Workouts get average and max heart rate (given, or from the heart-rate
 * samples recorded during them) and a Banister TRIMP load estimate.
 *
 * How this data reaches the recovery index is decided per person (see
 * mergeAppleIntoWellness): only compared, filling days Intervals.icu missed
 * (default), or preferred over Intervals.icu. Hand-entered values always win.
 */
import { localDate, getConfig, setConfig } from './db.mjs';
import { BASELINE_NEEDS } from './signals.mjs';
import { parseTime, parseSamples, buildNights, saveNight, listNights } from './apple-health.mjs';

const MIN = 60_000;
const DAY = 86_400_000;

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().trim();

/** Sample type label (Shortcut, any language) or Health Auto Export metric name → internal metric. */
export function metricOf(type) {
  const t = fold(type).replace(/[_-]+/g, ' ');
  if (!t) return null;
  if (/sleep analysis|phan tich giac ngu|^giac ngu$|^sleep$/.test(t)) return 'sleep';
  if (/variability|bien thien|\bhrv\b/.test(t)) return 'hrv';
  if (/resting heart|nhip tim (luc |khi )?nghi/.test(t)) return 'rhr';
  if (/walking heart|nhip tim trung binh khi di|khi di bo/.test(t)) return 'walk_hr';
  if (/respirat|nhip tho/.test(t)) return 'resp';
  if (/oxygen|oxy|spo2/.test(t)) return 'spo2';
  if (/wrist temp|nhiet do (co tay|khi ngu)|sleeping wrist/.test(t)) return 'wrist_temp';
  if (/step|buoc/.test(t)) return 'steps';
  if (/active energy|nang luong (dang )?hoat dong|calo hoat dong/.test(t)) return 'kcal';
  if (/workout|bai tap|bai luyen tap|luyen tap/.test(t)) return 'workout';
  if (/^heart rate$|^nhip tim$/.test(t)) return 'hr';
  return null;
}

/**
 * Number from what the iPhone prints: "45", "45,2", "45 ms", "1.234" steps
 * (Vietnamese thousands dot) or "97 %". Integers-only metrics treat a lone dot
 * or comma before three digits as a thousands separator.
 */
export function parseValue(raw, metric = '') {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const str = String(raw ?? '').trim();
  const m = /-?\d[\d.,]*/.exec(str);
  if (!m) return null;
  let t = m[0];
  const intMetric = metric === 'steps' || metric === 'kcal';
  if (/^\d{1,3}([.,]\d{3})+$/.test(t) && (intMetric || /[.,]\d{3}[.,]/.test(t))) t = t.replace(/[.,]/g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Physiological plausibility per metric; values outside are dropped as broken records. */
const RANGE = {
  hrv: [3, 300], rhr: [25, 130], hr: [25, 230], walk_hr: [30, 200], resp: [4, 40],
  spo2: [70, 100], wrist_temp: [-5, 45], steps: [0, 100000], kcal: [0, 10000],
};

function normalize(metric, value, unit = '') {
  if (value == null) return null;
  let v = value;
  const u = fold(unit);
  if (metric === 'spo2' && v <= 1) v *= 100;
  if (metric === 'kcal' && /kj/.test(u)) v /= 4.184;
  if (metric === 'wrist_temp' && /f/.test(u)) v = v > 50 ? (v - 32) / 1.8 : v / 1.8; // °F absolute or °F deviation
  const r = RANGE[metric];
  if (r && (v < r[0] || v > r[1])) return null;
  return v;
}

/**
 * Apple's HRV slot is labelled SDNN. Health Sync writes HUAWEI's rMSSD into it
 * (same number Intervals.icu shows), but an Apple Watch writes real SDNN, a
 * different quantity. Its readings are dropped so the two never mix.
 */
export const isAppleWatch = (source) => /apple\s*watch|dong ho apple/.test(fold(source));

// ---------------- parsing ----------------

/** Shortcut text (or array of lines) → { samples, sleepSamples, workouts, unknownTypes, badLines }. */
export function parseShortcutLines(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  const samples = [];
  const sleepLines = [];
  const workouts = [];
  const unknownTypes = new Set();
  let badLines = 0;
  for (const raw of lines.slice(0, 40000)) {
    if (raw && typeof raw === 'object') { sleepLines.push(raw); continue; }
    const line = String(raw ?? '').trim();
    if (!line) continue;
    const f = line.split('|').map((x) => x.trim());
    // Legacy sleep-only line: "start|end|value|source".
    if (parseTime(f[0]) != null) { sleepLines.push(line); continue; }
    const [type, start, end, value, unit = '', source = ''] = f;
    const metric = metricOf(type);
    if (!metric) { if (type) unknownTypes.add(type.slice(0, 40)); continue; }
    if (metric === 'sleep') { sleepLines.push({ start, end, value, source }); continue; }
    const s = parseTime(start);
    const e = parseTime(end) ?? s;
    if (s == null || e < s) { badLines++; continue; }
    if (metric === 'workout') {
      if (e - s < 5 * MIN || e - s > 12 * 60 * MIN) continue;
      workouts.push({ start: s, end: e, name: value || 'Buổi tập', source });
      continue;
    }
    const v = normalize(metric, parseValue(value, metric), unit);
    if (v == null) { badLines++; continue; }
    if (metric === 'hrv' && isAppleWatch(source)) continue;
    samples.push({ metric, start: s, end: e, value: v, source: source.slice(0, 60) });
  }
  const sleep = parseSamples(sleepLines);
  for (const l of sleep.unknownLabels) unknownTypes.add(l);
  return { samples, sleepSamples: sleep.samples, workouts, unknownTypes: [...unknownTypes], badLines: badLines + sleep.badLines };
}

const qtyOf = (x) => (x && typeof x === 'object' ? x.qty ?? x.Avg ?? x.avg ?? null : x);

/** Health Auto Export JSON → the same shape as parseShortcutLines, plus pre-summarized nights. */
export function parseAutoExport(body) {
  const data = body?.data || body || {};
  const samples = [];
  const sleepLines = [];
  const nights = [];
  const workouts = [];
  const unknownTypes = new Set();
  let badLines = 0;
  for (const m of Array.isArray(data.metrics) ? data.metrics : []) {
    const metric = metricOf(m?.name);
    if (!metric) { if (m?.name) unknownTypes.add(String(m.name).slice(0, 40)); continue; }
    for (const p of Array.isArray(m.data) ? m.data : []) {
      if (metric === 'sleep') {
        if (p.value != null && (p.startDate || p.start)) {
          sleepLines.push({ start: p.startDate || p.start, end: p.endDate || p.end, value: p.value, source: p.source || '' });
        } else if (p.sleepStart || p.inBedStart) {
          // Aggregated night: hours per stage.
          const start = parseTime(p.inBedStart || p.sleepStart);
          const end = parseTime(p.inBedEnd || p.sleepEnd);
          if (start == null || end == null || end <= start) { badLines++; continue; }
          const h = (k) => (Number.isFinite(Number(p[k])) ? Number(p[k]) * 60 : 0);
          const asleep = h('asleep') + h('core') + h('deep') + h('rem') || h('totalSleep');
          nights.push({
            date: localDate(new Date(end - 1)), startMs: start, endMs: end,
            sleepStartMs: parseTime(p.sleepStart) ?? start, sleepEndMs: parseTime(p.sleepEnd) ?? end,
            asleepMin: asleep, deepMin: h('deep'), coreMin: h('core'), remMin: h('rem'), unspecifiedMin: h('asleep'),
            awakeMin: h('awake'), inBedMin: h('inBed') || Math.round((end - start) / MIN), source: p.source || '',
          });
        }
        continue;
      }
      const t = parseTime(p.date || p.startDate);
      if (t == null) { badLines++; continue; }
      const v = normalize(metric, parseValue(qtyOf(p), metric), m.units);
      if (v == null) continue;
      if (metric === 'hrv' && isAppleWatch(p.source)) continue;
      samples.push({ metric, start: t, end: t, value: v, source: String(p.source || '').slice(0, 60) });
      if (metric === 'hr' && p.Max != null) {
        const mx = normalize('hr', parseValue(p.Max, 'hr'));
        if (mx != null) samples.push({ metric: 'hr_max', start: t, end: t, value: mx, source: '' });
      }
    }
  }
  for (const w of Array.isArray(data.workouts) ? data.workouts : []) {
    const s = parseTime(w.start || w.startDate);
    let e = parseTime(w.end || w.endDate);
    if (e == null && s != null && Number.isFinite(Number(w.duration))) e = s + Number(w.duration) * 1000;
    if (s == null || e == null || e - s < 5 * MIN) { badLines++; continue; }
    const avg = normalize('hr', parseValue(qtyOf(w.avgHeartRate ?? w.heartRateAvg ?? w.heartRate?.avg), 'hr'));
    const max = normalize('hr', parseValue(qtyOf(w.maxHeartRate ?? w.heartRateMax ?? w.heartRate?.max), 'hr'));
    const energy = w.activeEnergyBurned ?? w.activeEnergy;
    const kcal = normalize('kcal', parseValue(qtyOf(energy), 'kcal'), energy?.units);
    workouts.push({ id: w.id, start: s, end: e, name: w.name || 'Buổi tập', source: w.source || '', avgHr: avg, maxHr: max, kcal });
    for (const p of Array.isArray(w.heartRateData) ? w.heartRateData : []) {
      const t = parseTime(p.date);
      const v = normalize('hr', parseValue(p.Avg ?? p.qty, 'hr'));
      if (t != null && v != null) samples.push({ metric: 'hr', start: t, end: t, value: v, source: 'workout' });
    }
  }
  const sleep = parseSamples(sleepLines);
  return { samples, sleepSamples: sleep.samples, nights, workouts, unknownTypes: [...unknownTypes], badLines: badLines + sleep.badLines };
}

// ---------------- daily aggregation ----------------

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const median = (xs) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const NIGHT_METRICS = new Set(['hrv', 'resp', 'spo2']);
/** Fewest HRV readings inside deep sleep before the deep-sleep median is trusted. */
export const HRV_DEEP_MIN = 3;
const dateOf = (ms) => localDate(new Date(ms));
const dayStart = (date) => Date.parse(`${date}T00:00:00+07:00`);

/** Sum per source, keep the largest source (iPhone + watch would double count). */
function sumBySource(list) {
  const per = new Map();
  for (const s of list) per.set(s.source || '?', (per.get(s.source || '?') || 0) + s.value);
  return per.size ? Math.max(...per.values()) : null;
}

/**
 * Samples + sleep windows → { [date]: daily row }.
 * windows: Map date → { start, end } of the main sleep that ended that morning.
 */
export function aggregateDaily(samples, windows = new Map()) {
  const byMetric = new Map();
  for (const s of samples) {
    if (!byMetric.has(s.metric)) byMetric.set(s.metric, []);
    byMetric.get(s.metric).push(s);
  }
  const dates = new Set(samples.map((s) => dateOf(s.start)));
  // A night reading after 21:00 belongs to the next morning's night.
  for (const s of samples) if (NIGHT_METRICS.has(s.metric)) dates.add(dateOf(s.start + 3 * 3600000));
  for (const d of windows.keys()) dates.add(d);
  const out = {};
  const inside = (list, a, b) => list.filter((s) => s.start >= a && s.start < b);
  /**
   * Night metric for date d: inside the sleep, else 21:00 the evening before to
   * 11:00. Never a daytime spot check: a 15:00 HRV reading is a different
   * measurement and would distort the overnight baseline.
   */
  const nightly = (metric, d) => {
    const list = byMetric.get(metric) || [];
    const w = windows.get(d);
    const pick = w ? inside(list, w.start, w.end) : [];
    return pick.length ? pick : inside(list, dayStart(d) - 3 * 3600000, dayStart(d) + 11 * 3600000);
  };
  const latest = (metric, d) => {
    const list = inside(byMetric.get(metric) || [], dayStart(d), dayStart(d) + DAY);
    return list.length ? list.reduce((a, b) => (b.start >= a.start ? b : a)).value : null;
  };
  /**
   * Night HRV, WHOOP-style: HUAWEI writes a spot rMSSD about every 10 minutes
   * while asleep, and single readings swing widely (21–128 ms in one hour), so
   * the night is the MEDIAN of the readings inside deep-sleep blocks (≥ 3),
   * else of the whole sleep, else of 21:00 → 11:00.
   */
  const nightHrv = (d) => {
    const list = byMetric.get('hrv') || [];
    const w = windows.get(d);
    if (w?.deep?.length) {
      const deep = list.filter((s) => w.deep.some(([a, b]) => s.start >= a && s.start < b));
      if (deep.length >= HRV_DEEP_MIN) return { pick: deep, method: 'deep' };
    }
    if (w) {
      const sleep = inside(list, w.start, w.end);
      if (sleep.length) return { pick: sleep, method: 'sleep' };
    }
    const win = inside(list, dayStart(d) - 3 * 3600000, dayStart(d) + 11 * 3600000);
    return { pick: win, method: win.length ? 'window' : null };
  };
  for (const d of dates) {
    const { pick: hrv, method: hrvMethod } = nightHrv(d);
    const w = windows.get(d);
    const hrDay = inside(byMetric.get('hr') || [], dayStart(d), dayStart(d) + DAY);
    const hrSleep = w ? inside(byMetric.get('hr') || [], w.start, w.end) : [];
    const steps = inside(byMetric.get('steps') || [], dayStart(d), dayStart(d) + DAY);
    const kcal = inside(byMetric.get('kcal') || [], dayStart(d), dayStart(d) + DAY);
    const row = {
      date: d,
      hrv: round1(median(hrv.map((s) => s.value))),
      hrv_n: hrv.length || null,
      hrv_method: hrvMethod,
      rhr: latest('rhr', d),
      sleep_hr: round1(mean(hrSleep.map((s) => s.value))),
      // Whole-day average only when heart rate covers most of the day, not just a workout.
      avg_hr: new Set(hrDay.map((s) => Math.floor((s.start - dayStart(d)) / 3600000))).size >= 18 ? round1(mean(hrDay.map((s) => s.value))) : null,
      resp: round1(median(nightly('resp', d).map((s) => s.value))),
      spo2: round1(median(nightly('spo2', d).map((s) => s.value))),
      steps: steps.length ? Math.round(sumBySource(steps)) : null,
      kcal_active: kcal.length ? Math.round(sumBySource(kcal)) : null,
      walk_hr: latest('walk_hr', d),
      wrist_temp: latest('wrist_temp', d),
      sources: [...new Set([...hrv, ...hrDay].map((s) => s.source).filter(Boolean))],
    };
    if (Object.entries(row).some(([k, v]) => !['date', 'sources', 'hrv_n', 'hrv_method'].includes(k) && v != null)) out[d] = row;
  }
  return out;
}

// ---------------- workouts ----------------

/**
 * Banister TRIMP: minutes × HRr × 0.64 × e^(1.92 × HRr), HRr = heart-rate
 * reserve fraction. Uses the male coefficients (sex is not recorded); it is an
 * estimate to set beside Intervals.icu load, not a replacement for it.
 */
export function trimp(minutes, avgHr, restHr, maxHr) {
  if (!(minutes > 0) || !(avgHr > 0) || !(maxHr > restHr)) return null;
  const hrr = Math.min(Math.max((avgHr - restHr) / (maxHr - restHr), 0), 1);
  return Math.round(minutes * hrr * 0.64 * Math.exp(1.92 * hrr) * 10) / 10;
}

export function buildWorkouts(workouts, samples, { restHr = 60, maxHr = 185 } = {}) {
  const hr = samples.filter((s) => s.metric === 'hr');
  return workouts.map((w) => {
    const during = hr.filter((s) => s.start >= w.start && s.start <= w.end).map((s) => s.value);
    const avgHr = w.avgHr ?? (during.length >= 3 ? round1(mean(during)) : null);
    const maxSeen = w.maxHr ?? (during.length >= 3 ? Math.max(...during) : null);
    const minutes = Math.round((w.end - w.start) / MIN);
    return {
      key: w.id ? `id:${w.id}` : `${new Date(w.start).toISOString().slice(0, 16)}|${fold(w.name).slice(0, 30)}`,
      date: dateOf(w.start),
      start: w.start,
      end: w.end,
      name: String(w.name).slice(0, 60),
      minutes,
      avgHr,
      maxHr: maxSeen,
      kcal: w.kcal ?? null,
      trimp: trimp(minutes, avgHr, restHr, maxHr),
      source: String(w.source || '').slice(0, 60),
    };
  });
}

// ---------------- storage ----------------

const DAILY_COLS = ['hrv', 'hrv_n', 'hrv_method', 'rhr', 'sleep_hr', 'avg_hr', 'resp', 'spo2', 'steps', 'kcal_active', 'walk_hr', 'wrist_temp'];
const GROWING = new Set(['steps', 'kcal_active']);
const HRV_COLS = new Set(['hrv', 'hrv_n', 'hrv_method']);

export function saveDaily(db, userId, row) {
  // Night HRV: a later push whose window cut the night short has fewer readings;
  // keep the better method, then whichever saw more of the night (ties → newer).
  // Rank by method first (deep > sleep > window): a later push that adds the
  // sleep stages must upgrade a window median even though it uses fewer readings.
  const rank = (t) => `CASE ${t}.hrv_method WHEN 'deep' THEN 3 WHEN 'sleep' THEN 2 WHEN 'window' THEN 1 ELSE 0 END`;
  const hrvWins = `excluded.hrv IS NOT NULL AND (apple_daily.hrv IS NULL OR ${rank('excluded')} > ${rank('apple_daily')}
    OR (${rank('excluded')} = ${rank('apple_daily')} AND COALESCE(excluded.hrv_n,0) >= COALESCE(apple_daily.hrv_n,0)))`;
  const sets = DAILY_COLS.map((c) => (GROWING.has(c)
    ? `${c}=CASE WHEN excluded.${c} IS NULL THEN apple_daily.${c} WHEN apple_daily.${c} IS NULL THEN excluded.${c} ELSE MAX(excluded.${c}, apple_daily.${c}) END`
    : HRV_COLS.has(c)
      ? `${c}=CASE WHEN ${hrvWins} THEN excluded.${c} ELSE apple_daily.${c} END`
      : `${c}=COALESCE(excluded.${c}, apple_daily.${c})`)).join(', ');
  db.prepare(`INSERT INTO apple_daily(user_id,date,${DAILY_COLS.join(',')},sources,updated_at)
      VALUES(?,?,${DAILY_COLS.map(() => '?').join(',')},?,?)
      ON CONFLICT(user_id,date) DO UPDATE SET ${sets}, sources=excluded.sources, updated_at=excluded.updated_at`)
    .run(userId, row.date, ...DAILY_COLS.map((c) => row[c] ?? null), JSON.stringify(row.sources || []), new Date().toISOString());
}

export function saveWorkout(db, userId, w) {
  db.prepare(`INSERT INTO apple_workouts(user_id,workout_key,date,start_ms,end_ms,name,minutes,avg_hr,max_hr,kcal,trimp,source,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,workout_key) DO UPDATE SET date=excluded.date, start_ms=excluded.start_ms, end_ms=excluded.end_ms,
        name=excluded.name, minutes=excluded.minutes, avg_hr=COALESCE(excluded.avg_hr, apple_workouts.avg_hr),
        max_hr=COALESCE(excluded.max_hr, apple_workouts.max_hr), kcal=COALESCE(excluded.kcal, apple_workouts.kcal),
        trimp=COALESCE(excluded.trimp, apple_workouts.trimp), source=excluded.source, updated_at=excluded.updated_at`)
    .run(userId, w.key, w.date, w.start, w.end, w.name, w.minutes, w.avgHr, w.maxHr, w.kcal, w.trimp, w.source, new Date().toISOString());
}

export function listDaily(db, userId, from, to) {
  return db.prepare('SELECT * FROM apple_daily WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date DESC').all(userId, from, to);
}

export function listWorkouts(db, userId, from, to) {
  return db.prepare('SELECT * FROM apple_workouts WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY start_ms DESC').all(userId, from, to);
}

/** Resting HR and max HR used for TRIMP: stored medians/peaks, else defaults. */
function hrRefs(db, userId, samples) {
  const rhrs = db.prepare('SELECT rhr FROM apple_daily WHERE user_id = ? AND rhr IS NOT NULL ORDER BY date DESC LIMIT 30').all(userId).map((r) => r.rhr);
  const icu = db.prepare('SELECT resting_hr FROM wellness WHERE user_id = ? AND resting_hr IS NOT NULL ORDER BY date DESC LIMIT 30').all(userId).map((r) => r.resting_hr);
  const pool = [...samples.filter((s) => s.metric === 'rhr').map((s) => s.value), ...rhrs, ...icu].sort((a, b) => a - b);
  const restHr = pool.length ? pool[Math.floor(pool.length / 2)] : 60;
  const since = Date.now() - 120 * DAY;
  const peaks = [
    ...samples.filter((s) => s.metric === 'hr' || s.metric === 'hr_max').map((s) => s.value),
    ...db.prepare('SELECT max_hr FROM apple_workouts WHERE user_id = ? AND max_hr IS NOT NULL AND start_ms >= ?').all(userId, since).map((r) => r.max_hr),
    ...db.prepare('SELECT max_hr FROM activities WHERE user_id = ? AND max_hr IS NOT NULL').all(userId).map((r) => r.max_hr),
  ];
  const maxHr = Math.max(175, ...peaks.filter((x) => x <= 220));
  return { restHr, maxHr };
}

const LABEL = { hrv: 'HRV', rhr: 'nhịp tim nghỉ', sleep_hr: 'nhịp tim khi ngủ', resp: 'nhịp thở', spo2: 'SpO2', steps: 'bước' };
const ddmm = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const dur = (min) => { const m = Math.round(min || 0); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * One push (Shortcut or Health Auto Export) → sleep nights, daily rows and
 * workouts stored. Returns { ok, status, message, nights, days, workouts, … }.
 */
export function ingestAll(db, userId, body = {}) {
  const isAutoExport = body && typeof body === 'object' && (Array.isArray(body.data?.metrics) || Array.isArray(body.data?.workouts) || Array.isArray(body.metrics));
  const parsed = isAutoExport ? parseAutoExport(body) : parseShortcutLines(body.samples);
  const { samples, sleepSamples, workouts, unknownTypes, badLines } = parsed;

  const nights = buildNights(sleepSamples);
  for (const n of parsed.nights || []) {
    if (!nights.some((x) => x.date === n.date)) {
      const hhmm = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
      nights.push({ ...n, bedStart: hhmm(n.startMs), bedEnd: hhmm(n.endMs), awakenings: null, efficiency: n.inBedMin ? Math.round((n.asleepMin / n.inBedMin) * 1000) / 1000 : null, napMin: 0, hasStages: n.deepMin + n.coreMin + n.remMin > 0, sources: [n.source].filter(Boolean), samples: 0 });
    }
  }
  if (!samples.length && !nights.length && !workouts.length) {
    const why = unknownTypes.length
      ? `Không nhận ra loại dữ liệu: ${unknownTypes.join(', ')}.`
      : badLines
        ? `${badLines} dòng sai định dạng. Ở bước "Định dạng ngày" hãy chọn ISO 8601 và bật "Bao gồm thời gian".`
        : 'Không có mẫu nào trong khoảng thời gian đã chọn.';
    return { ok: false, status: 400, error: why, message: why, unknownTypes, badLines, nights: [], days: [], workouts: [] };
  }

  let score = num(body.sleepScore);
  if (score != null && (score < 0 || score > 100)) score = null;
  const newestNight = nights.reduce((a, n) => (!a || n.date > a ? n.date : a), null);
  for (const n of nights) saveNight(db, userId, n, { sleepScore: n.date === newestNight ? score : null });

  const windows = new Map(nights.filter((n) => n.sleepStartMs != null).map((n) => [n.date, { start: n.sleepStartMs, end: n.sleepEndMs, deep: n.deepBlocks || [] }]));
  const daily = aggregateDaily(samples, windows);
  for (const row of Object.values(daily)) saveDaily(db, userId, row);

  const built = buildWorkouts(workouts, samples, hrRefs(db, userId, samples));
  for (const w of built) saveWorkout(db, userId, w);

  // Message for the phone notification: the newest day, in a line.
  const days = Object.keys(daily).sort();
  const lastDay = days[days.length - 1];
  const parts = [];
  const lastNight = nights.find((n) => n.date === newestNight);
  if (lastNight) parts.push(`ngủ ${dur(lastNight.asleepMin)}${lastNight.hasStages ? ` (sâu ${dur(lastNight.deepMin)}, REM ${dur(lastNight.remMin)})` : ''}`);
  const d = daily[newestNight] || daily[lastDay];
  if (d) {
    for (const k of ['hrv', 'rhr', 'sleep_hr', 'resp', 'spo2']) {
      if (d[k] != null) parts.push(`${LABEL[k]} ${String(Math.round(d[k] * 10) / 10).replace('.', ',')}`);
    }
  }
  if (built.length) parts.push(`${built.length} buổi tập`);
  const when = newestNight || lastDay;
  const message = `${when ? `Ngày ${ddmm(when)}: ` : ''}${parts.join(', ') || 'đã nhận dữ liệu'}.${unknownTypes.length ? ` Bỏ qua loại lạ: ${unknownTypes.slice(0, 3).join(', ')}.` : ''}`;
  return {
    ok: true,
    status: 200,
    message,
    nights: nights.map((n) => ({ date: n.date, asleepMin: n.asleepMin, deepMin: n.deepMin, remMin: n.remMin, awakeMin: n.awakeMin, awakenings: n.awakenings })),
    days: days.map((k) => daily[k]),
    workouts: built.map((w) => ({ date: w.date, name: w.name, minutes: w.minutes, avgHr: w.avgHr, maxHr: w.maxHr, trimp: w.trimp })),
    unknownTypes,
    badLines,
    format: isAutoExport ? 'health-auto-export' : 'shortcut',
  };
}

// ---------------- merging into the recovery data ----------------

export const APPLE_MODES = Object.freeze(['off', 'fill', 'prefer']);
export const DEFAULT_APPLE_MODE = 'fill';

export function getAppleMode(db, userId) {
  const m = getConfig(db, `apple_mode:${userId}`, DEFAULT_APPLE_MODE);
  return APPLE_MODES.includes(m) ? m : DEFAULT_APPLE_MODE;
}

export function setAppleMode(db, userId, mode) {
  if (!APPLE_MODES.includes(mode)) throw new Error('Chế độ không hợp lệ.');
  setConfig(db, `apple_mode:${userId}`, mode);
  return mode;
}

export const HRV_SOURCES = Object.freeze(['auto', 'apple_night', 'intervals']);
/**
 * Nights of Apple night HRV (in the 60 days up to today) before "auto" switches
 * to it: the HRV baseline needs 14 earlier nights of the SAME source
 * (BASELINE_NEEDS.hrv_rmssd.minDays) plus last night, so switching earlier
 * would leave the person with no score while the Apple baseline builds.
 */
export const HRV_AUTO_MIN_NIGHTS = BASELINE_NEEDS.hrv_rmssd.minDays + 1;

export function getHrvSourceSetting(db, userId) {
  const v = getConfig(db, `hrv_source:${userId}`, 'auto');
  return HRV_SOURCES.includes(v) ? v : 'auto';
}

export function setHrvSourceSetting(db, userId, value) {
  if (!HRV_SOURCES.includes(value)) throw new Error('Nguồn HRV không hợp lệ.');
  setConfig(db, `hrv_source:${userId}`, value);
  return value;
}

const shiftDate = (date, days) => localDate(new Date(Date.parse(`${date}T12:00:00+07:00`) + days * DAY));

/**
 * Which HRV judges the recovery index: Apple night HRV ('apple_night') or the
 * Intervals.icu daily value ('intervals'). The two are different quantities
 * (sleep median vs all-day mean of spot readings), so a baseline only ever
 * uses one of them (signals.mjs hrvModel).
 */
export function hrvSourceInfo(db, userId, today = localDate()) {
  const setting = getHrvSourceSetting(db, userId);
  const appleNights = db.prepare('SELECT COUNT(*) AS n FROM apple_daily WHERE user_id = ? AND hrv IS NOT NULL AND date >= ? AND date <= ?')
    .get(userId, shiftDate(today, -60), today).n;
  const source = setting === 'intervals' ? 'intervals'
    : setting === 'apple_night' ? 'apple_night'
      : appleNights >= HRV_AUTO_MIN_NIGHTS ? 'apple_night' : 'intervals';
  const note = source === 'apple_night'
    ? 'HRV lúc ngủ từ Apple Health (trung vị các lần đo trong ngủ sâu).'
    : setting === 'auto'
      ? `HRV trung bình ngày từ Intervals.icu. Tự chuyển sang HRV lúc ngủ khi có ${HRV_AUTO_MIN_NIGHTS} đêm từ Apple Health (đang có ${appleNights}).`
      : 'HRV trung bình ngày từ Intervals.icu.';
  return { setting, source, appleNights, note };
}

/**
 * Taken from Apple even in "fill" mode: Intervals.icu's HUAWEI sleep total
 * adds that day's naps to the night, a different quantity from Apple's main
 * night (naps kept apart and credited to the next night's need in signals.mjs).
 */
const APPLE_FIRST = new Set(['sleep_secs']);

/** wellness column ← apple value, and the manual flag that protects it. HRV is handled apart (source). */
const MAP = [
  ['resting_hr', (a) => a.rhr, 'resting_hr_manual'],
  ['respiration', (a) => a.resp, 'respiration_manual'],
  ['spo2', (a) => a.spo2, 'spo2_manual'],
  ['steps', (a) => a.steps, 'steps_manual'],
  ['avg_sleeping_hr', (a) => a.sleep_hr, null],
  ['sleep_secs', (a) => (a._asleep_min > 0 ? a._asleep_min * 60 : null), 'sleep_secs_manual'],
  ['sleep_score', (a) => a._sleep_score, 'sleep_score_manual'],
];

/**
 * Intervals.icu rows + Apple Health → rows the recovery index reads.
 *   off    – Intervals only (Apple is shown for comparison)
 *   fill   – Apple fills fields Intervals left empty, and whole missing days
 *   prefer – Apple wins wherever it has a value
 * A hand-entered value is never replaced. Each row gets `_apple` listing the
 * fields that came from Apple, so the UI can say where a number is from.
 */
export function mergeAppleIntoWellness(db, userId, rows, oldest, newest, mode = getAppleMode(db, userId)) {
  const hrvSrc = hrvSourceInfo(db, userId, newest).source;
  if (hrvSrc === 'apple_night') rows = applyAppleHrv(db, userId, rows, oldest, newest);
  if (mode === 'off') return rows;
  const daily = db.prepare('SELECT * FROM apple_daily WHERE user_id = ? AND date >= ? AND date <= ?').all(userId, oldest, newest);
  const sleep = db.prepare('SELECT date, asleep_min, sleep_score, nap_min FROM apple_sleep WHERE user_id = ? AND date >= ? AND date <= ?').all(userId, oldest, newest);
  if (!daily.length && !sleep.length) return rows;
  const apple = new Map();
  for (const a of daily) apple.set(a.date, { ...a });
  for (const s of sleep) {
    const a = apple.get(s.date) || { date: s.date };
    a._asleep_min = s.asleep_min;
    a._sleep_score = s.sleep_score;
    a._nap_min = s.nap_min || 0;
    apple.set(s.date, a);
  }
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  const template = rows[0] ? Object.fromEntries(Object.keys(rows[0]).map((k) => [k, null])) : {};
  const dates = new Set([...byDate.keys(), ...apple.keys()]);
  for (const date of [...dates].sort()) {
    const base = byDate.get(date);
    const a = apple.get(date);
    if (!a) { out.push(base); continue; }
    const row = base ? { ...base } : { ...template, user_id: userId, date, hrv_manual: 0, respiration_manual: 0, source: 'apple' };
    const used = [];
    for (const [col, get, manualCol] of MAP) {
      const v = get(a);
      if (v == null) continue;
      if (manualCol && row[manualCol] === 1) continue;
      if (mode === 'fill' && row[col] != null && !APPLE_FIRST.has(col)) continue;
      row[col] = v;
      used.push(col);
    }
    if (used.includes('sleep_secs')) {
      row._sleep_src = 'apple';
      row._nap_min = a._nap_min || 0;
    }
    if (used.length) row._apple = [...(row._apple || []), ...used];
    out.push(row);
  }
  return out;
}

/**
 * HRV column from Apple night HRV. From the first Apple night on, every row's
 * hrv_rmssd is the Apple value or empty (never Intervals.icu); before it the
 * Intervals.icu history stays, tagged, so trends and the patterns engine keep
 * their history while each baseline compares like with like. Hand-entered
 * HRV always wins.
 */
function applyAppleHrv(db, userId, rows, oldest, newest) {
  const apple = db.prepare('SELECT date, hrv FROM apple_daily WHERE user_id = ? AND hrv IS NOT NULL AND date >= ? AND date <= ?').all(userId, oldest, newest);
  const first = db.prepare('SELECT MIN(date) AS d FROM apple_daily WHERE user_id = ? AND hrv IS NOT NULL').get(userId).d;
  if (!first) return rows;
  const byDate = new Map(apple.map((a) => [a.date, a.hrv]));
  const out = rows.map((r) => {
    if (r.hrv_manual === 1) return { ...r, _hrv_src: 'manual' };
    if (r.date < first) return { ...r, _hrv_src: 'icu' };
    const v = byDate.get(r.date) ?? null;
    const row = { ...r, hrv_icu: r.hrv_rmssd ?? null, hrv_rmssd: v, _hrv_src: 'apple' };
    if (v != null) row._apple = [...(r._apple || []), 'hrv_rmssd'];
    return row;
  });
  const have = new Set(rows.map((r) => r.date));
  const template = rows[0] ? Object.fromEntries(Object.keys(rows[0]).map((k) => [k, null])) : {};
  for (const [date, v] of byDate) {
    if (have.has(date)) continue;
    out.push({ ...template, user_id: userId, date, hrv_rmssd: v, hrv_manual: 0, respiration_manual: 0, source: 'apple', _hrv_src: 'apple', _apple: ['hrv_rmssd'] });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------- comparison view ----------------

/**
 * Last `days` days side by side: Intervals (raw table) vs Apple, so the parallel
 * run can be judged. Also mean absolute differences and how many days each
 * source alone had.
 */
export function compareSources(db, userId, today = localDate(), days = 14) {
  const from = localDate(new Date(Date.parse(`${today}T12:00:00+07:00`) - (days - 1) * DAY));
  const icu = new Map(db.prepare('SELECT date, hrv_rmssd, resting_hr, sleep_secs, steps, respiration FROM wellness WHERE user_id = ? AND date >= ? AND date <= ?').all(userId, from, today).map((r) => [r.date, r]));
  const ad = new Map(listDaily(db, userId, from, today).map((r) => [r.date, r]));
  const sl = new Map(listNights(db, userId, from, today).map((r) => [r.date, r]));
  const rows = [];
  for (let i = 0; i < days; i++) {
    const date = localDate(new Date(Date.parse(`${today}T12:00:00+07:00`) - i * DAY));
    const I = icu.get(date) || {};
    const A = ad.get(date) || {};
    const S = sl.get(date) || {};
    rows.push({
      date,
      hrv: [I.hrv_rmssd ?? null, A.hrv ?? null],
      rhr: [I.resting_hr ?? null, A.rhr ?? null],
      // Apple night + that day's naps = how Intervals.icu (HUAWEI) counts a day's sleep.
      sleepH: [I.sleep_secs != null ? Math.round(I.sleep_secs / 360) / 10 : null, S.asleep_min != null ? Math.round((S.asleep_min + (S.nap_min || 0)) / 6) / 10 : null],
      napMin: S.nap_min || 0,
      steps: [I.steps ?? null, A.steps ?? null],
      resp: [I.respiration ?? null, A.resp ?? null],
    });
  }
  const stat = (key) => {
    const both = rows.filter((r) => r[key][0] != null && r[key][1] != null);
    return {
      both: both.length,
      onlyIcu: rows.filter((r) => r[key][0] != null && r[key][1] == null).length,
      onlyApple: rows.filter((r) => r[key][0] == null && r[key][1] != null).length,
      meanAbsDiff: both.length ? Math.round(mean(both.map((r) => Math.abs(r[key][0] - r[key][1]))) * 10) / 10 : null,
    };
  };
  return { days: rows, stats: { hrv: stat('hrv'), rhr: stat('rhr'), sleepH: stat('sleepH'), steps: stat('steps'), resp: stat('resp') } };
}

/** Apple workouts with the overlapping Intervals.icu activity's load beside the TRIMP estimate. */
export function workoutsWithIcu(db, userId, from, to) {
  const ws = listWorkouts(db, userId, from, to);
  if (!ws.length) return [];
  const acts = db.prepare('SELECT start_date_local, moving_time, elapsed_time, training_load, type FROM activities WHERE user_id = ? AND substr(start_date_local,1,10) >= ? AND substr(start_date_local,1,10) <= ?').all(userId, from, to);
  const spans = acts.map((a) => {
    const s = parseTime(String(a.start_date_local).slice(0, 19));
    return { s, e: s + (a.elapsed_time || a.moving_time || 0) * 1000, load: a.training_load, type: a.type };
  }).filter((a) => a.s != null);
  return ws.map((w) => {
    const best = spans
      .map((a) => ({ a, overlap: Math.min(a.e, w.end_ms) - Math.max(a.s, w.start_ms) }))
      .filter((x) => x.overlap > 0.5 * (w.end_ms - w.start_ms))
      .sort((x, y) => y.overlap - x.overlap)[0];
    return { ...w, icuLoad: best?.a.load ?? null, icuType: best?.a.type ?? null };
  });
}

/** Last night's extras for the sleep card (heart rate during sleep, SpO2, breathing). */
export function nightExtras(db, userId, date) {
  const r = db.prepare('SELECT sleep_hr, spo2, resp, hrv, rhr FROM apple_daily WHERE user_id = ? AND date = ?').get(userId, date);
  return r || null;
}
