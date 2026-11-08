/**
 * Daily context ("bối cảnh"): what happened on a day that may change the NEXT
 * mornings' HRV / resting HR / sleep. One row per user per day, JSON payload.
 *
 * The day stored is the day the thing happened (the leg session, the coffee).
 * Its effect is read on wellness rows date+1 … date+3 (the nights after it).
 *
 * `symptom` (tê/run sau tập) is PRIVATE: it is only counted for the person to
 * show a doctor. It is never analysed as a pattern and never sent to the AI.
 */
import { localIso } from './db.mjs';

export const CONTEXT_FIELDS = Object.freeze([
  {
    id: 'workout', label: 'Buổi tập', type: 'multi',
    options: [
      { id: 'leg', label: 'Chân' },
      { id: 'chest_back', label: 'Ngực / Lưng' },
      { id: 'shoulder_arm', label: 'Vai / Tay' },
      { id: 'gym_full', label: 'Gym toàn thân' },
      { id: 'pickleball', label: 'Pickleball' },
      { id: 'run', label: 'Chạy bộ' },
      { id: 'ride', label: 'Đạp xe' },
      { id: 'walk', label: 'Đi bộ' },
      { id: 'yoga', label: 'Yoga' },
      { id: 'hiit', label: 'Lớp HIIT' },
      { id: 'cardio', label: 'Cardio khác' },
      { id: 'rest', label: 'Nghỉ' },
    ],
  },
  {
    id: 'load', label: 'Mức tạ', type: 'choice',
    options: [{ id: 'le50', label: '≤ 50%' }, { id: '50_70', label: '50–70%' }, { id: 'gt70', label: '> 70%' }],
  },
  {
    id: 'sauna', label: 'Xông hơi', type: 'choice',
    options: [{ id: 'none', label: 'Không' }, { id: 'day', label: 'Ban ngày' }, { id: 'evening', label: 'Buổi tối' }],
  },
  { id: 'coffee_cups', label: 'Cà phê (ly)', type: 'count', min: 0, max: 10 },
  { id: 'coffee_late', label: 'Cà phê sau 14h', type: 'bool' },
  { id: 'alcohol', label: 'Rượu bia (ly)', type: 'count', min: 0, max: 20 },
  { id: 'late_meal', label: 'Ăn tối muộn', type: 'bool' },
  { id: 'bedtime', label: 'Giờ lên giường', type: 'time' },
  { id: 'work_stress', label: 'Căng thẳng công việc', type: 'scale', min: 0, max: 2, labels: ['Nhẹ', 'Vừa', 'Căng'] },
  { id: 'symptom', label: 'Có cơn tê / run sau tập', type: 'bool', private: true },
]);

const FIELD = new Map(CONTEXT_FIELDS.map((f) => [f.id, f]));
export const PRIVATE_FIELDS = Object.freeze(CONTEXT_FIELDS.filter((f) => f.private).map((f) => f.id));

/** Validate a partial context object. Unknown keys are rejected so typos never
 * silently become "absent". Empty / null clears a field. */
export function normalizeContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Bối cảnh không hợp lệ.');
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const f = FIELD.get(k);
    if (!f) throw new Error(`Mục "${k}" không hợp lệ.`);
    if (v === null || v === undefined || v === '') continue;
    switch (f.type) {
      case 'multi': {
        if (!Array.isArray(v)) throw new Error(`${f.label}: cần danh sách.`);
        const ids = [...new Set(v.map(String))];
        for (const id of ids) if (!f.options.some((o) => o.id === id)) throw new Error(`${f.label}: "${id}" không hợp lệ.`);
        if (ids.includes('rest') && ids.length > 1) throw new Error('Đã chọn "Nghỉ" thì không chọn buổi tập khác.');
        if (ids.length) out[k] = ids;
        break;
      }
      case 'choice':
        if (!f.options.some((o) => o.id === String(v))) throw new Error(`${f.label}: "${v}" không hợp lệ.`);
        out[k] = String(v);
        break;
      case 'count':
      case 'scale': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < f.min || n > f.max) throw new Error(`${f.label}: cần số nguyên ${f.min}–${f.max}.`);
        out[k] = n;
        break;
      }
      case 'bool':
        if (typeof v !== 'boolean') throw new Error(`${f.label}: cần đúng / sai.`);
        if (v) out[k] = true;
        break;
      case 'time':
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw new Error(`${f.label}: cần dạng HH:MM.`);
        out[k] = String(v);
        break;
      default:
        break;
    }
  }
  return out;
}

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d));

