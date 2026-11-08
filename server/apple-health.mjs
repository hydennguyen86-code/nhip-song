/**
 * Apple Health → Nhịp Sống, pushed by an iPhone Shortcut.
 *
 * Why push: Apple Health has no web API. Only an app on the iPhone itself can
 * read it, so a Shortcut reads last night's sleep samples ("Find Health
 * Samples" → Sleep Analysis) and POSTs them here over Tailscale, with a
 * per-person secret token in the Authorization header.
 *
 * What arrives: one line per sample, "start|end|value|source", dates in
 * ISO 8601. Value is the stage label the iPhone shows (English or Vietnamese:
 * Deep/Sâu, Core/Lõi, REM, Awake/Thức, In Bed/Trên giường, Asleep/Đã ngủ) or
 * the raw HealthKit number (0 in bed, 1 asleep, 2 awake, 3 core, 4 deep, 5 REM).
 *
 * What is stored: per wake-up date, the main sleep episode reduced to minutes
 * per stage, time awake between first and last sleep, number of awakenings
 * (≥ 5 min), time in bed and efficiency. Overlapping samples (iPhone "in bed"
 * from the sleep schedule + watch stages, or two apps) are resolved minute by
 * minute: a stage beats "asleep", which beats "in bed", so nothing is counted
 * twice.
 *
 * This data is shown, not scored: it does not change the recovery index until
 * the patterns engine shows, on the person's own data, that it predicts HRV.
 */
import crypto from 'node:crypto';
import { APP_TZ, localDate } from './db.mjs';

export { APPLE_SCHEMA } from './apple-schema.mjs';


const MIN = 60_000;
/** Samples further apart than this start a new episode (a nap, or the next night). */
const EPISODE_GAP_MIN = 90;
/** An awake stretch shorter than this inside the night is not counted as an awakening. */
const AWAKENING_MIN = 5;
/** Longest episode we accept; anything longer is a broken record. */
const MAX_EPISODE_MIN = 18 * 60;
const MAX_SAMPLES = 40000;

// Priority when samples overlap the same minute: higher wins.
const RANK = { inbed: 1, asleep: 2, awake: 3, core: 4, rem: 4, deep: 4 };
const STAGE_BY_NUMBER = { 0: 'inbed', 1: 'asleep', 2: 'awake', 3: 'core', 4: 'deep', 5: 'rem' };

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().trim();

/** Stage label (any language the iPhone may be set to) → internal key, or null. */
export function stageOf(value) {
  const raw = String(value ?? '').trim();
  if (/^\d$/.test(raw)) return STAGE_BY_NUMBER[raw] || null;
  const v = fold(raw);
  if (!v) return null;
  if (/\brem\b/.test(v)) return 'rem';
  if (/deep|\bsau\b|ngu sau/.test(v)) return 'deep';
  if (/core|light|\bloi\b|\bnong\b|ngu nong|co ban/.test(v)) return 'core';
  if (/awake|\bthuc\b|tinh giac|\btinh\b/.test(v)) return 'awake';
  if (/in ?bed|tren giuong|\bgiuong\b|nam tren/.test(v)) return 'inbed';
  if (/asleep|unspecified|\bngu\b|da ngu|dang ngu/.test(v)) return 'asleep';
  return null;
}

