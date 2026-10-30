import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hrvModel, rhrModel, sleepNeed, sleepPerformance, respiratorySignal, robustStats, plausible,
  sickDatesFrom, HRV_LN_SPREAD_FLOOR,
} from '../server/signals.mjs';
import { computeRecovery } from '../server/recovery.mjs';
import { buildAdvice } from '../server/advice.mjs';
import { computeBaselines } from '../server/baseline.mjs';

const TODAY = '2026-10-27';
function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** n prior days with realistic spread (HRV CV ~12%), plus today. */
function series({ n = 40, hrv = 67, rhr = 52, sleepMin = 450, resp = null, today = {} } = {}) {
  const wiggle = [0, 0.12, -0.1, 0.05, -0.15, 0.08, -0.03];
  const out = [];
  for (let i = n; i >= 1; i--) {
    const k = wiggle[i % wiggle.length];
    out.push({
      date: addDays(TODAY, -i),
      hrv_rmssd: hrv * (1 + k),
      resting_hr: rhr + Math.round(k * 20),
      sleep_secs: (sleepMin + k * 60) * 60,
      respiration: resp == null ? null : resp + k,
    });
  }
  out.push({ date: TODAY, hrv_rmssd: hrv, resting_hr: rhr, sleep_secs: sleepMin * 60, respiration: resp, ...today });
  return out;
}

describe('respiration is a one-sided flag', () => {
  test('a source that never sends respiration is "not provided", not "missing"', () => {
    const r = computeRecovery({ wellness: series(), today: TODAY });
    const f = r.factors.find((x) => x.key === 'resp');
    assert.equal(f.respState, 'not_provided');
    assert.equal(f.subscore, null);
    assert.equal(r.total, 3);
    assert.equal(r.used, 3);
  });
  test('a lower breathing rate never earns points; the score is identical', () => {
    const base = computeRecovery({ wellness: series({ resp: 15 }), today: TODAY });
    const low = computeRecovery({ wellness: series({ resp: 15, today: { respiration: 12 } }), today: TODAY });
    assert.equal(low.score, base.score);
    assert.equal(respiratorySignal(series({ resp: 15, today: { respiration: 12 } }), TODAY).state, 'normal');
  });
  test('a rise alone flags but does not change the score', () => {
    const w = series({ resp: 15, today: { respiration: 17.5 } });
    assert.equal(respiratorySignal(w, TODAY).state, 'elevated');
    const base = computeRecovery({ wellness: series({ resp: 15 }), today: TODAY });
    const r = computeRecovery({ wellness: w, today: TODAY });
    assert.equal(r.score, base.score);
    assert.equal(r.illness, null);
    assert.equal(r.factors.find((x) => x.key === 'resp').status, 'bad');
  });
  test('rise + elevated resting HR = illness pattern: index capped at 50, advice = recover', () => {
    const w = series({ resp: 15, sleepMin: 480, today: { respiration: 17.5, resting_hr: 58, hrv_rmssd: 75 } });
    const r = computeRecovery({ wellness: w, today: TODAY });
    assert.ok(r.illness);
    assert.ok(r.score <= 50, `score ${r.score}`);
    assert.match(r.capped, /chống bệnh/);
    const a = buildAdvice({ today: TODAY, wellness: w, activities: [], checkin: null });
    // strong rises on both → REST (more conservative); a milder rise → RECOVER with the illness headline
    assert.equal(a.verdict, 'rest');
    assert.ok(a.flags.resp && a.flags.rhr);
    const mild = series({ resp: 15, sleepMin: 480, today: { respiration: 16.3, resting_hr: 54, hrv_rmssd: 67 } });
    const m = buildAdvice({ today: TODAY, wellness: mild, activities: [], checkin: null, settings: { rhr_z: 0.5 } });
    assert.equal(m.verdict, 'recover', m.headline);
    assert.match(m.headline, /chống bệnh/);
  });
});

