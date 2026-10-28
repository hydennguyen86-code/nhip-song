/**
 * The 10-second morning verdict.
 *
 * This is NOT a WHOOP Recovery clone. We do not output a 0–100 score pretending
 * to be a physiological measurement. We output one of a small set of qualitative
 * conclusions and list the reasons that produced it, plus what is missing.
 *
 * Priority order (never overridden):
 *   1. Red-flag symptoms → stop exercise, seek emergency care.
 *   2. User checkin "tired / sick" → recovery, ignore HRV/RHR counter-evidence.
 *   3. Serious data gap → "Chưa đủ dữ liệu".
 *   4. Baseline comparisons → "Ưu tiên hồi phục" / "Theo kế hoạch vừa sức".
 *
 * Signal handling follows standard sports-science practice for wearables:
 *   - HRV is compared as a 7-day rolling mean (Plews et al.), because a single
 *     night of rMSSD has day-to-day CV of ~5–10% and one low night is often
 *     noise, not a training state.
 *   - RHR, sleep and respiratory rate use last night's value (they are less
 *     noisy), compared to a personal 30-day window as z-scores.
 *   - The z thresholds are user-adjustable reference rules, not clinical
 *     cutoffs (see advice_settings).
 */
import { computeBaselines, compare, recentLoad, rollingMean } from './baseline.mjs';

const VERDICT = {
  EMERGENCY: 'emergency',
  REST: 'rest',
  RECOVER: 'recover',
  EASE: 'ease',
  PLAN: 'plan',
  UNKNOWN: 'unknown',
};

const LABEL = {
  [VERDICT.EMERGENCY]: 'NGƯNG TẬP — cần hỗ trợ y tế',
  [VERDICT.REST]: 'Hôm nay nên nghỉ hoàn toàn',
  [VERDICT.RECOVER]: 'Nên ưu tiên hồi phục',
  [VERDICT.EASE]: 'Nên giảm nhẹ giáo án',
  [VERDICT.PLAN]: 'Có thể theo kế hoạch vừa sức',
  [VERDICT.UNKNOWN]: 'Chưa đủ dữ liệu để kết luận',
};

const RED_FLAG_KEYWORDS = ['đau ngực', 'dut nguc', 'kho tho', 'khó thở', 'nga?t', 'ngất', 'gần ngất', 'gan nga?t', 'chóng mặt dữ dội'];

function hasRedFlag(checkin) {
  if (!checkin) return false;
  if (checkin.red_flag === 1) return true;
  if (checkin.level === 'serious') return true;
  const text = `${String(checkin.symptoms || '')} ${String(checkin.note || '')}`.toLowerCase();
  return RED_FLAG_KEYWORDS.some((k) => text.includes(k));
}

function fmtBpm(n) { return n === null || n === undefined ? '—' : `${Math.round(n)}`; }
function fmtMs(n) { return n === null || n === undefined ? '—' : `${n.toFixed(1)}`; }
function fmtMin(n) { return n === null || n === undefined ? '—' : `${Math.floor(n / 60)}h${String(Math.round(n % 60)).padStart(2, '0')}`; }
function fmtResp(n) { return n === null || n === undefined ? '—' : `${n.toFixed(1)}`; }

const DEFAULT_SETTINGS = {
  rhr_on: 1, hrv_on: 1, sleep_on: 1,
  rhr_z: 1.0, hrv_z: 1.0, sleep_z: 1.0, strong_z: 2.0,
};

