/**
 * Apple Health metrics: HRV, heart rate, breathing, SpO2, steps, workouts, and
 * how they merge into the rows the recovery index reads.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.mjs';
import { createUser, upsertWellness, upsertActivity, effectiveWellness, saveManualDay } from '../server/store.mjs';
import {
  metricOf, parseValue, parseShortcutLines, aggregateDaily, trimp, ingestAll, setAppleMode, getAppleMode,
  compareSources, workoutsWithIcu, listDaily, isAppleWatch,
} from '../server/apple-metrics.mjs';

const tmpDb = () => openDb(fs.mkdtempSync(path.join(os.tmpdir(), 'nhip-am-')));
const newUser = (db, name = 'hyden') => createUser(db, { username: name, displayName: name, password: 'matkhau123', role: 'admin' });
const L = (type, start, end, value, unit = '', source = 'Health Sync') => [type, start, end, value, unit, source].join('|');
const T = (hhmm, day = '2026-11-08') => `${day}T${hhmm}:00+07:00`;

/** A night 23:00 → 06:00 (ending 08/11) plus the morning readings. */
function morning(day = '2026-11-08', prev = '2026-11-07', { hrv = '48', rhr = '56' } = {}) {
  return [
    L('Phân tích giấc ngủ', T('23:00', prev), T('01:00', day), 'Lõi'),
    L('Phân tích giấc ngủ', T('01:00', day), T('02:00', day), 'Sâu'),
    L('Phân tích giấc ngủ', T('02:00', day), T('06:00', day), 'REM'),
    L('Độ biến thiên nhịp tim', T('03:00', day), T('03:00', day), hrv, 'ms'),
    L('Nhịp tim lúc nghỉ', T('07:00', day), T('07:00', day), rhr, 'nhịp/phút'),
    L('Nhịp thở', T('03:00', day), T('03:00', day), '14,6', 'lần/phút'),
    L('Độ bão hòa oxy trong máu', T('03:00', day), T('03:00', day), '0,96', '%'),
  ];
}

describe('apple metrics: parsing', () => {
  test('sample types in Vietnamese, English and Health Auto Export names', () => {
    const cases = {
      'Độ biến thiên nhịp tim': 'hrv', 'Heart Rate Variability': 'hrv', heart_rate_variability: 'hrv',
      'Nhịp tim lúc nghỉ': 'rhr', 'Resting Heart Rate': 'rhr', 'Nhịp tim': 'hr', 'Heart Rate': 'hr', heart_rate: 'hr',
      'Nhịp tim trung bình khi đi bộ': 'walk_hr', 'Nhịp thở': 'resp', respiratory_rate: 'resp',
      'Độ bão hòa oxy trong máu': 'spo2', blood_oxygen_saturation: 'spo2', 'Số bước': 'steps', step_count: 'steps',
      'Năng lượng hoạt động': 'kcal', active_energy: 'kcal', 'Phân tích giấc ngủ': 'sleep', sleep_analysis: 'sleep',
      'Bài tập': 'workout', Workouts: 'workout', apple_sleeping_wrist_temperature: 'wrist_temp',
    };
    for (const [label, want] of Object.entries(cases)) assert.equal(metricOf(label), want, label);
    assert.equal(metricOf('Mức độ ồn'), null);
  });

  test('values as the iPhone prints them, including the Vietnamese thousands dot', () => {
    assert.equal(parseValue('45,2', 'hrv'), 45.2);
    assert.equal(parseValue('45 ms', 'hrv'), 45);
    assert.equal(parseValue('1.234', 'steps'), 1234);
    assert.equal(parseValue('12.345.678', 'steps'), 12345678);
    assert.equal(parseValue('97 %', 'spo2'), 97);
    assert.equal(parseValue('abc', 'hrv'), null);
  });

  test('typed lines and legacy sleep lines in the same push; unknown types reported', () => {
    const r = parseShortcutLines([
      ...morning(),
      `${T('06:00')}|${T('06:30')}|Thức|HUAWEI`,
      L('Mức độ ồn', T('03:00'), T('03:00'), '40', 'dB'),
      L('Độ bão hòa oxy trong máu', T('03:10'), T('03:10'), '0,40', '%'),
    ].join('\n'));
    assert.equal(r.sleepSamples.length, 4);
    assert.deepEqual(r.unknownTypes, ['Mức độ ồn']);
    assert.equal(r.samples.filter((s) => s.metric === 'spo2').length, 1, 'SpO2 40% is dropped as implausible');
    assert.equal(r.samples.find((s) => s.metric === 'spo2').value, 96, 'fraction converted to %');
  });

  test('Apple Watch HRV (real SDNN) is never mixed in', () => {
    assert.equal(isAppleWatch('Apple Watch của Hyden'), true);
    assert.equal(isAppleWatch('Health Sync'), false);
    const r = parseShortcutLines(L('Độ biến thiên nhịp tim', T('03:00'), T('03:00'), '80', 'ms', 'Apple Watch của Hyden'));
    assert.equal(r.samples.length, 0);
  });
});

