/**
 * AI layer (Claude Haiku 5.5; Sonnet 5.5 only for the on-demand quarter review).
 *
 * The AI NEVER computes the score and never decides anything. It only rewrites
 * numbers that code already produced into a few plain Vietnamese sentences.
 *
 * Guardrails, enforced in code (not only in the prompt):
 *   - Whitelisted packet: numbers and labels only. No name, username, free-text
 *     note, symptom flag or medical history is ever sent.
 *   - Medical topics (thuốc, kháng đông, van tim, tim mạch, …): a question about
 *     them is answered locally with "nên hỏi bác sĩ" — no API call. Any output
 *     sentence that touches them, or pushes intensity ("đẩy mạnh", "tăng tạ"),
 *     is removed; if nothing is left, a fixed fallback is shown.
 *   - The "nên hỏi bác sĩ" flag comes from alerts.mjs, not from the model.
 *   - The AI cannot change anything: it has no tools, it only returns text.
 *
 * The API key is read from process.env.ANTHROPIC_API_KEY (.env), used only in
 * the request header, never stored in the database, logged or returned.
 */
import crypto from 'node:crypto';
import { localDate, localIso } from './db.mjs';
import { contextLabels } from './context.mjs';
import { addDays } from './signals.mjs';

export { AI_SCHEMA } from './ai-schema.mjs';

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };

/** Settings from the environment. The key itself is never part of the returned object. */
export function aiConfig(env = process.env) {
  return {
    configured: Boolean(env.ANTHROPIC_API_KEY && String(env.ANTHROPIC_API_KEY).trim()),
    baseUrl: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    model: env.AI_MODEL || 'claude-haiku-5-5',
    deepModel: env.AI_MODEL_DEEP || 'claude-sonnet-5-5',
    // USD per million tokens (Haiku 5.5 ≤100k-token prompts; Sonnet 5.5).
    price: {
      in: num(env.AI_PRICE_IN, 0.1), out: num(env.AI_PRICE_OUT, 0.5),
      deepIn: num(env.AI_PRICE_DEEP_IN, 2), deepOut: num(env.AI_PRICE_DEEP_OUT, 10),
    },
    userDailyCalls: num(env.AI_USER_DAILY_CALLS, 15),
    globalDailyCalls: num(env.AI_GLOBAL_DAILY_CALLS, 80),
    deepPerMonth: num(env.AI_DEEP_PER_MONTH, 2),
    timeoutMs: num(env.AI_TIMEOUT_MS, 30000),
  };
}

export class AiError extends Error {
  constructor(message, kind, status = 400) { super(message); this.kind = kind; this.status = status; }
}

/* ------------------------------------------------------------ guard -- */

export const MEDICAL_RE = /(warfarin|sintrom|acenocoumarol|kháng đông|chống đông|\bINR\b|thuốc|liều|van tim|van cơ học|van nhân tạo|van động mạch|tim mạch|bệnh tim|suy tim|loạn nhịp|rối loạn nhịp|rung nhĩ|ngoại tâm thu|huyết khối|đột quỵ|chảy máu|xuất huyết|chẩn đoán|siêu âm tim|phẫu thuật|mổ tim|nhồi máu|huyết áp)/i;
export const PUSH_RE = /(đẩy mạnh|tăng cường độ|tăng tạ|tăng mức tạ|nâng tạ nặng|vượt giới hạn|vượt ngưỡng|cố gắng hơn|tập nặng hơn|tập hết sức|max effort|kỷ lục cá nhân)/i;

export const MEDICAL_REPLY = 'Câu này liên quan đến sức khoẻ tim mạch hoặc thuốc, nên hỏi bác sĩ của bạn. Mình chỉ giải thích số hồi phục, giấc ngủ và lịch tập.';
export const FALLBACK_REPLY = 'Mình chưa diễn giải được phần này. Xem bảng số và quy luật ngay trên trang; nếu số liệu bất thường kéo dài, nên hỏi bác sĩ.';

/** Drop every sentence that touches medical topics or pushes intensity. */
export function guardOutput(text) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  const sentences = clean.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((s) => !MEDICAL_RE.test(s) && !PUSH_RE.test(s));
  const removed = sentences.length - kept.length;
  if (!kept.length) return { text: FALLBACK_REPLY, filtered: true, removed };
  return { text: kept.join(' '), filtered: removed > 0, removed };
}

