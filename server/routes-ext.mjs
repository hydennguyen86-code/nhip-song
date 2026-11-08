/**
 * Routes for daily context, patterns and the AI layer.
 * Kept out of index.mjs so the core server stays readable.
 *
 * Every route works on the signed-in user's own data only.
 */
import { localDate } from './db.mjs';
import { effectiveWellness, listActivitiesRange, latestCheckin, listCheckins, getAdviceSettings } from './store.mjs';
import { buildAdvice } from './advice.mjs';
import { computeRecovery, recoveryHistory, addDays } from './recovery.mjs';
import { sickDatesFrom } from './signals.mjs';
import { CONTEXT_FIELDS, saveContext, getContext, listContexts, contextLabels } from './context.mjs';
import { computePatterns } from './patterns.mjs';
import { analyzeSleepStructure } from './sleep-structure.mjs';
import { listNights, appleBedtimes } from './apple-health.mjs';
import { aiConfig, buildPacket, runAi, hashPacket, usageSummary, weeklyWindow, cached, AiError } from './ai.mjs';

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

/** Everything the patterns and AI views need, computed once per request. */
export function userBundle(db, userId, today = localDate(), { historyDays = 30, contextDays = 400 } = {}) {
  const wellness = effectiveWellness(db, userId, '1900-01-01', today);
  const activities = listActivitiesRange(db, userId, addDays(today, -contextDays), today);
  const checkins = listCheckins(db, userId, 500);
  const sickDates = sickDatesFrom(checkins);
  const checkin = latestCheckin(db, userId, today);
  const settings = getAdviceSettings(db, userId);
  const contexts = listContexts(db, userId, addDays(today, -contextDays), today);
  const recovery = computeRecovery({ wellness, today, checkin, settings, activities, sickDates });
  const advice = buildAdvice({ today, wellness, activities, checkin, settings, sickDates });
  const history = recoveryHistory({ wellness, today, days: historyDays, settings, checkins, activities });
  const bedtimes = appleBedtimes(db, userId, addDays(today, -contextDays), today);
  const patterns = computePatterns({ wellness, contexts, checkins, activities, bedtimes, sickDates, today });
  return { today, wellness, activities, checkins, sickDates, contexts, recovery, advice, history, patterns };
}

function activitySummary(activities, date) {
  return activities
    .filter((a) => String(a.start_date_local).slice(0, 10) === date)
    .map((a) => ({
      name: a.name || a.type || 'Buổi tập',
      type: a.type || null,
      start: String(a.start_date_local).slice(11, 16) || null,
      minutes: a.moving_time ? Math.round(a.moving_time / 60) : null,
      load: a.training_load != null ? Math.round(a.training_load) : null,
    }));
}

function aiFail(json, res, err) {
  if (err instanceof AiError) return json(res, err.status, { error: err.message, kind: err.kind });
  throw err;
}

