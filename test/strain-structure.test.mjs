/**
 * Strain 0–21 and sleep structure (consistency, next-night HRV analysis).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { strainOf, dailyLoads, buildStrain, strainSleepBump, STRAIN_TARGETS } from '../server/strain.mjs';
import { sleepConsistency, analyzeSleepStructure, restorative } from '../server/sleep-structure.mjs';
import { addDays } from '../server/signals.mjs';

const TODAY = '2026-11-08';

describe('strain 0–21', () => {
  test('log scale calibration points', () => {
    assert.equal(strainOf(0), 0);
    assert.equal(strainOf(-5), 0);
    assert.equal(strainOf(10), 7.6);
    assert.equal(strainOf(36), 12);
    assert.equal(strainOf(100), 15.7);
    assert.equal(strainOf(300), 19.8);
    assert.equal(strainOf(5000), 21, 'capped at 21');
    assert.ok(strainOf(200) - strainOf(100) < strainOf(100) - strainOf(0), 'each point is harder to earn');
  });

  test('daily load ignores sessions under 10 minutes and sums the rest', () => {
    const loads = dailyLoads([
      { start_date_local: `${TODAY}T07:00:00`, moving_time: 95, training_load: 3 },
      { start_date_local: `${TODAY}T07:05:00`, moving_time: 3600, training_load: 20 },
      { start_date_local: `${TODAY}T18:00:00`, moving_time: 4200, training_load: 36 },
    ]);
    assert.deepEqual(loads.get(TODAY), { load: 56, sessions: 2, minutes: 130 });
  });

  test('dashboard block: today, yesterday, 7 days with rest days at 0, target by band', () => {
    const acts = [
      { start_date_local: `${TODAY}T18:00:00`, moving_time: 4200, training_load: 36 },
      { start_date_local: `${addDays(TODAY, -1)}T18:00:00`, moving_time: 3600, training_load: 100 },
    ];
    const s = buildStrain({ activities: acts, today: TODAY, band: 'green' });
    assert.equal(s.today.strain, 12);
    assert.equal(s.yesterday.strain, 15.7);
    assert.equal(s.last7.length, 7);
    assert.equal(s.last7[6].date, TODAY);
    assert.equal(s.last7[0].strain, 0);
    assert.deepEqual(s.target, { ...STRAIN_TARGETS.green });
    assert.equal(buildStrain({ activities: acts, today: TODAY, band: 'unknown' }).target, null);
    assert.equal(buildStrain({ activities: acts, today: TODAY, band: 'red' }).target.max, 10);
  });

  test('sleep bump: 0 up to strain 10, 5 min per point, max 45', () => {
    assert.equal(strainSleepBump(8), 0);
    assert.equal(strainSleepBump(10), 0);
    assert.equal(strainSleepBump(12), 10);
    assert.equal(strainSleepBump(19), 45);
    assert.equal(strainSleepBump(21), 45);
  });
});

describe('sleep structure', () => {
  const night = (date, bed, wake, extra = {}) => ({ date, bed_start: bed, bed_end: wake, asleep_min: 420, deep_min: 80, core_min: 240, rem_min: 100, awake_min: 15, ...extra });

  test('restorative = deep + REM', () => {
    assert.deepEqual(restorative(night(TODAY, '23:00', '06:30')), { restorativeMin: 180, restorativePct: 180 / 420 });
  });

  test('consistency: same times → 100; bedtime after midnight wraps; needs 4 nights', () => {
    const same = [0, 1, 2, 3, 4].map((i) => night(addDays(TODAY, -i), '23:00', '06:30'));
    assert.equal(sleepConsistency(same, TODAY).score, 100);
    const wrap = [night(TODAY, '23:50', '06:30'), night(addDays(TODAY, -1), '00:10', '06:30'), night(addDays(TODAY, -2), '23:50', '06:30'), night(addDays(TODAY, -3), '00:10', '06:30')];
    const c = sleepConsistency(wrap, TODAY);
    assert.ok(c.bedSdMin < 15, 'about ±10 min, not ±23 h');
    assert.ok(c.score > 85);
    assert.deepEqual(sleepConsistency(same.slice(0, 3), TODAY), { score: null, nights: 3, need: 4 });
    const messy = [night(TODAY, '22:00', '05:30'), night(addDays(TODAY, -1), '01:00', '08:30'), night(addDays(TODAY, -2), '22:30', '06:00'), night(addDays(TODAY, -3), '00:30', '08:00')];
    assert.ok(sleepConsistency(messy, TODAY).score < 10);
  });

  test('analysis compares the NEXT night’s HRV; detects a real effect, needs 21 nights', () => {
    // 40 nights; every 4th night has little deep sleep, and the HRV of the next
    // morning is ~15% lower. Same-night HRV is unaffected.
    const nights = [];
    const wellness = [];
    for (let i = 80; i >= 0; i--) {
      const d = addDays(TODAY, -i);
      const low = i % 4 === 0 && i <= 40;
      if (i <= 40) nights.push(night(d, '23:00', '06:30', low ? { deep_min: 30 } : {}));
      const prevLow = (i + 1) % 4 === 0 && i + 1 <= 40;
      const wobble = 1 + 0.03 * Math.sin(i * 1.7);
      wellness.push({ date: d, hrv_rmssd: 60 * wobble * (prevLow ? 0.85 : 1), _hrv_src: 'apple' });
    }
    const r = analyzeSleepStructure({ nights, wellness });
    assert.equal(r.ready, true);
    const deep = r.items.find((x) => x.id === 'low_deep');
    assert.ok(deep.events >= 8);
    assert.ok(deep.pct < -10 && deep.pct > -20, `pct ${deep.pct}`);
    assert.ok(['clear', 'possible'].includes(deep.confidence));
    assert.match(deep.summary, /HRV đêm kế tiếp thấp hơn/);

    const few = analyzeSleepStructure({ nights: nights.slice(-10), wellness });
    assert.equal(few.ready, false);
    assert.ok(few.items.every((x) => x.confidence === 'insufficient' && x.pct == null));
  });
});

describe('naps', () => {
  test('a nap the afternoon before credits tonight’s need; Intervals nights (naps inside) get no credit', async () => {
    const { sleepNeed } = await import('../server/signals.mjs');
    const w = [];
    for (let i = 30; i >= 0; i--) w.push({ date: addDays(TODAY, -i), sleep_secs: 450 * 60, _sleep_src: 'apple', _nap_min: 0 });
    const base = sleepNeed(w, [], TODAY);
    w.find((r) => r.date === addDays(TODAY, -1))._nap_min = 34;
    const napped = sleepNeed(w, [], TODAY);
    assert.equal(napped.napCreditMin, 34);
    assert.equal(napped.needMin, base.needMin - 34);
    const icu = w.map((r) => ({ ...r, _sleep_src: undefined }));
    assert.equal(sleepNeed(icu, [], TODAY).napCreditMin, 0);
  });
});