/** ISO 8601 (with or without offset; without = app timezone) or "yyyy-MM-dd HH:mm[:ss]" → epoch ms. */
export function parseTime(s) {
  const t = String(s ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = '00', tz] = m;
  const offset = !tz ? '+07:00' : tz === 'Z' ? 'Z' : tz.includes(':') ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}${offset}`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Body → list of { start, end, stage, source }. Accepts `samples` as text
 * (one "start|end|value|source" per line) or as an array of objects.
 * Returns the parsed samples plus what could not be read, so the Shortcut can
 * show the person exactly what went wrong.
 */
export function parseSamples(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  const samples = [];
  const unknownLabels = new Set();
  let badLines = 0;
  for (const item of lines.slice(0, MAX_SAMPLES)) {
    let start; let end; let value; let source = '';
    if (item && typeof item === 'object') {
      ({ start, end, value } = item);
      source = item.source ?? '';
    } else {
      const line = String(item ?? '').trim();
      if (!line) continue;
      [start, end, value, source = ''] = line.split('|').map((x) => x.trim());
    }
    const s = parseTime(start);
    const e = parseTime(end);
    const stage = stageOf(value);
    if (s == null || e == null || e <= s || e - s > MAX_EPISODE_MIN * MIN) { badLines++; continue; }
    if (!stage) { unknownLabels.add(String(value ?? '').slice(0, 40)); continue; }
    samples.push({ start: s, end: e, stage, source: String(source).slice(0, 60) });
  }
  return { samples, unknownLabels: [...unknownLabels], badLines };
}

function hhmm(ms) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)).replace(/^24/, '00');
}

function localHour(ms) {
  return Number(hhmm(ms).slice(0, 2));
}

/** Sorted samples → episodes (groups separated by > EPISODE_GAP_MIN). */
function episodesOf(samples) {
  const sorted = [...samples].sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of sorted) {
    const cur = out[out.length - 1];
    if (cur && s.start - cur.end <= EPISODE_GAP_MIN * MIN) {
      cur.samples.push(s);
      cur.end = Math.max(cur.end, s.end);
    } else {
      out.push({ start: s.start, end: s.end, samples: [s] });
    }
  }
  return out;
}

/** One episode → minute-by-minute stages → summary numbers. */
export function summarizeEpisode(ep) {
  const n = Math.min(Math.round((ep.end - ep.start) / MIN), MAX_EPISODE_MIN);
  const minutes = new Array(n).fill(null);
  for (const s of ep.samples) {
    const from = Math.max(0, Math.round((s.start - ep.start) / MIN));
    const to = Math.min(n, Math.round((s.end - ep.start) / MIN));
    for (let i = from; i < to; i++) {
      if (!minutes[i] || RANK[s.stage] > RANK[minutes[i]]) minutes[i] = s.stage;
    }
  }
  const isSleep = (st) => st === 'deep' || st === 'core' || st === 'rem' || st === 'asleep';
  const first = minutes.findIndex(isSleep);
  let last = -1;
  for (let i = n - 1; i >= 0; i--) if (isSleep(minutes[i])) { last = i; break; }

  const count = { deep: 0, core: 0, rem: 0, asleep: 0, awake: 0 };
  let awakenings = 0;
  let run = 0;
  if (first >= 0) {
    for (let i = first; i <= last; i++) {
      const st = minutes[i];
      if (isSleep(st)) {
        count[st]++;
        if (run >= AWAKENING_MIN) awakenings++;
        run = 0;
      } else {
        // Awake, or "in bed" / a gap with no sleep recorded between first and last sleep.
        count.awake++;
        run++;
      }
    }
  }
  const asleep = count.deep + count.core + count.rem + count.asleep;
  // Deep-sleep blocks as [startMs, endMs]: WHOOP reads HRV in slow-wave sleep.
  const deepBlocks = [];
  for (let i = 0; i < n; i++) {
    if (minutes[i] !== 'deep') continue;
    let j = i;
    while (j + 1 < n && minutes[j + 1] === 'deep') j++;
    deepBlocks.push([ep.start + i * MIN, ep.start + (j + 1) * MIN]);
    i = j;
  }
  const bedFrom = minutes.findIndex((st) => st != null);
  let bedTo = -1;
  for (let i = n - 1; i >= 0; i--) if (minutes[i] != null) { bedTo = i; break; }
  const inBed = bedFrom >= 0 ? bedTo - bedFrom + 1 : 0;
  return {
    bedStart: bedFrom >= 0 ? hhmm(ep.start + bedFrom * MIN) : null,
    bedEnd: bedTo >= 0 ? hhmm(ep.start + (bedTo + 1) * MIN) : null,
    endMs: ep.start + (bedTo + 1) * MIN,
    sleepStartMs: first >= 0 ? ep.start + first * MIN : null,
    sleepEndMs: last >= 0 ? ep.start + (last + 1) * MIN : null,
    inBedMin: inBed,
    asleepMin: asleep,
    deepMin: count.deep,
    coreMin: count.core,
    remMin: count.rem,
    unspecifiedMin: count.asleep,
    awakeMin: count.awake,
    awakenings,
    efficiency: inBed > 0 ? Math.round((asleep / inBed) * 1000) / 1000 : null,
    hasStages: count.deep + count.core + count.rem > 0,
    deepBlocks,
    sources: [...new Set(ep.samples.map((s) => s.source).filter(Boolean))],
    samples: ep.samples.length,
  };
}

/**
 * Samples → one night per wake-up date (the local date the main episode ends).
 * The longest-sleep episode of a date is the night; other episodes that end
 * between 10:00 and 21:00 count as naps for that date.
 */
export function buildNights(samples) {
  const byDate = new Map();
  for (const ep of episodesOf(samples)) {
    const sum = summarizeEpisode(ep);
    if (sum.asleepMin <= 0) continue;
    const date = localDate(new Date(sum.endMs - 1));
    const list = byDate.get(date) || [];
    list.push(sum);
    byDate.set(date, list);
  }
  const nights = [];
  for (const [date, list] of byDate) {
    list.sort((a, b) => b.asleepMin - a.asleepMin);
    const [main, ...rest] = list;
    const napMin = rest.filter((e) => { const h = localHour(e.endMs - 1); return h >= 10 && h < 21; }).reduce((a, e) => a + e.asleepMin, 0);
    nights.push({ date, ...main, napMin });
  }
  return nights.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------- storage ----------------

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/** New secret for the Shortcut; replaces any old one. Only the hash is kept. */
export function issueToken(db, userId) {
  const token = 'ns_' + crypto.randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO ingest_tokens(user_id, token_hash, created_at, last_used_at) VALUES(?,?,?,NULL)
    ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, created_at=excluded.created_at, last_used_at=NULL`)
    .run(userId, hashToken(token), new Date().toISOString());
  return token;
}

