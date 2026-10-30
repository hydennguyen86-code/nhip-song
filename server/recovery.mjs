/**
 * A transparent 0–100 recovery index built from the user's own baselines.
 *
 * This is deliberately NOT a WHOOP Recovery clone. WHOOP's weights are secret;
 * we publish the whole formula instead (models live in signals.mjs):
 *
 *   - HRV (45%): ln(rMSSD) — 60% last night + 40% 7-day mean — as robust
 *     z vs a 60-day median/MAD baseline; SWC and 7-day CV are reported;
 *   - resting HR (25%): last night vs 30-day median, sign inverted;
 *   - sleep (30%): obtained / NEED (not vs own average), 85% → 50 points;
 *   - each part maps to 50 + 22 × z, clamped 2–99; weights re-normalised when
 *     a part is missing, so the output always says how many parts it used;
 *   - respiratory rate is a one-sided illness flag, never points. Breathing up
 *     together with RHR up or HRV down caps the index at 50.
 *
 * Missing data lowers confidence; it is never silently filled in. A "sick" or
 * "tired" check-in caps the index, because self-report outranks the watch.
 * Implausible values (sleep < 3h, RHR outside 30–110, ...) and days reported
 * as sick are kept out of baselines.
 */

import { computeBaselines, rollingMean } from './baseline.mjs';
import { hrvModel, rhrModel, sleepPerformance, sleepNeed, respiratorySignal, sickDatesFrom, plausible, SLEEP_PERF } from './signals.mjs';

/** Respiration is no longer scored (one-sided illness flag, see signals.mjs). */
export const RECOVERY_WEIGHTS = Object.freeze({ hrv: 0.45, rhr: 0.25, sleep: 0.3 });
export const BANDS = Object.freeze({ green: 67, yellow: 34 });

const DEFAULT_SETTINGS = { rhr_on: 1, hrv_on: 1, sleep_on: 1, rhr_z: 1, hrv_z: 1, sleep_z: 1, strong_z: 2 };

const ACTIONS = {
  plan: 'Giữ kế hoạch vừa sức. Khởi động 10 phút rồi tăng dần theo cảm giác.',
  ease: 'Giảm 20–30% khối lượng hôm nay. Bỏ hiệp cuối nếu nhịp thở chưa về bình thường.',
  recover: 'Chỉ vận động nhẹ 20–30 phút: đi bộ, giãn cơ, thở chậm. Không tập cường độ cao.',
  rest: 'Nghỉ hoàn toàn. Ngủ sớm hơn 45 phút, uống đủ nước, ăn nhẹ.',
  unknown: 'Chưa đủ dữ liệu. Bấm Đồng bộ, hoặc ghi cảm giác hôm nay.',
  emergency: 'Dừng buổi tập. Gọi 115 hoặc đến khoa cấp cứu gần nhất.',
};

const BAND_LABEL = {
  green: 'Sẵn sàng',
  yellow: 'Trung bình',
  red: 'Cần hồi phục',
  unknown: 'Chưa đủ dữ liệu',
  emergency: 'Dừng tập',
};

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function isNum(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }
function subScore(z) { return clamp(50 + z * 22, 2, 99); }

