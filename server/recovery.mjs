/**
 * A transparent 0–100 recovery index built from the user's own baselines.
 *
 * This is deliberately NOT a WHOOP Recovery clone. WHOOP's weights are secret
 * and proprietary; we cannot reproduce them and do not pretend to. What we do
 * instead is publish the whole formula:
 *
 *   - each available signal becomes a z-score against the person's 30-day
 *     baseline (HRV uses the 7-day rolling mean, per Plews et al.);
 *   - the z-score maps to a 0–100 sub-score with 50 = personal baseline and
 *     22 points per standard deviation;
 *   - the final index is the weighted mean of available sub-scores, with
 *     weights re-normalised when a signal is missing, so the output is always
 *     in 0–100 and always says how many signals it used.
 *
 * Missing data lowers confidence; it is never silently filled in. A "sick" or
 * "tired" check-in caps the index, because self-report outranks the watch.
 */

import { computeBaselines, compare, rollingMean } from './baseline.mjs';

export const RECOVERY_WEIGHTS = Object.freeze({ hrv: 0.4, rhr: 0.25, sleep: 0.25, resp: 0.1 });
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

/** Pick rMSSD when its baseline is ready, otherwise SDNN. Never blends the two. */
function hrvSeries(wellness, baselines, today) {
  const rmssd = baselines.hrvRmssd.baseline;
  const sdnn = baselines.hrvSdnn.baseline;
  if (!rmssd && !sdnn) return null;
  const useRmssd = Boolean(rmssd) || !sdnn;
  const field = useRmssd ? 'hrv_rmssd' : 'hrv_sdnn';
  const baseline = useRmssd ? baselines.hrvRmssd : baselines.hrvSdnn;
  const roll = rollingMean(wellness, field, today);
  if (!roll) return null;
  return { name: useRmssd ? 'rMSSD' : 'SDNN', roll, baseline: baseline.baseline, tier: baseline.tier };
}

/**
 * @returns {{
 *   score: number|null, band: string, bandLabel: string, action: string,
 *   factors: object[], used: number, total: number, confidence: string,
 *   capped: string|null, note: string
 * }}
 */
