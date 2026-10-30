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
 * Signal handling (models in signals.mjs):
 *   - HRV: ln(rMSSD), 60% last night + 40% 7-day mean, robust z vs a 60-day
 *     median/MAD baseline (spread floor 0.07 so one noisy night is not drama);
 *     SWC and 7-day CV are reported (Plews, Buchheit et al.).
 *   - RHR: last night vs 30-day median, robust z.
 *   - Sleep: obtained / need. < 85% = warning, < 70% = strong warning.
 *   - Respiratory rate: one-sided flag. Only a rise counts; a rise together
 *     with RHR up or HRV down = "body may be fighting something" → recover.
 *   - Only the BAD direction of a signal can count as a warning.
 *   - RHR/HRV z thresholds are user-adjustable reference rules, not clinical
 *     cutoffs (see advice_settings). The sleep cut-off is fixed at 85% of need.
 */
import { computeBaselines, recentLoad } from './baseline.mjs';
import { hrvModel, rhrModel, sleepPerformance, respiratorySignal, SLEEP_PERF } from './signals.mjs';

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
function fmtMin(n) {
  if (n === null || n === undefined) return '—';
  const m = Math.round(n);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}
function fmtResp(n) { return n === null || n === undefined ? '—' : `${n.toFixed(1)}`; }

const DEFAULT_SETTINGS = {
  rhr_on: 1, hrv_on: 1, sleep_on: 1,
  rhr_z: 1.0, hrv_z: 1.0, sleep_z: 1.0, strong_z: 2.0,
};