function hhmm(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

function bandFor(score) {
  if (score == null) return 'unknown';
  if (score >= BANDS.green) return 'green';
  if (score >= BANDS.yellow) return 'yellow';
  return 'red';
}

function factorBase(key, label) {
  return { key, label, basis: '—', valueText: '—', meanText: '—', z: null, subscore: null, weight: RECOVERY_WEIGHTS[key] || 0 };
}

/** Respiration as a one-sided flag row (never scored). */
function respFactor(resp) {
  const f = { ...factorBase('resp', 'Nhịp thở'), weight: 0, flag: true, supplemental: true, respState: resp.state };
  if (resp.state === 'not_provided') {
    return { ...f, status: 'info', valueText: 'nguồn không có', text: 'Đồng hồ/nguồn đồng bộ chưa gửi nhịp thở. Không ảnh hưởng điểm và độ tin cậy.' };
  }
  if (resp.state === 'insufficient') {
    return { ...f, status: 'info', valueText: `${resp.count}/${resp.minNights} đêm`, text: `Cần ≥${resp.minNights} đêm có nhịp thở trong 30 ngày để bật cờ cảnh báo (hiện có ${resp.count}).` };
  }
  if (resp.state === 'missing_today') {
    return { ...f, status: 'info', valueText: '—', meanText: `${resp.median.toFixed(1)} /ph`, text: 'Chưa có nhịp thở đêm qua. Cờ cảnh báo tạm tắt.' };
  }
  const elevated = resp.state === 'elevated';
  return {
    ...f,
    basis: 'Đêm qua',
    valueText: `${resp.value.toFixed(1)} /ph`,
    meanText: `${resp.median.toFixed(1)} /ph`,
    z: resp.z,
    status: elevated ? 'bad' : 'neutral',
    text: elevated
      ? `Nhịp thở ${resp.value.toFixed(1)} lần/phút, cao hơn trung vị ${resp.median.toFixed(1)} khoảng +${resp.delta.toFixed(1)} (ngưỡng +${resp.threshold.toFixed(1)}). Đây là cờ cảnh báo sớm (sốt, nhiễm trùng, rượu, nóng), không phải điểm.`
      : `Nhịp thở ${resp.value.toFixed(1)} lần/phút, trung vị ${resp.median.toFixed(1)} — không tăng bất thường. Thở chậm hơn không được cộng điểm.`,
  };
}

/**
 * @returns {{
 *   score: number|null, band: string, bandLabel: string, action: string,
 *   factors: object[], used: number, total: number, confidence: string,
 *   capped: string|null, note: string, illness: object|null
 * }}
 */
export function computeRecovery({ wellness, today, checkin, settings = DEFAULT_SETTINGS, activities = [], sickDates = null }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const total = (s.hrv_on ? 1 : 0) + (s.rhr_on ? 1 : 0) + (s.sleep_on ? 1 : 0);
  const redFlag = Boolean(checkin && (checkin.red_flag === 1 || checkin.level === 'serious'));
  if (redFlag) {
    return {
      score: null,
      rawScore: null,
      band: 'emergency',
      bandLabel: BAND_LABEL.emergency,
      action: ACTIONS.emergency,
      factors: [],
      used: 0,
      total,
      confidence: '—',
      capped: 'triệu chứng nặng',
      illness: null,
      note: 'Bạn báo triệu chứng nặng. Chỉ số hồi phục bị ẩn để không khuyến khích tập.',
    };
  }

  const factors = [];
  let hrv = null;
  let rhr = null;

  if (s.hrv_on) {
    hrv = hrvModel(wellness, today, { sickDates });
    if (hrv.ready) {
      const sub = subScore(hrv.z);
      const parts = [];
      if (hrv.acute) parts.push(`đêm qua ${hrv.acute.value.toFixed(0)} ms (${signed(hrv.acute.z)}σ)`);
      if (hrv.chronic) parts.push(`TB ${hrv.chronic.count} ngày ${hrv.chronic.value.toFixed(0)} ms (${signed(hrv.chronic.z)}σ, ${hrv.chronicState === 'inside' ? 'trong SWC' : hrv.chronicState === 'below' ? 'dưới SWC' : 'trên SWC'})`);
      let text = `HRV ${hrv.name}: ${parts.join('; ')}. Nền ${hrv.baselineMs.toFixed(0)} ms, vùng thay đổi nhỏ nhất có ý nghĩa ${hrv.swc.low.toFixed(0)}–${hrv.swc.high.toFixed(0)} ms (${hrv.daysAvailable} ngày, ${hrv.tier}).`;
      if (hrv.cv7?.high) text += ` HRV dao động mạnh bất thường 7 ngày qua (CV ${hrv.cv7.value.toFixed(0)}% so với thường ${hrv.cv7.typical.toFixed(0)}%).`;
      factors.push({
        ...factorBase('hrv', `HRV ${hrv.name}`),
        basis: hrv.basis,
        valueText: `${(hrv.acute || hrv.chronic).value.toFixed(1)} ms`,
        meanText: `${hrv.baselineMs.toFixed(1)} ms`,
        z: hrv.z,
        subscore: sub,
        status: hrv.z >= 0.5 ? 'good' : hrv.z <= -0.5 ? 'bad' : 'neutral',
        word: hrv.z >= 0.5 ? 'tốt hơn nền' : hrv.z <= -0.5 ? 'thấp hơn nền' : 'trong khoảng nền',
        text,
        tier: hrv.tier,
        cvHigh: Boolean(hrv.cv7?.high),
      });
    } else {
      factors.push({
        ...factorBase('hrv', 'HRV'),
        status: 'missing',
        text: hrv.state === 'insufficient'
          ? `Cần ≥${hrv.minDays} ngày HRV cùng loại trong ${hrv.windowDays} ngày nền (hiện có ${hrv.daysAvailable} ngày ${hrv.name}).`
          : `Đã có nền HRV ${hrv.name}, nhưng chưa có số đêm qua và chưa đủ 3 ngày trong 7 ngày gần nhất.`,
      });
    }
  } else {
    factors.push({ ...factorBase('hrv', 'HRV'), status: 'missing', disabled: true, text: 'Bạn đã tắt HRV trong Cài đặt → Ngưỡng gợi ý.' });
  }

  if (s.rhr_on) {
    rhr = rhrModel(wellness, today, { sickDates });
    if (rhr.ready) {
      const sub = subScore(-rhr.z);
      const word = rhr.z <= -0.5 ? 'tốt hơn nền' : rhr.z >= 0.5 ? 'cao hơn nền' : 'trong khoảng nền';
      factors.push({
        ...factorBase('rhr', 'Nhịp tim nghỉ'),
        basis: 'Đêm qua',
        valueText: `${Math.round(rhr.value)} bpm`,
        meanText: `${Math.round(rhr.median)} bpm`,
        z: rhr.z,
        subscore: sub,
        status: rhr.z <= -0.5 ? 'good' : rhr.z >= 0.5 ? 'bad' : 'neutral',
        word,
        text: `Nhịp tim nghỉ ${Math.round(rhr.value)} bpm so với trung vị ${Math.round(rhr.median)} bpm (${signed(rhr.z)}σ, ${rhr.count} ngày) — ${word}.`,
      });
    } else {
      factors.push({
        ...factorBase('rhr', 'Nhịp tim nghỉ'),
        status: 'missing',
        text: rhr.state === 'insufficient'
          ? `Cần ≥7 ngày nhịp tim nghỉ trong 30 ngày nền (hiện có ${rhr.count}).`
          : `Đã có ${rhr.count} ngày nền, nhưng chưa có nhịp tim nghỉ cho ngày ${today}.`,
      });
    }
  } else {
    factors.push({ ...factorBase('rhr', 'Nhịp tim nghỉ'), status: 'missing', disabled: true, text: 'Bạn đã tắt nhịp tim nghỉ trong Cài đặt → Ngưỡng gợi ý.' });
  }

  if (s.sleep_on) {
    const sp = sleepPerformance(wellness, activities, today);
    if (sp.ready) {
      const pctTxt = `${Math.round(sp.pct * 100)}%`;
      const extras = [];
      if (sp.repayMin) extras.push(`+${sp.repayMin} phút trả nợ ngủ (nợ 7 đêm ${hhmm(sp.debtMin)})`);
      if (sp.strainBumpMin) extras.push(`+${sp.strainBumpMin} phút vì hôm qua tập nhiều`);
      let text = `Ngủ ${hhmm(sp.actualMin)} / nhu cầu ${hhmm(sp.needMin)} = ${pctTxt}. Nhu cầu = nền ${hhmm(sp.baseMin)}${extras.length ? ' ' + extras.join(', ') : ''}.`;
      if (sp.nights < 7) text += ' Chưa đủ 7 đêm lịch sử nên nền tạm là 8h.';
      if (sp.suspect) text += ' Dưới 3 giờ — nếu là lỗi đồng bộ, hãy đánh dấu sai.';
      factors.push({
        ...factorBase('sleep', 'Giấc ngủ'),
        basis: 'Đêm qua · so với nhu cầu',
        valueText: hhmm(sp.actualMin),
        meanText: `cần ${hhmm(sp.needMin)}`,
        z: (sp.subscore - 50) / 22,
        chip: pctTxt,
        subscore: sp.subscore,
        status: sp.pct >= SLEEP_PERF.good ? 'good' : sp.pct < SLEEP_PERF.warn ? 'bad' : 'neutral',
        word: sp.pct >= SLEEP_PERF.good ? 'đủ nhu cầu' : sp.pct < SLEEP_PERF.warn ? 'thiếu ngủ' : 'gần đủ',
        pct: sp.pct,
        needMin: sp.needMin,
        text,
      });
    } else {
      factors.push({ ...factorBase('sleep', 'Giấc ngủ'), status: 'missing', text: `Chưa có dữ liệu ngủ cho ngày ${today}.` });
    }
  } else {
    factors.push({ ...factorBase('sleep', 'Giấc ngủ'), status: 'missing', disabled: true, text: 'Bạn đã tắt giấc ngủ trong Cài đặt → Ngưỡng gợi ý.' });
  }

  const resp = respiratorySignal(wellness, today, { sickDates });
  factors.push(respFactor(resp));

  // Illness pattern: breathing up AND (resting HR up OR HRV down).
  const rhrUp = Boolean(rhr?.ready && rhr.z >= 1);
  const hrvDown = Boolean(hrv?.ready && hrv.z <= -1);
  const illness = resp.state === 'elevated' && (rhrUp || hrvDown)
    ? { signals: ['nhịp thở tăng', rhrUp && 'nhịp tim nghỉ tăng', hrvDown && 'HRV giảm'].filter(Boolean) }
    : null;

  const used = factors.filter((f) => f.subscore != null);
  if (!used.length) {
    return {
      score: null,
      rawScore: null,
      band: 'unknown',
      bandLabel: BAND_LABEL.unknown,
      action: ACTIONS.unknown,
      factors,
      used: 0,
      total,
      confidence: 'thấp',
      capped: null,
      illness,
      weights: RECOVERY_WEIGHTS,
      note: total
        ? 'Chưa đủ dữ liệu để tính chỉ số. Nhịp thở chỉ là cờ cảnh báo, không tự tạo ra điểm. Không có nghĩa là bạn hồi phục kém.'
        : 'Bạn đã tắt cả HRV, nhịp tim nghỉ và giấc ngủ. Nhịp thở chỉ là cờ bổ sung nên không có điểm.',
    };
  }

  const weightSum = used.reduce((acc, f) => acc + f.weight, 0);
  let rawScore = clamp(used.reduce((acc, f) => acc + f.subscore * (f.weight / weightSum), 0), 0, 100);
  rawScore = Math.round(rawScore);
  let score = rawScore;

  let capped = null;
  if (checkin && checkin.level === 'sick' && score > 30) {
    score = 30;
    capped = 'bạn báo đang bệnh';
  } else if (checkin && checkin.level === 'tired' && score > 50) {
    score = 50;
    capped = 'bạn báo mệt / ngủ kém';
  } else if (illness && score > 50) {
    score = 50;
    capped = `dấu hiệu cơ thể có thể đang chống bệnh (${illness.signals.join(' + ')})`;
  }

  score = Math.round(clamp(score, 0, 100));
  const band = bandFor(score);

  for (const f of used) {
    f.contribution = Math.round((f.subscore - 50) * (f.weight / weightSum));
  }
  const ranked = [...used].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  let confidence = used.length >= 3 ? 'cao' : used.length === 2 ? 'vừa' : 'thấp';
  const hrvUsed = used.find((f) => f.key === 'hrv');
  if (confidence === 'cao' && hrvUsed && hrvUsed.tier === 'sơ bộ') confidence = 'vừa';
  const top = ranked[0];
  const explanation = top
    ? `${top.label} ${top.contribution >= 0 ? 'kéo điểm lên' : 'kéo điểm xuống'} ${Math.abs(top.contribution)} điểm so với mốc 50.`
    : '';
  const rest = factors.filter((f) => f.subscore == null);

  return {
    score,
    rawScore,
    band,
    bandLabel: BAND_LABEL[band],
    action: ACTIONS[band === 'green' ? 'plan' : band === 'yellow' ? 'ease' : 'rest'],
    factors: [...ranked, ...rest],
    used: used.length,
    total,
    confidence,
    capped,
    illness,
    explanation,
    weights: RECOVERY_WEIGHTS,
    note: 'Chỉ số tham khảo, công thức công khai: HRV ln (đêm qua + 7 ngày), nhịp tim nghỉ so trung vị, giấc ngủ so với nhu cầu. Nhịp thở là cờ cảnh báo, không cộng điểm. Không phải thuật toán WHOOP, không phải thiết bị y tế.',
  };
}

function signed(z) { return `${z >= 0 ? '+' : ''}${z.toFixed(1)}`; }

/** Recovery index for each of the last `days` days, for the trend strip. */
export function recoveryHistory({ wellness, today, days = 30, settings, checkins = [], activities = [] }) {
  const byDate = new Map();
  for (const c of checkins) {
    const date = String(c.local_date).slice(0, 10);
    const prev = byDate.get(date);
    if (!prev || (c.id || 0) > (prev.id || 0)) byDate.set(date, c);
  }
  const sickDates = sickDatesFrom(checkins);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const r = computeRecovery({ wellness, today: date, checkin: byDate.get(date) || null, settings, activities, sickDates });
    out.push({ date, score: r.score, band: r.band });
  }
  return out;
}

