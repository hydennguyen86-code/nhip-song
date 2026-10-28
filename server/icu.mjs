/**
 * Client for https://intervals.icu/api/v1 (only GET). Read-only by design so
 * the app can never damage the athlete's upstream data.
 *
 * Authentication per OpenAPI spec: HTTP Basic with username = literal
 * "API_KEY" and password = the athlete's personal API key from /settings.
 *
 * Verified 2026-10-27 against https://intervals.icu/api/v1/docs/ (OpenAPI 3.0.1).
 */

const BASE_URL = 'https://intervals.icu';
const USER_AGENT = 'NhipSong/1.0 (personal LAN app)';

// Fields we actually consume. Asking explicitly keeps payloads small and
// stops nulls from silently filling missing metrics.
const WELLNESS_FIELDS = [
  'id',
  'date',
  'restingHR',
  'hrv',
  'hrvSDNN',
  'sleepSecs',
  'sleepScore',
  'sleepQuality',
  'steps',
  'weight',
  'avgSleepingHR',
  'kcalConsumed',
  'readiness',
  'spO2',
  'respiration',
  'soreness',
  'fatigue',
  'stress',
  'mood',
  'motivation',
  'comments',
  'updated',
].join(',');

const ACTIVITY_FIELDS = [
  'id',
  'start_date_local',
  'name',
  'type',
  'moving_time',
  'elapsed_time',
  'distance',
  'total_elevation_gain',
  'average_heartrate',
  'max_heartrate',
  'average_watts',
  'icu_normalised_watts',
  'icu_training_load',
  'icu_intensity',
  'rpe',
  'feel',
  'kilocalories',
  'calories',
].join(',');

export class IcuError extends Error {
  constructor(kind, message, { status, retryAfter } = {}) {
    super(message);
    this.name = 'IcuError';
    this.kind = kind; // 'auth' | 'rate' | 'timeout' | 'network' | 'http' | 'parse'
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function authHeader(apiKey) {
  const raw = `${apiKey}`;
  if (!raw || !raw.trim()) throw new IcuError('auth', 'API key trống.');
  return 'Basic ' + Buffer.from(`API_KEY:${raw.trim()}`).toString('base64');
}

async function fetchJson(url, { apiKey, timeoutMs = 15000, method = 'GET', headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        Authorization: authHeader(apiKey),
        ...headers,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && (err.name === 'AbortError' || /abort/i.test(String(err)))) {
      throw new IcuError('timeout', 'Intervals.icu phản hồi quá chậm, thử lại sau.');
    }
    throw new IcuError('network', 'Không kết nối được Intervals.icu: ' + (err?.message || err));
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new IcuError('auth', 'API key không được chấp nhận (HTTP ' + response.status + ').', { status: response.status });
  }
  if (response.status === 429) {
    const retry = Number(response.headers.get('retry-after')) || 60;
    throw new IcuError('rate', 'Intervals.icu tạm chặn vì gửi yêu cầu quá nhiều lần.', { status: 429, retryAfter: retry });
  }
  if (!response.ok) {
    throw new IcuError('http', 'Intervals.icu trả lỗi HTTP ' + response.status, { status: response.status });
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new IcuError('parse', 'Intervals.icu trả dữ liệu không phải JSON hợp lệ.');
  }
}

/** GET /api/v1/athlete/{id} — cheap probe used when the user saves a key. */
export async function fetchAthlete(athleteId, apiKey) {
  if (!athleteId) throw new IcuError('auth', 'Thiếu mã vận động viên (athlete ID).');
  return fetchJson(`${BASE_URL}/api/v1/athlete/${encodeURIComponent(athleteId)}`, { apiKey });
}

/**
 * GET /api/v1/athlete/{id}/wellness?oldest&newest&fields
 * Returns an array (possibly empty). Missing days are simply absent.
 */
export async function fetchWellness(athleteId, apiKey, { oldest, newest }) {
  if (!oldest || !newest) throw new IcuError('http', 'Thiếu khoảng ngày khi lấy wellness.');
  const url = new URL(`${BASE_URL}/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness`);
  url.searchParams.set('oldest', oldest);
  url.searchParams.set('newest', newest);
  url.searchParams.set('fields', WELLNESS_FIELDS);
  const data = await fetchJson(url.toString(), { apiKey });
  return Array.isArray(data) ? data : [];
}

/** GET /api/v1/athlete/{id}/activities?oldest&newest&fields */
export async function fetchActivities(athleteId, apiKey, { oldest, newest }) {
  if (!oldest) throw new IcuError('http', 'Thiếu ngày khởi đầu khi lấy activities.');
  const url = new URL(`${BASE_URL}/api/v1/athlete/${encodeURIComponent(athleteId)}/activities`);
  url.searchParams.set('oldest', oldest);
  if (newest) url.searchParams.set('newest', newest);
  url.searchParams.set('fields', ACTIVITY_FIELDS);
  const data = await fetchJson(url.toString(), { apiKey });
  return Array.isArray(data) ? data : [];
}

export const ICU_ENDPOINTS = { BASE_URL, WELLNESS_FIELDS, ACTIVITY_FIELDS };
