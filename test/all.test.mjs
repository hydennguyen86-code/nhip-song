/**
 * Test runner — `node --test test/`
 * Zero deps, uses node:test + node:assert/strict.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, dataKey, localDate, localIso, encrypt, decrypt } from '../server/db.mjs';
import { hashPassword, verifyPassword, createSession, sessionUser, manualTargetUser } from '../server/auth.mjs';
import { computeBaselines, compare, recentLoad, rollingMean } from '../server/baseline.mjs';
import { buildAdvice } from '../server/advice.mjs';
import { parseCsv, previewWellness, previewActivities } from '../server/csv.mjs';
import { createUser, findUser, getUser, upsertWellness, upsertActivity, effectiveWellness, listActivitiesRange, listExclusions, excludeField, includeField, latestCheckin, addCheckin, setManualHrv, setManualRespiration, saveManualDay, mergeWellness } from '../server/store.mjs';
import { syncUser } from '../server/sync.mjs';
import { computeRecovery } from '../server/recovery.mjs';
import * as icu from '../server/icu.mjs';

function tmp(name = 'nhip-test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
  return dir;
}

describe('crypto + auth', () => {
  test('scrypt hash + verify round trip', () => {
    const h = hashPassword('matkhau123');
    assert.ok(h.startsWith('scrypt$'));
    assert.equal(verifyPassword('matkhau123', h), true);
    assert.equal(verifyPassword('sai', h), false);
  });
  test('AES-256-GCM encrypt/decrypt round trip', () => {
    const key = 'aa'.repeat(32);
    const ct = encrypt(key, 'API-SECRET-XYZ');
    assert.notEqual(ct.includes('API-SECRET'), true);
    assert.equal(decrypt(key, ct), 'API-SECRET-XYZ');
  });
  test('session token round trip', () => {
    const dir = tmp();
    const db = openDb(dir);
    const id = createUser(db, { username: 'abc', displayName: 'A', password: 'password1' });
    const tok = createSession(db, id);
    const u = sessionUser(db, tok);
    assert.equal(u.id, id);
    assert.equal(sessionUser(db, 'bogus'), null);
  });
});

describe('store: users, scoping, wellness, activities', () => {
  test('reject short password + weird username', () => {
    const db = openDb(tmp());
    assert.throws(() => createUser(db, { username: 'ab', displayName: 'AB', password: 'short' }));
    assert.throws(() => createUser(db, { username: 'has spaces', displayName: 'x', password: 'longenough1' }));
  });
  test('two users: rows are isolated by user_id', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'alice', displayName: 'A', password: 'pw-alice-1' });
    const b = createUser(db, { username: 'bob', displayName: 'B', password: 'pw-bob-1' });
    upsertWellness(db, a, { date: '2026-10-01', restingHR: 50 });
    upsertWellness(db, b, { date: '2026-10-01', restingHR: 70 });
    assert.equal(db.prepare('SELECT resting_hr FROM wellness WHERE user_id=? AND date=?').get(a, '2026-10-01').resting_hr, 50);
    assert.equal(db.prepare('SELECT resting_hr FROM wellness WHERE user_id=? AND date=?').get(b, '2026-10-01').resting_hr, 70);
  });
  test('upsert same date does not duplicate', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    upsertWellness(db, a, { date: '2026-10-01', restingHR: 50 });
    upsertWellness(db, a, { date: '2026-10-01', restingHR: 55 });
    const rows = db.prepare('SELECT * FROM wellness WHERE user_id=?').all(a);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].resting_hr, 55);
  });
  test('rMSSD and SDNN stay in separate columns', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    upsertWellness(db, a, { date: '2026-10-01', hrv: 75, hrvSDNN: 40 });
    const r = db.prepare('SELECT hrv_rmssd, hrv_sdnn FROM wellness WHERE user_id=?').get(a);
    assert.equal(r.hrv_rmssd, 75);
    assert.equal(r.hrv_sdnn, 40);
  });
  test('missing fields stored as NULL, not 0', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    upsertWellness(db, a, { date: '2026-10-01', restingHR: 50 });
    const r = db.prepare('SELECT * FROM wellness WHERE user_id=?').get(a);
    assert.equal(r.hrv_rmssd, null);
    assert.equal(r.steps, null);
    assert.equal(r.sleep_secs, null);
  });
  test('Intervals wellness payload keyed by id (no date field) is stored', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    assert.equal(upsertWellness(db, a, { id: '2026-10-01', restingHR: 50, sleepSecs: 28800 }), true);
    const r = db.prepare('SELECT * FROM wellness WHERE user_id=?').get(a);
    assert.equal(r.date, '2026-10-01');
    assert.equal(r.resting_hr, 50);
  });
  test('activity upsert dedupes by id', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    upsertActivity(db, a, { id: 'act-1', start_date_local: '2026-10-01T07:00:00', name: 'X', moving_time: 1800, icu_training_load: 50 });
    upsertActivity(db, a, { id: 'act-1', start_date_local: '2026-10-01T07:00:00', name: 'X rename', moving_time: 1800, icu_training_load: 55 });
    const rows = db.prepare('SELECT * FROM activities WHERE user_id=?').all(a);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'X rename');
    assert.equal(rows[0].training_load, 55);
  });
  test('exclusions drop a field from baseline reads', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    upsertWellness(db, a, { date: '2026-10-01', restingHR: 999 });
    excludeField(db, a, { dataset: 'wellness', rowKey: '2026-10-01', field: 'resting_hr', reason: 'sai' });
    const rows = effectiveWellness(db, a, '2026-10-01', '2026-10-01');
    assert.equal(rows[0].resting_hr, null);
    includeField(db, a, { dataset: 'wellness', rowKey: '2026-10-01', field: 'resting_hr' });
    assert.equal(effectiveWellness(db, a, '2026-10-01', '2026-10-01')[0].resting_hr, 999);
  });
});

describe('baseline computation', () => {
  function seed(days) {
    // returns wellness rows with date/rhr/hrv/sleep/steps
    const rows = [];
    for (const [d, rhr, rmssd, sleep, steps] of days) {
      rows.push({ date: d, resting_hr: rhr, hrv_rmssd: rmssd, sleep_secs: sleep, steps });
    }
    return rows;
  }
  test('target day is never inside its own baseline window', () => {
    const rows = seed([['2026-10-27', 50, 70, 28000, 10000]]);
    const b = computeBaselines(rows, '2026-10-27');
    assert.equal(b.rhr.count, 0);
    assert.equal(b.windowEnd, '2026-10-26');
  });
  test('30-day window: only days strictly before target and inside window', () => {
    const days = [];
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2026, 8, 20 + i));
      const iso = d.toISOString().slice(0, 10);
      days.push([iso, 50 + (i % 5), 70 + (i % 3), 28000, 10000]);
    }
    const target = '2026-10-29';
    const rows = seed(days);
    const b = computeBaselines(rows, target, { windowDays: 30 });
    assert.ok(b.windowStart < target);
    assert.ok(b.windowEnd < target);
    assert.ok(b.rhr.count <= 30);
  });
  test('HRV baseline needs >=14 valid days, rMSSD and SDNN counted separately', () => {
    const rows = [];
    for (let i = 1; i <= 10; i++) rows.push({ date: `2026-10-${String(i).padStart(2, '0')}`, hrv_rmssd: 60 + i });
    for (let i = 1; i <= 15; i++) rows.push({ date: `2026-10-${String(i).padStart(2, '0')}`, hrv_sdnn: 30 + i });
    const b = computeBaselines(rows, '2026-10-31');
    assert.equal(b.hrvRmssd.daysAvailable, 10);
    assert.equal(b.hrvRmssd.baseline, null);
    assert.equal(b.hrvSdnn.daysAvailable, 15);
    assert.ok(b.hrvSdnn.baseline);
  });
  test('stats give mean and sd correct', () => {
    const rows = [];
    for (let i = 1; i <= 20; i++) rows.push({ date: `2026-10-${String(i).padStart(2, '0')}`, hrv_rmssd: 50 + i });
    const b = computeBaselines(rows, '2026-10-25');
    // window = 09-25..10-24, rows 10-01..10-20 fall inside → 20 values, mean of 51..70 = 60.5
    assert.equal(b.hrvRmssd.baseline.count, 20);
    assert.ok(Math.abs(b.hrvRmssd.baseline.mean - 60.5) < 0.01);
  });
  test('recentLoad sums activities within days and skips target day', () => {
    const acts = [
      { start_date_local: '2026-10-25T07:00', training_load: 100, moving_time: 3600 },
      { start_date_local: '2026-10-26T07:00', training_load: 150, moving_time: 2400 },
      { start_date_local: '2026-10-27T07:00', training_load: 200, moving_time: 1200 }, // target day
    ];
    const r = recentLoad(acts, '2026-10-27', 7);
    assert.equal(r.sessions, 2);
    assert.equal(r.totalLoad, 250);
    assert.equal(r.totalMinutes, 100);
  });
});

describe('advice engine', () => {
  test('red flag → EMERGENCY, no other reasons override', () => {
    const a = buildAdvice({ today: '2026-10-27', wellness: [], activities: [], checkin: { level: 'serious', red_flag: 1, symptoms: 'đau ngực' } });
    assert.equal(a.verdict, 'emergency');
    assert.equal(a.emergency.show, true);
  });
  test('red flag detected from note even without symptoms field', () => {
    const a = buildAdvice({ today: '2026-10-27', wellness: [], activities: [], checkin: { level: 'ok', note: 'tối qua thấy khó thở' } });
    assert.equal(a.verdict, 'emergency');
  });
  test('"tired" checkin beats good HRV', () => {
    const wellness = [];
    for (let i = 1; i <= 20; i++) wellness.push({ date: `2026-10-${String(i).padStart(2, '0')}`, resting_hr: 52, hrv_rmssd: 80, sleep_secs: 28000 });
    wellness.push({ date: '2026-10-21', resting_hr: 52, hrv_rmssd: 82, sleep_secs: 28000 });
    const a = buildAdvice({ today: '2026-10-21', wellness, activities: [], checkin: { level: 'tired' } });
    assert.equal(a.verdict, 'recover');
  });
  test('no data at all → UNKNOWN', () => {
    const a = buildAdvice({ today: '2026-10-27', wellness: [], activities: [], checkin: null });
    assert.equal(a.verdict, 'unknown');
    assert.ok(a.gaps.length >= 3);
  });
  test('plan verdict when everything is in baseline', () => {
    const wellness = [];
    for (let i = 1; i <= 30; i++) wellness.push({ date: `2026-09-${String(i).padStart(2, '0')}`, resting_hr: 52, hrv_rmssd: 80, sleep_secs: 28000, steps: 10000 });
    wellness.push({ date: '2026-10-01', resting_hr: 52, hrv_rmssd: 80, sleep_secs: 28000, steps: 10000 });
    // target 2026-10-02 — the day itself has values close to baseline
    wellness.push({ date: '2026-10-02', resting_hr: 52, hrv_rmssd: 82, sleep_secs: 28000 });
    const a = buildAdvice({ today: '2026-10-02', wellness, activities: [], checkin: null });
    assert.equal(a.verdict, 'plan', JSON.stringify(a.reasons));
  });
  test('single bad HRV night is smoothed away by 7-day rolling mean', () => {
    const wellness = [];
    for (let i = 1; i <= 30; i++) wellness.push({ date: `2026-09-${String(i).padStart(2, '0')}`, resting_hr: 52 + (i % 3), hrv_rmssd: 80 + (i % 3), sleep_secs: 28000 });
    // one mildly low night right before the assessment day
    wellness.push({ date: '2026-10-01', resting_hr: 53, hrv_rmssd: 76, sleep_secs: 28000 });
    const a = buildAdvice({ today: '2026-10-01', wellness, activities: [], checkin: null });
    // last night ln(76/81) ≈ −0.064 over the 0.07 spread floor → acute z ≈ −0.9;
    // 7-day mean is almost on baseline → mixed z ≈ −0.6, above the −1 threshold
    const hrv = a.reasons.find((r) => r.kind === 'hrv');
    assert.ok(hrv.smoothed);
    assert.ok(hrv.z > -1, `z=${hrv.z}`);
    assert.equal(a.verdict, 'plan', JSON.stringify(a.reasons));
  });
  test('elevated respiration adds a supplemental reason', () => {
    const wellness = [];
    for (let i = 1; i <= 30; i++) wellness.push({ date: `2026-09-${String(i).padStart(2, '0')}`, resting_hr: 52, hrv_rmssd: 80, sleep_secs: 28000, respiration: 14 + (i % 3) * 0.3 });
    wellness.push({ date: '2026-10-01', resting_hr: 52, hrv_rmssd: 80, sleep_secs: 28000, respiration: 19 });
    const a = buildAdvice({ today: '2026-10-01', wellness, activities: [], checkin: null });
    const resp = a.reasons.find((r) => r.kind === 'resp');
    assert.ok(resp, 'respiration reason missing');
    assert.ok(resp.z > 1);
  });
  test('disabled factor via settings is skipped and reported', () => {
    const wellness = [];
    for (let i = 1; i <= 30; i++) wellness.push({ date: `2026-09-${String(i).padStart(2, '0')}`, resting_hr: 52 + (i % 3), hrv_rmssd: 80 + (i % 3), sleep_secs: 28000 });
    wellness.push({ date: '2026-10-01', resting_hr: 70, hrv_rmssd: 50, sleep_secs: 28000 });
    const a = buildAdvice({ today: '2026-10-01', wellness, activities: [], checkin: null, settings: { rhr_on: 0, hrv_on: 0 } });
    assert.ok(a.reasons.some((r) => r.kind === 'hrv-off'));
    assert.ok(a.reasons.some((r) => r.kind === 'rhr-off'));
    assert.equal(a.verdict, 'plan');
  });
  test('custom thresholds: high RHR triggers ease only when threshold crossed', () => {
    const wellness = [];
    for (let i = 1; i <= 30; i++) wellness.push({ date: `2026-09-${String(i).padStart(2, '0')}`, resting_hr: 52 + (i % 5), hrv_rmssd: 80, sleep_secs: 28000 });
    const today = '2026-10-01';
    wellness.push({ date: today, resting_hr: 56, hrv_rmssd: 80, sleep_secs: 28000 }); // z ≈ 1.27
    const strict = buildAdvice({ today, wellness, activities: [], checkin: null, settings: { rhr_z: 1.5 } });
    assert.equal(strict.verdict, 'plan');
    const loose = buildAdvice({ today, wellness, activities: [], checkin: null, settings: { rhr_z: 1.0 } });
    assert.equal(loose.verdict, 'ease');
  });
});

describe('rolling HRV mean', () => {
  test('uses up to 7 days ending at target, requires 3 valid points', () => {
    const rows = [
      { date: '2026-10-01', hrv_rmssd: 60 },
      { date: '2026-10-02', hrv_rmssd: 70 },
      { date: '2026-10-03', hrv_rmssd: 80 },
    ];
    const r = rollingMean(rows, 'hrv_rmssd', '2026-10-03');
    assert.equal(r.value, 70);
    assert.equal(r.count, 3);
    assert.equal(rollingMean(rows.slice(0, 2), 'hrv_rmssd', '2026-10-03'), null);
  });
});

describe('csv parser + preview', () => {
  test('handles quoted commas, CRLF, and UTF-8 BOM', () => {
    const csv = '﻿date,name,note\r\n2026-10-01,"a, b","he said ""hi"""\r\n';
    const rows = parseCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'a, b');
    assert.equal(rows[0].note, 'he said "hi"');
  });
  test('previewWellness maps standard columns', () => {
    const p = previewWellness('date,restingHR,hrv,hrvSDNN,sleepSecs,sleepScore,steps\n2026-10-01,52,75,,28000,85,10000\n');
    assert.equal(p.total, 1);
    assert.equal(p.sample[0].restingHR, 52);
    assert.equal(p.sample[0].hrv, 75);
    assert.equal(p.sample[0].hrvSDNN, null);
    assert.equal(p.dates.oldest, '2026-10-01');
  });
  test('previewWellness rejects CSV without date column', () => {
    const p = previewWellness('restingHR\n52\n');
    assert.ok(p.error);
  });
  test('previewActivities detects id + start_date_local', () => {
    const p = previewActivities('id,start_date_local,name,moving_time,icu_training_load\n1,2026-10-01T07:00:00,Run,3600,80\n');
    assert.equal(p.total, 1);
    assert.equal(p.sample[0].moving_time, 3600);
    assert.equal(p.dates.newest, '2026-10-01');
  });
});

describe('icu client auth', () => {
  test('missing key → rejects with IcuError auth kind', async () => {
    await assert.rejects(
      () => icu.fetchWellness('i1', '', { oldest: '2026-01-01', newest: '2026-01-31' }),
      /API key/,
    );
  });
});

describe('sync error handling', () => {
  test('no key → returns skipped, marks error, does not wipe data', async () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    upsertWellness(db, a, { date: '2026-10-01', restingHR: 52 });
    const r = await syncUser(db, a, 'aa'.repeat(32));
    assert.equal(r.ok, false);
    assert.equal(r.skipped, true);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM wellness WHERE user_id=?').get(a).n, 1);
  });
});

describe('manual HRV fallback', () => {
  test('stores a manual reading on a new day and marks it', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    const entry = setManualHrv(db, a, { date: '2026-10-01', value: '65.5' });
    assert.equal(entry.hrv, 65.5);
    assert.equal(entry.manual, true);
    const r = db.prepare('SELECT * FROM wellness WHERE user_id=? AND date=?').get(a, '2026-10-01');
    assert.equal(r.hrv_rmssd, 65.5);
    assert.equal(r.hrv_manual, 1);
    assert.ok(r.hrv_manual_at);
    assert.equal(r.source, 'manual');
  });
  test('adding manual HRV keeps other wellness fields', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    upsertWellness(db, a, { date: '2026-10-01', restingHR: 52, sleepSecs: 28000 });
    setManualHrv(db, a, { date: '2026-10-01', value: 64 });
    const r = db.prepare('SELECT * FROM wellness WHERE user_id=? AND date=?').get(a, '2026-10-01');
    assert.equal(r.resting_hr, 52);
    assert.equal(r.sleep_secs, 28000);
    assert.equal(r.hrv_rmssd, 64);
    assert.equal(r.hrv_manual, 1);
  });
  test('sync with NULL HRV preserves the manual value and flag', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    setManualHrv(db, a, { date: '2026-10-01', value: 64 });
    upsertWellness(db, a, { date: '2026-10-01', restingHR: 52 });
    const r = db.prepare('SELECT * FROM wellness WHERE user_id=? AND date=?').get(a, '2026-10-01');
    assert.equal(r.hrv_rmssd, 64);
    assert.equal(r.hrv_manual, 1);
    assert.ok(r.hrv_manual_at);
  });
  test('sync with a real HRV replaces the manual value and clears the flag', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    setManualHrv(db, a, { date: '2026-10-01', value: 64 });
    upsertWellness(db, a, { date: '2026-10-01', hrv: 72 });
    const r = db.prepare('SELECT * FROM wellness WHERE user_id=? AND date=?').get(a, '2026-10-01');
    assert.equal(r.hrv_rmssd, 72);
    assert.equal(r.hrv_manual, 0);
    assert.equal(r.hrv_manual_at, null);
  });
  test('CSV HRV also overrides manual, while a blank CSV HRV preserves it', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    setManualHrv(db, a, { date: '2026-10-01', value: 64 });
    mergeWellness(db, a, { date: '2026-10-01', restingHR: 50 }, 'csv');
    assert.equal(db.prepare('SELECT hrv_rmssd, hrv_manual FROM wellness WHERE user_id=? AND date=?').get(a, '2026-10-01').hrv_rmssd, 64);
    mergeWellness(db, a, { date: '2026-10-01', hrv: 70 }, 'csv');
    const r = db.prepare('SELECT hrv_rmssd, hrv_manual FROM wellness WHERE user_id=? AND date=?').get(a, '2026-10-01');
    assert.equal(r.hrv_rmssd, 70);
    assert.equal(r.hrv_manual, 0);
  });
  test('clearing a manual reading leaves other fields intact', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    upsertWellness(db, a, { date: '2026-10-01', restingHR: 52, sleepSecs: 28000 });
    setManualHrv(db, a, { date: '2026-10-01', value: 64 });
    const cleared = setManualHrv(db, a, { date: '2026-10-01', value: null });
    assert.equal(cleared.hrv, null);
    const r = db.prepare('SELECT * FROM wellness WHERE user_id=? AND date=?').get(a, '2026-10-01');
    assert.equal(r.hrv_rmssd, null);
    assert.equal(r.hrv_manual, 0);
    assert.equal(r.resting_hr, 52);
    assert.equal(r.sleep_secs, 28000);
  });
  test('manual HRV is visible to effective/baseline reads', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    setManualHrv(db, a, { date: '2026-10-01', value: 61.5 });
    const rows = effectiveWellness(db, a, '2026-10-01', '2026-10-01');
    assert.equal(rows[0].hrv_rmssd, 61.5);
  });
  test('rejects invalid dates, future dates and out-of-range values', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    assert.throws(() => setManualHrv(db, a, { date: '2026-02-31', value: 64 }), /Ngày/);
    assert.throws(() => setManualHrv(db, a, { date: '2999-01-01', value: 64 }), /tương lai/);
    assert.throws(() => setManualHrv(db, a, { date: '2026-10-01', value: 0 }), /1–300/);
    assert.throws(() => setManualHrv(db, a, { date: '2026-10-01', value: 301 }), /1–300/);
    assert.throws(() => setManualHrv(db, a, { date: '2026-10-01', value: null }), /xoá/);
  });
  test('admin records for a family member, members cannot', () => {
    const db = openDb(tmp());
    const adminId = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123', role: 'admin' });
    const memberId = createUser(db, { username: 'def', displayName: 'B', password: 'pwlong123', role: 'member' });
    const admin = getUser(db, adminId);
    const member = getUser(db, memberId);
    assert.equal(manualTargetUser(db, admin, memberId), memberId);
    assert.equal(manualTargetUser(db, member, adminId), null);
    assert.equal(manualTargetUser(db, member, memberId), memberId);
    assert.equal(manualTargetUser(db, admin, null), adminId);
    assert.equal(manualTargetUser(db, admin, 999), null);
    assert.equal(manualTargetUser(db, member, ''), memberId);
    setManualHrv(db, manualTargetUser(db, admin, memberId), { date: '2026-10-01', value: 58 });
    assert.equal(effectiveWellness(db, memberId, '2026-10-01', '2026-10-01')[0].hrv_rmssd, 58);
    assert.equal(effectiveWellness(db, adminId, '2026-10-01', '2026-10-01').length, 0);
  });
});

describe('manual respiration', () => {
  const row = (db, a, d = '2026-10-01') => db.prepare('SELECT * FROM wellness WHERE user_id=? AND date=?').get(a, d);
  test('stores a reading on a new day and keeps other fields on an existing one', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    const entry = setManualRespiration(db, a, { date: '2026-10-01', value: '14.5' });
    assert.equal(entry.respiration, 14.5);
    assert.equal(entry.manual, true);
    assert.equal(row(db, a).respiration_manual, 1);
    assert.equal(row(db, a).source, 'manual');
    upsertWellness(db, a, { id: '2026-10-02', restingHR: 50, hrv: 70 });
    setManualRespiration(db, a, { date: '2026-10-02', value: 15 });
    const r = row(db, a, '2026-10-02');
    assert.equal(r.resting_hr, 50);
    assert.equal(r.hrv_rmssd, 70);
    assert.equal(r.hrv_manual, 0);
    assert.equal(r.respiration, 15);
  });
  test('sync with NULL keeps it, sync with a real value replaces it and clears the flag', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    setManualRespiration(db, a, { date: '2026-10-01', value: 14 });
    upsertWellness(db, a, { id: '2026-10-01', restingHR: 50, respiration: null });
    assert.equal(row(db, a).respiration, 14);
    assert.equal(row(db, a).respiration_manual, 1);
    assert.ok(row(db, a).respiration_manual_at);
    upsertWellness(db, a, { id: '2026-10-01', restingHR: 50, respiration: 16 });
    assert.equal(row(db, a).respiration, 16);
    assert.equal(row(db, a).respiration_manual, 0);
    assert.equal(row(db, a).respiration_manual_at, null);
  });
  test('a blank CSV value keeps it, a CSV value replaces it', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    setManualRespiration(db, a, { date: '2026-10-01', value: 14 });
    mergeWellness(db, a, { date: '2026-10-01', restingHR: 50 }, 'csv');
    assert.equal(row(db, a).respiration, 14);
    assert.equal(row(db, a).respiration_manual, 1);
    mergeWellness(db, a, { date: '2026-10-01', respiration: 16 }, 'csv');
    assert.equal(row(db, a).respiration, 16);
    assert.equal(row(db, a).respiration_manual, 0);
  });
  test('HRV and respiration flags are independent; clearing one leaves the other', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    setManualHrv(db, a, { date: '2026-10-01', value: 60 });
    setManualRespiration(db, a, { date: '2026-10-01', value: 14 });
    setManualRespiration(db, a, { date: '2026-10-01', value: null });
    assert.equal(row(db, a).respiration, null);
    assert.equal(row(db, a).respiration_manual, 0);
    assert.equal(row(db, a).hrv_rmssd, 60);
    assert.equal(row(db, a).hrv_manual, 1);
  });
  test('rejects bad input and refuses to clear a synced value', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    assert.throws(() => setManualRespiration(db, a, { date: '2026-02-31', value: 14 }), /Ngày/);
    assert.throws(() => setManualRespiration(db, a, { date: '2999-01-01', value: 14 }), /tương lai/);
    assert.throws(() => setManualRespiration(db, a, { date: '2026-10-01', value: 5.9 }), /6–30/);
    assert.throws(() => setManualRespiration(db, a, { date: '2026-10-01', value: 31 }), /6–30/);
    assert.throws(() => setManualRespiration(db, a, { date: '2026-10-01', value: 'abc' }), /6–30/);
    upsertWellness(db, a, { id: '2026-10-01', respiration: 16 });
    assert.throws(() => setManualRespiration(db, a, { date: '2026-10-01', value: null }), /xoá/);
    assert.equal(row(db, a).respiration, 16);
  });
  test('an admin records for a member, and the reading reaches only that member', () => {
    const db = openDb(tmp());
    const adminId = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123', role: 'admin' });
    const memberId = createUser(db, { username: 'def', displayName: 'B', password: 'pwlong123', role: 'member' });
    setManualRespiration(db, manualTargetUser(db, getUser(db, adminId), memberId), { date: '2026-10-01', value: 14 });
    assert.equal(effectiveWellness(db, memberId, '2026-10-01', '2026-10-01')[0].respiration, 14);
    assert.equal(effectiveWellness(db, adminId, '2026-10-01', '2026-10-01').length, 0);
  });
});

describe('manual day form', () => {
  const setup = () => {
    const db = openDb(tmp());
    return { db, a: createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' }) };
  };
  const row = (db, a, d = '2026-10-01') => db.prepare('SELECT * FROM wellness WHERE user_id=? AND date=?').get(a, d);
  test('saves every metric at once and marks each one manual', () => {
    const { db, a } = setup();
    const r = saveManualDay(db, a, { date: '2026-10-01', values: { resting_hr: 55, sleep_secs: 25200, sleep_score: 80, steps: 8000, spo2: 97, weight: 60.5, hrv_rmssd: 62, respiration: 15 } });
    assert.equal(r.changed.length, 8);
    const w = row(db, a);
    assert.equal(w.resting_hr, 55);
    assert.equal(w.sleep_secs, 25200);
    assert.equal(w.resting_hr_manual, 1);
    assert.ok(w.spo2_manual_at);
    assert.equal(w.hrv_manual, 1);
    assert.equal(w.respiration_manual, 1);
  });
  test('re-saving a synced value does not mark it manual, a blank leaves it alone', () => {
    const { db, a } = setup();
    upsertWellness(db, a, { id: '2026-10-01', restingHR: 50, sleepSecs: 25000 });
    const r = saveManualDay(db, a, { date: '2026-10-01', values: { resting_hr: 50, sleep_secs: '', weight: 60 } });
    assert.deepEqual(r.changed, ['weight']);
    assert.equal(row(db, a).resting_hr_manual, 0);
    assert.equal(row(db, a).sleep_secs, 25000);
    assert.equal(row(db, a).weight_manual, 1);
  });
  test('a blank clears a manual value only', () => {
    const { db, a } = setup();
    saveManualDay(db, a, { date: '2026-10-01', values: { resting_hr: 55, steps: 8000 } });
    assert.deepEqual(saveManualDay(db, a, { date: '2026-10-01', values: { resting_hr: '' } }).changed, ['resting_hr']);
    assert.equal(row(db, a).resting_hr, null);
    assert.equal(row(db, a).resting_hr_manual, 0);
    assert.equal(row(db, a).steps, 8000);
  });
  test('one bad value rejects the whole form', () => {
    const { db, a } = setup();
    assert.throws(() => saveManualDay(db, a, { date: '2026-10-01', values: { resting_hr: 55, spo2: 40 } }), /SpO2/);
    assert.equal(row(db, a), undefined);
    assert.throws(() => saveManualDay(db, a, { date: '2026-10-01', values: { steps: 10.5 } }), /nguyên/);
    assert.throws(() => saveManualDay(db, a, { date: '2026-10-01', values: { sleep_secs: 0 } }), /Giờ ngủ/);
    assert.throws(() => saveManualDay(db, a, { date: '2026-10-01', values: { password: 1 } }), /không hợp lệ/);
    assert.throws(() => saveManualDay(db, a, { date: '2999-01-01', values: { steps: 1 } }), /tương lai/);
  });
  test('sync with NULL keeps manual readings, a real value replaces them, a plain NULL still clears', () => {
    const { db, a } = setup();
    saveManualDay(db, a, { date: '2026-10-01', values: { resting_hr: 55, sleep_secs: 25200 } });
    upsertWellness(db, a, { id: '2026-10-01', restingHR: null, sleepSecs: 26000 });
    assert.equal(row(db, a).resting_hr, 55);
    assert.equal(row(db, a).resting_hr_manual, 1);
    assert.equal(row(db, a).sleep_secs, 26000);
    assert.equal(row(db, a).sleep_secs_manual, 0);
    upsertWellness(db, a, { id: '2026-10-01', restingHR: null, sleepSecs: null });
    assert.equal(row(db, a).sleep_secs, null);
  });
  test('CSV blank keeps manual readings, CSV value replaces them', () => {
    const { db, a } = setup();
    saveManualDay(db, a, { date: '2026-10-01', values: { resting_hr: 55, weight: 60 } });
    mergeWellness(db, a, { date: '2026-10-01', weight: 61 }, 'csv');
    assert.equal(row(db, a).resting_hr_manual, 1);
    assert.equal(row(db, a).weight, 61);
    assert.equal(row(db, a).weight_manual, 0);
  });
  test('resting HR and sleep typed by hand produce a score without HRV', () => {
    const { db, a } = setup();
    for (let i = 1; i <= 10; i++) saveManualDay(db, a, { date: `2026-09-${String(i).padStart(2, '0')}`, values: { resting_hr: 55 + (i % 3), sleep_secs: 26000 } });
    const wellness = effectiveWellness(db, a, '2026-09-01', '2026-09-10');
    const r = computeRecovery({ wellness, today: '2026-09-10' });
    assert.notEqual(r.score, null);
    assert.equal(r.used, 2);
    assert.equal(r.confidence, 'vừa');
  });
});

describe('checkins', () => {
  test('latestCheckin returns newest for today only', () => {
    const db = openDb(tmp());
    const a = createUser(db, { username: 'abc', displayName: 'A', password: 'pwlong123' });
    addCheckin(db, a, { level: 'ok' });
    addCheckin(db, a, { level: 'tired' });
    const today = localDate();
    const c = latestCheckin(db, a, today);
    assert.equal(c.level, 'tired');
    assert.equal(latestCheckin(db, a, '1999-01-01'), undefined);
  });
});
