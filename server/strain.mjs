/**
 * Strain tập luyện, 0–21, WHOOP-style.
 *
 * WHOOP does not publish its formula. What is public: strain is a 0–21 scale,
 * logarithmic in cardiovascular load (each point is harder to earn the higher
 * you go), and the daily target follows the morning recovery.
 *
 * Here the load is Intervals.icu `icu_training_load` (computed by Intervals.icu
 * from the session's heart-rate stream), summed over the day's sessions of at
 * least 10 minutes:
 *
 *     strain = min(21, 3.73 × ln(1 + load / 1.5))
 *
 * Calibrated so that 70 min of pickleball (load ≈ 36) ≈ 12, load 100 ≈ 15.7,
 * load 300 ≈ 19.8. Unlike WHOOP, heart rate outside recorded sessions is not
 * counted, so a rest day is 0.
 */
import { addDays } from './signals.mjs';

export const STRAIN = Object.freeze({ a: 3.73, c: 1.5, max: 21, minSessionSecs: 600 });

/** Target by recovery band (WHOOP's idea: train to what the body can absorb today). */
export const STRAIN_TARGETS = Object.freeze({
  green: { min: 14, max: 18, label: 'Có thể tập nặng' },
  yellow: { min: 10, max: 14, label: 'Tập vừa' },
  red: { min: 0, max: 10, label: 'Ưu tiên hồi phục' },
});

/** 0–21, one decimal. */
export function strainOf(load) {
  const l = Number(load);
  if (!Number.isFinite(l) || l <= 0) return 0;
  return Math.round(Math.min(STRAIN.max, STRAIN.a * Math.log(1 + l / STRAIN.c)) * 10) / 10;
}

const dayOf = (a) => String(a.start_date_local || '').slice(0, 10);
const secsOf = (a) => a.moving_time ?? a.elapsed_time ?? null;

/** date → { load, sessions, minutes } for sessions ≥ 10 minutes (shorter ones are stray watch taps). */
export function dailyLoads(activities = []) {
  const out = new Map();
  for (const a of activities) {
    const d = dayOf(a);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const secs = secsOf(a);
    if (secs != null && secs < STRAIN.minSessionSecs) continue;
    const cur = out.get(d) || { load: 0, sessions: 0, minutes: 0 };
    cur.load += Number(a.training_load) > 0 ? Number(a.training_load) : 0;
    cur.sessions += 1;
    cur.minutes += secs != null ? secs / 60 : 0;
    out.set(d, cur);
  }
  return out;
}

/** Strain of one local date. */
export function strainOn(activities, date, loads = dailyLoads(activities)) {
  const l = loads.get(date) || { load: 0, sessions: 0, minutes: 0 };
  return { date, strain: strainOf(l.load), load: Math.round(l.load), sessions: l.sessions, minutes: Math.round(l.minutes) };
}

/**
 * Extra sleep need from yesterday's strain: nothing up to 10, then 5 minutes
 * per point, at most 45 (strain 19).
 */
export function strainSleepBump(strain) {
  return Math.round(Math.min(45, Math.max(0, (Number(strain) - 10) * 5)));
}

/** Dashboard block. `band` is the recovery band of today. */
export function buildStrain({ activities = [], today, band }) {
  const loads = dailyLoads(activities);
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    last7.push({ date: d, strain: strainOf(loads.get(d)?.load || 0) });
  }
  const t = STRAIN_TARGETS[band] || null;
  return {
    today: strainOn(activities, today, loads),
    yesterday: strainOn(activities, addDays(today, -1), loads),
    last7,
    target: t ? { ...t } : null,
    note: 'Strain tập luyện = thang 0–21 tính từ load các buổi tập trên Intervals.icu. Không tính vận động ngoài buổi tập như WHOOP.',
  };
}
