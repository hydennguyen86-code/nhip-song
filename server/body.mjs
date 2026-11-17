/**
 * Body composition from a bioimpedance scale (Fitdays+), weighed once a week
 * under the same conditions (weekend morning, after the toilet, before eating
 * or drinking).
 *
 * Two ways in: typed by the user (including the scale's raw impedance), or
 * pushed from Apple Health by the iPhone Shortcut (weight, body fat %, lean
 * mass). A typed value always wins; Apple only fills what was not typed.
 *
 * The scale measures impedance and derives water, then muscle and fat from
 * equations that assume fixed hydration. One reading therefore swings with a
 * sauna, a meal or a workout by more than real muscle changes in a month. So
 * the app trusts only the average of several standard-condition readings and
 * reports a change only when it is larger than that noise. Code computes every
 * number here; nothing is a diagnosis.
 */
const DAY = 86_400_000;

export const BODY_FIELDS = Object.freeze([
  { col: 'weight', label: 'Cân nặng', unit: 'kg', min: 25, max: 250, digits: 1 },
  { col: 'fat_pct', label: 'Tỷ lệ mỡ', unit: '%', min: 3, max: 60, digits: 1 },
  { col: 'skeletal_kg', label: 'Cơ xương', unit: 'kg', min: 5, max: 80, digits: 1 },
  { col: 'lean_kg', label: 'Khối không mỡ', unit: 'kg', min: 15, max: 150, digits: 1 },
  { col: 'muscle_kg', label: 'Cơ (tổng)', unit: 'kg', min: 10, max: 120, digits: 1 },
  { col: 'water_kg', label: 'Nước', unit: 'kg', min: 10, max: 120, digits: 1 },
  { col: 'protein_kg', label: 'Protein', unit: 'kg', min: 2, max: 40, digits: 1 },
  { col: 'bone_kg', label: 'Xương', unit: 'kg', min: 1, max: 8, digits: 1 },
  { col: 'visceral', label: 'Mỡ nội tạng', unit: 'mức', min: 1, max: 30, digits: 0 },
  { col: 'bmr', label: 'Chuyển hoá cơ bản', unit: 'kcal', min: 600, max: 4000, digits: 0 },
]);
const COLS = BODY_FIELDS.map((f) => f.col);
const FIELD = Object.fromEntries(BODY_FIELDS.map((f) => [f.col, f]));

/** Raw impedance: right arm, left arm, trunk, right leg, left leg, at 20 and 100 kHz. */
export const SEGMENTS = Object.freeze(['ra', 'la', 'tr', 'rl', 'll']);
export const FREQS = Object.freeze(['z20', 'z100']);
const Z_RANGE = [5, 1500];

/**
 * Noise of one home reading, in the field's unit. A change smaller than this
 * between two 4-reading averages is not reported. Hydration alone moves the
 * derived muscle and fat by about this much.
 */