/** Build the morning card. `settings` comes from advice_settings (per user). */
export function buildAdvice({ user, today, wellness, activities = [], checkin, settings = DEFAULT_SETTINGS, sickDates = null }) {
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
  const baselines = computeBaselines(wellness, today, { sickDates });

  // ---- RHR (last night vs robust 30-day median) ----
  if (s.rhr_on) {
    const rhr = rhrModel(wellness, today, { sickDates });
    if (rhr.ready) {
      const word = rhr.z <= -0.5 ? 'tốt hơn nền' : rhr.z >= 0.5 ? 'cao hơn nền' : 'trong khoảng nền';
      reasons.push({
        kind: 'rhr',
        text: `Nhịp tim nghỉ hôm nay ${fmtBpm(rhr.value)} vs trung vị 30 ngày ${fmtBpm(rhr.median)} bpm — ${word}.`,
        ready: true, value: rhr.value, mean: rhr.median, z: rhr.z, word,
      });
    } else {
      gaps.push({ kind: 'rhr', text: `Chưa đủ dữ liệu RHR (cần ≥7 ngày trong 30 ngày nền và có số hôm nay). Hiện có ${rhr.count} ngày nền.` });
    }
  } else {
    reasons.push({ kind: 'rhr-off', text: 'Bạn đã tắt nhận xét RHR trong cài đặt ngưỡng.' });
  }

  // ---- HRV (ln, last night + 7-day mean, SWC, CV; rMSSD and SDNN never merged) ----
  if (s.hrv_on) {
    const hrv = hrvModel(wellness, today, { sickDates });
    if (hrv.ready) {
      const parts = [];
      if (hrv.acute) parts.push(`đêm qua ${fmtMs(hrv.acute.value)} ms`);
      if (hrv.chronic) parts.push(`TB ${hrv.chronic.count} ngày ${fmtMs(hrv.chronic.value)} ms`);
      const word = hrv.z >= 0.5 ? 'tốt hơn nền' : hrv.z <= -0.5 ? 'thấp hơn nền' : 'trong khoảng nền';
      let text = `HRV ${hrv.name} ${parts.join(', ')} so với nền ${fmtMs(hrv.baselineMs)} ms (SWC ${hrv.swc.low.toFixed(0)}–${hrv.swc.high.toFixed(0)}, ${hrv.daysAvailable} ngày, mức ${hrv.tier}) — ${word}.`;
      if (hrv.cv7?.high) text += ` Dao động 7 ngày cao bất thường (CV ${hrv.cv7.value.toFixed(0)}% vs thường ${hrv.cv7.typical.toFixed(0)}%).`;
      reasons.push({
        kind: 'hrv', text, ready: true, value: (hrv.acute || hrv.chronic).value, mean: hrv.baselineMs, z: hrv.z, word,
        which: hrv.name, smoothed: Boolean(hrv.chronic), smoothedDays: hrv.chronic?.count || 0, tier: hrv.tier,
        acuteZ: hrv.acute?.z ?? null, chronicZ: hrv.chronic?.z ?? null, cvHigh: Boolean(hrv.cv7?.high),
      });
    } else {
      gaps.push({ kind: 'hrv', text: `HRV cần tối thiểu ${hrv.minDays} ngày cùng loại (rMSSD hoặc SDNN) trong ${hrv.windowDays} ngày và số đêm qua hoặc ≥3 ngày trong 7 ngày gần nhất. Hiện có ${hrv.name}=${hrv.daysAvailable} ngày (${hrv.tier}).` });
    }
  } else {
    reasons.push({ kind: 'hrv-off', text: 'Bạn đã tắt nhận xét HRV trong cài đặt ngưỡng.' });
  }

  // ---- Sleep (obtained / need, not vs own average) ----
  if (s.sleep_on) {
    const sp = sleepPerformance(wellness, activities, today);
    if (sp.ready) {
      const pct = Math.round(sp.pct * 100);
      const word = sp.pct >= SLEEP_PERF.good ? 'đủ nhu cầu' : sp.pct >= SLEEP_PERF.warn ? 'gần đủ' : 'thiếu ngủ';
      reasons.push({
        kind: 'sleep',
        text: `Ngủ ${fmtMin(sp.actualMin)} / nhu cầu ${fmtMin(sp.needMin)} (${pct}%) — ${word}.${sp.suspect ? ' Dưới 3 giờ: nếu là lỗi đồng bộ, hãy đánh dấu sai.' : ''}`,
        ready: true, value: sp.actualMin, need: sp.needMin, pct: sp.pct, word,
      });
    } else {
      gaps.push({ kind: 'sleep', text: 'Chưa có dữ liệu ngủ đêm qua.' });
    }
  } else {
    reasons.push({ kind: 'sleep-off', text: 'Bạn đã tắt nhận xét ngủ trong cài đặt ngưỡng.' });
  }

  // ---- Respiratory rate: one-sided illness flag, only a RISE counts ----
  const resp = respiratorySignal(wellness, today, { sickDates });
  if (resp.state === 'elevated' || resp.state === 'normal') {
    reasons.push({
      kind: 'resp',
      text: resp.state === 'elevated'
        ? `Nhịp thở ${fmtResp(resp.value)} lần/phút, cao hơn trung vị ${fmtResp(resp.median)} +${fmtResp(resp.delta)} — cờ cảnh báo sớm (sốt, nhiễm trùng, rượu, nóng).`
        : `Nhịp thở ${fmtResp(resp.value)} lần/phút, trung vị ${fmtResp(resp.median)} — không tăng bất thường.`,
      ready: true, value: resp.value, mean: resp.median, z: resp.z, elevated: resp.state === 'elevated', strong: resp.strong, supplemental: true,
    });
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

  // ---- Quantitative signal aggregation (only the BAD direction counts) ----
  const get = (k) => reasons.find((r) => r.kind === k && r.ready);
  const rhrR = get('rhr');
  const hrvR = get('hrv');
  const sleepR = get('sleep');
  const respR = get('resp');
  const flags = {
    rhr: Boolean(rhrR && rhrR.z > s.rhr_z),
    hrv: Boolean(hrvR && hrvR.z < -s.hrv_z),
    sleep: Boolean(sleepR && sleepR.pct < SLEEP_PERF.warn),
    resp: Boolean(respR && respR.elevated),
  };
  const strong = {
    rhr: Boolean(rhrR && rhrR.z > s.strong_z),
    hrv: Boolean(hrvR && hrvR.z < -s.strong_z),
    sleep: Boolean(sleepR && sleepR.pct < SLEEP_PERF.strong),
    resp: Boolean(respR && respR.strong),
  };
  const warn = Object.values(flags).filter(Boolean).length;
  const strongWarn = Object.values(strong).filter(Boolean).length;
  const illness = flags.resp && (flags.rhr || flags.hrv);
  const extra = { checkin, today, baselines, load, flags };

  if (strongWarn >= 2 || warn >= 3) return finalize(VERDICT.REST, LABEL[VERDICT.REST], 'Nhiều chỉ số lệch nền rõ rệt theo hướng xấu.', reasons, gaps, extra);
  if (illness) return finalize(VERDICT.RECOVER, LABEL[VERDICT.RECOVER], `Nhịp thở tăng cùng ${flags.rhr ? 'nhịp tim nghỉ tăng' : 'HRV giảm'} — dấu hiệu cơ thể có thể đang chống bệnh. Theo dõi nhiệt độ, ưu tiên nghỉ.`, reasons, gaps, extra);
  if (warn >= 2) return finalize(VERDICT.RECOVER, LABEL[VERDICT.RECOVER], 'Vài chỉ số xấu hơn nền hoặc thiếu ngủ — nên ưu tiên hồi phục.', reasons, gaps, extra);
  if (warn === 1) {
    const which = flags.sleep ? 'Ngủ chưa đủ nhu cầu' : flags.resp ? 'Nhịp thở tăng bất thường' : 'Một chỉ số lệch nền';
    return finalize(VERDICT.EASE, LABEL[VERDICT.EASE], `${which} — buổi tập nên nhẹ hơn dự kiến.`, reasons, gaps, extra);
  }
  return finalize(VERDICT.PLAN, LABEL[VERDICT.PLAN], 'Các chỉ số trong khoảng nền cá nhân, ngủ đủ nhu cầu.', reasons, gaps, extra);
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