describe('sleep is judged against need, not against own average', () => {
  test('chronic 6h50 sleeper is "short" even when last night equals their average', () => {
    const w = series({ sleepMin: 410 });
    const sp = sleepPerformance(w, [], TODAY);
    assert.ok(sp.needMin >= 450, `need ${sp.needMin}`);
    assert.ok(sp.pct < 0.85, `pct ${sp.pct}`);
    const r = computeRecovery({ wellness: w, today: TODAY });
    const f = r.factors.find((x) => x.key === 'sleep');
    assert.equal(f.status, 'bad');
    assert.ok(f.subscore < 50);
    assert.match(f.chip, /%$/);
  });
  test('need = floor 7.5h + 20% of 7-night debt (max 60) + training bump', () => {
    const w = [];
    for (let i = 30; i >= 1; i--) w.push({ date: addDays(TODAY, -i), sleep_secs: (i <= 7 ? 390 : 480) * 60 });
    const n = sleepNeed(w, [], TODAY);
    assert.equal(n.debtNights, 7);
    assert.ok(n.baseMin >= 450 && n.baseMin <= 510);
    assert.equal(n.repayMin, Math.round(Math.min(n.debtMin * 0.2, 60)));
    const acts = [];
    for (const d of [5, 10, 15, 20]) acts.push({ start_date_local: addDays(TODAY, -d) + 'T07:00', moving_time: 1800 });
    acts.push({ start_date_local: addDays(TODAY, -1) + 'T18:00', moving_time: 5400 });
    const heavy = sleepNeed(w, acts, TODAY);
    assert.equal(heavy.strainBumpMin, 45);
    assert.equal(heavy.needMin, n.needMin + 45);
  });
  test('works from night one (no baseline needed), default base 8h', () => {
    const sp = sleepPerformance([{ date: TODAY, sleep_secs: 480 * 60 }], [], TODAY);
    assert.equal(sp.ready, true);
    assert.equal(sp.baseMin, 480);
    assert.ok(Math.abs(sp.pct - 1) < 1e-9);
  });
  test('a 44-minute "night" is kept out of the baseline but flagged when it is today', () => {
    const w = series({ sleepMin: 450 });
    w[w.length - 5].sleep_secs = 2640;
    const b = computeBaselines(w, TODAY);
    assert.ok(b.sleepMinutes.min > 100);
    const today = series({ sleepMin: 450, today: { sleep_secs: 2640 } });
    assert.equal(sleepPerformance(today, [], TODAY).suspect, true);
  });
});

describe('HRV ln model', () => {
  test('robust baseline on ln values, SWC brackets the baseline', () => {
    const h = hrvModel(series(), TODAY);
    assert.equal(h.ready, true);
    assert.equal(h.name, 'rMSSD');
    assert.ok(h.swc.low < h.baselineMs && h.baselineMs < h.swc.high);
    assert.ok(h.spread >= HRV_LN_SPREAD_FLOOR);
    assert.equal(h.tier, 'ổn định');
  });
  test('one very low night moves the score now (acute part), not only after a week', () => {
    const normal = computeRecovery({ wellness: series(), today: TODAY });
    const low = computeRecovery({ wellness: series({ today: { hrv_rmssd: 45 } }), today: TODAY });
    const fN = normal.factors.find((x) => x.key === 'hrv');
    const fL = low.factors.find((x) => x.key === 'hrv');
    assert.ok(fL.subscore < fN.subscore - 15, `${fL.subscore} vs ${fN.subscore}`);
    assert.ok(hrvModel(series({ today: { hrv_rmssd: 45 } }), TODAY).acute.z < -2);
  });
  test('missing last night falls back to the 7-day mean and says so', () => {
    const h = hrvModel(series({ today: { hrv_rmssd: null } }), TODAY);
    assert.equal(h.acute, null);
    assert.ok(h.chronic);
    assert.match(h.basis, /thiếu đêm qua/);
  });
  test('7-day CV flags a see-saw week', () => {
    const w = series();
    const saw = [90, 45, 95, 40, 92, 44];
    for (let i = 0; i < saw.length; i++) w[w.length - 2 - i].hrv_rmssd = saw[i];
    const h = hrvModel(w, TODAY);
    assert.equal(h.cv7.high, true, JSON.stringify(h.cv7));
  });
  test('HRV baseline window is 60 days (≥14 needed); preliminary below 28', () => {
    const h = hrvModel(series({ n: 20 }), TODAY);
    assert.equal(h.tier, 'sơ bộ');
    const r = computeRecovery({ wellness: series({ n: 20 }), today: TODAY });
    assert.equal(r.confidence, 'vừa');
  });
  test('sick days are excluded from baselines', () => {
    const w = series();
    const sick = new Set([addDays(TODAY, -3), addDays(TODAY, -4)]);
    for (const d of sick) w.find((r) => r.date === d).resting_hr = 75;
    assert.ok(rhrModel(w, TODAY).count > rhrModel(w, TODAY, { sickDates: sick }).count);
    assert.deepEqual([...sickDatesFrom([{ local_date: '2026-10-01', level: 'sick' }, { local_date: '2026-10-02', level: 'ok' }])], ['2026-10-01']);
  });
});

describe('helpers', () => {
  test('robust stats resist one outlier', () => {
    const st = robustStats([50, 51, 52, 53, 54, 150]);
    assert.ok(st.median < 54);
    assert.ok(st.madSd < st.sd);
  });
  test('plausibility ranges', () => {
    assert.equal(plausible('sleep_secs', 2640), false);
    assert.equal(plausible('resting_hr', 52), true);
    assert.equal(plausible('respiration', 45), false);
  });
  test('a very good HRV night is never counted as a "strong" warning', () => {
    const w = series({ sleepMin: 480, today: { hrv_rmssd: 140 } });
    const a = buildAdvice({ today: TODAY, wellness: w, activities: [], checkin: null });
    assert.equal(a.verdict, 'plan', a.headline);
  });
});