export const BODY_NOISE = Object.freeze({ weight: 1.0, fat_pct: 1.5, skeletal_kg: 0.8, lean_kg: 1.0 });
/** Protein above ~1.6 g/kg/day adds no further muscle gain. */
export const PROTEIN_G_PER_KG = 1.6;

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const ms = (date) => Date.parse(`${date}T12:00:00Z`);
const addDays = (date, n) => new Date(ms(date) + n * DAY).toISOString().slice(0, 10);
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function toNum(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function cleanImpedance(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  let any = false;
  for (const f of FREQS) {
    for (const s of SEGMENTS) {
      const v = toNum(raw?.[f]?.[s]);
      if (v == null) continue;
      if (Number.isNaN(v) || v < Z_RANGE[0] || v > Z_RANGE[1]) throw new Error(`Trở kháng ${f === 'z20' ? '20' : '100'} kHz ngoài khoảng ${Z_RANGE[0]}–${Z_RANGE[1]} Ω.`);
      (out[f] ||= {})[s] = round(v, 1);
      any = true;
    }
  }
  return any ? out : null;
}

function rowOut(r) {
  if (!r) return null;
  const parse = (t, fb) => { try { return t ? JSON.parse(t) : fb; } catch { return fb; } };
  return { ...r, impedance: parse(r.impedance, null), manual_cols: parse(r.manual_cols, []), standard: !!r.standard };
}

export function getBody(db, userId, date) {
  return rowOut(db.prepare('SELECT * FROM body_comp WHERE user_id = ? AND date = ?').get(userId, date));
}

export function listBody(db, userId, from, to) {
  return db.prepare('SELECT * FROM body_comp WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date').all(userId, from, to).map(rowOut);
}

function writeRow(db, userId, row) {
  db.prepare(`INSERT INTO body_comp(user_id,date,${COLS.join(',')},impedance,standard,note,manual_cols,source,updated_at)
      VALUES(?,?,${COLS.map(() => '?').join(',')},?,?,?,?,?,?)
      ON CONFLICT(user_id,date) DO UPDATE SET ${COLS.map((c) => `${c}=excluded.${c}`).join(', ')},
        impedance=excluded.impedance, standard=excluded.standard, note=excluded.note,
        manual_cols=excluded.manual_cols, source=excluded.source, updated_at=excluded.updated_at`)
    .run(userId, row.date, ...COLS.map((c) => row[c] ?? null), row.impedance ? JSON.stringify(row.impedance) : null,
      row.standard === false ? 0 : 1, row.note || null, JSON.stringify(row.manual_cols || []), row.source || null, new Date().toISOString());
}

/**
 * A typed reading. Fields left empty are cleared from the typed set (an Apple
 * value for the same day stays). Throws a Vietnamese message on a bad value.
 */
export function saveManualBody(db, userId, date, data = {}, { today } = {}) {
  if (!isDate(date)) throw new Error('Ngày không hợp lệ.');
  if (today && date > today) throw new Error('Không ghi cho ngày trong tương lai.');
  if (today && date < addDays(today, -730)) throw new Error('Chỉ ghi bù tối đa 2 năm.');
  const typed = {};
  for (const f of BODY_FIELDS) {
    const v = toNum(data[f.col]);
    if (v == null) continue;
    if (Number.isNaN(v) || v < f.min || v > f.max) throw new Error(`${f.label} phải trong khoảng ${f.min}–${f.max} ${f.unit}.`);
    typed[f.col] = round(v, f.digits === 0 ? 0 : 2);
  }
  const impedance = cleanImpedance(data.impedance);
  const prev = getBody(db, userId, date);
  const appleVals = prev ? Object.fromEntries(COLS.filter((c) => !prev.manual_cols.includes(c) && prev[c] != null).map((c) => [c, prev[c]])) : {};
  if (!Object.keys(typed).length && !impedance && !Object.keys(appleVals).length) throw new Error('Chưa có số nào để lưu.');
  const row = {
    date,
    ...appleVals,
    ...typed,
    impedance,
    standard: data.standard !== false,
    note: String(data.note || '').trim().slice(0, 200) || null,
    manual_cols: Object.keys(typed),
    source: Object.keys(appleVals).some((c) => !(c in typed)) ? 'manual+apple' : 'manual',
  };
  writeRow(db, userId, row);
  return getBody(db, userId, date);
}

/** Apple Health values for a day: fill only what the user did not type. */
export function saveAppleBody(db, userId, date, vals) {
  const prev = getBody(db, userId, date);
  const typedCols = prev?.manual_cols || [];
  const row = prev ? { ...prev } : { date, standard: true, manual_cols: [] };
  let changed = false;
  for (const c of ['weight', 'fat_pct', 'lean_kg']) {
    const v = vals[c];
    if (v == null || typedCols.includes(c)) continue;
    const f = FIELD[c];
    if (v < f.min || v > f.max) continue;
    row[c] = round(v, 2);
    changed = true;
  }
  if (!changed) return prev;
  row.source = typedCols.length ? 'manual+apple' : 'apple';
  writeRow(db, userId, row);
  return getBody(db, userId, date);
}

export function deleteBody(db, userId, date) {
  return db.prepare('DELETE FROM body_comp WHERE user_id = ? AND date = ?').run(userId, date).changes > 0;
}

/**
 * Trend over standard-condition readings:
 * - recent = average of the last ≤ 4 readings within 35 days of the newest;
 * - earlier = average of ≤ 4 readings 7–12 weeks before the newest;
 * - change = recent − earlier, flagged only past BODY_NOISE.
 */
export function bodySummary(rows, { today } = {}) {
  const all = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = all[all.length - 1] || null;
  const daysSinceLast = last && today ? Math.round((ms(today) - ms(last.date)) / DAY) : null;
  const usable = all.filter((r) => r.standard);
  const out = {
    count: usable.length,
    total: all.length,
    last: last ? { date: last.date, standard: last.standard } : null,
    daysSinceLast,
    due: daysSinceLast == null || daysSinceLast >= 7,
    recent: null,
    earlier: null,
    change: null,
    flags: [],
    state: usable.length ? 'collecting' : 'empty',
    messages: [],
    protein: null,
    odd: null,
  };
  if (!usable.length) {
    out.messages.push('Chưa có lần đo nào. Mỗi tuần đo một lần vào cuối tuần, buổi sáng sau khi đi vệ sinh và trước khi ăn uống.');
    return out;
  }
  const newest = usable[usable.length - 1].date;
  const avgOf = (list) => Object.fromEntries(COLS.map((c) => {
    const xs = list.map((r) => r[c]).filter((v) => v != null);
    return [c, xs.length ? round(mean(xs), FIELD[c].digits === 0 ? 0 : 2) : null];
  }));
  const recentList = usable.filter((r) => r.date >= addDays(newest, -35)).slice(-4);
  const earlierList = usable.filter((r) => r.date <= addDays(newest, -49) && r.date >= addDays(newest, -84)).slice(-4);
  out.recent = { ...avgOf(recentList), n: recentList.length, from: recentList[0].date, to: newest };

  // A single reading far from the average of the ones before it: likely hydration, not body change.
  const before = usable.filter((r) => r.date < newest && r.date >= addDays(newest, -35)).slice(-4);
  if (before.length >= 2) {
    const ref = avgOf(before);
    const lastRow = usable[usable.length - 1];
    const off = ['weight', 'skeletal_kg', 'fat_pct'].filter((c) => lastRow[c] != null && ref[c] != null && Math.abs(lastRow[c] - ref[c]) > BODY_NOISE[c] * 1.8);
    if (off.length) out.odd = { date: newest, fields: off };
  }

  const w = out.recent.weight;
  if (w != null) out.protein = { gPerDay: Math.round((w * PROTEIN_G_PER_KG) / 5) * 5, perKg: PROTEIN_G_PER_KG, weight: w };

  if (recentList.length >= 3 && earlierList.length >= 2) {
    out.earlier = { ...avgOf(earlierList), n: earlierList.length, from: earlierList[0].date, to: earlierList[earlierList.length - 1].date };
    out.change = {};
    for (const c of ['weight', 'fat_pct', 'skeletal_kg', 'lean_kg']) {
      out.change[c] = out.recent[c] != null && out.earlier[c] != null ? round(out.recent[c] - out.earlier[c], FIELD[c].digits) : null;
    }
    out.weeksApart = Math.round((ms(out.recent.to) - ms(out.earlier.to)) / (7 * DAY));
    const muscleCol = out.change.skeletal_kg != null ? 'skeletal_kg' : out.change.lean_kg != null ? 'lean_kg' : null;
    const past = (c) => out.change[c] != null && Math.abs(out.change[c]) > BODY_NOISE[c];
    if (muscleCol && past(muscleCol)) out.flags.push(out.change[muscleCol] < 0 ? 'muscle_down' : 'muscle_up');
    if (past('fat_pct')) out.flags.push(out.change.fat_pct > 0 ? 'fat_up' : 'fat_down');
    if (past('weight')) out.flags.push(out.change.weight > 0 ? 'weight_up' : 'weight_down');
    out.state = out.flags.length ? 'changed' : 'stable';
    const fmt = (c, v) => `${v > 0 ? '+' : '−'}${String(Math.abs(v)).replace('.', ',')} ${FIELD[c].unit}`;
    const span = `so với khoảng ${out.weeksApart} tuần trước`;
    if (out.flags.includes('muscle_down')) out.messages.push(`${FIELD[muscleCol].label} giảm ${fmt(muscleCol, out.change[muscleCol])} ${span}, lớn hơn mức nhiễu của cân. Xem lại lượng đạm mỗi ngày và việc tập có bị giảm quá nhiều không.`);
    if (out.flags.includes('muscle_up')) out.messages.push(`${FIELD[muscleCol].label} tăng ${fmt(muscleCol, out.change[muscleCol])} ${span}.`);
    if (out.flags.includes('fat_up')) out.messages.push(`Tỷ lệ mỡ tăng ${fmt('fat_pct', out.change.fat_pct)} ${span}.`);
    if (out.flags.includes('fat_down')) out.messages.push(`Tỷ lệ mỡ giảm ${fmt('fat_pct', out.change.fat_pct)} ${span}.`);
    if (out.flags.includes('weight_up') || out.flags.includes('weight_down')) out.messages.push(`Cân nặng ${out.change.weight > 0 ? 'tăng' : 'giảm'} ${fmt('weight', out.change.weight)} ${span}.`);
    if (!out.flags.length) out.messages.push(`Cơ, mỡ và cân nặng ổn định ${span}: mọi thay đổi đều nằm trong mức nhiễu của cân.`);
  } else {
    const weeks = Math.max(0, 8 - Math.round((ms(newest) - ms(usable[0].date)) / (7 * DAY)));
    out.messages.push(`Đang có ${usable.length} lần đo đúng điều kiện. Cần đo đều khoảng 8 tuần${weeks ? ` (còn khoảng ${weeks} tuần)` : ''} mới so được xu hướng; một lần đo lẻ dao động theo lượng nước trong người nhiều hơn mức cơ hay mỡ thay đổi thật trong một tháng.`);
  }
  if (out.odd) out.messages.push(`Lần đo ${out.odd.date.slice(8, 10)}/${out.odd.date.slice(5, 7)} lệch xa các lần trước. Nếu hôm đó đo sau xông hơi, sau tập hay sau khi ăn uống, hãy bỏ chọn "Đo đúng điều kiện" để không tính vào xu hướng.`);
  return out;
}
