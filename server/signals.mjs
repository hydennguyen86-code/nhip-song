/**
 * Signal models v2 — how each wearable number is turned into evidence.
 *
 * Why this file exists: the first version compared every metric to the
 * person's own 30-day mean with a plain z-score. Three problems showed up on
 * real HUAWEI data:
 *
 *   1. Respiratory rate was scored linearly ("lower = better") even though the
 *      source never delivered a single night of it. Breathing rate during sleep
 *      is very stable night to night; its value is an ONE-SIDED illness flag
 *      (a rise), not a points-per-sigma contributor.
 *   2. Sleep was judged against the person's own average. Someone who sleeps
 *      6h50 every night then looks "normal" forever. Sleep is now judged against
 *      a NEED (≥7.5h floor + part of the 7-night debt + yesterday's training),
 *      like WHOOP's "sleep performance" = obtained / needed.
 *   3. HRV was a 7-day rolling mean of raw rMSSD vs mean/SD. Now: ln(rMSSD),
 *      robust centre (median/MAD), last night ("acute") and the 7-day mean
 *      ("chronic") reported separately, the smallest worthwhile change (SWC =
 *      0.5 × SD of ln) and the 7-day coefficient of variation (Plews,
 *      Buchheit et al.).
 *
 * Every function returns its provenance (sample size, window, state) so the UI
 * can say exactly what is known and what is not.
 */

const PLAUSIBLE = Object.freeze({
  resting_hr: [30, 110],
  hrv_rmssd: [5, 250],
  hrv_sdnn: [5, 300],
  sleep_secs: [3 * 3600, 14 * 3600],
  respiration: [6, 30],
});

/** Sleep shorter than this is treated as a likely sync error for baselines. */
export const SLEEP_SUSPECT_SECS = PLAUSIBLE.sleep_secs[0];
/** Minimum spread in ln(HRV): day-to-day noise of wrist rMSSD is ≥ ~7%. */
export const HRV_LN_SPREAD_FLOOR = 0.07;
/** Last night vs 7-day mean in the HRV signal. */
export const HRV_MIX = Object.freeze({ acute: 0.6, chronic: 0.4 });
/** Sleep performance cut-offs (obtained / need). */
export const SLEEP_PERF = Object.freeze({ good: 0.95, warn: 0.85, strong: 0.7 });

export function plausible(field, v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return false;
  const r = PLAUSIBLE[field];
  return r ? v >= r[0] && v <= r[1] : true;
}

export function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function medianSorted(s) {
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function mean(values) { return values.reduce((a, b) => a + b, 0) / values.length; }
function sd(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1));
}

/** Median + MAD-based spread; falls back to SD when MAD is 0. */
export function robustStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median = medianSorted(sorted);
  const mad = medianSorted(values.map((v) => Math.abs(v - median)).sort((a, b) => a - b));
  const s = sd(values);
  const madSd = 1.4826 * mad;
  return { median, mean: mean(values), sd: s, madSd, spread: madSd > 0 ? madSd : s, count: values.length };
}

/** Plausible values of `field` strictly before `today`, inside the window, sick days excluded. */
export function priorValues(wellness, field, today, { windowDays = 30, sickDates = null } = {}) {
  const start = addDays(today, -windowDays);
  return wellness
    .filter((r) => r.date < today && r.date >= start && !(sickDates && sickDates.has(r.date)) && plausible(field, r[field]))
    .map((r) => r[field]);
}

export function sickDatesFrom(checkins = []) {
  const out = new Set();
  for (const c of checkins) if (c && c.level === 'sick') out.add(String(c.local_date).slice(0, 10));
  return out;
}

function rowOn(wellness, date) { return wellness.find((w) => w.date === date) || null; }

/* ------------------------------------------------------------------ RHR -- */

/** Last night's resting HR vs robust 30-day baseline (median, MAD, floor 1 bpm). */
export function rhrModel(wellness, today, { windowDays = 30, minDays = 7, sickDates = null } = {}) {
  const vals = priorValues(wellness, 'resting_hr', today, { windowDays, sickDates });
  const info = { count: vals.length, minDays, windowDays };
  if (vals.length < minDays) return { ready: false, state: 'insufficient', ...info };
  const st = robustStats(vals);
  const spread = Math.max(st.spread, 1);
  const row = rowOn(wellness, today);
  if (!row || !plausible('resting_hr', row.resting_hr)) return { ready: false, state: 'missing_today', ...info, median: st.median, spread };
  const z = (row.resting_hr - st.median) / spread;
  return { ready: true, state: 'ok', ...info, value: row.resting_hr, median: st.median, spread, z };
}