export function revokeToken(db, userId) {
  db.prepare('DELETE FROM ingest_tokens WHERE user_id = ?').run(userId);
}

export function tokenInfo(db, userId) {
  const r = db.prepare('SELECT created_at AS createdAt, last_used_at AS lastUsedAt FROM ingest_tokens WHERE user_id = ?').get(userId);
  return r ? { hasToken: true, ...r } : { hasToken: false, createdAt: null, lastUsedAt: null };
}

/** "Authorization: Bearer <token>" → user id, or null. Constant-time over the hash. */
export function userForToken(db, header) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header || '').trim());
  if (!m) return null;
  const row = db.prepare('SELECT user_id FROM ingest_tokens WHERE token_hash = ?').get(hashToken(m[1]));
  if (!row) return null;
  db.prepare('UPDATE ingest_tokens SET last_used_at = ? WHERE user_id = ?').run(new Date().toISOString(), row.user_id);
  return row.user_id;
}

export function saveNight(db, userId, n, { sleepScore = null } = {}) {
  // A push covering "the last 2 days" cuts the start of the oldest night; never
  // let that partial night replace the full one stored by an earlier push.
  const old = db.prepare('SELECT samples, asleep_min, sleep_score FROM apple_sleep WHERE user_id = ? AND date = ?').get(userId, n.date);
  if (old && (n.samples || 0) < (old.samples || 0) && (n.asleepMin || 0) < (old.asleep_min || 0)) {
    if (sleepScore != null && old.sleep_score == null) db.prepare('UPDATE apple_sleep SET sleep_score = ? WHERE user_id = ? AND date = ?').run(sleepScore, userId, n.date);
    // The afternoon nap is usually seen only by the next morning's push, whose window cut this night.
    if ((n.napMin || 0) > 0) db.prepare('UPDATE apple_sleep SET nap_min = MAX(COALESCE(nap_min, 0), ?) WHERE user_id = ? AND date = ?').run(n.napMin, userId, n.date);
    return false;
  }
  const clockOf = (ms) => (Number.isFinite(ms) ? hhmm(ms) : null);
  db.prepare(`INSERT INTO apple_sleep(user_id,date,bed_start,bed_end,sleep_start,sleep_end,in_bed_min,asleep_min,deep_min,core_min,rem_min,unspecified_min,
      awake_min,awakenings,efficiency,nap_min,sleep_score,sources,samples,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,date) DO UPDATE SET bed_start=excluded.bed_start, bed_end=excluded.bed_end,
      sleep_start=COALESCE(excluded.sleep_start, apple_sleep.sleep_start), sleep_end=COALESCE(excluded.sleep_end, apple_sleep.sleep_end), in_bed_min=excluded.in_bed_min,
      asleep_min=excluded.asleep_min, deep_min=excluded.deep_min, core_min=excluded.core_min, rem_min=excluded.rem_min,
      unspecified_min=excluded.unspecified_min, awake_min=excluded.awake_min, awakenings=excluded.awakenings,
      efficiency=excluded.efficiency, nap_min=MAX(excluded.nap_min, COALESCE(apple_sleep.nap_min, 0)),
      sleep_score=COALESCE(excluded.sleep_score, apple_sleep.sleep_score),
      sources=excluded.sources, samples=excluded.samples, updated_at=excluded.updated_at`)
    .run(userId, n.date, n.bedStart, n.bedEnd, n.sleepStart ?? clockOf(n.sleepStartMs), n.sleepEnd ?? clockOf(n.sleepEndMs), n.inBedMin, n.asleepMin, n.deepMin, n.coreMin, n.remMin, n.unspecifiedMin,
      n.awakeMin, n.awakenings, n.efficiency, n.napMin || 0, sleepScore, JSON.stringify(n.sources || []), n.samples || 0, new Date().toISOString());
}