/** Build the morning card. `settings` comes from advice_settings (per user). */
export function buildAdvice({ user, today, wellness, activities, checkin, settings = DEFAULT_SETTINGS }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const reasons = [];
  const gaps = [];
  const red = hasRedFlag(checkin);

  if (red) {
    return {
      verdict: VERDICT.EMERGENCY,
      label: LABEL[VERDICT.EMERGENCY],
      headline: 'Dừng buổi tập và tìm hỗ trợ y tế khẩn cấp.',
      reasons: ['Bạn báo triệu chứng nặng: đau ngực, khó thở rõ, ngất hoặc gần ngất.'],
      gaps: [],
      emergency: {
        show: true,
        text: 'Gọi 115 (Việt Nam) hoặc đến khoa cấp cứu gần nhất. Không cố tập, không cố "vượt qua".',
      },
      checkin,
      today,
    };
  }

  // Wellness rows are already exclusion-filtered upstream.
  const baselines = computeBaselines(wellness, today);
  const latest = wellness.filter((w) => w.date === today)[0] || null;

  // ---- RHR (last night vs 30-day baseline) ----
  if (s.rhr_on) {
    if (baselines.rhr.count >= 7 && latest?.resting_hr) {
      const c = compare(latest.resting_hr, baselines.rhr, { higherIsBetter: false });
      reasons.push({
        kind: 'rhr',
        text: `Nhịp tim nghỉ hôm nay ${fmtBpm(c.value)} vs nền 30 ngày ${fmtBpm(c.mean)} bpm — ${c.word}.`,
        ...c,
      });
    } else {
      gaps.push({ kind: 'rhr', text: `Chưa đủ dữ liệu RHR (cần ≥7 ngày trong 30 ngày nền và có số hôm nay). Hiện có ${baselines.rhr.count} ngày nền.` });
    }
  } else {
    reasons.push({ kind: 'rhr-off', text: 'Bạn đã tắt nhận xét RHR trong cài đặt ngưỡng.' });
  }

  // ---- HRV (7-day rolling mean, rMSSD vs SDNN never merged) ----
  const hrvSource = s.hrv_on ? chooseHrv(wellness, baselines) : null;
  if (hrvSource) {
    reasons.push({ kind: 'hrv', text: hrvSource.text, ...hrvSource.comparison });
  } else if (s.hrv_on) {
    gaps.push({ kind: 'hrv', text: `HRV cần tối thiểu ${baselines.hrvRmssd.minDays} ngày cùng loại (rMSSD hoặc SDNN) và ≥3 ngày đo trong 7 ngày gần nhất. Hiện có rMSSD=${baselines.hrvRmssd.daysAvailable} ngày (${baselines.hrvRmssd.tier}), SDNN=${baselines.hrvSdnn.daysAvailable} ngày (${baselines.hrvSdnn.tier}).` });
  } else {
    reasons.push({ kind: 'hrv-off', text: 'Bạn đã tắt nhận xét HRV trong cài đặt ngưỡng.' });
  }

  // ---- Sleep ----
  if (s.sleep_on) {
    if (baselines.sleepMinutes.count >= 7 && latest?.sleep_secs) {
      const minutes = latest.sleep_secs / 60;
      const c = compare(minutes, baselines.sleepMinutes, { higherIsBetter: true });
      reasons.push({ kind: 'sleep', text: `Ngủ ${fmtMin(minutes)} so với nền ${fmtMin(c.mean)} — ${c.word}.`, ...c });
    } else {
      gaps.push({ kind: 'sleep', text: `Chưa đủ lịch sử ngủ (cần ≥7 ngày). Hiện có ${baselines.sleepMinutes.count} ngày.` });
    }
  } else {
    reasons.push({ kind: 'sleep-off', text: 'Bạn đã tắt nhận xét ngủ trong cài đặt ngưỡng.' });
  }

  // ---- Respiratory rate (supplemental: illness marker, only when present) ----
  if (baselines.respiration.count >= 7 && latest?.respiration) {
    const c = compare(latest.respiration, baselines.respiration, { higherIsBetter: false });
    reasons.push({ kind: 'resp', text: `Nhịp thở hôm nay ${fmtResp(c.value)} so với nền ${fmtResp(c.mean)} lần/phút — ${c.word}.`, ...c, supplemental: true });
  }

  // ---- Steps (today is never a "today total" until the day ends) ----
  const yRow = wellness.filter((w) => w.date === previousDate(today))[0];
  if (yRow?.steps) {
    reasons.push({ kind: 'steps', text: `Bước hôm qua ${yRow.steps.toLocaleString('vi-VN')}. (Không dùng số hôm nay vì ngày chưa kết thúc.)` });
  } else {
    gaps.push({ kind: 'steps', text: 'Chưa có số bước của ngày hôm qua.' });
  }

  // ---- Recent training load ----
  const load = recentLoad(activities, today, 7);
  if (load.sessions > 0) {
    reasons.push({ kind: 'load', text: `7 ngày qua: ${load.sessions} buổi, tổng tải ${Math.round(load.totalLoad)}, ${Math.round(load.totalMinutes)} phút. ${load.note}` });
  } else {
    reasons.push({ kind: 'load', text: '7 ngày qua không có dữ liệu buổi tập trong Intervals.icu.' });
  }

  // ---- Check-in overrides (tired / sick) ----
  if (checkin && checkin.level === 'sick') {
    return finalize(VERDICT.REST, LABEL[VERDICT.REST], 'Bạn báo đang bệnh. Ưu tiên hồi phục, bỏ qua phân tích đồng hồ.', reasons, gaps, { checkin, today, baselines, load });
  }
  if (checkin && checkin.level === 'tired') {
    return finalize(VERDICT.RECOVER, LABEL[VERDICT.RECOVER], 'Bạn báo mệt / ngủ kém — ưu tiên hồi phục dù số đồng hồ có thể cho thấy khác.', reasons, gaps, { checkin, today, baselines, load });
  }

  // ---- Insufficient data ----
  const measurable = reasons.filter((r) => ['rhr', 'hrv', 'sleep'].includes(r.kind)).length;
  if (measurable === 0) {
    return finalize(VERDICT.UNKNOWN, LABEL[VERDICT.UNKNOWN], 'Chưa có đủ RHR / HRV / ngủ để kết luận. Hãy bấm Đồng bộ hoặc chờ thêm ngày.', reasons, gaps, { checkin, today, baselines, load });
  }

  // ---- Quantitative signal aggregation (z-score reference rules) ----
  const warn = reasons.filter((r) => r.ready && r.z !== undefined && (
    (r.kind === 'rhr' && r.z > s.rhr_z) ||
    (r.kind === 'hrv' && r.z < -s.hrv_z) ||
    (r.kind === 'sleep' && r.z < -s.sleep_z)
  )).length;
  const strongWarn = reasons.filter((r) => r.ready && r.z !== undefined && Math.abs(r.z) > s.strong_z).length;

  if (strongWarn >= 2 || warn >= 3) return finalize(VERDICT.REST, LABEL[VERDICT.REST], 'Nhiều chỉ số lệch nền rõ rệt theo hướng xấu.', reasons, gaps, { checkin, today, baselines, load });
  if (warn >= 2) return finalize(VERDICT.RECOVER, LABEL[VERDICT.RECOVER], 'Vài chỉ số dưới nền — nên ưu tiên hồi phục.', reasons, gaps, { checkin, today, baselines, load });
  if (warn === 1) return finalize(VERDICT.EASE, LABEL[VERDICT.EASE], 'Một chỉ số lệch nền — buổi tập nên nhẹ hơn dự kiến.', reasons, gaps, { checkin, today, baselines, load });
  return finalize(VERDICT.PLAN, LABEL[VERDICT.PLAN], 'Các chỉ số trong khoảng nền cá nhân.', reasons, gaps, { checkin, today, baselines, load });
}