export function computeRecovery({ wellness, today, checkin, settings = DEFAULT_SETTINGS }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
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
      total: 4,
      confidence: '—',
      capped: 'triệu chứng nặng',
      note: 'Bạn báo triệu chứng nặng. Chỉ số hồi phục bị ẩn để không khuyến khích tập.',
    };
  }

  const baselines = computeBaselines(wellness, today);
  const latest = wellness.find((w) => w.date === today) || null;
  const factors = [];

  if (s.hrv_on) {
    const hrv = hrvSeries(wellness, baselines, today);
    if (hrv) {
      const c = compare(hrv.roll.value, hrv.baseline, { higherIsBetter: true });
      const sub = subScore(c.z);
      factors.push({
        key: 'hrv',
        label: `HRV ${hrv.name}`,
        basis: `TB ${hrv.roll.count} ngày`,
        valueText: `${c.value.toFixed(1)} ms`,
        meanText: `${c.mean.toFixed(1)} ms`,
        z: c.z,
        subscore: sub,
        weight: RECOVERY_WEIGHTS.hrv,
        status: c.z >= 0.5 ? 'good' : c.z <= -0.5 ? 'bad' : 'neutral',
        word: c.word,
        text: `HRV ${hrv.name} ${c.value.toFixed(1)} ms so với nền ${c.mean.toFixed(1)} ms (${signed(c.z)}σ) — ${c.word}.`,
        tier: hrv.tier,
      });
    } else {
      factors.push(missing('hrv', 'HRV', 'Cần ≥14 ngày HRV cùng loại (rMSSD hoặc SDNN) và ≥3 ngày đo trong 7 ngày gần nhất.'));
    }
  } else {
    factors.push({ ...missing('hrv', 'HRV', 'Bạn đã tắt HRV trong Cài đặt → Ngưỡng gợi ý.'), disabled: true });
  }

  if (s.rhr_on) {
    if (baselines.rhr.count >= 7 && latest && isNum(latest.resting_hr)) {
      const c = compare(latest.resting_hr, baselines.rhr, { higherIsBetter: false });
      const sub = subScore(-c.z);
      factors.push({
        key: 'rhr',
        label: 'Nhịp tim nghỉ',
        basis: 'Đêm qua',
        valueText: `${Math.round(c.value)} bpm`,
        meanText: `${Math.round(c.mean)} bpm`,
        z: c.z,
        subscore: sub,
        weight: RECOVERY_WEIGHTS.rhr,
        status: c.z <= -0.5 ? 'good' : c.z >= 0.5 ? 'bad' : 'neutral',
        word: c.word,
        text: `Nhịp tim nghỉ ${Math.round(c.value)} bpm so với nền ${Math.round(c.mean)} bpm (${signed(c.z)}σ) — ${c.word}.`,
      });
    } else {
      factors.push(missing('rhr', 'Nhịp tim nghỉ', `Cần ≥7 ngày RHR trong 30 ngày nền và số của đêm qua (hiện có ${baselines.rhr.count} ngày nền).`));
    }
  } else {
    factors.push({ ...missing('rhr', 'Nhịp tim nghỉ', 'Bạn đã tắt nhịp tim nghỉ trong Cài đặt → Ngưỡng gợi ý.'), disabled: true });
  }

  if (s.sleep_on) {
    if (baselines.sleepMinutes.count >= 7 && latest && isNum(latest.sleep_secs)) {
      const minutes = latest.sleep_secs / 60;
      const c = compare(minutes, baselines.sleepMinutes, { higherIsBetter: true });
      const sub = subScore(c.z);
      factors.push({
        key: 'sleep',
        label: 'Giấc ngủ',
        basis: 'Đêm qua',
        valueText: hhmm(c.value),
        meanText: hhmm(c.mean),
        z: c.z,
        subscore: sub,
        weight: RECOVERY_WEIGHTS.sleep,
        status: c.z >= 0.5 ? 'good' : c.z <= -0.5 ? 'bad' : 'neutral',
        word: c.word,
        text: `Ngủ ${hhmm(c.value)} so với nền ${hhmm(c.mean)} (${signed(c.z)}σ) — ${c.word}.`,
      });
    } else {
      factors.push(missing('sleep', 'Giấc ngủ', `Cần ≥7 đêm có dữ liệu ngủ (hiện có ${baselines.sleepMinutes.count}).`));
    }
  } else {
    factors.push({ ...missing('sleep', 'Giấc ngủ', 'Bạn đã tắt giấc ngủ trong Cài đặt → Ngưỡng gợi ý.'), disabled: true });
  }

  if (baselines.respiration.count >= 7 && latest && isNum(latest.respiration)) {
    const c = compare(latest.respiration, baselines.respiration, { higherIsBetter: false });
    const sub = subScore(-c.z);
    factors.push({
      key: 'resp',
      label: 'Nhịp thở',
      basis: 'Đêm qua',
      valueText: `${c.value.toFixed(1)} /ph`,
      meanText: `${c.mean.toFixed(1)} /ph`,
      z: c.z,
      subscore: sub,
      weight: RECOVERY_WEIGHTS.resp,
      status: c.z <= -0.5 ? 'good' : c.z >= 0.5 ? 'bad' : 'neutral',
      word: c.word,
      text: `Nhịp thở ${c.value.toFixed(1)} lần/phút so với nền ${c.mean.toFixed(1)} (${signed(c.z)}σ) — ${c.word}.`,
      supplemental: true,
    });
  } else {
    factors.push(missing('resp', 'Nhịp thở', `Cần ≥7 đêm có nhịp thở (hiện có ${baselines.respiration.count}).`));
  }

  const used = factors.filter((f) => f.subscore != null);
  // Respiration is a supplemental illness signal; it must never produce a score
  // on its own (same rule as the morning verdict).
  const coreUsed = used.filter((f) => f.key !== 'resp');
  if (!used.length || !coreUsed.length) {
    return {
      score: null,
      rawScore: null,
      band: 'unknown',
      bandLabel: BAND_LABEL.unknown,
      action: ACTIONS.unknown,
      factors,
      used: 0,
      total: 4,
      confidence: 'thấp',
      capped: null,
      weights: RECOVERY_WEIGHTS,
      note: used.length
        ? 'Nhịp thở chỉ là tín hiệu bổ sung. Cần ít nhất một trong HRV, nhịp tim nghỉ hoặc giấc ngủ để tính điểm.'
        : 'Chưa đủ dữ liệu để tính chỉ số. Không có nghĩa là bạn hồi phục kém.',
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
  }

  score = Math.round(clamp(score, 0, 100));
  const band = bandFor(score);

  // Contribution in index points, summing to (score - 50) before any cap.
  for (const f of used) {
    f.contribution = Math.round((f.subscore - 50) * (f.weight / weightSum));
  }
  const ranked = [...used].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const confidence = used.length >= 4 ? 'cao' : used.length === 3 ? 'vừa' : 'thấp';
  const top = ranked[0];
  const explanation = top
    ? `${top.label} ${top.contribution >= 0 ? 'kéo điểm lên' : 'kéo điểm xuống'} ${Math.abs(top.contribution)} điểm so với mốc 50.`
    : '';
  const missingFactors = factors.filter((f) => f.subscore == null);

  return {
    score,
    rawScore,
    band,
    bandLabel: BAND_LABEL[band],
    action: ACTIONS[band === 'green' ? 'plan' : band === 'yellow' ? 'ease' : 'rest'],
    factors: [...ranked, ...missingFactors],
    used: used.length,
    total: 4,
    confidence,
    capped,
    explanation,
    weights: RECOVERY_WEIGHTS,
    note: 'Chỉ số tham khảo, tính tuyến tính từ z-score cá nhân. Không phải thuật toán WHOOP, không phải thiết bị y tế.',
  };
}

