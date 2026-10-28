/**
 * Nhịp Sống — HTTP server.
 * Zero npm dependencies: node:http + node:sqlite + node:crypto.
 *
 * Runs on the LAN. Binds to 0.0.0.0 by default so the iPhone can reach it, but
 * the router ports are NEVER opened. Do not expose this to the Internet.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, dataKey, localDate, localIso, getConfig, setConfig } from './db.mjs';
import { createSession, sessionUser, destroySession, parseCookies, sessionCookie, clearCookie, SESSION_COOKIE, purgeExpiredSessions } from './auth.mjs';
import { findUser, getUser, listUsers, createUser, setPassword, saveIcuKey, getIcuKey, clearIcuKey, upsertWellness, upsertActivity, effectiveWellness, listActivitiesRange, listWellnessRange, addCheckin, latestCheckin, listCheckins, excludeField, includeField, listExclusions, markSync, getAdviceSettings, setAdviceSettings } from './store.mjs';
import { syncUser } from './sync.mjs';
import { buildAdvice } from './advice.mjs';
import { computeRecovery, recoveryHistory, buildSleepPlan, buildLoadTarget, buildMetrics, addDays, ACTIONS } from './recovery.mjs';
import { JOURNAL_TAGS, normalizeTags, buildJournalInsights } from './journal.mjs';
import { previewWellness, previewActivities } from './csv.mjs';
import { computeBaselines } from './baseline.mjs';
import { startScheduler, getSchedule, setSchedule } from './scheduler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.NHIP_DATA_DIR || path.join(ROOT, 'data');

const db = openDb(DATA_DIR);
const key = dataKey(DATA_DIR);

// ---------- helpers ----------
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function text(res, status, s) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(s); }
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => { total += c.length; if (total > limit) { reject(new Error('Payload quá lớn.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON không hợp lệ.'); }
}
async function readForm(req) {
  const raw = await readBody(req);
  const out = {};
  for (const kv of raw.split('&')) {
    if (!kv) continue;
    const [k, v = ''] = kv.split('=');
    out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

function attachUser(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  req.user = token ? sessionUser(db, token) : null;
  req.token = token;
}

function requireUser(req, res) {
  if (!req.user) { json(res, 401, { error: 'Chưa đăng nhập.' }); return false; }
  if (req.user.must_change_pw) { json(res, 403, { error: 'Cần đổi mật khẩu trước.', mustChangePw: true }); return false; }
  return true;
}
function requireAdmin(req, res) {
  if (!requireUser(req, res)) return false;
  if (req.user.role !== 'admin') { json(res, 403, { error: 'Cần quyền quản trị.' }); return false; }
  return true;
}

function ip(req) {
  return req.socket?.remoteAddress || '';
}

/** The qualitative verdict wins over the index band when wording today's action. */
function adviceAction(verdict, fallback) {
  return ACTIONS[verdict] || fallback;
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ---------- static ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Không tìm thấy trang.'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

// ---------- routes ----------
async function route(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const method = req.method;
  attachUser(req, res);

  // --- auth ---
  if (p === '/api/login' && method === 'POST') {
    const body = await readJson(req);
    const username = String(body.username || '').toLowerCase().trim();
    const password = String(body.password || '');
    const user = findUser(db, username);
    if (!user) { await delay(500); return json(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' }); }
    const { verifyPassword } = await import('./auth.mjs');
    if (!verifyPassword(password, user.pw_hash)) return json(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
    const token = createSession(db, user.id);
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: false }));
    return json(res, 200, { ok: true, user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role, mustChangePw: !!user.must_change_pw } });
  }
  if (p === '/api/logout' && method === 'POST') {
    if (req.token) destroySession(db, req.token);
    res.setHeader('Set-Cookie', clearCookie());
    return json(res, 200, { ok: true });
  }
  if (p === '/api/me' && method === 'GET') {
    if (!req.user) return json(res, 401, { error: 'Chưa đăng nhập.' });
    return json(res, 200, { user: { id: req.user.id, username: req.user.username, displayName: req.user.display_name, role: req.user.role, mustChangePw: !!req.user.must_change_pw } });
  }
  if (p === '/api/change-password' && method === 'POST') {
    if (!req.user) return json(res, 401, { error: 'Chưa đăng nhập.' });
    const body = await readJson(req);
    const { verifyPassword } = await import('./auth.mjs');
    if (!verifyPassword(String(body.current || ''), req.user.pw_hash)) return json(res, 401, { error: 'Mật khẩu hiện tại không đúng.' });
    try { setPassword(db, req.user.id, String(body.next || '')); } catch (e) { return json(res, 400, { error: e.message }); }
    return json(res, 200, { ok: true });
  }

  // --- setup (bootstrap one admin) ---
  if (p === '/api/setup-status' && method === 'GET') {
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    return json(res, 200, { needSetup: count === 0, count });
  }
  if (p === '/api/setup-admin' && method === 'POST') {
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (count > 0) return json(res, 403, { error: 'Đã có tài khoản. Không tạo thêm admin công khai.' });
    const body = await readJson(req);
    try {
      const id = createUser(db, { username: body.username, displayName: body.displayName || body.username, password: body.password, role: 'admin' });
      const token = createSession(db, id);
      res.setHeader('Set-Cookie', sessionCookie(token));
      return json(res, 200, { ok: true, id });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // --- family user management (admin only) ---
  if (p === '/api/users' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, { users: listUsers(db) });
  }
  if (p === '/api/users' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    try {
      const id = createUser(db, { username: body.username, displayName: body.displayName || body.username, password: body.password, role: body.role === 'admin' ? 'admin' : 'member', mustChangePw: 1 });
      return json(res, 200, { ok: true, id });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // --- icu config ---
  if (p === '/api/config/icu' && method === 'GET') {
    if (!requireUser(req, res)) return;
    const row = db.prepare('SELECT icu_athlete_id AS athleteId, icu_key_cipher IS NOT NULL AS hasKey, last_sync_at AS lastSync, last_sync_error AS lastError FROM users WHERE id = ?').get(req.user.id);
    return json(res, 200, { athleteId: row.athleteId || '', hasKey: !!row.hasKey, lastSync: row.lastSync, lastError: row.lastError });
  }
  if (p === '/api/config/icu' && method === 'POST') {
    if (!requireUser(req, res)) return;
    const body = await readJson(req);
    const athleteId = String(body.athleteId || '').trim();
    const apiKey = String(body.apiKey || '').trim();
    if (!athleteId || !apiKey) return json(res, 400, { error: 'Cả athlete ID và API key đều bắt buộc.' });
    // verify before saving so a typo does not lock them out
    const { fetchAthlete } = await import('./icu.mjs');
    try {
      const info = await fetchAthlete(athleteId, apiKey);
      saveIcuKey(db, req.user.id, { athleteId, apiKey, dataKeyHex: key });
      return json(res, 200, { ok: true, name: info?.name || '' });
    } catch (e) {
      return json(res, 400, { error: e.message || 'Không kết nối được Intervals.icu.' });
    }
  }
  if (p === '/api/config/icu' && method === 'DELETE') {
    if (!requireUser(req, res)) return;
    clearIcuKey(db, req.user.id);
    return json(res, 200, { ok: true });
  }

  // --- sync now ---
  if (p === '/api/sync' && method === 'POST') {
    if (!requireUser(req, res)) return;
    const body = await readJson(req);
    const r = await syncUser(db, req.user.id, key, { backDays: Number(body.backDays) || null, logger: log });
    if (r.ok) return json(res, 200, r);
    return json(res, 400, r);
  }

  // --- morning advice ---
  if (p === '/api/advice' && method === 'GET') {
    if (!requireUser(req, res)) return;
    const today = localDate();
    const wellness = effectiveWellness(db, req.user.id, '1900-01-01', today);
    const activities = listActivitiesRange(db, req.user.id, '1900-01-01', today);
    const checkin = latestCheckin(db, req.user.id, today);
    const settings = getAdviceSettings(db, req.user.id);
    const advice = buildAdvice({ user: req.user, today, wellness, activities, checkin, settings });
    const lastRow = db.prepare('SELECT last_sync_at AS at FROM users WHERE id = ?').get(req.user.id);
    return json(res, 200, { ...advice, lastSync: lastRow?.at || null, settings });
  }

  // --- dashboard payload: recovery index, factors, sleep plan, load, history ---
  if (p === '/api/dashboard' && method === 'GET') {
    if (!requireUser(req, res)) return;
    const today = localDate();
    const histDays = Math.max(7, Math.min(90, Number(u.searchParams.get('history')) || 30));
    const wellness = effectiveWellness(db, req.user.id, '1900-01-01', today);
    const activities = listActivitiesRange(db, req.user.id, addDays(today, -35), today);
    const checkin = latestCheckin(db, req.user.id, today);
    const settings = getAdviceSettings(db, req.user.id);

    const advice = buildAdvice({ user: req.user, today, wellness, activities, checkin, settings });
    const recovery = computeRecovery({ wellness, today, checkin, settings });
    recovery.action = adviceAction(advice.verdict, recovery.action);
    const sleepPlan = buildSleepPlan({ wellness, activities, today });
    const load = buildLoadTarget({ activities, today, band: recovery.band });
    const history = recoveryHistory({ wellness, today, days: histDays, settings, checkins: listCheckins(db, req.user.id, histDays + 7) });
    const metrics = buildMetrics({ wellness, today });

    const userRow = db.prepare('SELECT last_sync_at AS lastSync, display_name AS displayName, created_at AS createdAt FROM users WHERE id = ?').get(req.user.id);
    const first = db.prepare('SELECT MIN(date) AS first, COUNT(*) AS days FROM wellness WHERE user_id = ?').get(req.user.id);

    return json(res, 200, {
      today,
      lastSync: userRow?.lastSync || null,
      user: { displayName: userRow?.displayName || req.user.display_name },
      data: { firstDate: first?.first || null, days: first?.days || 0 },
      recovery,
      advice,
      sleepPlan,
      load,
      history,
      metrics,
      recent: activities.slice(0, 4),
      checkin: checkin || null,
      journalTags: JOURNAL_TAGS,
    });
  }

  // --- adjustable rule thresholds (spec: "có thể điều chỉnh hoặc vô hiệu hóa") ---
  if (p === '/api/advice-settings' && method === 'GET') {
    if (!requireUser(req, res)) return;
    return json(res, 200, getAdviceSettings(db, req.user.id));
  }
  if (p === '/api/advice-settings' && method === 'POST') {
    if (!requireUser(req, res)) return;
    const body = await readJson(req);
    try {
      return json(res, 200, setAdviceSettings(db, req.user.id, body));
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // --- trends (7d / 30d) ---
  if (p === '/api/trends' && method === 'GET') {
    if (!requireUser(req, res)) return;
    const days = Math.max(7, Math.min(120, Number(u.searchParams.get('days')) || 30));
    const today = localDate();
    const oldest = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - days + 1); return d.toISOString().slice(0, 10); })();
    const wellness = effectiveWellness(db, req.user.id, oldest, today);
    const activities = listActivitiesRange(db, req.user.id, oldest, today);
    return json(res, 200, { days, oldest, newest: today, wellness, activities });
  }

  // --- baseline view ---
  if (p === '/api/baseline' && method === 'GET') {
    if (!requireUser(req, res)) return;
    const today = localDate();
    const wellness = effectiveWellness(db, req.user.id, '1900-01-01', today);
    const b = computeBaselines(wellness, today);
    return json(res, 200, b);
  }

  // --- activities list ---
  if (p === '/api/activities' && method === 'GET') {
    if (!requireUser(req, res)) return;
    const days = Math.max(7, Math.min(365, Number(u.searchParams.get('days')) || 30));
    const today = localDate();
    const oldest = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); })();
    const items = listActivitiesRange(db, req.user.id, oldest, today);
    return json(res, 200, { items, days });
  }

  // --- checkin ---
  if (p === '/api/checkin' && method === 'GET') {
    if (!requireUser(req, res)) return;
    const items = listCheckins(db, req.user.id, 60);
    const today = localDate();
    const wellness = effectiveWellness(db, req.user.id, '1900-01-01', today);
    const history = recoveryHistory({ wellness, today, days: 60 });
    return json(res, 200, {
      items,
      tags: JOURNAL_TAGS,
      insights: buildJournalInsights({ checkins: items, history }),
    });
  }
  if (p === '/api/checkin' && method === 'POST') {
    if (!requireUser(req, res)) return;
    const body = await readJson(req);
    const level = String(body.level || '');
    if (!['ok', 'tired', 'sick', 'serious'].includes(level)) return json(res, 400, { error: 'Cấp độ không hợp lệ.' });
    const id = addCheckin(db, req.user.id, {
      level,
      symptoms: body.symptoms,
      redFlag: body.redFlag || level === 'serious',
      note: body.note,
      tags: normalizeTags(body.tags),
    });
    return json(res, 200, { ok: true, id });
  }

  // --- exclusions ---
  if (p === '/api/exclusions' && method === 'GET') {
    if (!requireUser(req, res)) return;
    return json(res, 200, { items: listExclusions(db, req.user.id) });
  }
  if (p === '/api/exclusions' && method === 'POST') {
    if (!requireUser(req, res)) return;
    const body = await readJson(req);
    if (!['wellness', 'activity'].includes(body.dataset)) return json(res, 400, { error: 'dataset không hợp lệ.' });
    excludeField(db, req.user.id, { dataset: body.dataset, rowKey: body.rowKey, field: body.field, reason: body.reason });
    return json(res, 200, { ok: true });
  }
  if (p === '/api/exclusions' && method === 'DELETE') {
    if (!requireUser(req, res)) return;
    const body = await readJson(req);
    includeField(db, req.user.id, { dataset: body.dataset, rowKey: body.rowKey, field: body.field });
    return json(res, 200, { ok: true });
  }

  // --- CSV import preview & commit ---
  if (p === '/api/csv/preview' && method === 'POST') {
    if (!requireUser(req, res)) return;
    const raw = await readBody(req);
    const kind = u.searchParams.get('kind') === 'activities' ? 'activities' : 'wellness';
    const preview = kind === 'activities' ? previewActivities(raw) : previewWellness(raw);
    // stash preview text in memory for commit
    const token = Math.random().toString(36).slice(2, 10);
    pendingCsv.set(token, { user: req.user.id, kind, raw, expires: Date.now() + 15 * 60_000 });
    return json(res, 200, { token, ...preview });
  }
  if (p === '/api/csv/commit' && method === 'POST') {
    if (!requireUser(req, res)) return;
    const body = await readJson(req);
    const entry = pendingCsv.get(body.token);
    if (!entry || entry.user !== req.user.id || entry.expires < Date.now()) return json(res, 400, { error: 'Preview đã hết hạn, hãy nhập lại.' });
    pendingCsv.delete(body.token);
    let written = 0;
    let skipped = 0;
    if (entry.kind === 'wellness') {
      const rows = previewWellness(entry.raw).total ? JSON.parse(JSON.stringify(previewWellness(entry.raw).sample || [])) : [];
      // We already know the shape; re-parse to get all rows.
      const all = parseAll(entry.raw, 'wellness');
      for (const rec of all) {
        if (upsertWellness(db, req.user.id, rec)) written++; else skipped++;
      }
    } else {
      const all = parseAll(entry.raw, 'activities');
      for (const rec of all) {
        if (upsertActivity(db, req.user.id, rec, 'csv')) written++; else skipped++;
      }
    }
    return json(res, 200, { ok: true, written, skipped, kind: entry.kind });
  }

  // --- schedule config ---
  if (p === '/api/schedule' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, getSchedule(db));
  }
  if (p === '/api/schedule' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    setSchedule(db, body);
    return json(res, 200, getSchedule(db));
  }

  // --- backup export ---
  if (p === '/api/backup' && method === 'GET') {
    if (!requireUser(req, res)) return;
    const dump = {
      meta: { exportedAt: localIso(), user: req.user.username, note: 'Không chứa API key.' },
      wellness: db.prepare('SELECT * FROM wellness WHERE user_id = ?').all(req.user.id),
      activities: db.prepare('SELECT * FROM activities WHERE user_id = ?').all(req.user.id),
      checkins: db.prepare('SELECT * FROM checkins WHERE user_id = ?').all(req.user.id),
      exclusions: db.prepare('SELECT * FROM exclusions WHERE user_id = ?').all(req.user.id),
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="nhip-song-backup-${req.user.username}-${localDate()}.json"` });
    res.end(JSON.stringify(dump, null, 2));
    return;
  }
  if (p === '/api/restore' && method === 'POST') {
    if (!requireUser(req, res)) return;
    const body = await readJson(req);
    let counts = { wellness: 0, activities: 0, checkins: 0 };
    for (const w of body.wellness || []) { if (upsertWellness(db, req.user.id, { date: w.date, restingHR: w.resting_hr, hrv: w.hrv_rmssd, hrvSDNN: w.hrv_sdnn, sleepSecs: w.sleep_secs, sleepScore: w.sleep_score, steps: w.steps, weight: w.weight, avgSleepingHR: w.avg_sleeping_hr, kcalConsumed: w.kcal_consumed, readiness: w.readiness, spO2: w.spo2, respiration: w.respiration })) counts.wellness++; }
    for (const a of body.activities || []) { if (upsertActivity(db, req.user.id, { id: a.activity_id, start_date_local: a.start_date_local, name: a.name, type: a.type, moving_time: a.moving_time, elapsed_time: a.elapsed_time, distance: a.distance, total_elevation_gain: a.elevation, average_heartrate: a.avg_hr, max_heartrate: a.max_hr, average_watts: a.avg_watts, icu_training_load: a.training_load, rpe: a.rpe, icu_intensity: a.intensity }, a.source || 'restore')) counts.activities++; }
    for (const c of body.checkins || []) { if (c.local_date === localDate() || true) { /* historical checkins allowed */ } }
    return json(res, 200, { ok: true, counts });
  }

  // --- status page (data freshness) ---
  if (p === '/api/status' && method === 'GET') {
    if (!requireUser(req, res)) return;
    const row = db.prepare('SELECT last_sync_at, last_sync_error, icu_athlete_id, icu_key_cipher IS NOT NULL AS hasKey FROM users WHERE id = ?').get(req.user.id);
    return json(res, 200, row);
  }

  // --- debug endpoints ---
  if (p === '/api/health') return json(res, 200, { ok: true, tz: 'Asia/Ho_Chi_Minh', now: localIso() });

  return json(res, 404, { error: 'API not found.' });
}

const pendingCsv = new Map();
// Re-parse but return ALL records — previewWellness only returns 3 samples.
function parseAll(csvText, kind) {
  const { parseCsv, detectWellnessColumns, detectActivityColumns } = csvModule;
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const header = Object.keys(rows[0]);
  if (kind === 'wellness') {
    const cols = detectWellnessColumns(header);
    if (!cols.date) return [];
    const num = (v) => { const s = String(v ?? '').trim().replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
    return rows.map((r) => ({
      date: String(r[cols.date] || '').slice(0, 10),
      restingHR: cols.restingHR ? num(r[cols.restingHR]) : null,
      hrv: cols.hrv ? num(r[cols.hrv]) : null,
      hrvSDNN: cols.hrvSDNN ? num(r[cols.hrvSDNN]) : null,
      sleepSecs: cols.sleepSecs ? num(r[cols.sleepSecs]) : null,
      sleepScore: cols.sleepScore ? num(r[cols.sleepScore]) : null,
      steps: cols.steps ? num(r[cols.steps]) : null,
      weight: cols.weight ? num(r[cols.weight]) : null,
      avgSleepingHR: cols.avgSleepingHR ? num(r[cols.avgSleepingHR]) : null,
      kcalConsumed: cols.kcalConsumed ? num(r[cols.kcalConsumed]) : null,
      readiness: cols.readiness ? num(r[cols.readiness]) : null,
      spO2: cols.spO2 ? num(r[cols.spO2]) : null,
      respiration: cols.respiration ? num(r[cols.respiration]) : null,
      source: 'csv',
    })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  }
  const cols = detectActivityColumns(header);
  const num = (v) => { const s = String(v ?? '').trim().replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
  return rows.map((r) => ({
    id: cols.id ? String(r[cols.id] || '').trim() : '',
    start_date_local: cols.start_date_local ? String(r[cols.start_date_local] || '').trim() : '',
    name: cols.name ? String(r[cols.name] || '').trim() : '',
    type: cols.type ? String(r[cols.type] || '').trim() : '',
    moving_time: cols.moving_time ? num(r[cols.moving_time]) : null,
    elapsed_time: cols.elapsed_time ? num(r[cols.elapsed_time]) : null,
    distance: cols.distance ? num(r[cols.distance]) : null,
    total_elevation_gain: cols.total_elevation_gain ? num(r[cols.total_elevation_gain]) : null,
    average_heartrate: cols.average_heartrate ? num(r[cols.average_heartrate]) : null,
    max_heartrate: cols.max_heartrate ? num(r[cols.max_heartrate]) : null,
    average_watts: cols.average_watts ? num(r[cols.average_watts]) : null,
    icu_training_load: cols.icu_training_load ? num(r[cols.icu_training_load]) : null,
    icu_intensity: cols.icu_intensity ? num(r[cols.icu_intensity]) : null,
    rpe: cols.rpe ? num(r[cols.rpe]) : null,
  })).filter((a) => a.id || a.start_date_local);
}

let csvModule;
async function loadCsv() { csvModule = await import('./csv.mjs'); }

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) {
      await route(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Method not allowed');
    serveStatic(req, res, u.pathname);
  } catch (err) {
    log('SERVER ERROR', err?.stack || err);
    if (!res.headersSent) json(res, 500, { error: 'Lỗi máy chủ. Hãy thử lại.' });
    else try { res.end(); } catch {}
  }
});

const PORT = Number(process.env.PORT || 8899);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  await loadCsv();
  purgeExpiredSessions(db);
  const scheduler = startScheduler(db, key, { logger: log });
  server.listen(PORT, HOST, () => {
    log(`Nhịp Sống đang chạy tại http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
    log(`Dữ liệu lưu tại: ${DATA_DIR}`);
  });
  process.on('SIGTERM', () => { scheduler.stop(); server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { scheduler.stop(); server.close(() => process.exit(0)); });
}
start();
