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
      { id: 'pickleball', label: 'Pickleball' },
      { id: 'cardio', label: 'Cardio nhẹ' },
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

/* ------------------------------------------------- binary factors -- */

const bedMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); const mins = h * 60 + m; return mins < 5 * 60 ? mins + 24 * 60 : mins; };
const hasWorkout = (c, id) => Array.isArray(c.workout) && c.workout.includes(id);

/**
 * Yes/no factors the pattern engine compares. `source` says where a day counts
 * as "known": 'context' = only days with a saved context (or legacy journal
 * tags); 'activity' = every day, because Intervals.icu activities are synced.
 */
export const FACTORS = Object.freeze([
  { id: 'leg', label: 'Tập chân', source: 'context', test: (c) => hasWorkout(c, 'leg') },
  { id: 'chest_back', label: 'Tập ngực / lưng', source: 'context', test: (c) => hasWorkout(c, 'chest_back') },
  { id: 'shoulder_arm', label: 'Tập vai / tay', source: 'context', test: (c) => hasWorkout(c, 'shoulder_arm') },
  { id: 'pickleball', label: 'Pickleball', source: 'context', test: (c) => hasWorkout(c, 'pickleball') },
  { id: 'cardio', label: 'Cardio nhẹ', source: 'context', test: (c) => hasWorkout(c, 'cardio') },
  { id: 'heavy_load', label: 'Tạ > 70% (thêm)', source: 'context', test: (c) => c.load === 'gt70' },
  { id: 'sauna_day', label: 'Xông hơi ban ngày', source: 'context', test: (c) => c.sauna === 'day' },
  { id: 'sauna_evening', label: 'Xông hơi buổi tối', source: 'context', test: (c) => c.sauna === 'evening' },
  { id: 'coffee_3plus', label: 'Cà phê ≥ 3 ly', source: 'context', test: (c) => (c.coffee_cups || 0) >= 3 },
  { id: 'coffee_late', label: 'Cà phê sau 14h', source: 'context', test: (c) => c.coffee_late === true },
  { id: 'alcohol', label: 'Rượu bia', source: 'context', test: (c) => (c.alcohol || 0) >= 1 },
  { id: 'late_meal', label: 'Ăn tối muộn', source: 'context', test: (c) => c.late_meal === true },
  { id: 'late_bed', label: 'Ngủ sau 23h30', source: 'context', test: (c) => c.bedtime != null && bedMinutes(c.bedtime) >= 23 * 60 + 30 },
  { id: 'stress_high', label: 'Làm việc căng thẳng', source: 'context', test: (c) => c.work_stress === 2 },
  { id: 'late_workout', label: 'Tập sau 19h', source: 'activity', test: (c) => c._late_workout === true },
]);

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
export function buildDayFacts({ contexts = new Map(), checkins = [], activities = [] }) {
  const days = new Map();
  const get = (d) => { if (!days.has(d)) days.set(d, { _logged: false }); return days.get(d); };
  for (const [date, c] of contexts) Object.assign(get(date), c, { _logged: true });
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
    const d = get(date);
    d._activities = (d._activities || 0) + 1;
    d._load = (d._load || 0) + (a.training_load || 0);
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
  if (Array.isArray(c.workout)) for (const id of c.workout) out.push(id === 'rest' ? 'Nghỉ tập' : `Tập ${wf.options.find((o) => o.id === id)?.label.toLowerCase()}`);
  if (c.load) out.push(`Tạ ${FIELD.get('load').options.find((o) => o.id === c.load)?.label}`);
  if (c.sauna && c.sauna !== 'none') out.push(c.sauna === 'evening' ? 'Xông hơi tối' : 'Xông hơi');
  if (c.coffee_cups) out.push(`Cà phê ${c.coffee_cups} ly`);
  if (c.coffee_late) out.push('Cà phê sau 14h');
  if (c.alcohol) out.push(`Rượu bia ${c.alcohol} ly`);
  if (c.late_meal) out.push('Ăn tối muộn');
  if (c.bedtime) out.push(`Lên giường ${c.bedtime}`);
  if (c.work_stress != null) out.push(`Căng thẳng: ${FIELD.get('work_stress').labels[c.work_stress]}`);
  if (c._late_workout && !out.some((x) => x.startsWith('Tập'))) out.push('Tập sau 19h');
  return out;
}
