import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRecovery, recoveryHistory, buildSleepPlan, buildLoadTarget,
  RECOVERY_WEIGHTS, BANDS,
} from '../server/recovery.mjs';
import { buildJournalInsights, normalizeTags } from '../server/journal.mjs';

const TODAY = '2026-10-27';

function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 30 baseline days plus the assessed day. Small variation keeps sd > 0. */
function rows({
  today = TODAY, n = 30, rhr = 50, hrv = 80, sleep = 450 * 60, resp = 14,
  todayRhr = rhr, todayHrv = hrv, todaySleep = sleep, todayResp = resp, rmssd = true,
} = {}) {
  const out = [];
  for (let i = n; i >= 1; i--) {
    const j = i % 4;
    out.push({
      date: addDays(today, -i),
      resting_hr: rhr + j * 0.5,
      hrv_rmssd: rmssd ? hrv + j : null,
      hrv_sdnn: rmssd ? null : hrv + j,
      sleep_secs: sleep + j * 300,
      respiration: resp + j * 0.1,
    });
  }
  out.push({
    date: today,
    resting_hr: todayRhr,
    hrv_rmssd: rmssd ? todayHrv : null,
    hrv_sdnn: rmssd ? null : todayHrv,
    sleep_secs: todaySleep,
    respiration: todayResp,
  });
  return out;
}

