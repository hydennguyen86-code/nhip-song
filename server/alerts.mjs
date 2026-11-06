/**
 * Unusual-reading rules. Code decides; the AI never does.
 *
 * 1. HRV far ABOVE baseline is not rewarded. A wrist rMSSD spike can come from
 *    irregular beats or a bad reading, not better recovery. Last night's ln-HRV
 *    z above HRV_HIGH_Z → the HRV part of the index is capped at "no bonus".
 * 2. "Nên hỏi bác sĩ" (no explanation of causes) when a reading stays unusual:
 *      - HRV z > HRV_HIGH_Z on ≥ 2 consecutive nights ending last night, or
 *      - resting HR ≥ max(+5 bpm, +2 spreads) above its 30-day median on
 *        ≥ 3 consecutive days ending today.
 */
import { robustStats, priorValues, plausible, HRV_LN_SPREAD_FLOOR, addDays, BASELINE_NEEDS } from './signals.mjs';

export const ALERT_RULES = Object.freeze({ hrvHighZ: 2.5, hrvHighNights: 2, rhrHighBpm: 5, rhrHighZ: 2, rhrHighDays: 3 });

function hrvZOn(wellness, date, sickDates) {
  const row = wellness.find((w) => w.date === date);
  if (!row || !plausible('hrv_rmssd', row.hrv_rmssd)) return null;
  const { windowDays, minDays } = BASELINE_NEEDS.hrv_rmssd;
  const ln = priorValues(wellness, 'hrv_rmssd', date, { windowDays, sickDates }).map(Math.log);
  if (ln.length < minDays) return null;
  const st = robustStats(ln);
  return (Math.log(row.hrv_rmssd) - st.median) / Math.max(st.spread, HRV_LN_SPREAD_FLOOR);
}

function rhrHighOn(wellness, date, sickDates) {
  const row = wellness.find((w) => w.date === date);
  if (!row || !plausible('resting_hr', row.resting_hr)) return null;
  const { windowDays, minDays } = BASELINE_NEEDS.resting_hr;
  const vals = priorValues(wellness, 'resting_hr', date, { windowDays, sickDates });
  if (vals.length < minDays) return null;
  const st = robustStats(vals);
  const delta = row.resting_hr - st.median;
  return delta >= Math.max(ALERT_RULES.rhrHighBpm, ALERT_RULES.rhrHighZ * Math.max(st.spread, 1));
}

function streak(today, test) {
  let n = 0;
  for (let i = 0; i < 30; i++) {
    if (test(addDays(today, -i)) === true) n++; else break;
  }
  return n;
}

/** @returns {{ hrvHigh: boolean, hrvHighZ: number|null, hrvHighNights: number, rhrHighDays: number, doctor: null | { text: string, reasons: string[] } }} */
export function unusualReadings(wellness, today, { sickDates = null } = {}) {
  const z = hrvZOn(wellness, today, sickDates);
  const hrvNights = streak(today, (d) => { const v = hrvZOn(wellness, d, sickDates); return v == null ? null : v > ALERT_RULES.hrvHighZ; });
  const rhrDays = streak(today, (d) => rhrHighOn(wellness, d, sickDates));
  const reasons = [];
  if (hrvNights >= ALERT_RULES.hrvHighNights) reasons.push(`HRV cao bất thường so với mức thường ngày ${hrvNights} đêm liền`);
  if (rhrDays >= ALERT_RULES.rhrHighDays) reasons.push(`nhịp tim nghỉ cao hơn mức thường ngày ${rhrDays} ngày liền`);
  return {
    hrvHigh: z != null && z > ALERT_RULES.hrvHighZ,
    hrvHighZ: z,
    hrvHighNights: hrvNights,
    rhrHighDays: rhrDays,
    doctor: reasons.length
      ? { reasons, text: `${reasons.map((r, i) => (i ? r : r[0].toUpperCase() + r.slice(1))).join('; ')}. Nên hỏi bác sĩ.` }
      : null,
  };
}