function chooseHrv(wellness, baselines) {
  // Prefer rMSSD when its baseline is ready; otherwise SDNN. Never blend.
  const rmssdReady = baselines.hrvRmssd.baseline;
  const sdnnReady = baselines.hrvSdnn.baseline;
  if (!rmssdReady && !sdnnReady) return null;
  const useRmssd = Boolean(rmssdReady) || !sdnnReady;
  const name = useRmssd ? 'rMSSD' : 'SDNN';
  const field = useRmssd ? 'hrv_rmssd' : 'hrv_sdnn';
  const baseline = useRmssd ? baselines.hrvRmssd : baselines.hrvSdnn;
  const roll = rollingMean(wellness, field, baselines.targetDate);
  if (!roll) return null;
  const cmp = compare(roll.value, baseline.baseline, { higherIsBetter: true });
  return {
    text: `HRV ${name} 7 ngày gần nhất ${fmtMs(cmp.value)} ms so với nền ${fmtMs(cmp.mean)} ms (${baseline.baseline.count} ngày, mức ${baseline.tier}) — ${cmp.word}.`,
    comparison: { ...cmp, which: name, smoothed: true, smoothedDays: roll.count, tier: baseline.tier },
  };
}

function finalize(verdict, label, headline, reasons, gaps, extra) {
  return { verdict, label, headline, reasons, gaps, emergency: { show: false }, ...extra };
}

function previousDate(d) {
  const t = new Date(d + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

export { VERDICT, LABEL, DEFAULT_SETTINGS };