describe('recovery index', () => {
  test('explains missing current values separately from insufficient baseline', () => {
    const r = computeRecovery({ wellness: rows({ todayRhr: null, todaySleep: null, todayResp: null }), today: TODAY });
    for (const key of ['rhr', 'sleep']) {
      assert.match(r.factors.find((f) => f.key === key).text, /chưa có.*2026-10-27/i);
    }
    assert.equal(r.factors.find((f) => f.key === 'resp').respState, 'missing_today');
    const insufficient = computeRecovery({ wellness: rows({ n: 3 }), today: TODAY });
    assert.match(insufficient.factors.find((f) => f.key === 'rhr').text, /hiện có 3/);
  });
  test('weights are explicit and sum to 1', () => {
    const sum = Object.values(RECOVERY_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-12);
    assert.ok(BANDS.green > BANDS.yellow);
  });

  test('elevated resting HR pulls the score down (direction is inverted)', () => {
    const low = computeRecovery({ wellness: rows({ todayRhr: 50 }), today: TODAY, checkin: null });
    const high = computeRecovery({ wellness: rows({ todayRhr: 62 }), today: TODAY, checkin: null });
    assert.ok(high.score < low.score - 10, `${high.score} vs ${low.score}`);
    const f = high.factors.find((x) => x.key === 'rhr');
    assert.ok(f.subscore < 50, `subscore=${f.subscore}`);
    assert.equal(f.status, 'bad');
  });

  test('all three scored factors are used, contributions add up to score − 50', () => {
    const r = computeRecovery({ wellness: rows({ todayHrv: 86, todaySleep: 480 * 60 }), today: TODAY, checkin: null });
    assert.equal(r.used, 3);
    assert.equal(r.total, 3);
    assert.equal(r.factors.find((f) => f.key === 'resp').subscore, null);
    assert.equal(r.confidence, 'cao');
    const sum = r.factors.reduce((a, f) => a + (f.contribution || 0), 0);
    assert.ok(Math.abs(sum - (r.score - 50)) <= 2, `contrib ${sum} vs ${r.score - 50}`);
    assert.equal(r.band, 'green');
  });

  test('missing factors renormalise weights and lower confidence', () => {
    const w = rows({ n: 20 });
    for (const row of w) {
      delete row.resting_hr;
      delete row.sleep_secs;
      delete row.respiration;
    }
    const r = computeRecovery({ wellness: w, today: TODAY, checkin: null });
    assert.equal(r.used, 1);
    assert.equal(r.confidence, 'thấp');
    assert.equal(r.factors.filter((f) => f.subscore == null).length, 3);
    assert.equal(r.factors.find((f) => f.key === 'hrv').key, 'hrv');
    assert.ok(r.score > 0 && r.score <= 100);
  });

  test('no data at all returns unknown, not a fake score', () => {
    const r = computeRecovery({ wellness: [], today: TODAY, checkin: null });
    assert.equal(r.score, null);
    assert.equal(r.band, 'unknown');
    assert.equal(r.used, 0);
    assert.equal(r.factors.length, 4);
  });

  test('sick and tired check-ins cap the index', () => {
    const wellness = rows({ todayHrv: 90, todayRhr: 46, todaySleep: 510 * 60, todayResp: 13 });
    const base = computeRecovery({ wellness, today: TODAY, checkin: null });
    assert.ok(base.score > 67, `base=${base.score}`);
    const tired = computeRecovery({ wellness, today: TODAY, checkin: { level: 'tired' } });
    assert.equal(tired.rawScore, base.score);
    assert.equal(tired.score, 50);
    assert.equal(tired.band, 'yellow');
    assert.match(tired.capped, /mệt/);
    const sick = computeRecovery({ wellness, today: TODAY, checkin: { level: 'sick' } });
    assert.equal(sick.score, 30);
    assert.equal(sick.band, 'red');
  });

  test('a low score is not relabelled as capped when the cap changes nothing', () => {
    const r = computeRecovery({ wellness: rows({ todayRhr: 62, todayHrv: 65 }), today: TODAY, checkin: { level: 'tired' } });
    assert.ok(r.score < 50);
    assert.equal(r.capped, null);
  });

  test('factors switched off in settings are shown as disabled, not as missing data', () => {
    const settings = { hrv_on: 0, rhr_on: 0, sleep_on: 0 };
    const r = computeRecovery({ wellness: rows(), today: TODAY, checkin: null, settings });
    assert.equal(r.used, 0);
    assert.equal(r.score, null);
    assert.equal(r.band, 'unknown');
    assert.equal(r.factors.filter((f) => f.disabled).length, 3);
    for (const key of ['hrv', 'rhr', 'sleep']) {
      const f = r.factors.find((x) => x.key === key);
      assert.equal(f.subscore, null);
      assert.equal(f.disabled, true);
      assert.match(f.text, /đã tắt/);
    }
    const resp = r.factors.find((f) => f.key === 'resp');
    assert.ok(resp && resp.flag && resp.subscore == null && !resp.disabled);
    assert.equal(r.total, 0);
    assert.match(r.note, /bổ sung/);
  });

  test('one disabled factor lowers used but still yields a score', () => {
    const r = computeRecovery({ wellness: rows(), today: TODAY, checkin: null, settings: { sleep_on: 0 } });
    assert.equal(r.used, 2);
    assert.equal(r.total, 2);
    assert.equal(r.confidence, 'vừa');
    assert.equal(r.factors.find((f) => f.key === 'sleep').disabled, true);
    assert.ok(r.score != null && r.score > 0);
  });

  test('red flag hides the score entirely', () => {
    for (const checkin of [{ level: 'serious' }, { level: 'ok', red_flag: 1 }]) {
      const r = computeRecovery({ wellness: rows(), today: TODAY, checkin });
      assert.equal(r.score, null);
      assert.equal(r.rawScore, null);
      assert.equal(r.band, 'emergency');
      assert.match(r.action, /115/);
    }
  });

  test('rMSSD and SDNN are used separately, rMSSD wins when both are ready', () => {
    const sdnn = computeRecovery({ wellness: rows({ n: 20, rmssd: false }), today: TODAY, checkin: null });
    assert.equal(sdnn.factors.find((f) => f.key === 'hrv').label, 'HRV SDNN');
    const both = rows({ n: 20 });
    for (const row of both) row.hrv_sdnn = 40 + (row.date.charCodeAt(9) % 4);
    const r = computeRecovery({ wellness: both, today: TODAY, checkin: null });
    assert.equal(r.factors.find((f) => f.key === 'hrv').label, 'HRV rMSSD');
  });

  test('history length and last point match a direct computation', () => {
    const wellness = rows({ n: 40, todayHrv: 85 });
    const h = recoveryHistory({ wellness, today: TODAY, days: 7 });
    assert.equal(h.length, 7);
    assert.equal(h[6].date, TODAY);
    const direct = computeRecovery({ wellness, today: TODAY, checkin: null });
    assert.equal(h[6].score, direct.score);
    assert.ok(h.every((x) => x.score == null || (x.score >= 0 && x.score <= 100)));
  });

  test('history applies that day\'s check-in cap', () => {
    const wellness = rows({ n: 40, todayHrv: 85 });
    const h = recoveryHistory({
      wellness,
      today: TODAY,
      days: 7,
      checkins: [{ id: 1, local_date: addDays(TODAY, -2), level: 'sick' }],
    });
    const day = h.find((x) => x.date === addDays(TODAY, -2));
    assert.equal(day.score, 30);
  });
});