/** @returns {Promise<boolean>} true when the request was handled here. */
export async function handleExtRoutes({ p, method, u, req, res, db, json, readJson, requireUser, log = () => {} }) {
  // ---------- daily context ----------
  if (p === '/api/context' && method === 'GET') {
    if (!requireUser(req, res)) return true;
    const today = localDate();
    const date = isDate(u.searchParams.get('date')) ? u.searchParams.get('date') : addDays(today, -1);
    const acts = listActivitiesRange(db, req.user.id, addDays(today, -21), today);
    const ctx = listContexts(db, req.user.id, addDays(today, -21), today);
    const recent = [];
    for (let i = 1; i <= 14; i++) {
      const d = addDays(today, -i);
      const c = ctx.get(d) || null;
      recent.push({ date: d, logged: Boolean(c), labels: contextLabels(c), activities: activitySummary(acts, d).length });
    }
    json(res, 200, {
      date,
      today,
      data: getContext(db, req.user.id, date) || {},
      apple: appleBedtimes(db, req.user.id, date, date).get(date) || null,
      activities: activitySummary(listActivitiesRange(db, req.user.id, date, date), date),
      fields: CONTEXT_FIELDS,
      recent,
    });
    return true;
  }
  if (p === '/api/context' && method === 'POST') {
    if (!requireUser(req, res)) return true;
    const body = await readJson(req);
    const today = localDate();
    if (!isDate(body.date)) { json(res, 400, { error: 'Ngày không hợp lệ.' }); return true; }
    if (body.date < addDays(today, -60)) { json(res, 400, { error: 'Chỉ ghi bù tối đa 60 ngày.' }); return true; }
    try {
      const data = saveContext(db, req.user.id, body.date, body.data || {}, { today });
      json(res, 200, { ok: true, date: body.date, data: data || {}, labels: contextLabels(data) });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
    return true;
  }

  // ---------- patterns ----------
  if (p === '/api/patterns' && method === 'GET') {
    if (!requireUser(req, res)) return true;
    const b = userBundle(db, req.user.id);
    const nights = listNights(db, req.user.id, addDays(b.today, -400), b.today);
    const sleepStructure = analyzeSleepStructure({ nights, wellness: b.wellness, sickDates: b.sickDates });
    json(res, 200, { ...b.patterns, sleepStructure, today: b.today });
    return true;
  }

  // ---------- AI ----------
  if (p === '/api/ai/status' && method === 'GET') {
    if (!requireUser(req, res)) return true;
    const cfg = aiConfig();
    json(res, 200, {
      configured: cfg.configured,
      model: cfg.model,
      deepModel: cfg.deepModel,
      limits: { userDailyCalls: cfg.userDailyCalls, globalDailyCalls: cfg.globalDailyCalls, deepPerMonth: cfg.deepPerMonth },
      price: cfg.price,
      usage: usageSummary(db, req.user.id),
      server: req.user.role === 'admin' ? usageSummary(db, null) : undefined,
      weekly: weeklyWindow(),
    });
    return true;
  }
  if (p === '/api/ai/explain' && method === 'POST') {
    if (!requireUser(req, res)) return true;
    const b = userBundle(db, req.user.id);
    if (b.recovery.needsHrv) { json(res, 200, { text: b.recovery.note, local: true }); return true; }
    const packet = buildPacket(b);
    try {
      const out = await runAi({ db, userId: req.user.id, kind: 'explain', packet, cacheKey: `${b.today}:${hashPacket(packet)}` });
      json(res, 200, out);
    } catch (err) { aiFail(json, res, err); }
    return true;
  }
  if (p === '/api/ai/ask' && method === 'POST') {
    if (!requireUser(req, res)) return true;
    const body = await readJson(req);
    const b = userBundle(db, req.user.id);
    const packet = buildPacket({ ...b, days: 28 });
    try {
      const out = await runAi({ db, userId: req.user.id, kind: 'ask', packet, question: body.question });
      json(res, 200, out);
    } catch (err) { aiFail(json, res, err); }
    return true;
  }
  if (p === '/api/ai/weekly' && method === 'GET') {
    if (!requireUser(req, res)) return true;
    const w = weeklyWindow();
    const cfg = aiConfig();
    const b = userBundle(db, req.user.id, w.weekEnd);
    const packet = { tuan: `${w.weekStart} → ${w.weekEnd}`, ...buildPacket({ ...b, days: 14 }) };
    if (u.searchParams.get('generate') !== '1') {
      const hit = cached(db, req.user.id, 'weekly', w.weekEnd);
      json(res, 200, hit
        ? { available: true, ...w, text: hit.text, cached: true, model: hit.model, createdAt: hit.created_at }
        : { available: false, reason: cfg.configured ? 'not_generated' : 'not_configured', ...w });
      return true;
    }
    try {
      const out = await runAi({ db, userId: req.user.id, kind: 'weekly', packet, cacheKey: w.weekEnd });
      json(res, 200, { available: true, ...w, ...out });
    } catch (err) { aiFail(json, res, err); }
    return true;
  }
  if (p === '/api/ai/quarter' && method === 'POST') {
    if (!requireUser(req, res)) return true;
    const b = userBundle(db, req.user.id, localDate(), { historyDays: 90 });
    const packet = buildPacket({ ...b, days: 90 });
    try {
      const out = await runAi({ db, userId: req.user.id, kind: 'quarter', packet, cacheKey: `${b.today}:${hashPacket(packet)}` });
      json(res, 200, out);
    } catch (err) { aiFail(json, res, err); }
    return true;
  }
  return false;
}
