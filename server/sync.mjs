/**
 * Sync engine. Pulls wellness + activities from Intervals.icu and upserts into
 * the local DB. Never touches upstream. Errors are captured so a failed sync
 * leaves existing data intact and tells the user why.
 *
 * Windows:
 *   initial sync  = 120 days back (enough to seed baselines)
 *   incremental   = last-sync minus 7 days, so late-arriving records are picked up.
 */
import { fetchWellness, fetchActivities, IcuError } from './icu.mjs';
import { upsertWellness, upsertActivity, getIcuKey, markSync } from './store.mjs';
import { localDate } from './db.mjs';

function addLocalDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function firstDayOfLocal(now = new Date()) {
  return localDate(now);
}

export async function syncUser(db, userId, dataKeyHex, { backDays = null, logger = () => {} } = {}) {
  const creds = getIcuKey(db, userId, dataKeyHex);
  if (!creds || !creds.apiKey) {
    markSync(db, userId, { ok: false, error: 'Chưa cấu hình API key Intervals.icu.' });
    return { ok: false, error: 'Chưa cấu hình API key.', skipped: true };
  }
  const user = db.prepare('SELECT last_sync_at FROM users WHERE id = ?').get(userId);
  const today = firstDayOfLocal();
  let oldest;
  if (backDays) oldest = addLocalDays(today, -backDays);
  else if (user?.last_sync_at) oldest = addLocalDays(String(user.last_sync_at).slice(0, 10), -7);
  else oldest = addLocalDays(today, -120);

  const stats = { oldest, newest: today, wellness: { pulled: 0, written: 0 }, activities: { pulled: 0, written: 0 } };
  try {
    const w = await fetchWellness(creds.athleteId, creds.apiKey, { oldest, newest: today });
    stats.wellness.pulled = w.length;
    for (const rec of w) if (upsertWellness(db, userId, rec)) stats.wellness.written++;
    const a = await fetchActivities(creds.athleteId, creds.apiKey, { oldest, newest: today });
    stats.activities.pulled = a.length;
    for (const rec of a) if (upsertActivity(db, userId, rec)) stats.activities.written++;
    markSync(db, userId, { ok: true });
    logger(`Sync user ${userId}: ${stats.wellness.written} wellness, ${stats.activities.written} activities.`);
    return { ok: true, stats };
  } catch (err) {
    const kind = err instanceof IcuError ? err.kind : 'unknown';
    const msg = err?.message || String(err);
    markSync(db, userId, { ok: false, error: `[${kind}] ${msg}` });
    logger(`Sync user ${userId} FAILED [${kind}]: ${msg}`);
    return { ok: false, kind, error: msg, stats };
  }
}