/* ------------------------------------------------------------------ HRV -- */

/**
 * ln(HRV) model. rMSSD and SDNN are separate series and never blended.
 * Baseline: 60 days before today (≥14 valid days), centre = median of ln,
 * spread = max(MAD-SD of ln, 0.07).
 */
export function hrvModel(wellness, today, { windowDays = 60, minDays = 14, sickDates = null } = {}) {
  const lnOf = (field) => priorValues(wellness, field, today, { windowDays, sickDates }).map(Math.log);
  const lnR = lnOf('hrv_rmssd');
  const lnS = lnOf('hrv_sdnn');
  const useRmssd = lnR.length >= minDays || (lnS.length < minDays && lnR.length >= lnS.length);
  const field = useRmssd ? 'hrv_rmssd' : 'hrv_sdnn';
  const name = useRmssd ? 'rMSSD' : 'SDNN';
  const lnVals = useRmssd ? lnR : lnS;
  const tier = lnVals.length < minDays ? 'không đủ' : lnVals.length < 28 ? 'sơ bộ' : 'ổn định';
  const info = { field, name, daysAvailable: lnVals.length, minDays, windowDays, tier };
  if (lnVals.length < minDays) return { ready: false, state: 'insufficient', ...info };

  const st = robustStats(lnVals);
  const center = st.median;
  const spread = Math.max(st.spread, HRV_LN_SPREAD_FLOOR);
  const byDate = new Map(wellness.map((r) => [r.date, r]));

  const todayRow = byDate.get(today);
  const acute = todayRow && plausible(field, todayRow[field])
    ? { value: todayRow[field], z: (Math.log(todayRow[field]) - center) / spread }
    : null;

  const last7 = [];
  for (let i = 0; i < 7; i++) {
    const r = byDate.get(addDays(today, -i));
    if (r && plausible(field, r[field])) last7.push(r[field]);
  }
  const chronic = last7.length >= 3
    ? (() => { const m = mean(last7.map(Math.log)); return { value: Math.exp(m), count: last7.length, z: (m - center) / spread }; })()
    : null;

  if (!acute && !chronic) return { ready: false, state: 'no_recent', ...info };

  let z;
  let basis;
  if (acute && chronic) {
    z = HRV_MIX.acute * acute.z + HRV_MIX.chronic * chronic.z;
    basis = `Đêm qua ${Math.round(HRV_MIX.acute * 100)}% · TB ${chronic.count} ngày ${Math.round(HRV_MIX.chronic * 100)}%`;
  } else if (acute) {
    z = acute.z;
    basis = 'Đêm qua (chưa đủ 3 ngày cho TB 7 ngày)';
  } else {
    z = chronic.z;
    basis = `TB ${chronic.count} ngày (thiếu đêm qua)`;
  }

  // Smallest worthwhile change around the baseline, in ms.
  const swc = { low: Math.exp(center - 0.5 * spread), high: Math.exp(center + 0.5 * spread) };
  const chronicState = !chronic ? null : chronic.z < -0.5 ? 'below' : chronic.z > 0.5 ? 'above' : 'inside';

  // 7-day CV (raw ms) vs the person's typical 7-day CV inside the baseline window.
  let cv7 = null;
  if (last7.length >= 5) {
    const value = (sd(last7) / mean(last7)) * 100;
    const typicals = [];
    for (let end = 7; end <= windowDays; end++) {
      const win = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(today, -(end - i));
        if (sickDates && sickDates.has(d)) continue;
        const r = byDate.get(d);
        if (r && plausible(field, r[field])) win.push(r[field]);
      }
      if (win.length >= 5) typicals.push((sd(win) / mean(win)) * 100);
    }
    const typical = typicals.length >= 3 ? medianSorted(typicals.sort((a, b) => a - b)) : null;
    cv7 = { value, typical, high: typical != null && value >= typical * 1.5 && value - typical >= 3 };
  }

  return {
    ready: true, state: 'ok', ...info,
    baselineMs: Math.exp(center), center, spread,
    acute, chronic, z, basis, swc, chronicState, cv7,
  };
}