/**
 * Bedtimes for the context engine, keyed by the CONTEXT date: the evening of
 * day D is the night stored under D + 1 (wake date). The watch's sleep onset
 * is used, not the iPhone "in bed" time, which often just follows the sleep
 * schedule. Falls back to the in-bed start for nights stored before sleep
 * onset was recorded.
 */
export function appleBedtimes(db, userId, fromContextDate, toContextDate) {
  const shift = (d, k) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare('SELECT date, sleep_start, bed_start, sleep_end, bed_end FROM apple_sleep WHERE user_id = ? AND date >= ? AND date <= ?')
    .all(userId, shift(fromContextDate, 1), shift(toContextDate, 1));
  const out = new Map();
  for (const r of rows) {
    const bedtime = r.sleep_start || r.bed_start;
    if (bedtime) out.set(shift(r.date, -1), { bedtime, wake: r.sleep_end || r.bed_end || null, inBed: r.bed_start || null });
  }
  return out;
}

/** Backup row (apple_sleep columns) → stored night. Returns true when written. */
export function restoreNight(db, userId, r) {
  if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))) return false;
  let sources = [];
  try { sources = JSON.parse(r.sources || '[]'); } catch { /* keep empty */ }
  saveNight(db, userId, {
    date: r.date, bedStart: r.bed_start, bedEnd: r.bed_end, inBedMin: r.in_bed_min, asleepMin: r.asleep_min,
    deepMin: r.deep_min, coreMin: r.core_min, remMin: r.rem_min, unspecifiedMin: r.unspecified_min, awakeMin: r.awake_min,
    awakenings: r.awakenings, efficiency: r.efficiency, napMin: r.nap_min, sources, samples: r.samples,
  }, { sleepScore: numOrNull(r.sleep_score) });
  return true;
}

export function listNights(db, userId, from, to) {
  return db.prepare('SELECT * FROM apple_sleep WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date DESC').all(userId, from, to);
}

const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const dur = (min) => {
  const m = Math.round(min || 0);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};
const ddmm = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/**
 * Handle one push from the Shortcut. `body` = { samples, sleepScore? }.
 * Returns the response object; `message` is a one-line Vietnamese summary the
 * Shortcut shows as a notification.
 */