describe('apple metrics: daily rows', () => {
  test('HRV from the night, never a daytime spot check; resting HR latest of the day', () => {
    const { samples } = parseShortcutLines([
      ...morning(),
      L('Độ biến thiên nhịp tim', T('04:00'), T('04:00'), '52', 'ms'),
      L('Độ biến thiên nhịp tim', T('15:00'), T('15:00'), '25', 'ms'),
      L('Độ biến thiên nhịp tim', T('15:00', '2026-11-07'), T('15:00', '2026-11-07'), '30', 'ms'),
      L('Nhịp tim lúc nghỉ', T('20:00'), T('20:00'), '58', 'nhịp/phút'),
    ].join('\n'));
    const win = new Map([['2026-11-08', { start: Date.parse(T('23:00', '2026-11-07')), end: Date.parse(T('06:00')) }]]);
    const days = aggregateDaily(samples, win);
    assert.equal(days['2026-11-08'].hrv, 50, 'mean of 03:00 and 04:00 only');
    assert.equal(days['2026-11-08'].hrv_n, 2);
    assert.equal(days['2026-11-08'].rhr, 58);
    assert.equal(days['2026-11-07'], undefined, 'a lone afternoon HRV makes no day');
  });

  test('steps: largest source kept, iPhone + watch not added together', () => {
    const { samples } = parseShortcutLines([
      L('Số bước', T('08:00'), T('09:00'), '1.000', 'bước', 'iPhone'),
      L('Số bước', T('10:00'), T('11:00'), '500', 'bước', 'iPhone'),
      L('Số bước', T('08:00'), T('09:00'), '1.300', 'bước', 'Health Sync'),
    ].join('\n'));
    assert.equal(aggregateDaily(samples)['2026-11-08'].steps, 1500);
  });

  test('heart rate during sleep; whole-day average only with most of the day covered', () => {
    const hr = [];
    for (let m = 0; m < 6 * 60; m += 10) hr.push(L('Nhịp tim', new Date(Date.parse(T('00:00')) + m * 60000).toISOString(), '', '55'));
    const { samples } = parseShortcutLines(hr.join('\n'));
    const win = new Map([['2026-11-08', { start: Date.parse(T('00:00')), end: Date.parse(T('06:00')) }]]);
    const d = aggregateDaily(samples, win)['2026-11-08'];
    assert.equal(d.sleep_hr, 55);
    assert.equal(d.avg_hr, null, '6 hours of data is not a day');
  });
});

