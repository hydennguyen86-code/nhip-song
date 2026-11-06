// Tests for daily context, the pattern engine, unusual-reading alerts, the AI
// guard layer and the Cloudflare hardening. No network: the AI is a fake fetch.
process.env.NHIP_SKIP_DOTENV = '1';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.mjs';
import { createUser } from '../server/store.mjs';
import { normalizeContext, saveContext, listContexts, buildDayFacts, contextLabels } from '../server/context.mjs';
import { computePatterns, welch, morningOutcomes } from '../server/patterns.mjs';
import { unusualReadings } from '../server/alerts.mjs';
import { computeRecovery } from '../server/recovery.mjs';
import { guardOutput, isMedicalQuestion, buildPacket, runAi, aiConfig, weeklyWindow, FALLBACK_REPLY, MEDICAL_REPLY } from '../server/ai.mjs';
import { createLoginLimiter, isHttps, clientIp } from '../server/security.mjs';
import { parseEnv } from '../server/env.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nhip-ins-'));
function addDays(date, n) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/** Deterministic pseudo-random in [-1, 1]. */
function noise(i, salt = 1) { const x = Math.sin(i * 12.9898 * salt + salt * 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

const TODAY = '2026-11-06';

/**
 * 140 days. Leg day every 7th day; chest/back on other training days; every
 * day has a saved context. Planted effect: HRV −16 % the morning after leg day,
 * −10 % two mornings after, normal on the third; RHR +3 bpm the morning after.
 */
function plantedWorld({ days = 140 } = {}) {
  const contexts = new Map();
  const wellness = [];
  const start = addDays(TODAY, -days);
  for (let i = 0; i <= days; i++) {
    const date = addDays(start, i);
    const isLeg = i % 7 === 3;
    const isChest = i % 7 === 0 || i % 7 === 5;
    contexts.set(date, isLeg ? { workout: ['leg'], load: 'le50' } : isChest ? { workout: ['chest_back'] } : { workout: ['rest'], coffee_cups: 2 });
    const prevLeg = (i - 1) % 7 === 3;
    const prev2Leg = (i - 2) % 7 === 3;
    let hrv = 60 * Math.exp(0.05 * noise(i, 3));
    if (prevLeg) hrv *= 0.84;
    if (prev2Leg) hrv *= 0.9;
    const rhr = 52 + 0.8 * noise(i, 7) + (prevLeg ? 3 : 0);
    wellness.push({ date, hrv_rmssd: hrv, resting_hr: rhr, sleep_secs: (7.5 * 60 + 15 * noise(i, 11)) * 60 });
  }
  return { contexts, wellness };
}

describe('daily context', () => {
  test('valid context is normalized, empties dropped', () => {
    const c = normalizeContext({ workout: ['leg'], load: 'le50', sauna: 'evening', coffee_cups: 2, coffee_late: false, bedtime: '23:45', work_stress: 1, alcohol: '' });
    assert.deepEqual(c, { workout: ['leg'], load: 'le50', sauna: 'evening', coffee_cups: 2, bedtime: '23:45', work_stress: 1 });
  });
  test('unknown keys, bad values and "rest + workout" are rejected', () => {
    assert.throws(() => normalizeContext({ bogus: 1 }), /không hợp lệ/);
    assert.throws(() => normalizeContext({ workout: ['leg', 'rest'] }), /Nghỉ/);
    assert.throws(() => normalizeContext({ coffee_cups: 2.5 }), /số nguyên/);
    assert.throws(() => normalizeContext({ coffee_late: 'yes' }), /đúng \/ sai/);
    assert.throws(() => normalizeContext({ bedtime: '25:00' }), /HH:MM/);
    assert.throws(() => normalizeContext({ load: 'max' }), /không hợp lệ/);
  });
  test('save, read back, empty deletes, no future dates', () => {
    const db = openDb(tmp());
    const u = createUser(db, { username: 'ctx', displayName: 'C', password: 'pwlong123' });
    saveContext(db, u, '2026-11-05', { workout: ['pickleball'], symptom: true }, { today: TODAY });
    assert.deepEqual(listContexts(db, u, '2026-11-01', TODAY).get('2026-11-05'), { workout: ['pickleball'], symptom: true });
    saveContext(db, u, '2026-11-05', {}, { today: TODAY });
    assert.equal(listContexts(db, u, '2026-11-01', TODAY).size, 0);
    assert.throws(() => saveContext(db, u, '2026-11-07', { alcohol: 1 }, { today: TODAY }), /tương lai/);
  });
  test('labels never include the private symptom field', () => {
    const labels = contextLabels({ workout: ['leg'], symptom: true, alcohol: 2 });
    assert.ok(labels.includes('Tập chân'));
    assert.ok(labels.some((l) => l.includes('Rượu bia 2')));
    assert.ok(!labels.join(' ').toLowerCase().includes('tê'));
  });
  test('legacy journal tags and late activities become factors', () => {
    const days = buildDayFacts({
      checkins: [{ local_date: '2026-10-01', tags: ['alcohol', 'stress'] }],
      activities: [{ start_date_local: '2026-10-02T19:30:00', training_load: 40 }],
    });
    assert.equal(days.get('2026-10-01').alcohol, 1);
    assert.equal(days.get('2026-10-01').work_stress, 2);
    assert.equal(days.get('2026-10-01')._logged, true);
    assert.equal(days.get('2026-10-02')._late_workout, true);
    assert.equal(days.get('2026-10-02')._logged, false);
  });
});

describe('pattern engine', () => {
  test('welch interval contains the true difference for clear data', () => {
    const w = welch([1, 1.2, 0.9, 1.1, 1.0], [0, 0.1, -0.1, 0.05, -0.05, 0]);
    assert.ok(w.lo > 0.8 && w.hi < 1.2 && Math.abs(w.diff - 1) < 0.05);
  });
  test('finds the planted leg-day effect: clear, a clear HRV drop, 2 days to recover', () => {
    const { contexts, wellness } = plantedWorld();
    const p = computePatterns({ wellness, contexts, today: TODAY });
    const leg = p.factors.find((f) => f.id === 'leg');
    assert.ok(leg, 'leg factor missing');
    assert.equal(leg.confidence, 'clear', leg.summary);
    assert.ok(leg.nEvents >= 18);
    const l1 = leg.lags[0];
    assert.ok(l1.hrv.pct < -7 && l1.hrv.pct > -25, `pct ${l1.hrv.pct}`);
    assert.ok(l1.hrv.swc <= -1);
    assert.ok(l1.rhr.diff > 1.5 && l1.rhr.diff < 4.5, `rhr ${l1.rhr.diff}`);
    assert.equal(leg.affectedDays, 2, leg.summary);
    assert.match(leg.summary, /Sau ngày tập chân/);
    assert.equal(p.factors[0].id, 'leg', 'clear effects are listed first');
  });
  test('a factor without a real effect is not called clear, even when it follows leg days', () => {
    const { contexts, wellness } = plantedWorld();
    const p = computePatterns({ wellness, contexts, today: TODAY });
    const chest = p.factors.find((f) => f.id === 'chest_back');
    assert.ok(chest);
    assert.notEqual(chest.confidence, 'clear', chest.summary);
    assert.ok(Math.abs(chest.lags[0].hrv.swc) < 1, chest.summary);
  });
  test('few events → insufficient, with a plain sentence', () => {
    const { contexts, wellness } = plantedWorld({ days: 30 });
    for (const [d, c] of contexts) if (c.workout?.includes('leg')) { contexts.delete(d); break; }
    const p = computePatterns({ wellness, contexts, today: TODAY });
    const leg = p.factors.find((f) => f.id === 'leg');
    assert.equal(leg.confidence, 'insufficient');
    assert.match(leg.summary, /cần ít nhất 4 lần/);
  });
  test('confounded factors report "thường đi kèm"', () => {
    const { contexts, wellness } = plantedWorld();
    for (const [d, c] of contexts) if (c.workout?.includes('leg')) contexts.set(d, { ...c, sauna: 'evening' });
    const p = computePatterns({ wellness, contexts, today: TODAY });
    const leg = p.factors.find((f) => f.id === 'leg');
    assert.ok(leg.oftenWith, 'expected an "often with" companion');
    assert.match(leg.oftenWith.label, /Xông hơi/);
  });
  test('rigid weekly plan: a factor that always coincides with another is "chưa tách được", never clear', () => {
    const { wellness } = plantedWorld();
    const contexts = new Map();
    const start = addDays(TODAY, -140);
    for (let i = 0; i <= 140; i++) {
      const w = i % 7;
      // shoulders always exactly 2 days before legs → "leg 1 day ago" == "shoulders 3 days ago"
      contexts.set(addDays(start, i), w === 3 ? { workout: ['leg'] } : w === 1 ? { workout: ['shoulder_arm'] } : { workout: ['rest'] });
    }
    const p = computePatterns({ wellness, contexts, today: TODAY });
    const leg = p.factors.find((f) => f.id === 'leg');
    assert.ok(leg.inseparable, leg.summary);
    assert.equal(leg.inseparable.id, 'shoulder_arm');
    assert.equal(leg.confidence, 'unclear');
    assert.match(leg.summary, /Chưa tách được/);
  });
  test('sick days are left out of outcomes', () => {
    const { wellness } = plantedWorld({ days: 40 });
    const sick = new Set([wellness[30].date]);
    const o = morningOutcomes(wellness, { sickDates: sick });
    assert.equal(o.has(wellness[30].date), false);
  });
  test('symptom days are counted but never become a pattern', () => {
    const { contexts, wellness } = plantedWorld({ days: 60 });
    let n = 0;
    for (const [d, c] of contexts) if (n < 5 && c.workout?.includes('leg')) { contexts.set(d, { ...c, symptom: true }); n++; }
    const p = computePatterns({ wellness, contexts, today: TODAY });
    assert.equal(p.symptomDays, 5);
    assert.ok(!p.factors.some((f) => f.id === 'symptom'));
  });
});

describe('unusual readings', () => {
  const base = () => {
    const rows = [];
    for (let i = 60; i >= 0; i--) rows.push({ date: addDays(TODAY, -i), hrv_rmssd: 60 * Math.exp(0.05 * noise(i, 5)), resting_hr: 52 + 0.6 * noise(i, 9), sleep_secs: 27000 });
    return rows;
  };
  test('one very high HRV night: flagged, not rewarded, no doctor note', () => {
    const w = base();
    w[w.length - 1].hrv_rmssd = 140;
    const a = unusualReadings(w, TODAY);
    assert.equal(a.hrvHigh, true);
    assert.equal(a.doctor, null);
    const r = computeRecovery({ wellness: w, today: TODAY, checkin: null });
    const f = r.factors.find((x) => x.key === 'hrv');
    assert.equal(f.suspectHigh, true);
    assert.ok(f.subscore <= 50, `HRV must not add points (got ${f.subscore})`);
    assert.match(f.text, /không được cộng điểm/);
  });
  test('two high HRV nights in a row → "nên hỏi bác sĩ"', () => {
    const w = base();
    w[w.length - 1].hrv_rmssd = 140;
    w[w.length - 2].hrv_rmssd = 135;
    const a = unusualReadings(w, TODAY);
    assert.equal(a.hrvHighNights, 2);
    assert.match(a.doctor.text, /Nên hỏi bác sĩ\.$/);
  });
  test('resting HR up ≥ 5 bpm for 3 days → doctor note; 2 days → none', () => {
    const w = base();
    for (const k of [1, 2]) w[w.length - k].resting_hr = 60;
    assert.equal(unusualReadings(w, TODAY).doctor, null);
    w[w.length - 3].resting_hr = 60;
    const a = unusualReadings(w, TODAY);
    assert.equal(a.rhrHighDays, 3);
    assert.match(a.doctor.text, /nhịp tim nghỉ/i);
    const r = computeRecovery({ wellness: w, today: TODAY, checkin: null });
    assert.ok(r.alerts.doctor);
  });
});

describe('AI guard layer', () => {
  test('medical and intensity-pushing sentences are removed', () => {
    const g = guardOutput('HRV thấp hơn nền. Bạn nên tăng tạ hôm nay. Warfarin có thể làm vậy. Có thể cân nhắc buổi nhẹ.');
    assert.equal(g.text, 'HRV thấp hơn nền. Có thể cân nhắc buổi nhẹ.');
    assert.equal(g.filtered, true);
    assert.equal(g.removed, 2);
  });
  test('all sentences removed → fixed fallback', () => {
    assert.equal(guardOutput('Van tim của bạn ổn. Hãy đẩy mạnh.').text, FALLBACK_REPLY);
  });
  test('medical questions are detected', () => {
    for (const q of ['Thuốc warfarin có ảnh hưởng HRV?', 'INR cao thì sao', 'van cơ học có sao không', 'tôi có bị rung nhĩ?']) assert.ok(isMedicalQuestion(q), q);
    assert.ok(!isMedicalQuestion('Tuần này nên tập chân ngày nào?'));
  });
  test('the packet carries numbers and labels only: no name, note or symptom', () => {
    const { contexts, wellness } = plantedWorld({ days: 40 });
    const y = addDays(TODAY, -1);
    contexts.set(y, { workout: ['leg'], symptom: true });
    const recovery = computeRecovery({ wellness, today: TODAY, checkin: null });
    const packet = buildPacket({ today: TODAY, recovery, advice: { label: 'Có thể theo kế hoạch vừa sức' }, wellness, history: [], contexts, patterns: computePatterns({ wellness, contexts, today: TODAY }) });
    const s = JSON.stringify(packet);
    assert.ok(packet.boi_canh_cac_ngay.some((d) => d.ngay === y && d.boi_canh.includes('Tập chân')));
    for (const banned of ['symptom', 'tê', 'run sau tập', 'displayName', 'username', 'note', 'Hyden']) assert.ok(!s.includes(banned), banned);
    assert.ok(packet.so_lieu_theo_ngay.length <= 14);
  });
  test('API key is never part of the config object', () => {
    const cfg = aiConfig({ ANTHROPIC_API_KEY: 'sk-ant-secret-123' });
    assert.equal(cfg.configured, true);
    assert.ok(!JSON.stringify(cfg).includes('sk-ant-secret-123'));
  });
});

describe('runAi', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-test-key', AI_USER_DAILY_CALLS: '2', AI_GLOBAL_DAILY_CALLS: '50' };
  function fakeFetch(text = 'Điểm hôm nay thấp vì HRV giảm. Có thể cân nhắc nghỉ.') {
    const calls = [];
    const fn = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 100 } }) };
    };
    fn.calls = calls;
    return fn;
  }
  const setup = () => {
    const db = openDb(tmp());
    const u = createUser(db, { username: 'aitest', displayName: 'Tên Riêng', password: 'pwlong123' });
    return { db, u };
  };
  test('calls the Messages API with the key in the header only, logs usage and cost', async () => {
    const { db, u } = setup();
    const f = fakeFetch();
    const out = await runAi({ db, userId: u, kind: 'explain', packet: { diem_hoi_phuc: 40 }, cacheKey: 'k1', fetchImpl: f, env });
    assert.equal(out.cached, false);
    assert.equal(f.calls.length, 1);
    const { url, init } = f.calls[0];
    assert.match(url, /\/v1\/messages$/);
    assert.equal(init.headers['x-api-key'], 'sk-test-key');
    assert.equal(init.headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.ok(!init.body.includes('sk-test-key'));
    assert.ok(!JSON.stringify(out).includes('sk-test-key'));
    const row = db.prepare('SELECT * FROM ai_usage').get();
    assert.equal(row.input_tokens, 1000);
    assert.ok(Math.abs(row.cost_usd - (1000 * 0.1 + 100 * 0.5) / 1e6) < 1e-12);
  });
  test('asks for low effort and has room to think; empty answers are errors, not cached', async () => {
    const { db, u } = setup();
    const f = fakeFetch();
    await runAi({ db, userId: u, kind: 'explain', packet: {}, cacheKey: 'e1', fetchImpl: f, env });
    const body = JSON.parse(f.calls[0].init.body);
    assert.deepEqual(body.output_config, { effort: 'low' });
    assert.ok(body.max_tokens >= 1500);
    const thinkingOnly = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'thinking', thinking: '...' }], stop_reason: 'max_tokens', usage: { input_tokens: 10, output_tokens: 2000 } }) });
    await assert.rejects(runAi({ db, userId: u, kind: 'explain', packet: { x: 1 }, cacheKey: 'e2', fetchImpl: thinkingOnly, env }), (e) => e.kind === 'empty' && /hết giới hạn/.test(e.message));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_cache WHERE cache_key='e2'").get().n, 0);
  });
  test('a fully filtered answer is shown but not cached, so the next click retries', async () => {
    const { db, u } = setup();
    const bad = fakeFetch('Van tim của bạn ổn. Hãy đẩy mạnh.');
    const first = await runAi({ db, userId: u, kind: 'explain', packet: {}, cacheKey: 'f1', fetchImpl: bad, env });
    assert.equal(first.text, FALLBACK_REPLY);
    const good = fakeFetch('Ngủ ít làm điểm giảm.');
    const second = await runAi({ db, userId: u, kind: 'explain', packet: {}, cacheKey: 'f1', fetchImpl: good, env });
    assert.equal(second.cached, false);
    assert.equal(second.text, 'Ngủ ít làm điểm giảm.');
  });
  test('second identical request is served from cache without a call', async () => {
    const { db, u } = setup();
    const f = fakeFetch();
    await runAi({ db, userId: u, kind: 'explain', packet: {}, cacheKey: 'same', fetchImpl: f, env });
    const again = await runAi({ db, userId: u, kind: 'explain', packet: {}, cacheKey: 'same', fetchImpl: f, env });
    assert.equal(again.cached, true);
    assert.equal(f.calls.length, 1);
  });
  test('per-user daily cap', async () => {
    const { db, u } = setup();
    const f = fakeFetch();
    await runAi({ db, userId: u, kind: 'ask', question: 'Hôm nay sao?', packet: {}, fetchImpl: f, env });
    await runAi({ db, userId: u, kind: 'ask', question: 'Còn mai?', packet: {}, fetchImpl: f, env });
    await assert.rejects(runAi({ db, userId: u, kind: 'ask', question: 'Lần ba?', packet: {}, fetchImpl: f, env }), (e) => e.kind === 'cap_user' && e.status === 429);
  });
  test('medical question answered locally, no API call, no usage', async () => {
    const { db, u } = setup();
    const f = fakeFetch();
    const out = await runAi({ db, userId: u, kind: 'ask', question: 'Uống warfarin có làm HRV thấp?', packet: {}, fetchImpl: f, env });
    assert.equal(out.text, MEDICAL_REPLY);
    assert.equal(f.calls.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_usage').get().n, 0);
  });
  test('model output is guarded before it is cached or returned', async () => {
    const { db, u } = setup();
    const f = fakeFetch('Ngủ ít làm điểm giảm. Nên đẩy mạnh buổi chân. Van tim không sao.');
    const out = await runAi({ db, userId: u, kind: 'explain', packet: {}, cacheKey: 'g', fetchImpl: f, env });
    assert.equal(out.text, 'Ngủ ít làm điểm giảm.');
    assert.equal(db.prepare("SELECT text FROM ai_cache WHERE cache_key='g'").get().text, 'Ngủ ít làm điểm giảm.');
  });
  test('quarter uses Sonnet and has a monthly cap', async () => {
    const { db, u } = setup();
    const f = fakeFetch();
    const e2 = { ...env, AI_USER_DAILY_CALLS: '20', AI_DEEP_PER_MONTH: '1' };
    await runAi({ db, userId: u, kind: 'quarter', packet: {}, fetchImpl: f, env: e2 });
    assert.equal(JSON.parse(f.calls[0].init.body).model, 'claude-sonnet-5-5');
    await assert.rejects(runAi({ db, userId: u, kind: 'quarter', packet: {}, fetchImpl: f, env: e2 }), (e) => e.kind === 'cap_deep');
  });
  test('no key → not_configured, nothing sent', async () => {
    const { db, u } = setup();
    const f = fakeFetch();
    await assert.rejects(runAi({ db, userId: u, kind: 'explain', packet: {}, fetchImpl: f, env: {} }), (e) => e.kind === 'not_configured');
    assert.equal(f.calls.length, 0);
  });
  test('401 from the API becomes a clear auth error', async () => {
    const { db, u } = setup();
    const f = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await assert.rejects(runAi({ db, userId: u, kind: 'explain', packet: {}, fetchImpl: f, env }), (e) => e.kind === 'auth');
  });
  test('weekly window: Sunday 18:00 local starts the new week', () => {
    assert.equal(weeklyWindow(new Date('2026-11-06T03:00:00Z')).weekEnd, '2026-11-01'); // Fri
    assert.equal(weeklyWindow(new Date('2026-11-08T10:00:00Z')).weekEnd, '2026-11-01'); // Sun 17:00 local
    assert.equal(weeklyWindow(new Date('2026-11-08T12:00:00Z')).weekEnd, '2026-11-08'); // Sun 19:00 local
  });
});