/* ---------------------------------------------------------------- Sleep -- */

/**
 * Sleep need for the night that ENDED on `today` (i.e. what the planner would
 * have asked for the evening before). Base = own 30-night mean clamped to
 * 7.5–8.5h (8h when < 7 nights), + 20% of the 7-night debt (max 60 min),
 * + up to 45 min when yesterday's training minutes were above the 28-day
 * daily average.
 */
export function sleepNeed(wellness, activities = [], today) {
  const nights = priorValues(wellness, 'sleep_secs', today, { windowDays: 30 }).map((s) => s / 60);
  const personalMean = nights.length >= 7 ? mean(nights) : 480;
  const base = clamp(personalMean, 450, 510);

  let debt = 0;
  let debtNights = 0;
  for (let i = 1; i <= 7; i++) {
    const r = rowOn(wellness, addDays(today, -i));
    if (r && plausible('sleep_secs', r.sleep_secs)) {
      debtNights++;
      debt += Math.max(0, base - r.sleep_secs / 60);
    }
  }
  debt = Math.min(debt, 600);
  const repay = Math.min(debt * 0.2, 60);

  const day = (a) => String(a.start_date_local).slice(0, 10);
  const yesterday = addDays(today, -1);
  const yMinutes = activities.filter((a) => day(a) === yesterday).reduce((acc, a) => acc + (a.moving_time || 0), 0) / 60;
  const from = addDays(yesterday, -28);
  const avgDaily = activities.filter((a) => day(a) >= from && day(a) < yesterday).reduce((acc, a) => acc + (a.moving_time || 0), 0) / 60 / 28;
  const ratio = avgDaily > 0 ? yMinutes / avgDaily : (yMinutes > 0 ? 2 : 0);
  const strainBump = clamp((ratio - 1) * 25, 0, 45);

  return {
    needMin: Math.round(base + repay + strainBump),
    baseMin: Math.round(base),
    personalMeanMin: Math.round(personalMean),
    nights: nights.length,
    debtMin: Math.round(debt),
    debtNights,
    repayMin: Math.round(repay),
    strainBumpMin: Math.round(strainBump),
  };
}

/** Obtained / need for last night, with a 0–100 sub-score (85% → 50). */
export function sleepPerformance(wellness, activities = [], today) {
  const row = rowOn(wellness, today);
  const need = sleepNeed(wellness, activities, today);
  if (!row || !(typeof row.sleep_secs === 'number' && row.sleep_secs > 0)) return { ready: false, state: 'missing_today', ...need };
  const actualMin = row.sleep_secs / 60;
  const pct = actualMin / need.needMin;
  const subscore = clamp(50 + (pct - SLEEP_PERF.warn) * 220, 2, 99);
  return {
    ready: true,
    state: pct >= SLEEP_PERF.good ? 'good' : pct >= SLEEP_PERF.warn ? 'ok' : pct >= SLEEP_PERF.strong ? 'short' : 'very_short',
    ...need,
    actualMin,
    pct,
    subscore,
    suspect: row.sleep_secs < SLEEP_SUSPECT_SECS,
  };
}

/* ---------------------------------------------------------- Respiration -- */

/**
 * One-sided illness flag. Never contributes points. A LOWER breathing rate
 * is never read as "better recovery".
 * elevated: rise ≥ max(1.0 /min, 2 × robust spread) above the 30-night median.
 */
export function respiratorySignal(wellness, today, { windowDays = 30, minNights = 7, sickDates = null } = {}) {
  const ever = wellness.some((r) => plausible('respiration', r.respiration));
  if (!ever) return { state: 'not_provided', count: 0 };
  const vals = priorValues(wellness, 'respiration', today, { windowDays, sickDates });
  if (vals.length < minNights) return { state: 'insufficient', count: vals.length, minNights };
  const st = robustStats(vals);
  const spread = Math.max(st.spread, 0.3);
  const row = rowOn(wellness, today);
  if (!row || !plausible('respiration', row.respiration)) return { state: 'missing_today', count: vals.length, median: st.median };
  const delta = row.respiration - st.median;
  const threshold = Math.max(1.0, 2 * spread);
  return {
    state: delta >= threshold ? 'elevated' : 'normal',
    strong: delta >= 2 * threshold,
    value: row.respiration,
    median: st.median,
    delta,
    z: delta / spread,
    threshold,
    count: vals.length,
  };
}