describe('apple metrics: workouts', () => {
  test('TRIMP formula', () => {
    // 60 min at HRr 0.5 → 60 × 0.5 × 0.64 × e^0.96
    assert.equal(trimp(60, 120, 60, 180), Math.round(60 * 0.5 * 0.64 * Math.exp(0.96) * 10) / 10);
    assert.equal(trimp(60, null, 60, 180), null);
    assert.equal(trimp(60, 50, 60, 180), 0, 'below resting HR clamps to 0');
  });

  test('workout gets average/max HR from samples during it and sits beside the Intervals load', () => {
    const db = tmpDb();
    const uid = newUser(db);
    upsertActivity(db, uid, { id: 'i1', start_date_local: '2026-11-07T17:52:00', type: 'Padel', moving_time: 4000, elapsed_time: 4100, icu_training_load: 36 }, 'icu');
    const lines = [L('Bài tập', T('17:50', '2026-11-07'), T('19:00', '2026-11-07'), 'Padel')];
    for (let m = 0; m < 70; m += 2) lines.push(L('Nhịp tim', new Date(Date.parse(T('17:50', '2026-11-07')) + m * 60000).toISOString(), '', String(m < 35 ? 130 : 150)));
    const out = ingestAll(db, uid, { samples: lines.join('\n') });
    assert.equal(out.workouts.length, 1);
    assert.equal(out.workouts[0].minutes, 70);
    assert.equal(out.workouts[0].maxHr, 150);
    assert.ok(out.workouts[0].avgHr > 135 && out.workouts[0].avgHr < 145);
    assert.ok(out.workouts[0].trimp > 0);
    const [w] = workoutsWithIcu(db, uid, '2026-11-01', '2026-11-08');
    assert.equal(w.icuLoad, 36);
    ingestAll(db, uid, { samples: lines.join('\n') });
    assert.equal(workoutsWithIcu(db, uid, '2026-11-01', '2026-11-08').length, 1, 're-push does not duplicate');
  });

  test('Health Auto Export JSON: metrics, aggregated sleep, workouts with kJ energy', () => {
    const db = tmpDb();
    const uid = newUser(db);
    const out = ingestAll(db, uid, { data: {
      metrics: [
        { name: 'heart_rate_variability', units: 'ms', data: [{ date: '2026-11-09 03:10:00 +0700', qty: 47, source: 'HUAWEI' }] },
        { name: 'resting_heart_rate', units: 'count/min', data: [{ date: '2026-11-09 00:00:00 +0700', qty: 55 }] },
        { name: 'sleep_analysis', units: 'hr', data: [{ date: '2026-11-09', sleepStart: '2026-11-08 23:10:00 +0700', sleepEnd: '2026-11-09 06:20:00 +0700', inBedStart: '2026-11-08 23:00:00 +0700', inBedEnd: '2026-11-09 06:30:00 +0700', core: 4, deep: 1.2, rem: 1.5, awake: 0.3, asleep: 0, inBed: 7.5 }] },
      ],
      workouts: [{ id: 'W1', name: 'Pickleball', start: '2026-11-09 17:00:00 +0700', end: '2026-11-09 18:10:00 +0700', avgHeartRate: { qty: 138 }, maxHeartRate: { qty: 170 }, activeEnergyBurned: { qty: 2092, units: 'kJ' } }],
    } });
    assert.equal(out.ok, true);
    assert.equal(out.format, 'health-auto-export');
    const [d] = listDaily(db, uid, '2026-11-09', '2026-11-09');
    assert.equal(d.hrv, 47);
    assert.equal(d.rhr, 55);
    assert.equal(out.nights[0].deepMin, 72);
    assert.equal(out.workouts[0].avgHr, 138);
    const w = db.prepare('SELECT kcal FROM apple_workouts WHERE user_id = ?').get(uid);
    assert.equal(Math.round(w.kcal), 500);
  });
});