function missing(key, label, why) {
  return { key, label, basis: '—', valueText: '—', meanText: '—', z: null, subscore: null, weight: RECOVERY_WEIGHTS[key] || 0, status: 'missing', text: why };
}
function signed(z) { return `${z >= 0 ? '+' : ''}${z.toFixed(1)}`; }

/** Recovery index for each of the last `days` days, for the trend strip. */
export function recoveryHistory({ wellness, today, days = 30, settings, checkins = [] }) {
  const byDate = new Map();
  for (const c of checkins) {
    const date = String(c.local_date).slice(0, 10);
    const prev = byDate.get(date);
    if (!prev || (c.id || 0) > (prev.id || 0)) byDate.set(date, c);
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const r = computeRecovery({ wellness, today: date, checkin: byDate.get(date) || null, settings });
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
    if (w && isNum(w.sleep_secs)) {
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
export function buildMetrics({ wellness, today }) {
  const baselines = computeBaselines(wellness, today);
  const byDate = new Map(wellness.map((w) => [w.date, w]));
  const latest = byDate.get(today) || null;
  const previous = byDate.get(addDays(today, -1)) || null;

  const hrv = hrvSeries(wellness, baselines, today);
  const hrvBaseline = hrv ? hrv.baseline.mean : null;
  const rollRmssd = rollingMean(wellness, 'hrv_rmssd', today);
  const rollSdnn = rollingMean(wellness, 'hrv_sdnn', today);
  const roll = rollRmssd ? { ...rollRmssd, name: 'rMSSD' } : rollSdnn ? { ...rollSdnn, name: 'SDNN' } : null;
  const hrvValue = hrv ? hrv.roll.value : roll ? roll.value : null;

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
      basis: hrv ? `${hrv.name} · TB 7 ngày` : roll ? `${roll.name} · TB 7 ngày` : 'Chưa đủ dữ liệu',
      tier: hrv?.tier || null,
    },
    rhr: {
      value: latest && isNum(latest.resting_hr) ? latest.resting_hr : null,
      mean: baselines.rhr.count ? baselines.rhr.mean : null,
      unit: 'bpm',
      basis: 'Đêm qua',
    },
    sleep: {
      value: latest && isNum(latest.sleep_secs) ? latest.sleep_secs / 3600 : null,
      mean: baselines.sleepMinutes.count ? baselines.sleepMinutes.mean / 60 : null,
      score: latest && isNum(latest.sleep_score) ? latest.sleep_score : null,
      unit: 'giờ',
      basis: 'Đêm qua',
    },
    resp: {
      value: latest && isNum(latest.respiration) ? latest.respiration : null,
      mean: baselines.respiration.count ? baselines.respiration.mean : null,
      unit: '/ph',
      basis: 'Đêm qua',
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
