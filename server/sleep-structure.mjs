/**
 * Sleep structure from Apple Health: shown, not scored.
 *
 *  - Restorative sleep = deep + REM (WHOOP's term for the stages linked to
 *    physical and mental recovery).
 *  - Consistency 0–100 = 100 − (SD of bedtime + SD of wake time over the last
 *    7 nights, minutes) ÷ 1.2; needs ≥ 4 nights. Same bed/wake time every
 *    night → 100; ±1 h scatter on both → 0.
 *  - Does it predict HRV? A night with little deep sleep, little REM, or a lot
 *    of time awake is compared with the person's other nights on the HRV of
 *    the NEXT night. Not the same night: the night HRV is measured inside the
 *    deep-sleep blocks of that same sleep, so the two always move together and
 *    say nothing about recovery.
 *
 * Wrist-measured stages differ from polysomnography; only the person's own
 * comparisons over many nights are meaningful.
 */
import { addDays } from './signals.mjs';
import { morningOutcomes, welch, PATTERN_RULES, CONFIDENCE_LABEL } from './patterns.mjs';

export const SLEEP_STRUCTURE_RULES = Object.freeze({
  consistencyNights: 7, consistencyMin: 4, consistencyDivisor: 1.2,
  minAsleepMin: 180, minEvents: 4, readyNights: 21, clearEvents: 8,
  lowShare: 0.03, restlessExtraMin: 10,
});

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1)));
const median = (xs) => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const clock = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Restorative minutes and share of sleep. */
export function restorative(row) {
  if (!row || !(row.asleep_min > 0)) return { restorativeMin: null, restorativePct: null };
  const min = (row.deep_min || 0) + (row.rem_min || 0);
  return { restorativeMin: Math.round(min), restorativePct: min / row.asleep_min };
}

/** `nights` = apple_sleep rows (any order). Uses the newest 7 with times up to `today`. */
export function sleepConsistency(nights, today) {
  const R = SLEEP_STRUCTURE_RULES;
  const use = nights
    .filter((n) => n.date <= today && n.date > addDays(today, -R.consistencyNights) && clock(n.bed_start) != null && clock(n.bed_end) != null && n.asleep_min >= R.minAsleepMin)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, R.consistencyNights);
  if (use.length < R.consistencyMin) return { score: null, nights: use.length, need: R.consistencyMin };
  // Bedtime before 18:00 belongs to the next day's clock (00:30 → 24:30).
  const bed = use.map((n) => { const m = clock(n.bed_start); return m < 18 * 60 ? m + 1440 : m; });
  const wake = use.map((n) => clock(n.bed_end));
  const bedSd = sd(bed);
  const wakeSd = sd(wake);
  const score = Math.round(Math.min(100, Math.max(0, 100 - (bedSd + wakeSd) / R.consistencyDivisor)));
  return { score, nights: use.length, bedSdMin: Math.round(bedSd), wakeSdMin: Math.round(wakeSd) };
}

const ITEMS = [
  { id: 'low_deep', label: 'Đêm ít ngủ sâu', phrase: 'ít ngủ sâu', value: (n) => n.deep_min / n.asleep_min, test: (v, m) => v < m - SLEEP_STRUCTURE_RULES.lowShare },
  { id: 'low_rem', label: 'Đêm ít REM', phrase: 'ít REM', value: (n) => n.rem_min / n.asleep_min, test: (v, m) => v < m - SLEEP_STRUCTURE_RULES.lowShare },
  { id: 'restless', label: 'Đêm thức giấc nhiều', phrase: 'thức giấc nhiều', value: (n) => n.awake_min, test: (v, m) => v > m + SLEEP_STRUCTURE_RULES.restlessExtraMin },
];

function confidence(w, nEvents) {
  const R = SLEEP_STRUCTURE_RULES;
  const swc = PATTERN_RULES.swcZ;
  if (!w || nEvents < R.minEvents) return 'insufficient';
  const big = Math.abs(w.diff) >= swc;
  if (nEvents >= R.clearEvents && (w.lo > 0 || w.hi < 0) && big) return 'clear';
  if (big) return 'possible';
  if (nEvents >= R.clearEvents && w.lo > -swc && w.hi < swc) return 'none';
  return 'unclear';
}

const fmt1 = (x) => (Math.round(Math.abs(x) * 10) / 10).toLocaleString('vi-VN');

/**
 * @param nights   apple_sleep rows
 * @param wellness rows the recovery index reads (effectiveWellness: HRV source-tagged)
 */
export function analyzeSleepStructure({ nights = [], wellness = [], sickDates = null }) {
  const R = SLEEP_STRUCTURE_RULES;
  const outcomes = morningOutcomes(wellness, { sickDates });
  const usable = nights
    .filter((n) => n.asleep_min >= R.minAsleepMin && (n.deep_min + n.core_min + n.rem_min) > 0)
    .map((n) => ({ n, z: outcomes.get(addDays(n.date, 1))?.hrvZ, spread: outcomes.get(addDays(n.date, 1))?.hrvSpread }))
    .filter((x) => typeof x.z === 'number');
  const ready = usable.length >= R.readyNights;
  const spreadTypical = usable.length ? mean(usable.map((x) => x.spread)) : null;
  const items = ITEMS.map((it) => {
    if (!usable.length) return { id: it.id, label: it.label, events: 0, others: 0, pct: null, lo: null, hi: null, confidence: 'insufficient', summary: `${it.label}: chưa có dữ liệu.` };
    const vals = usable.map((x) => it.value(x.n));
    const med = median(vals);
    const ev = [];
    const other = [];
    usable.forEach((x, i) => (it.test(vals[i], med) ? ev : other).push(x.z));
    const w = ev.length >= 2 && other.length >= 2 ? welch(ev, other) : null;
    const conf = ready ? confidence(w, ev.length) : 'insufficient';
    const toPct = (z) => (Math.exp(z * spreadTypical) - 1) * 100;
    const show = conf !== 'insufficient' && w;
    const pct = show ? Math.round(toPct(w.diff) * 10) / 10 : null;
    const summary = !show
      ? `${it.label}: có ${ev.length} đêm, cần ít nhất ${R.minEvents} đêm và tổng ${R.readyNights} đêm có dữ liệu.`
      : `Sau đêm ${it.phrase}, HRV đêm kế tiếp ${pct < 0 ? 'thấp hơn' : 'cao hơn'} khoảng ${fmt1(pct)}% so với các đêm khác (${ev.length} đêm, ${CONFIDENCE_LABEL[conf]}).`;
    return {
      id: it.id, label: it.label, events: ev.length, others: other.length,
      pct, lo: show ? Math.round(toPct(w.lo) * 10) / 10 : null, hi: show ? Math.round(toPct(w.hi) * 10) / 10 : null,
      confidence: conf, summary,
    };
  });
  return {
    ready, nights: usable.length, need: R.readyNights, items,
    note: 'Chỉ đưa cấu trúc giấc ngủ vào điểm khi dữ liệu của bạn cho thấy nó dự báo HRV.',
  };
}