describe('sleep planner', () => {
  function sleepRows(minutes = 420, days = 30) {
    const out = [];
    for (let i = days; i >= 0; i--) out.push({ date: addDays(TODAY, -i), sleep_secs: minutes * 60 + (i % 3) * 300 });
    return out;
  }

  test('base is clamped to a sane 7.5–8.5h and tiers are ordered', () => {
    const plan = buildSleepPlan({ wellness: sleepRows(420, 30), activities: [], today: TODAY });
    assert.equal(plan.baseMinutes, 450);
    assert.ok(plan.tiers.getBy >= 420);
    assert.ok(plan.tiers.perform > plan.tiers.getBy);
    assert.ok(plan.tiers.peak > plan.tiers.perform);
    assert.ok(plan.tiers.peak <= 600);
  });

  test('debt counts only the last seven nights and is capped', () => {
    const wellness = sleepRows(390, 30);
    const plan = buildSleepPlan({ wellness, activities: [], today: TODAY });
    assert.equal(plan.debtNights, 7);
    assert.ok(plan.debtMinutes <= 600);
  });

  test('a heavy day yesterday raises the perform/peak targets', () => {
    const activities = [];
    for (const d of [10, 16, 22, 28]) {
      activities.push({ start_date_local: addDays(TODAY, -d) + 'T07:00:00', moving_time: 1800, training_load: 40 });
    }
    const light = buildSleepPlan({ wellness: sleepRows(450, 30), activities, today: TODAY });
    const heavy = buildSleepPlan({
      wellness: sleepRows(450, 30),
      activities: [...activities, { start_date_local: addDays(TODAY, -1) + 'T18:00:00', moving_time: 5400 }],
      today: TODAY,
    });
    assert.equal(light.strainBumpMinutes, 0);
    assert.equal(heavy.strainBumpMinutes, 45);
    assert.ok(heavy.tiers.perform >= light.tiers.perform + 40);
    assert.ok(heavy.tiers.peak <= 600);
  });
});

describe('weekly load target', () => {
  const activities = [
    { start_date_local: addDays(TODAY, -1) + 'T07:00:00', training_load: 100, moving_time: 3600 },
    { start_date_local: addDays(TODAY, -2) + 'T07:00:00', training_load: 100, moving_time: 3600 },
    { start_date_local: addDays(TODAY, -3) + 'T07:00:00', training_load: 100, moving_time: 3600 },
    { start_date_local: TODAY + 'T07:00:00', training_load: 999, moving_time: 3600 },
  ];

  test('last 7 days exclude today and compare to the 28-day weekly average', () => {
    const r = buildLoadTarget({ activities, today: TODAY, band: 'green' });
    assert.equal(r.last7Load, 300);
    assert.equal(r.sessions, 3);
    assert.equal(r.minutes, 180);
    assert.equal(r.weeklyAvg28, 75);
    assert.equal(r.pct, 400);
    assert.equal(r.trend, 'high');
    assert.deepEqual(r.target, { min: 90, max: 125, label: 'Tải vừa đến cao' });
  });

  test('target follows the recovery band', () => {
    assert.deepEqual(buildLoadTarget({ activities, today: TODAY, band: 'red' }).target, { min: 0, max: 45, label: 'Ưu tiên hồi phục' });
    assert.equal(buildLoadTarget({ activities, today: TODAY, band: 'unknown' }).target, null);
  });
});

describe('journal insights', () => {
  const history = [];
  for (let i = 2; i <= 7; i++) history.push({ date: `2026-10-0${i}`, score: 40 });
  for (let i = 10; i <= 14; i++) history.push({ date: `2026-10-${i}`, score: 60 });

  test('describes next-day recovery without claiming causality', () => {
    const checkins = [1, 2, 3, 4, 5, 6].map((i) => ({ local_date: `2026-10-0${i}`, tags: ['alcohol'] }));
    const r = buildJournalInsights({ checkins, history });
    const alcohol = r.insights.find((x) => x.id === 'alcohol');
    assert.ok(alcohol);
    assert.equal(alcohol.days, 6);
    assert.equal(alcohol.avgTagged, 40);
    assert.equal(alcohol.avgOther, 60);
    assert.equal(alcohol.delta, -20);
    assert.match(r.note, /Không phải quan hệ nhân quả/);
  });

  test('hides a habit until three tagged days exist', () => {
    const checkins = [1, 2].map((i) => ({ local_date: `2026-10-0${i}`, tags: ['alcohol'] }));
    const r = buildJournalInsights({ checkins, history });
    assert.equal(r.insights.length, 0);
    assert.equal(r.pending.find((p) => p.id === 'alcohol').days, 2);
  });

  test('tags are normalised and unknown tags dropped', () => {
    assert.deepEqual(normalizeTags(['alcohol', 'alcohol', 'bogus', 'stress']), ['alcohol', 'stress']);
    assert.deepEqual(normalizeTags('alcohol'), []);
  });
});
