/**
 * Apple Health sleep push (iPhone Shortcut → /api/ingest/apple-health).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.mjs';
import { createUser } from '../server/store.mjs';
import {
  stageOf, parseTime, parseSamples, buildNights, ingest, issueToken, revokeToken, tokenInfo,
  userForToken, listNights, restoreNight, sleepDetailView, appleBedtimes,
} from '../server/apple-health.mjs';

const tmpDb = () => openDb(fs.mkdtempSync(path.join(os.tmpdir(), 'nhip-apple-')));
const line = (s, e, v, src = 'HUAWEI Health') => `${s}|${e}|${v}|${src}`;
const night = [
  line('2026-11-07T22:50:00+07:00', '2026-11-08T06:30:00+07:00', 'Trên giường', 'iPhone'),
  line('2026-11-07T23:05:00+07:00', '2026-11-08T00:20:00+07:00', 'Lõi'),
  line('2026-11-08T00:20:00+07:00', '2026-11-08T01:25:00+07:00', 'Sâu'),
  line('2026-11-08T01:25:00+07:00', '2026-11-08T02:00:00+07:00', 'REM'),
  line('2026-11-08T02:00:00+07:00', '2026-11-08T02:12:00+07:00', 'Thức'),
  line('2026-11-08T02:12:00+07:00', '2026-11-08T05:00:00+07:00', 'Core'),
  line('2026-11-08T05:00:00+07:00', '2026-11-08T05:03:00+07:00', 'Awake'),
  line('2026-11-08T05:03:00+07:00', '2026-11-08T06:10:00+07:00', 'REM'),
].join('\n');

describe('apple health: parsing', () => {
  test('stage labels in Vietnamese, English and HealthKit numbers', () => {
    const cases = {
      'Sâu': 'deep', 'Ngủ sâu': 'deep', Deep: 'deep', 'Lõi': 'core', Core: 'core', 'Ngủ nông': 'core', Light: 'core',
      REM: 'rem', 'Thức': 'awake', 'Tỉnh giấc': 'awake', Awake: 'awake', 'Trên giường': 'inbed', 'In Bed': 'inbed',
      'Đã ngủ': 'asleep', Asleep: 'asleep', 0: 'inbed', 1: 'asleep', 2: 'awake', 3: 'core', 4: 'deep', 5: 'rem',
    };
    for (const [label, want] of Object.entries(cases)) assert.equal(stageOf(label), want, label);
    assert.equal(stageOf('Bơi'), null);
    assert.equal(stageOf(''), null);
  });

  test('times: ISO with offset, Z, compact offset, and no offset = Vietnam time', () => {
    const want = Date.parse('2026-11-08T05:00:00+07:00');
    assert.equal(parseTime('2026-11-08T05:00:00+07:00'), want);
    assert.equal(parseTime('2026-11-07T22:00:00Z'), want);
    assert.equal(parseTime('2026-11-08T05:00:00+0700'), want);
    assert.equal(parseTime('2026-11-08 05:00'), want);
    assert.equal(parseTime('8 thg 11, 2026 lúc 05:00'), null, 'localized text is rejected, not guessed');
  });

  test('bad lines and unknown labels are reported, not silently dropped', () => {
    const r = parseSamples(`${night}\ngarbage\n${line('2026-11-08T06:10:00+07:00', '2026-11-08T06:20:00+07:00', 'Bơi')}\n${line('2026-11-08T07:00:00+07:00', '2026-11-08T06:00:00+07:00', 'REM')}`);
    assert.equal(r.samples.length, 8);
    assert.equal(r.badLines, 2, 'garbage line and end-before-start');
    assert.deepEqual(r.unknownLabels, ['Bơi']);
  });

  test('array of objects works the same as text lines', () => {
    const r = parseSamples([{ start: '2026-11-08T00:00:00+07:00', end: '2026-11-08T01:00:00+07:00', value: 'Deep', source: 'x' }]);
    assert.equal(r.samples[0].stage, 'deep');
  });
});

describe('apple health: nights', () => {
  test('stages summed, overlaps resolved minute by minute, short awake ignored as awakening', () => {
    const [n] = buildNights(parseSamples(night).samples);
    assert.equal(n.date, '2026-11-08', 'night belongs to the wake-up date');
    assert.equal(n.deepMin, 65);
    assert.equal(n.coreMin, 75 + 168);
    assert.equal(n.remMin, 35 + 67);
    assert.equal(n.awakeMin, 15);
    assert.equal(n.awakenings, 1, '12-minute wake counts, 3-minute does not');
    assert.equal(n.asleepMin, 65 + 243 + 102);
    assert.equal(n.inBedMin, 460, 'iPhone in-bed record spans 22:50–06:30');
    assert.equal(n.bedStart, '22:50');
    assert.equal(n.bedEnd, '06:30');
    assert.ok(Math.abs(n.efficiency - 410 / 460) < 0.001);
    assert.equal(n.hasStages, true);
    assert.deepEqual(n.sources.sort(), ['HUAWEI Health', 'iPhone']);
  });

  test('duplicate samples from two apps are not counted twice', () => {
    const doubled = `${night}\n${night.replaceAll('HUAWEI Health', 'Health Sync')}`;
    const [n] = buildNights(parseSamples(doubled).samples);
    assert.equal(n.asleepMin, 410);
  });

  test('"asleep" without stages still gives total sleep; gaps inside the night count as awake', () => {
    const txt = [
      line('2026-11-08T00:00:00+07:00', '2026-11-08T03:00:00+07:00', 'Asleep'),
      line('2026-11-08T03:20:00+07:00', '2026-11-08T07:00:00+07:00', 'Asleep'),
    ].join('\n');
    const [n] = buildNights(parseSamples(txt).samples);
    assert.equal(n.asleepMin, 400);
    assert.equal(n.unspecifiedMin, 400);
    assert.equal(n.hasStages, false);
    assert.equal(n.awakeMin, 20);
    assert.equal(n.awakenings, 1);
  });

  test('afternoon nap is a separate episode, counted as nap for that date', () => {
    const txt = `${night}\n${line('2026-11-08T13:00:00+07:00', '2026-11-08T13:40:00+07:00', 'Core')}`;
    const nights = buildNights(parseSamples(txt).samples);
    assert.equal(nights.length, 1);
    assert.equal(nights[0].napMin, 40);
    assert.equal(nights[0].asleepMin, 410, 'nap does not inflate the night');
  });

  test('two nights in one push → two dates', () => {
    const prev = night.replaceAll('2026-11-08', '2026-11-07X').replaceAll('2026-11-07T', '2026-11-06T').replaceAll('2026-11-07X', '2026-11-07');
    const nights = buildNights(parseSamples(`${prev}\n${night}`).samples);
    assert.deepEqual(nights.map((x) => x.date), ['2026-11-07', '2026-11-08']);
  });
});

describe('apple health: tokens and ingest', () => {
  test('token: issued once, only hash stored, replaced on re-issue, revocable', () => {
    const db = tmpDb();
    const uid = createUser(db, { username: 'hyden', displayName: 'H', password: 'matkhau123', role: 'admin' });
    assert.equal(tokenInfo(db, uid).hasToken, false);
    const t1 = issueToken(db, uid);
    assert.match(t1, /^ns_[A-Za-z0-9_-]{30,}$/);
    const stored = db.prepare('SELECT token_hash FROM ingest_tokens WHERE user_id = ?').get(uid).token_hash;
    assert.notEqual(stored, t1);
    assert.equal(userForToken(db, `Bearer ${t1}`), uid);
    assert.ok(tokenInfo(db, uid).lastUsedAt, 'use is recorded');
    assert.equal(userForToken(db, t1), null, 'Bearer prefix required');
    assert.equal(userForToken(db, 'Bearer sai'), null);
    const t2 = issueToken(db, uid);
    assert.equal(userForToken(db, `Bearer ${t1}`), null, 'old token dies on re-issue');
    assert.equal(userForToken(db, `Bearer ${t2}`), uid);
    revokeToken(db, uid);
    assert.equal(userForToken(db, `Bearer ${t2}`), null);
  });

  test('ingest stores the night, keeps the sleep score across re-pushes, message is readable', () => {
    const db = tmpDb();
    const uid = createUser(db, { username: 'hyden', displayName: 'H', password: 'matkhau123', role: 'admin' });
    const out = ingest(db, uid, { samples: night, sleepScore: '82' });
    assert.equal(out.ok, true);
    assert.match(out.message, /^Đêm 08\/11: ngủ 6h50 \(sâu 1h05, REM 1h42\), thức 15 phút, 1 lần tỉnh\.$/);
    ingest(db, uid, { samples: night });
    const [row] = listNights(db, uid, '2026-11-01', '2026-11-30');
    assert.equal(row.sleep_score, 82, 'a push without a score does not erase it');
    assert.equal(row.deep_min, 65);
    assert.equal(ingest(db, uid, { samples: night, sleepScore: 150 }).ok, true);
    assert.equal(listNights(db, uid, '2026-11-01', '2026-11-30')[0].sleep_score, 82, 'out-of-range score ignored');
  });

  test('ingest explains what is wrong when nothing usable arrives', () => {
    const db = tmpDb();
    const uid = createUser(db, { username: 'hyden', displayName: 'H', password: 'matkhau123', role: 'admin' });
    const a = ingest(db, uid, { samples: '' });
    assert.equal(a.ok, false);
    assert.equal(a.status, 400);
    assert.match(a.message, /Không có mẫu/);
    const b = ingest(db, uid, { samples: '8 thg 11|9 thg 11|Sâu' });
    assert.match(b.message, /ISO 8601/);
    const c = ingest(db, uid, { samples: line('2026-11-08T00:00:00+07:00', '2026-11-08T01:00:00+07:00', 'Mơ màng') });
    assert.match(c.message, /Mơ màng/);
  });

  test('other users never see the data; restore round-trips a backup row', () => {
    const db = tmpDb();
    const a = createUser(db, { username: 'nguoia', displayName: 'A', password: 'matkhau123', role: 'admin' });
    const b = createUser(db, { username: 'nguoib', displayName: 'B', password: 'matkhau123' });
    ingest(db, a, { samples: night, sleepScore: 80 });
    assert.equal(listNights(db, b, '2026-01-01', '2026-12-31').length, 0);
    const [row] = listNights(db, a, '2026-01-01', '2026-12-31');
    assert.equal(restoreNight(db, b, row), true);
    const [copy] = listNights(db, b, '2026-01-01', '2026-12-31');
    assert.equal(copy.deep_min, 65);
    assert.equal(copy.sleep_score, 80);
    assert.equal(restoreNight(db, b, { date: 'bad' }), false);
  });

  test('dashboard view: norm after 7 nights with stages, compare with Intervals', () => {
    const db = tmpDb();
    const uid = createUser(db, { username: 'hyden', displayName: 'H', password: 'matkhau123', role: 'admin' });
    issueToken(db, uid);
    const shift = (txt, days) => txt.replace(/2026-11-(0[78])/g, (_, d) => {
      const dt = new Date(Date.UTC(2026, 10, Number(d) - days));
      return dt.toISOString().slice(0, 10);
    });
    for (let k = 8; k >= 1; k--) ingest(db, uid, { samples: shift(night, k) });
    let v = sleepDetailView(db, uid, '2026-11-08', { intervalsSleepSecs: 454 * 60 });
    assert.equal(v.night, null, 'no push yet for today');
    assert.equal(v.lastDate, '2026-11-07');
    ingest(db, uid, { samples: night });
    v = sleepDetailView(db, uid, '2026-11-08', { intervalsSleepSecs: 454 * 60 });
    assert.equal(v.connected, true);
    assert.equal(v.night.date, '2026-11-08');
    assert.equal(v.norm.nights, 8);
    assert.ok(Math.abs(v.norm.deepPct - 65 / 410) < 1e-9);
    assert.deepEqual(v.compare, { intervalsMin: 454, appleMin: 410, diffMin: -44 });
  });
});

describe('apple health: bedtime from the watch', () => {
  test('sleep onset stored; bedtime keyed by the evening (context date); fills context only when not typed', async () => {
    const { buildDayFacts } = await import('../server/context.mjs');
    const db = tmpDb();
    const uid = createUser(db, { username: 'hyden', displayName: 'H', password: 'matkhau123', role: 'admin' });
    ingest(db, uid, { samples: night });
    const [row] = listNights(db, uid, '2026-11-08', '2026-11-08');
    assert.equal(row.bed_start, '22:50', 'iPhone in-bed');
    assert.equal(row.sleep_start, '23:05', 'watch sleep onset');
    assert.equal(row.sleep_end, '06:10');
    const map = appleBedtimes(db, uid, '2026-11-07', '2026-11-07');
    assert.deepEqual(map.get('2026-11-07'), { bedtime: '23:05', wake: '06:10', inBed: '22:50' });
    const days = buildDayFacts({ contexts: new Map([['2026-11-06', { bedtime: '22:00' }]]), bedtimes: new Map([['2026-11-06', { bedtime: '23:30' }], ['2026-11-07', { bedtime: '23:05' }]]) });
    assert.equal(days.get('2026-11-06').bedtime, '22:00', 'typed bedtime wins');
    assert.equal(days.get('2026-11-07').bedtime, '23:05');
    assert.equal(days.get('2026-11-07')._bed_auto, true);
    assert.equal(days.get('2026-11-07')._logged, false, 'an Apple bedtime does not make other context factors "known"');
  });
});