/**
 * Sleep need built from the person's own recent average (floored at 7.5h),
 * recent sleep debt and yesterday's training minutes. Debt is repaid gradually
 * — at most one hour is added to a single night — so the planner does not ask
 * for an impossible 10h night after one bad week. Three tiers, like a planner.
 */
export function buildSleepPlan({ wellness, activities, today }) {
  const baselines = computeBaselines(wellness, today);
  const byDate = new Map(wellness.map((w) => [w.date, w]));

  const personalMean = baselines.sleepMinutes.count >= 7 ? baselines.sleepMinutes.mean : 480;
  const base = Math.round(clamp(personalMean, 450, 510));

  let debt = 0;
  let nights = 0;
  for (let i = 0; i < 7; i++) {
    const w = byDate.get(addDays(today, -i));
    if (w && plausible('sleep_secs', w.sleep_secs)) {
      nights++;
      debt += Math.max(0, base - w.sleep_secs / 60);
    }
  }
  debt = Math.round(Math.min(debt, 600));

  const yesterday = addDays(today, -1);
  const yMinutes = activities
    .filter((a) => String(a.start_date_local).slice(0, 10) === yesterday)
    .reduce((acc, a) => acc + (a.moving_time || 0), 0) / 60;

  const windowStart = addDays(today, -28);
  const total28 = activities
    .filter((a) => {
      const d = String(a.start_date_local).slice(0, 10);
      return d >= windowStart && d < today;
    })
    .reduce((acc, a) => acc + (a.moving_time || 0), 0) / 60;
  const avgDaily = total28 / 28;
  const ratio = avgDaily > 0 ? yMinutes / avgDaily : (yMinutes > 0 ? 2 : 0);
  const strainBump = Math.round(clamp((ratio - 1) * 25, 0, 45));

  const repay = Math.min(debt, 300);
  let getBy = base - 15 + Math.min(repay * 0.08, 20);
  let perform = base + Math.min(repay * 0.2, 60) + strainBump;
  let peak = perform + 30;

  getBy = clamp(getBy, 420, 570);
  perform = clamp(Math.max(perform, getBy + 15), 435, 580);
  peak = clamp(Math.max(peak, perform + 20), 455, 600);

  return {
    baseMinutes: base,
    personalMeanMinutes: Math.round(personalMean),
    debtMinutes: debt,
    debtNights: nights,
    repayMinutes: Math.round(repay * 0.2 + Math.min(repay * 0.08, 20)),
    strainBumpMinutes: strainBump,
    yesterdayMinutes: Math.round(yMinutes),
    avgDailyMinutes: Math.round(avgDaily),
    tiers: {
      getBy: Math.round(getBy),
      perform: Math.round(perform),
      peak: Math.round(peak),
    },
    tierLabels: {
      getBy: 'Tối thiểu để tỉnh táo',
      perform: 'Hồi phục tốt',
      peak: 'Đỉnh phong độ',
    },
    note: 'Nền = trung bình ngủ của bạn (sàn 7,5h) + một phần nợ ngủ 7 ngày + điều chỉnh theo số phút tập hôm qua. Tập sức mạnh/bơi/yoga có thể bị đếm thiếu.',
  };
}