describe('apple metrics: storage and merge', () => {
  test('a later push covering part of the day never lowers steps', () => {
    const db = tmpDb();
    const uid = newUser(db);
    ingestAll(db, uid, { samples: L('Số bước', T('08:00'), T('20:00'), '9.000', 'bước') });
    ingestAll(db, uid, { samples: L('Số bước', T('19:00'), T('20:00'), '400', 'bước') });
    assert.equal(listDaily(db, uid, '2026-11-08', '2026-11-08')[0].steps, 9000);
  });

  test('modes: fill takes only what Intervals lacks, prefer replaces, off ignores; manual always wins', () => {
    const db = tmpDb();
    const uid = newUser(db);
    upsertWellness(db, uid, { date: '2026-11-08', restingHR: 57, hrv: 60, sleepSecs: 7.5 * 3600 });
    ingestAll(db, uid, { samples: [...morning(), ...morning('2026-11-07', '2026-11-06', { hrv: '44', rhr: '55' })].join('\n') });
    assert.equal(getAppleMode(db, uid), 'fill');

    let rows = effectiveWellness(db, uid, '2026-11-01', '2026-11-08');
    const d8 = rows.find((r) => r.date === '2026-11-08');
    assert.equal(d8.hrv_rmssd, 60, 'Intervals value kept in fill mode');
    assert.equal(d8.respiration, 14.6, 'missing field filled');
    assert.deepEqual(d8._apple.sort(), ['respiration', 'spo2']);
    const d7 = rows.find((r) => r.date === '2026-11-07');
    assert.equal(d7.hrv_rmssd, 44, 'whole missing day filled');
    assert.equal(d7.sleep_secs, 7 * 3600);

    setAppleMode(db, uid, 'prefer');
    rows = effectiveWellness(db, uid, '2026-11-08', '2026-11-08');
    assert.equal(rows[0].hrv_rmssd, 48);
    assert.equal(rows[0].sleep_secs, 7 * 3600);

    saveManualDay(db, uid, { date: '2026-11-08', values: { hrv_rmssd: 70 } });
    rows = effectiveWellness(db, uid, '2026-11-08', '2026-11-08');
    assert.equal(rows[0].hrv_rmssd, 70, 'hand-entered HRV beats Apple even in prefer mode');

    setAppleMode(db, uid, 'off');
    rows = effectiveWellness(db, uid, '2026-11-01', '2026-11-08');
    assert.equal(rows.find((r) => r.date === '2026-11-07'), undefined);
    assert.throws(() => setAppleMode(db, uid, 'all'));
  });

  test('another user never receives this user’s Apple data', () => {
    const db = tmpDb();
    const a = newUser(db, 'nguoia');
    const b = newUser(db, 'nguoib');
    ingestAll(db, a, { samples: morning().join('\n') });
    assert.equal(effectiveWellness(db, b, '2026-11-01', '2026-11-08').length, 0);
  });

  test('comparison: side by side with differences and one-source days', () => {
    const db = tmpDb();
    const uid = newUser(db);
    upsertWellness(db, uid, { date: '2026-11-08', restingHR: 57, hrv: 50, sleepSecs: 7.5 * 3600 });
    ingestAll(db, uid, { samples: [...morning(), ...morning('2026-11-07', '2026-11-06')].join('\n') });
    const c = compareSources(db, uid, '2026-11-08', 3);
    assert.deepEqual(c.days[0].hrv, [50, 48]);
    assert.deepEqual(c.days[0].sleepH, [7.5, 7]);
    assert.equal(c.stats.hrv.both, 1);
    assert.equal(c.stats.hrv.onlyApple, 1);
    assert.equal(c.stats.hrv.meanAbsDiff, 2);
  });

  test('message summarises the newest day for the phone notification', () => {
    const db = tmpDb();
    const uid = newUser(db);
    const out = ingestAll(db, uid, { samples: morning().join('\n') });
    assert.equal(out.message, 'Ngày 08/11: ngủ 7h00 (sâu 1h00, REM 4h00), HRV 48, nhịp tim nghỉ 56, nhịp thở 14,6, SpO2 96.');
    const bad = ingestAll(db, uid, { samples: L('Mức độ ồn', T('03:00'), T('03:00'), '40', 'dB') });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Mức độ ồn/);
  });
});