export function ingest(db, userId, body = {}) {
  const { samples, unknownLabels, badLines } = parseSamples(body.samples);
  if (!samples.length) {
    const why = unknownLabels.length
      ? `Không nhận ra nhãn giai đoạn ngủ: ${unknownLabels.join(', ')}.`
      : badLines
        ? `${badLines} dòng sai định dạng ngày. Ở bước "Định dạng ngày" hãy chọn ISO 8601 và bật "Bao gồm thời gian".`
        : 'Không có mẫu giấc ngủ nào trong khoảng thời gian đã chọn.';
    return { ok: false, status: 400, error: why, unknownLabels, badLines, nights: [], message: why };
  }
  const nights = buildNights(samples);
  let score = numOrNull(body.sleepScore);
  if (score != null && (score < 0 || score > 100)) score = null;
  const newest = nights[nights.length - 1]?.date;
  for (const n of nights) saveNight(db, userId, n, { sleepScore: n.date === newest ? score : null });
  const last = nights[nights.length - 1];
  const message = last
    ? `Đêm ${ddmm(last.date)}: ngủ ${dur(last.asleepMin)}${last.hasStages ? ` (sâu ${dur(last.deepMin)}, REM ${dur(last.remMin)})` : ''}, thức ${Math.round(last.awakeMin)} phút, ${last.awakenings} lần tỉnh.${nights.length > 1 ? ` Cập nhật ${nights.length} đêm.` : ''}`
    : 'Đã nhận dữ liệu nhưng không có đêm ngủ nào đủ dài.';
  return {
    ok: true,
    status: 200,
    message,
    nights: nights.map((n) => ({ date: n.date, bedStart: n.bedStart, bedEnd: n.bedEnd, asleepMin: n.asleepMin, deepMin: n.deepMin, coreMin: n.coreMin, remMin: n.remMin, awakeMin: n.awakeMin, awakenings: n.awakenings, efficiency: n.efficiency, hasStages: n.hasStages })),
    unknownLabels,
    badLines,
  };
}

// ---------------- dashboard view ----------------

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Last night's structure next to the person's own 30-night norm (needs ≥ 7
 * nights with stages), plus the Intervals total for the same date so the two
 * sources can be compared during the parallel run.
 */
export function sleepDetailView(db, userId, today = localDate(), { intervalsSleepSecs = null } = {}) {
  const from = new Date(Date.parse(`${today}T12:00:00+07:00`) - 30 * 86400000);
  const rows = listNights(db, userId, localDate(from), today);
  const last = rows.find((r) => r.date === today) || null;
  const recentStale = !last && rows[0] ? rows[0].date : null;
  const prior = rows.filter((r) => r.date < today && r.asleep_min > 180 && (r.deep_min + r.core_min + r.rem_min) > 0);
  const pct = (r, k) => (r.asleep_min > 0 ? r[k] / r.asleep_min : null);
  const norm = prior.length >= 7
    ? {
        nights: prior.length,
        deepPct: mean(prior.map((r) => pct(r, 'deep_min'))),
        remPct: mean(prior.map((r) => pct(r, 'rem_min'))),
        corePct: mean(prior.map((r) => pct(r, 'core_min'))),
        awakeMin: mean(prior.map((r) => r.awake_min)),
        awakenings: mean(prior.map((r) => r.awakenings)),
        efficiency: mean(prior.map((r) => r.efficiency).filter((x) => x != null)),
        restorativePct: mean(prior.map((r) => (r.deep_min + r.rem_min) / r.asleep_min)),
      }
    : { nights: prior.length, need: 7 };
  const night = last
    ? {
        date: last.date,
        bedStart: last.bed_start,
        bedEnd: last.bed_end,
        inBedMin: last.in_bed_min,
        asleepMin: last.asleep_min,
        deepMin: last.deep_min,
        coreMin: last.core_min,
        remMin: last.rem_min,
        unspecifiedMin: last.unspecified_min,
        awakeMin: last.awake_min,
        awakenings: last.awakenings,
        efficiency: last.efficiency,
        napMin: last.nap_min,
        sleepScore: last.sleep_score,
        deepPct: pct(last, 'deep_min'),
        remPct: pct(last, 'rem_min'),
        corePct: pct(last, 'core_min'),
        hasStages: (last.deep_min + last.core_min + last.rem_min) > 0,
        restorativeMin: Math.round(last.deep_min + last.rem_min),
        restorativePct: last.asleep_min > 0 ? (last.deep_min + last.rem_min) / last.asleep_min : null,
        updatedAt: last.updated_at,
      }
    : null;
  const compare = night && Number.isFinite(intervalsSleepSecs)
    // Intervals.icu (HUAWEI) counts the day's naps into the night; compare like with like.
    ? { intervalsMin: Math.round(intervalsSleepSecs / 60), appleMin: Math.round(night.asleepMin + (night.napMin || 0)), diffMin: Math.round(night.asleepMin + (night.napMin || 0) - intervalsSleepSecs / 60) }
    : null;
  return { connected: tokenInfo(db, userId).hasToken, night, lastDate: rows[0]?.date || null, staleSince: recentStale, norm, compare };
}