export function saveContext(db, userId, date, data, { today } = {}) {
  if (!isDate(date)) throw new Error('Ngày không hợp lệ.');
  if (today && date > today) throw new Error('Không ghi bối cảnh cho ngày tương lai.');
  const clean = normalizeContext(data);
  if (!Object.keys(clean).length) {
    db.prepare('DELETE FROM daily_context WHERE user_id = ? AND date = ?').run(userId, date);
    return null;
  }
  db.prepare(
    `INSERT INTO daily_context(user_id, date, data, updated_at) VALUES(?,?,?,?)
     ON CONFLICT(user_id, date) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(userId, date, JSON.stringify(clean), localIso());
  return clean;
}

export function getContext(db, userId, date) {
  const row = db.prepare('SELECT data FROM daily_context WHERE user_id = ? AND date = ?').get(userId, date);
  return row ? JSON.parse(row.data) : null;
}

/** Map date → context object, oldest first. */
export function listContexts(db, userId, oldest, newest) {
  const rows = db.prepare('SELECT date, data FROM daily_context WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(userId, oldest, newest);
  return new Map(rows.map((r) => [r.date, JSON.parse(r.data)]));
}

/* ---------------------------------------------------------- factors -- */

const bedMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); const mins = h * 60 + m; return mins < 5 * 60 ? mins + 24 * 60 : mins; };
const hasWorkout = (c, id) => Array.isArray(c.workout) && c.workout.includes(id);
const GYM_PARTS = ['leg', 'chest_back', 'shoulder_arm', 'gym_full'];
/** Watch load of a gym day, shared between the body parts ticked that day. */
const gymShare = (c) => {
  if (!(c._gym_load > 0)) return null;
  const parts = GYM_PARTS.filter((p) => hasWorkout(c, p)).length;
  return parts ? c._gym_load / parts : null;
};
const gymMinShare = (c) => {
  if (!(c._gym_min > 0)) return null;
  const parts = GYM_PARTS.filter((p) => hasWorkout(c, p)).length;
  return parts ? c._gym_min / parts : null;
};

/**
 * A sport the watch records when the person starts it (run, ride, walk, yoga,
 * pickleball): found from Intervals.icu even without a tag, so every day is
 * "known" (no recording and no tag = did not do it). Tagging it covers days
 * without the watch. Load is the dose for hard sports; minutes for gentle ones
 * (walking, yoga), where heart-rate load is near zero and tells little.
 */
const watchSport = (id, label, kind, unit = 'load') => ({
  id, label, source: 'activity',
  test: (c) => hasWorkout(c, id) || c[`_${kind}_min`] > 0,
  dose: unit === 'phút' ? (c) => (c[`_${kind}_min`] > 0 ? c[`_${kind}_min`] : null) : (c) => (c[`_${kind}_load`] > 0 ? c[`_${kind}_load`] : null),
  minutes: (c) => (c[`_${kind}_min`] > 0 ? c[`_${kind}_min`] : null),
  unit,
});

/**
 * Factors the pattern engine compares. `test` says whether the factor happened
 * on a day; `source` says where a day counts as "known": 'context' = only days
 * with a saved context (or legacy journal tags); 'activity' = every day,
 * because Intervals.icu activities are synced; 'bedtime' = days with a saved
 * context or a bedtime measured by the watch (Apple Health).
 *
 * Optional `dose(c)` makes the factor "how much", not just "yes/no": the
 * regression then uses the dose relative to the person's usual dose, so the
 * effect is read at their usual amount and per unit (per drink, per hour…).
 * A day where the factor happened but the dose is unknown (no watch data)
 * counts at the usual dose. `minutes(c)` is only for the summary text.
 */
export const FACTORS = Object.freeze([
  { id: 'leg', label: 'Tập chân', source: 'context', test: (c) => hasWorkout(c, 'leg'), dose: gymShare, minutes: gymMinShare, unit: 'load' },
  { id: 'chest_back', label: 'Tập ngực / lưng', source: 'context', test: (c) => hasWorkout(c, 'chest_back'), dose: gymShare, minutes: gymMinShare, unit: 'load' },
  { id: 'shoulder_arm', label: 'Tập vai / tay', source: 'context', test: (c) => hasWorkout(c, 'shoulder_arm'), dose: gymShare, minutes: gymMinShare, unit: 'load' },
  { id: 'gym_full', label: 'Gym toàn thân', source: 'context', test: (c) => hasWorkout(c, 'gym_full'), dose: gymShare, minutes: gymMinShare, unit: 'load' },
  watchSport('pickleball', 'Pickleball', 'racket'),
  watchSport('run', 'Chạy bộ', 'run'),
  watchSport('ride', 'Đạp xe', 'ride'),
  watchSport('walk', 'Đi bộ', 'walk', 'phút'),
  watchSport('yoga', 'Yoga', 'yoga', 'phút'),
  // HIIT needs the tag: HUAWEI labels many ordinary moments "HIIT" on its own.
  { id: 'hiit', label: 'Lớp HIIT', source: 'context', test: (c) => hasWorkout(c, 'hiit'), dose: (c) => (c._hiit_load > 0 ? c._hiit_load : null), minutes: (c) => (c._hiit_min > 0 ? c._hiit_min : null), unit: 'load' },
  { id: 'cardio', label: 'Cardio khác', source: 'context', test: (c) => hasWorkout(c, 'cardio'), dose: (c) => (c._cardio_load > 0 ? c._cardio_load : null), minutes: (c) => (c._cardio_min > 0 ? c._cardio_min : null), unit: 'load' },
  { id: 'heavy_load', label: 'Tạ > 70% (thêm)', source: 'context', test: (c) => c.load === 'gt70' },
  { id: 'sauna_day', label: 'Xông hơi ban ngày', source: 'context', test: (c) => c.sauna === 'day' },
  { id: 'sauna_evening', label: 'Xông hơi buổi tối', source: 'context', test: (c) => c.sauna === 'evening' },
  { id: 'coffee_3plus', label: 'Cà phê ≥ 3 ly', source: 'context', test: (c) => (c.coffee_cups || 0) >= 3 },
  { id: 'coffee_late', label: 'Cà phê sau 14h', source: 'context', test: (c) => c.coffee_late === true },
  { id: 'alcohol', label: 'Rượu bia', source: 'context', test: (c) => (c.alcohol || 0) >= 1, dose: (c) => Math.min(c.alcohol || 0, 12) || null, unit: 'ly', perUnit: true },
  { id: 'late_meal', label: 'Ăn tối muộn', source: 'context', test: (c) => c.late_meal === true },
  { id: 'late_bed', label: 'Lên giường trễ hơn thường lệ', source: 'bedtime', test: (c) => c._bed_dev_h >= BEDTIME_RULES.minShiftH, dose: (c) => c._bed_dev_h, unit: 'giờ', perUnit: true },
  { id: 'early_bed', label: 'Lên giường sớm hơn thường lệ', source: 'bedtime', test: (c) => c._bed_dev_h <= -BEDTIME_RULES.minShiftH, dose: (c) => -c._bed_dev_h, unit: 'giờ', perUnit: true },
  { id: 'stress_high', label: 'Làm việc căng thẳng', source: 'context', test: (c) => c.work_stress === 2 },
  { id: 'late_workout', label: 'Tập sau 19h', source: 'activity', test: (c) => c._late_workout === true },
]);

/**
 * "Usual bedtime" = median of the bedtimes logged in the 28 days before
 * (needs ≥ 7 of them). A night ≥ 30 min later counts as late, ≥ 30 min earlier
 * as early, with the shift in hours as the dose. Until there are 7 logged
 * bedtimes, or when the bedtime is not logged that day, the day counts as a
 * usual night (neither late nor early).
 */
export const BEDTIME_RULES = Object.freeze({ window: 28, min: 7, minShiftH: 0.5, maxShiftH: 4 });

const shiftDate = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const median = (xs) => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

/** Adds `_bed_dev_h` (+ later, − earlier) and `_bed_usual` (minutes) to day facts in place. */
export function addBedtimeDeviation(days, rules = BEDTIME_RULES) {
  const beds = [...days.entries()].filter(([, c]) => c.bedtime != null).map(([d, c]) => [d, bedMinutes(c.bedtime)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (let i = 0; i < beds.length; i++) {
    const [date, mins] = beds[i];
    const from = shiftDate(date, -rules.window);
    const prior = [];
    for (let j = i - 1; j >= 0 && beds[j][0] >= from; j--) prior.push(beds[j][1]);
    if (prior.length < rules.min) continue;
    const usual = median(prior);
    const dev = Math.max(-rules.maxShiftH, Math.min(rules.maxShiftH, (mins - usual) / 60));
    const c = days.get(date);
    c._bed_usual = usual;
    c._bed_dev_h = dev;
  }
  return days;
}

/** Intervals.icu activity types. Huawei has no pickleball mode, so pickleball arrives as Padel. */
export const ACTIVITY_KIND = Object.freeze({
  racket: /padel|pickle|tennis|badminton|squash|racquet/i,
  gym: /weight|strength|crossfit/i,
  yoga: /yoga|pilates/i,
  hiit: /hiit|highintensity|interval/i,
  run: /run$/i,
  ride: /ride$|bike|cycl/i,
  walk: /walk|hike/i,
  cardio: /swim|row|elliptic|stair|cardio|workout/i,
});
const KINDS = Object.keys(ACTIVITY_KIND);
const KIND_LABEL = { racket: 'Pickleball', run: 'Chạy bộ', ride: 'Đạp xe', walk: 'Đi bộ', yoga: 'Yoga' };
const KIND_TAG = { racket: 'pickleball', run: 'run', ride: 'ride', walk: 'walk', yoga: 'yoga' };
/** Recordings shorter than this are ignored (stray starts on the watch). */
export const MIN_ACTIVITY_SECS = 600;

/** Old journal tags (checkins.tags) expressed as context, so existing history counts. */
const LEGACY_TAG = {
  alcohol: { alcohol: 1 },
  late_caffeine: { coffee_late: true },
  stress: { work_stress: 2 },
  late_meal: { late_meal: true },
  late_workout: { _late_workout: true },
};

/**
 * Merge saved contexts, legacy journal tags and activity facts into
 * date → { ...context, _logged: bool }.
 * A checkin dated D with tags describes day D (as the old journal did).
 */
export function buildDayFacts({ contexts = new Map(), checkins = [], activities = [], bedtimes = new Map() }) {
  const days = new Map();
  const get = (d) => { if (!days.has(d)) days.set(d, { _logged: false }); return days.get(d); };
  for (const [date, c] of contexts) Object.assign(get(date), c, { _logged: true });
  // Bedtime measured by the watch (Apple Health) when not typed in: no more hand entry.
  for (const [date, b] of bedtimes) {
    const t = typeof b === 'string' ? b : b?.bedtime;
    if (!t) continue;
    const d = get(date);
    if (d.bedtime == null) { d.bedtime = t; d._bed_auto = true; }
  }
  for (const ck of checkins) {
    const tags = Array.isArray(ck.tags) ? ck.tags : [];
    if (!tags.length) continue;
    const d = get(String(ck.local_date).slice(0, 10));
    for (const t of tags) {
      const m = LEGACY_TAG[t];
      if (!m) continue;
      for (const [k, v] of Object.entries(m)) if (d[k] === undefined) d[k] = v;
    }
    d._logged = true;
  }
  for (const a of activities) {
    const start = String(a.start_date_local || '');
    const date = start.slice(0, 10);
    if (!isDate(date)) continue;
    const secs = a.moving_time ?? a.elapsed_time;
    if (secs != null && secs < MIN_ACTIVITY_SECS) continue;
    const d = get(date);
    const load = a.training_load || 0;
    const mins = secs != null ? secs / 60 : 0;
    d._activities = (d._activities || 0) + 1;
    d._load = (d._load || 0) + load;
    const type = String(a.type || '');
    const kind = KINDS.find((k) => ACTIVITY_KIND[k].test(type)) || null;
    if (kind) {
      d[`_${kind}_load`] = (d[`_${kind}_load`] || 0) + load;
      d[`_${kind}_min`] = (d[`_${kind}_min`] || 0) + mins;
    }
    const hour = Number(start.slice(11, 13));
    if (Number.isFinite(hour) && hour >= 19) d._late_workout = true;
  }
  return days;
}

/** Short Vietnamese labels for one day's context (for UI lists and the AI packet). Never includes private fields. */
export function contextLabels(c) {
  if (!c) return [];
  const out = [];
  const wf = FIELD.get('workout');
  if (Array.isArray(c.workout)) for (const id of c.workout) {
    const label = wf.options.find((o) => o.id === id)?.label;
    out.push(id === 'rest' ? 'Nghỉ tập' : GYM_PARTS.includes(id) && id !== 'gym_full' ? `Tập ${label.toLowerCase()}` : label);
  }
  if (c.load) out.push(`Tạ ${FIELD.get('load').options.find((o) => o.id === c.load)?.label}`);
  if (c.sauna && c.sauna !== 'none') out.push(c.sauna === 'evening' ? 'Xông hơi tối' : 'Xông hơi');
  if (c.coffee_cups) out.push(`Cà phê ${c.coffee_cups} ly`);
  if (c.coffee_late) out.push('Cà phê sau 14h');
  if (c.alcohol) out.push(`Rượu bia ${c.alcohol} ly`);
  if (c.late_meal) out.push('Ăn tối muộn');
  if (c.bedtime) out.push(`Lên giường ${c.bedtime}`);
  if (c.work_stress != null) out.push(`Căng thẳng: ${FIELD.get('work_stress').labels[c.work_stress]}`);
  for (const [kind, label] of Object.entries(KIND_LABEL)) {
    if (c[`_${kind}_min`] > 0 && !(Array.isArray(c.workout) && c.workout.includes(KIND_TAG[kind]))) out.push(`${label} ${Math.round(c[`_${kind}_min`])} phút (đồng hồ)`);
  }
  if (c._late_workout && !out.some((x) => x.startsWith('Tập'))) out.push('Tập sau 19h');
  return out;
}