export function isMedicalQuestion(q) { return MEDICAL_RE.test(String(q || '')); }

/* ----------------------------------------------------------- prompts -- */

const SYSTEM = [
  'Bạn là trợ lý giải thích số liệu hồi phục trong app Nhịp Sống. Bạn nhận một gói DỮ LIỆU dạng JSON do code tính sẵn.',
  'Quy tắc bắt buộc:',
  '1. Chỉ dùng số có trong DỮ LIỆU. Không bịa số. Không tự tính điểm mới.',
  '2. Chỉ nói về hồi phục, giấc ngủ, thói quen và lịch tập. Tuyệt đối không bàn về bệnh, tim mạch, van tim, nhịp tim bất thường, thuốc, liều thuốc, xét nghiệm hay chẩn đoán. Nếu được hỏi, chỉ trả lời: "Câu này nên hỏi bác sĩ."',
  '3. Không bao giờ khuyên tăng cường độ, tăng tạ hay "đẩy mạnh". Mọi gợi ý viết dạng "có thể cân nhắc"; người dùng tự quyết lịch tập.',
  '4. Nếu canh_bao_bac_si có nội dung: chỉ nhắc đúng ý "số liệu bất thường kéo dài, nên hỏi bác sĩ", không giải thích nguyên nhân.',
  '5. Quy luật có do_chac là "chưa đủ dữ liệu", "chưa rõ" hoặc "có thể" phải nói rõ là chưa chắc. Đây là tương quan trên dữ liệu cá nhân, không phải nhân quả.',
  '6. Viết tiếng Việt, xưng "bạn", câu ngắn, không tiêu đề, không markdown, không emoji.',
].join('\n');

const TASKS = {
  explain: { maxSentences: 5, maxTokens: 400, instruction: 'Giải thích ngắn vì sao điểm hôm nay như vậy: yếu tố nào kéo lên/xuống, bối cảnh 1–3 ngày trước có khớp quy luật nào không. Kết thúc bằng một gợi ý nhẹ về nghỉ ngơi hoặc lịch tập hôm nay.' },
  ask: { maxSentences: 6, maxTokens: 500, instruction: 'Trả lời câu hỏi của người dùng dựa trên DỮ LIỆU. Nếu dữ liệu không đủ để trả lời, nói thẳng là chưa đủ.' },
  weekly: { maxSentences: 8, maxTokens: 650, instruction: 'Tóm tắt tuần: xu hướng điểm, HRV, nhịp tim nghỉ, giấc ngủ so với tuần trước; quy luật nổi bật; một gợi ý cho cách xếp lịch tuần tới (ví dụ ngày nặng nên cách nhau bao lâu), dạng "có thể cân nhắc".' },
  quarter: { maxSentences: 12, maxTokens: 1100, instruction: 'Nhìn lại cả quý: xu hướng dài hạn, quy luật nào đã rõ hơn, quy luật nào vẫn chưa đủ dữ liệu, nên ghi thêm bối cảnh gì để biết rõ hơn.' },
};

export function buildPrompt(kind, packet, question = '') {
  const t = TASKS[kind];
  if (!t) throw new AiError('Loại yêu cầu không hợp lệ.', 'bad_kind');
  const user = [
    `NHIỆM VỤ: ${t.instruction} Tối đa ${t.maxSentences} câu.`,
    question ? `CÂU HỎI: ${String(question).slice(0, 500)}` : null,
    'DỮ LIỆU:',
    JSON.stringify(packet),
  ].filter(Boolean).join('\n');
  return { system: SYSTEM, user, maxTokens: t.maxTokens };
}

/* ------------------------------------------------------------ packet -- */

const r1 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const r2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/**
 * The ONLY data the model ever sees. Pure function of already-computed results.
 * Keys are Vietnamese so the model echoes the app's vocabulary.
 */
