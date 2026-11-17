/** Weekly body composition: typed readings, Apple Health fill, trend vs noise. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.mjs';
import { createUser } from '../server/store.mjs';
import { saveManualBody, saveAppleBody, getBody, listBody, deleteBody, bodySummary } from '../server/body.mjs';
import { metricOf, ingestAll } from '../server/apple-metrics.mjs';

const tmpDb = () => openDb(fs.mkdtempSync(path.join(os.tmpdir(), 'nhip-body-')));
const newUser = (db) => createUser(db, { username: 'hyden', displayName: 'Hyden', password: 'matkhau123', role: 'admin' });
const L = (type, start, value, unit = '', source = 'Fitdays+') => [type, start, start, value, unit, source].join('|');
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

describe('body composition', () => {
  test('typed reading from the June report; impedance kept; bad value rejected', () => {
    const db = tmpDb(); const uid = newUser(db);
    const r = saveManualBody(db, uid, '2026-06-14', {
      weight: '66,4', fat_pct: 17.3, skeletal_kg: 30.9, lean_kg: 54.9, visceral: 3, bmr: 1555,
      impedance: { z20: { ra: 298.4, la: 302.5, tr: 24.4, rl: 245.2, ll: 256.7 }, z100: { ra: 269.7, tr: '18,4' } },
    }, { today: '2026-11-11' });
    assert.equal(r.weight, 66.4);
    assert.equal(r.source, 'manual');
    assert.equal(r.impedance.z100.tr, 18.4);
    assert.deepEqual(r.manual_cols.sort(), ['bmr', 'fat_pct', 'lean_kg', 'skeletal_kg', 'visceral', 'weight']);
    assert.throws(() => saveManualBody(db, uid, '2026-06-15', { fat_pct: 95 }, { today: '2026-11-11' }), /Tỷ lệ mỡ/);
    assert.throws(() => saveManualBody(db, uid, '2026-12-01', { weight: 66 }, { today: '2026-11-11' }), /tương lai/);
    assert.throws(() => saveManualBody(db, uid, '2026-06-16', {}, { today: '2026-11-11' }), /Chưa có số/);
  });

  test('Apple fills only what was not typed; a typed value is never overwritten', () => {
    const db = tmpDb(); const uid = newUser(db);
    saveAppleBody(db, uid, '2026-11-15', { weight: 66.8, fat_pct: 18.1, lean_kg: 54.7 });
    assert.equal(getBody(db, uid, '2026-11-15').source, 'apple');
    saveManualBody(db, uid, '2026-11-15', { weight: 66.5, skeletal_kg: 31 }, { today: '2026-11-15' });
    let r = getBody(db, uid, '2026-11-15');
    assert.equal(r.weight, 66.5, 'typed wins');
    assert.equal(r.fat_pct, 18.1, 'Apple value kept');
    assert.equal(r.source, 'manual+apple');
    saveAppleBody(db, uid, '2026-11-15', { weight: 70, fat_pct: 17.9 });
    r = getBody(db, uid, '2026-11-15');
    assert.equal(r.weight, 66.5);
    assert.equal(r.fat_pct, 17.9, 'a newer Apple value replaces the older Apple one');
    assert.ok(deleteBody(db, uid, '2026-11-15'));
    assert.equal(listBody(db, uid, '2026-01-01', '2026-12-31').length, 0);
  });

  test('summary: collecting, then stable within noise, then muscle loss past noise', () => {
    const start = '2026-09-06';
    const mk = (n, f) => Array.from({ length: n }, (_, i) => ({ date: addDays(start, i * 7), standard: true, ...f(i) }));
    let s = bodySummary(mk(3, () => ({ weight: 66.4, fat_pct: 17.3, skeletal_kg: 30.9 })), { today: addDays(start, 14) });
    assert.equal(s.state, 'collecting');
    assert.equal(s.protein.gPerDay, 105);

    s = bodySummary(mk(10, (i) => ({ weight: 66.4 + (i % 2 ? 0.4 : -0.4), fat_pct: 17.3 + (i % 3) * 0.3, skeletal_kg: 30.9 + (i % 2 ? 0.3 : -0.3) })), { today: addDays(start, 63) });
    assert.equal(s.state, 'stable');
    assert.deepEqual(s.flags, []);

    s = bodySummary(mk(10, (i) => ({ weight: 66.4 - i * 0.15, fat_pct: 17.3, skeletal_kg: 30.9 - i * 0.2 })), { today: addDays(start, 63) });
    assert.ok(s.flags.includes('muscle_down'), JSON.stringify(s.change));
    assert.match(s.messages[0], /Cơ xương giảm/);
  });

  test('a reading taken outside the standard conditions is left out of the trend', () => {
    const rows = [
      { date: '2026-11-01', standard: true, weight: 66.4, skeletal_kg: 30.9 },
      { date: '2026-11-08', standard: true, weight: 66.6, skeletal_kg: 31.0 },
      { date: '2026-11-15', standard: false, weight: 64.9, skeletal_kg: 29.6 },
    ];
    const s = bodySummary(rows, { today: '2026-11-15' });
    assert.equal(s.count, 2);
    assert.equal(s.recent.weight, 66.5);
    assert.equal(s.due, false);
  });

  test('an odd reading (likely hydration) is pointed out', () => {
    const rows = ['2026-10-18', '2026-10-25', '2026-11-01'].map((d) => ({ date: d, standard: true, weight: 66.4, skeletal_kg: 30.9, fat_pct: 17.3 }));
    rows.push({ date: '2026-11-08', standard: true, weight: 66.2, skeletal_kg: 29.0, fat_pct: 17.5 });
    const s = bodySummary(rows, { today: '2026-11-08' });
    assert.deepEqual(s.odd.fields, ['skeletal_kg']);
    assert.ok(s.messages.some((m) => /lệch xa/.test(m)));
  });

  test('Apple Health scale types are recognised; BMI is ignored; the Shortcut push fills the row', () => {
    assert.equal(metricOf('Body Mass'), 'body_mass');
    assert.equal(metricOf('Cân nặng'), 'body_mass');
    assert.equal(metricOf('weight_body_mass'), 'body_mass');
    assert.equal(metricOf('Body Fat Percentage'), 'body_fat');
    assert.equal(metricOf('Lean Body Mass'), 'lean_mass');
    assert.equal(metricOf('Body Mass Index'), null);
    const db = tmpDb(); const uid = newUser(db);
    const out = ingestAll(db, uid, { samples: [
      L('Body Mass', '2026-11-15T06:40:00+07:00', '66,6', 'kg'),
      L('Body Fat Percentage', '2026-11-15T06:40:00+07:00', '0,178', '%'),
      L('Lean Body Mass', '2026-11-15T06:40:00+07:00', '120,9', 'lb'),
      L('Body Mass Index', '2026-11-15T06:40:00+07:00', '22,3', ''),
    ].join('\n') });
    assert.ok(out.ok, out.error);
    assert.match(out.message, /cân 66,6 kg, mỡ 17,8%/);
    const r = getBody(db, uid, '2026-11-15');
    assert.equal(r.weight, 66.6);
    assert.equal(r.fat_pct, 17.8);
    assert.equal(r.lean_kg, 54.84);
    assert.equal(r.source, 'apple');
  });
});