describe('Cloudflare hardening', () => {
  test('login limiter locks after 8 failures and resets on success', () => {
    let t = 0;
    const l = createLoginLimiter({ max: 8, windowMs: 1000, now: () => t });
    const keys = ['ip:1.2.3.4', 'user:hyden'];
    for (let i = 0; i < 8; i++) l.fail(keys);
    assert.equal(l.blocked(keys), true);
    assert.equal(l.blocked(['ip:9.9.9.9', 'user:hyden']), true, 'same username from another IP is still blocked');
    t = 1500;
    assert.equal(l.blocked(keys), false);
    l.fail(keys); l.reset(keys);
    assert.equal(l.blocked(keys), false);
  });
  test('proxy headers are trusted only with TRUST_PROXY=1', () => {
    const req = { headers: { 'cf-connecting-ip': '5.6.7.8', 'x-forwarded-proto': 'https' }, socket: { remoteAddress: '127.0.0.1' } };
    delete process.env.TRUST_PROXY; delete process.env.COOKIE_SECURE;
    assert.equal(clientIp(req), '127.0.0.1');
    assert.equal(isHttps(req), false);
    process.env.TRUST_PROXY = '1';
    assert.equal(clientIp(req), '5.6.7.8');
    assert.equal(isHttps(req), true);
    delete process.env.TRUST_PROXY;
  });
  test('.env parser: comments, quotes, export', () => {
    const v = parseEnv('# c\nexport A=1\nB="x y"\nC=z # note\nbad line\n');
    assert.deepEqual(v, { A: '1', B: 'x y', C: 'z' });
  });
});
