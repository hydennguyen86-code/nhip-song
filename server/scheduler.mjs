/**
 * Scheduled sync. Runs on the Mac, so the machine must be on.
 * The user can set a local Asia/Ho_Chi_Minh hour in Settings (default 06:30);
 * we check every minute and fire once per day per user.
 */
import { localDate } from './db.mjs';
import { syncUser } from './sync.mjs';
import { listUsers } from './store.mjs';
import { getConfig, setConfig } from './db.mjs';

const KEY_LAST_RUN = 'schedule.lastRunDate';
const KEY_HOUR = 'schedule.hour'; // 0-23
const KEY_MINUTE = 'schedule.minute'; // 0-59

export function getSchedule(db) {
  return {
    enabled: getConfig(db, 'schedule.enabled', '1') === '1',
    hour: Number(getConfig(db, KEY_HOUR, '6')),
    minute: Number(getConfig(db, KEY_MINUTE, '30')),
    lastRun: getConfig(db, KEY_LAST_RUN, null),
  };
}

export function setSchedule(db, { enabled, hour, minute }) {
  if (enabled !== undefined) setConfig(db, 'schedule.enabled', enabled ? '1' : '0');
  if (hour !== undefined) setConfig(db, KEY_HOUR, String(Math.max(0, Math.min(23, Number(hour) || 0))));
  if (minute !== undefined) setConfig(db, KEY_MINUTE, String(Math.max(0, Math.min(59, Number(minute) || 0))));
}

/** Start the ticker. Returns a stop() function. */
export function startScheduler(db, dataKeyHex, { logger = () => {} } = {}) {
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    const cfg = getSchedule(db);
    if (!cfg.enabled) return;
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(now).reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
    const hh = Number(parts.hour);
    const mm = Number(parts.minute);
    const today = localDate(now);
    if (hh !== cfg.hour || mm < cfg.minute) return;
    if (cfg.lastRun === today) return;
    busy = true;
    setConfig(db, KEY_LAST_RUN, today);
    try {
      const users = listUsers(db);
      for (const u of users) {
        if (stopped) break;
        const r = await syncUser(db, u.id, dataKeyHex, { logger });
        if (r.ok) logger(`scheduled sync #${u.id} → ${r.stats.wellness.written}/${r.stats.activities.written}`);
      }
    } catch (e) {
      logger('scheduled sync error: ' + e.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
  return { stop() { stopped = true; clearInterval(timer); }, tick };
}