export function buildPacket({ today, recovery, advice, wellness = [], history = [], contexts = new Map(), patterns = null, days = 14 }) {
  const from = addDays(today, -(days - 1));
  const scoreBy = new Map(history.map((h) => [h.date, h.score]));
  const rows = wellness.filter((w) => w.date >= from && w.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const ctxDays = [];
  for (let d = addDays(today, -days); d < today; d = addDays(d, 1)) {
    const labels = contextLabels(contexts.get(d));
    if (labels.length) ctxDays.push({ ngay: d, boi_canh: labels });
  }
  return {
    ngay: today,
    diem_hoi_phuc: recovery?.score ?? null,
    muc: recovery?.bandLabel ?? null,
    do_tin_cay: recovery?.confidence ?? null,
    can_hrv: Boolean(recovery?.needsHrv),
    ket_luan_cua_code: advice?.label ?? null,
    yeu_to: (recovery?.factors || []).map((f) => ({
      ten: f.label, gia_tri: f.valueText, muc_nen: f.meanText, z: r2(f.z), trang_thai: f.word || f.status,
      ...(f.suspectHigh ? { hrv_cao_bat_thuong: true } : {}),
    })),
    canh_bao_bac_si: recovery?.alerts?.doctor ? recovery.alerts.doctor.text : null,
    so_lieu_theo_ngay: rows.map((w) => ({
      ngay: w.date,
      hrv_ms: r1(w.hrv_rmssd),
      nhip_tim_nghi: r1(w.resting_hr),
      ngu_gio: w.sleep_secs ? r1(w.sleep_secs / 3600) : null,
      diem: scoreBy.get(w.date) ?? null,
    })),
    boi_canh_cac_ngay: ctxDays,
    quy_luat: (patterns?.factors || []).map((f) => ({
      yeu_to: f.label,
      so_lan: f.nEvents,
      do_chac: f.confidenceLabel,
      hrv_sang_hom_sau_pct: r1(f.lags[0]?.hrv?.pct),
      hrv_sang_hom_sau_swc: r1(f.lags[0]?.hrv?.swc),
      nhip_tim_nghi_sang_hom_sau_bpm: r1(f.lags[0]?.rhr?.diff),
      ngu_dem_sau_phut: f.lags[0]?.sleep ? Math.round(f.lags[0].sleep.diff) : null,
      so_ngay_hrv_con_thap: f.affectedDays,
      thuong_di_kem: f.oftenWith ? f.oftenWith.label : null,
    })),
  };
}

/* -------------------------------------------------------- storage -- */

export function hashPacket(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

export function cached(db, userId, kind, key) {
  return db.prepare('SELECT text, model, created_at FROM ai_cache WHERE user_id = ? AND kind = ? AND cache_key = ?').get(userId, kind, key) || null;
}
function storeCache(db, userId, kind, key, model, text) {
  db.prepare(`INSERT INTO ai_cache(user_id,kind,cache_key,model,text,created_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_id,kind,cache_key) DO UPDATE SET model=excluded.model, text=excluded.text, created_at=excluded.created_at`)
    .run(userId, kind, key, model, text, localIso());
}

export function costOf(cfg, model, usage) {
  const deep = model === cfg.deepModel;
  const pin = deep ? cfg.price.deepIn : cfg.price.in;
  const pout = deep ? cfg.price.deepOut : cfg.price.out;
  return ((usage.input_tokens || 0) * pin + (usage.output_tokens || 0) * pout) / 1e6;
}

function recordUsage(db, cfg, userId, kind, model, usage) {
  db.prepare('INSERT INTO ai_usage(user_id,day,ts,kind,model,input_tokens,output_tokens,cost_usd) VALUES(?,?,?,?,?,?,?,?)')
    .run(userId, localDate(), localIso(), kind, model, usage.input_tokens || 0, usage.output_tokens || 0, costOf(cfg, model, usage));
}

export function usageSummary(db, userId = null, now = new Date()) {
  const today = localDate(now);
  const month = today.slice(0, 7);
  const scope = userId == null ? '' : ' AND user_id = ?';
  const args = userId == null ? [] : [userId];
  const m = db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(input_tokens),0) AS inTok, COALESCE(SUM(output_tokens),0) AS outTok FROM ai_usage WHERE substr(day,1,7) = ?${scope}`).get(month, ...args);
  const d = db.prepare(`SELECT COUNT(*) AS calls FROM ai_usage WHERE day = ?${scope}`).get(today, ...args);
  return { month, monthCalls: m.calls, monthCostUsd: Math.round(m.cost * 10000) / 10000, monthInputTokens: m.inTok, monthOutputTokens: m.outTok, todayCalls: d.calls };
}

function checkCaps(db, cfg, userId, kind) {
  const today = localDate();
  const mine = db.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE day = ? AND user_id = ?').get(today, userId).n;
  if (mine >= cfg.userDailyCalls) throw new AiError(`Hôm nay bạn đã dùng hết ${cfg.userDailyCalls} lượt AI. Mai dùng tiếp nhé.`, 'cap_user', 429);
  const all = db.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE day = ?').get(today).n;
  if (all >= cfg.globalDailyCalls) throw new AiError('Cả server đã dùng hết lượt AI hôm nay.', 'cap_global', 429);
  if (kind === 'quarter') {
    const month = today.slice(0, 7);
    const deep = db.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND kind = 'quarter' AND substr(day,1,7) = ?").get(userId, month).n;
    if (deep >= cfg.deepPerMonth) throw new AiError(`Phân tích quý (Sonnet) tối đa ${cfg.deepPerMonth} lần/tháng.`, 'cap_deep', 429);
  }
}

/* ----------------------------------------------------------- client -- */

export async function callClaude({ cfg, model, system, user, maxTokens, fetchImpl = globalThis.fetch, env = process.env }) {
  const apiKey = String(env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new AiError('Chưa cấu hình ANTHROPIC_API_KEY trong .env trên máy chủ.', 'not_configured', 503);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      signal: ctl.signal,
    });
  } catch (err) {
    throw new AiError(err?.name === 'AbortError' ? 'AI trả lời quá lâu, thử lại sau.' : 'Không gọi được AI (mạng).', 'network', 502);
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try { body = await res.json(); } catch { /* handled below */ }
  if (!res.ok) {
    const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate' : 'http';
    const msg = kind === 'auth' ? 'API key không hợp lệ hoặc đã bị thu hồi.' : kind === 'rate' ? 'API đang giới hạn tốc độ hoặc đã chạm hạn mức chi tiêu.' : `AI lỗi (HTTP ${res.status}).`;
    throw new AiError(msg, kind, 502);
  }
  const textOut = (body?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  return { text: textOut, usage: body?.usage || {} };
}

/**
 * Run one AI task for a user. Handles cache, caps, guard and usage logging.
 * @param ctx {db, userId, kind: 'explain'|'ask'|'weekly'|'quarter', packet, question?, cacheKey?, fetchImpl?, env?}
 */
export async function runAi({ db, userId, kind, packet, question = '', cacheKey = null, fetchImpl, env = process.env }) {
  const cfg = aiConfig(env);
  if (kind === 'ask') {
    const q = String(question || '').trim();
    if (!q) throw new AiError('Câu hỏi trống.', 'empty');
    if (q.length > 500) throw new AiError('Câu hỏi tối đa 500 ký tự.', 'too_long');
    if (isMedicalQuestion(q)) return { text: MEDICAL_REPLY, cached: false, filtered: false, local: true };
  }
  if (cacheKey) {
    const hit = cached(db, userId, kind, cacheKey);
    if (hit) return { text: hit.text, cached: true, model: hit.model, createdAt: hit.created_at };
  }
  if (!cfg.configured) throw new AiError('Chưa cấu hình ANTHROPIC_API_KEY trong .env trên máy chủ.', 'not_configured', 503);
  checkCaps(db, cfg, userId, kind);
  const model = kind === 'quarter' ? cfg.deepModel : cfg.model;
  const prompt = buildPrompt(kind, packet, question);
  const out = await callClaude({ cfg, model, system: prompt.system, user: prompt.user, maxTokens: prompt.maxTokens, fetchImpl, env });
  recordUsage(db, cfg, userId, kind, model, out.usage);
  const guarded = guardOutput(out.text);
  if (cacheKey) storeCache(db, userId, kind, cacheKey, model, guarded.text);
  return { text: guarded.text, cached: false, filtered: guarded.filtered, model };
}

/** The week a Sunday summary belongs to: available from Sunday 18:00 (local) until next Sunday 18:00. */
export function weeklyWindow(now = new Date()) {
  const today = localDate(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(now));
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  let sunday = addDays(today, -dow);
  if (dow === 0 && hour < 18) sunday = addDays(sunday, -7);
  return { weekEnd: sunday, weekStart: addDays(sunday, -6) };
}