/** Weekly training-load target as a percentage of the 28-day weekly average. */
export function buildLoadTarget({ activities, today, band }) {
  const inRange = (a, from, toExclusive) => {
    const d = String(a.start_date_local).slice(0, 10);
    return d >= from && d < toExclusive;
  };
  const sum = (list) => list.reduce((acc, a) => acc + (a.training_load || 0), 0);
  const minutes = (list) => list.reduce((acc, a) => acc + (a.moving_time || 0), 0) / 60;

  const last7List = activities.filter((a) => inRange(a, addDays(today, -7), today));
  const prev7List = activities.filter((a) => inRange(a, addDays(today, -14), addDays(today, -7)));
  const last28List = activities.filter((a) => inRange(a, addDays(today, -28), today));

  const last7 = sum(last7List);
  const prev7 = sum(prev7List);
  const weeklyAvg28 = sum(last28List) / 4;
  const pct = weeklyAvg28 > 0 ? Math.round((last7 / weeklyAvg28) * 100) : null;

  const target = {
    green: { min: 90, max: 125, label: 'Tải vừa đến cao' },
    yellow: { min: 50, max: 85, label: 'Tải nhẹ đến vừa' },
    red: { min: 0, max: 45, label: 'Ưu tiên hồi phục' },
    unknown: null,
    emergency: null,
  }[band] || null;

  return {
    last7Load: Math.round(last7),
    prev7Load: Math.round(prev7),
    weeklyAvg28: Math.round(weeklyAvg28),
    pct,
    sessions: last7List.length,
    minutes: Math.round(minutes(last7List)),
    target,
    trend: pct == null ? null : pct > 120 ? 'high' : pct < 60 ? 'low' : 'ok',
    note: 'Tải = icu_training_load. Không phản ánh đủ tập sức mạnh, bơi hay yoga.',
  };
}

