/**
 * Personal baselines. Each function returns the number plus its provenance
 * (sample size and window) so the UI can honestly say how trustworthy it is.
 *
 * Rules baked in here:
 *   - RHR baseline: mean of the 30 valid days BEFORE the assessed day
 *     (the assessed day itself is never part of its own baseline).
 *   - HRV baseline: only when >= 14 valid days of the SAME metric exist.
 *     rMSSD and SDNN are counted as separate series, never merged.
 *   - Sleep: minutes per night; we report both mean and how many nights
 *     actually have data. Nap vs night is not decided here — that would need
 *     start-time evidence we do not always get.
 *   - Steps: mean over valid completed days; we never treat 10.000 as a rule.
 *
 * Every baseline is descriptive statistics, not a clinical threshold.
 */

import { plausible } from './signals.mjs';

const DAY_MS = 86400000;

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function addLocalDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const sd = values.length > 1
    ? Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1))
    : 0;
  return { mean, median, sd, min: sorted[0], max: sorted[sorted.length - 1], count: values.length };
}

/**
 * @param rows  effective wellness rows (already exclusion-filtered), each with .date
 * @param targetDate  the day being assessed (YYYY-MM-DD) — excluded from baseline
 * @param windowDays  baseline lookback (default 30)
 */
export function computeBaselines(rows, targetDate, { windowDays = 30, hrvMinDays = 14, hrvWindowDays = 60, sickDates = null } = {}) {
  // Implausible values (e.g. a 44-minute "night" from a sync glitch) and days
  // the person reported as sick never enter a baseline.
  const inWindow = (r, days) => r.date < targetDate && r.date >= addLocalDays(targetDate, -days) && !(sickDates && sickDates.has(r.date));
  const before = rows.filter((r) => inWindow(r, windowDays));
  const beforeHrv = rows.filter((r) => inWindow(r, hrvWindowDays));

  const pickFrom = (list, field) => list.map((r) => r[field]).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && plausible(field, v));
  const pick = (field) => pickFrom(before, field);

  const rhrValues = pick('resting_hr');
  const rmssdValues = pickFrom(beforeHrv, 'hrv_rmssd');
  const sdnnValues = pickFrom(beforeHrv, 'hrv_sdnn');
  const sleepValues = pick('sleep_secs').map((s) => s / 60);
  const sleepScoreValues = pick('sleep_score');
  const stepsValues = pick('steps');
  const weightValues = pick('weight');
  const avgSleepHrValues = pick('avg_sleeping_hr');
  const respValues = pick('respiration');

  const rmssdBaseline = rmssdValues.length >= hrvMinDays ? stats(rmssdValues) : null;
  const sdnnBaseline = sdnnValues.length >= hrvMinDays ? stats(sdnnValues) : null;

  /** HRV confidence: 14–27 days is a preliminary reference, 28+ is considered
   * stable in the literature (Plews 2013 et al. use ≥4 weeks of daily measures). */
  const tier = (n, min) => (n < min ? 'không đủ' : n < 28 ? 'sơ bộ' : 'ổn định');

  return {
    targetDate,
    windowDays,
    windowStart: addLocalDays(targetDate, -windowDays),
    windowEnd: addLocalDays(targetDate, -1),
    rhr: { metric: 'resting_hr', unit: 'bpm', ...(stats(rhrValues) || { count: 0 }), needs: 7 },
    hrvRmssd: { metric: 'hrv_rmssd', unit: 'ms', windowDays: hrvWindowDays, daysAvailable: rmssdValues.length, minDays: hrvMinDays, tier: tier(rmssdValues.length, hrvMinDays), baseline: rmssdBaseline },
    hrvSdnn: { metric: 'hrv_sdnn', unit: 'ms', windowDays: hrvWindowDays, daysAvailable: sdnnValues.length, minDays: hrvMinDays, tier: tier(sdnnValues.length, hrvMinDays), baseline: sdnnBaseline },
    sleepMinutes: { metric: 'sleep_secs', unit: 'phút', ...(stats(sleepValues) || { count: 0 }), note: 'Có thể gồm cả ngủ trưa; Intervals.icu chỉ báo tổng sleepSecs.' },
    sleepScore: { metric: 'sleep_score', unit: '/100', ...(stats(sleepScoreValues) || { count: 0 }) },
    steps: { metric: 'steps', unit: 'bước', ...(stats(stepsValues) || { count: 0 }) },
    respiration: { metric: 'respiration', unit: 'lần/phút', ...(stats(respValues) || { count: 0 }), needs: 7 },
    weight: stats(weightValues) ? { unit: 'kg', ...stats(weightValues) } : null,
    avgSleepingHr: stats(avgSleepHrValues) ? { unit: 'bpm', ...stats(avgSleepHrValues) } : null,
  };
}

/**
 * 7-day rolling mean ending on targetDate (inclusive) for the given field.
 * Science: a single morning rMSSD reading is noisy (day-to-day CV ~5–10%);
 * Plews et al. recommend the 7-day rolling average. Missing days are skipped,
 * but we require at least 3 of the last 7 so the average is not a stale value.
 */
export function rollingMean(rows, field, targetDate, { window = 7, minPoints = 3 } = {}) {
  const byDate = new Map(rows.map((r) => [r.date, r[field]]));
  const values = [];
  for (let i = 0; i < window; i++) {
    const d = addLocalDays(targetDate, -i);
    const v = byDate.get(d);
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) values.push(v);
  }
  if (values.length < minPoints) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return { value: sum / values.length, count: values.length };
}

/** Compare today's value to the baseline. Returns z + a human word. */
export function compare(value, baseline, { higherIsBetter = null } = {}) {
  if (typeof value !== 'number' || !baseline || !baseline.mean) return { ready: false };
  const delta = value - baseline.mean;
  // sd can be a float residue (e.g. 2e-16) for a constant series; treat that as 0
  // so a flat baseline yields z=0 instead of a meaningless huge z.
  const z = baseline.sd > 1e-6 ? delta / baseline.sd : 0;
  let word;
  if (Math.abs(z) < 0.5) word = 'trong khoảng nền';
  else if (z > 0) word = higherIsBetter === false ? 'cao hơn nền' : higherIsBetter === true ? 'tốt hơn nền' : 'cao hơn nền';
  else word = higherIsBetter === false ? 'tốt hơn nền' : higherIsBetter === true ? 'thấp hơn nền' : 'thấp hơn nền';
  return { ready: true, value, mean: baseline.mean, delta, z, word };
}

/** Recent training load summary over the last `days` days. */
export function recentLoad(activities, targetDate, days = 7) {
  const start = addLocalDays(targetDate, -days);
  const inRange = activities.filter((a) => {
    const d = String(a.start_date_local).slice(0, 10);
    return d >= start && d < targetDate;
  });
  const totalLoad = inRange.reduce((acc, a) => acc + (a.training_load || 0), 0);
  const totalMinutes = inRange.reduce((acc, a) => acc + (a.moving_time || 0), 0) / 60;
  const intensity = inRange.reduce((acc, a) => acc + (a.intensity || 0), 0) / (inRange.length || 1);
  const byDay = new Map();
  for (const a of inRange) {
    const d = String(a.start_date_local).slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + (a.training_load || 0));
  }
  return {
    days,
    sessions: inRange.length,
    totalLoad,
    totalMinutes,
    avgIntensity: inRange.length ? intensity : null,
    daysActive: byDay.size,
    note: 'Tải tập từ Intervals.icu (icmp training load). Tập sức mạnh, bơi, yoga có thể không phản ánh đủ trong chỉ số này.',
  };
}