/** Compact values for the four metric tiles. */
export function buildMetrics({ wellness, today, activities = [], sickDates = null }) {
  const baselines = computeBaselines(wellness, today, { sickDates });
  const byDate = new Map(wellness.map((w) => [w.date, w]));
  const latest = byDate.get(today) || null;
  const previous = byDate.get(addDays(today, -1)) || null;

  const hrv = hrvModel(wellness, today, { sickDates });
  const rollRmssd = rollingMean(wellness, 'hrv_rmssd', today);
  const rollSdnn = rollingMean(wellness, 'hrv_sdnn', today);
  const roll = rollRmssd ? { ...rollRmssd, name: 'rMSSD' } : rollSdnn ? { ...rollSdnn, name: 'SDNN' } : null;
  const hrvValue = hrv.ready ? (hrv.acute || hrv.chronic).value : roll ? roll.value : null;
  const hrvBaseline = hrv.ready ? hrv.baselineMs : null;

  const sp = sleepPerformance(wellness, activities, today);
  const need = sp.needMin ?? sleepNeed(wellness, activities, today).needMin;
  const resp = respiratorySignal(wellness, today, { sickDates });

  const spark = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    const w = byDate.get(d);
    spark.push({
      date: d,
      hrv: w ? (isNum(w.hrv_rmssd) ? w.hrv_rmssd : isNum(w.hrv_sdnn) ? w.hrv_sdnn : null) : null,
      rhr: w && isNum(w.resting_hr) ? w.resting_hr : null,
      sleep: w && isNum(w.sleep_secs) ? w.sleep_secs / 3600 : null,
      resp: w && isNum(w.respiration) ? w.respiration : null,
      steps: w && isNum(w.steps) ? w.steps : null,
    });
  }

  return {
    hrv: {
      value: hrvValue,
      mean: hrvBaseline,
      deltaPct: hrvValue && hrvBaseline ? ((hrvValue - hrvBaseline) / hrvBaseline) * 100 : null,
      unit: 'ms',
      basis: hrv.ready
        ? `${hrv.name} · ${hrv.acute ? 'đêm qua' : 'TB 7 ngày'} · SWC ${hrv.swc.low.toFixed(0)}–${hrv.swc.high.toFixed(0)}`
        : roll ? `${roll.name} · TB 7 ngày` : 'Chưa đủ dữ liệu',
      tier: hrv.tier || null,
      acute: hrv.acute || null,
      chronic: hrv.chronic || null,
      cv7: hrv.cv7 || null,
    },
    rhr: {
      value: latest && isNum(latest.resting_hr) ? latest.resting_hr : null,
      mean: baselines.rhr.count ? baselines.rhr.median : null,
      unit: 'bpm',
      basis: 'Đêm qua',
    },
    sleep: {
      value: latest && isNum(latest.sleep_secs) ? latest.sleep_secs / 3600 : null,
      mean: need ? need / 60 : null,
      need: need || null,
      pct: sp.ready ? sp.pct : null,
      score: latest && isNum(latest.sleep_score) ? latest.sleep_score : null,
      unit: 'giờ',
      basis: sp.ready ? `${Math.round(sp.pct * 100)}% nhu cầu ${hhmm(need)}` : 'Đêm qua',
    },
    resp: {
      value: latest && isNum(latest.respiration) ? latest.respiration : null,
      mean: resp.median ?? null,
      unit: '/ph',
      basis: resp.state === 'not_provided' ? 'Nguồn không cung cấp' : resp.state === 'elevated' ? 'Tăng bất thường' : 'Cờ cảnh báo · đêm qua',
      state: resp.state,
    },
    steps: {
      value: previous && isNum(previous.steps) ? previous.steps : null,
      mean: baselines.steps.count ? baselines.steps.mean : null,
      unit: 'bước',
      basis: 'Hôm qua',
    },
    spark,
  };
}

export { ACTIONS, BAND_LABEL, addDays };
