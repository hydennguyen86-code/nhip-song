/**
 * Pattern engine: "what happens to MY next mornings after X?"
 *
 * Deterministic statistics, no AI. The AI layer only reads the table this
 * produces. Method (n-of-1, descriptive, not causal):
 *
 *   Outcome of each morning M (wellness row M = the night before M), each
 *   against the person's own baseline BEFORE M:
 *     - HRV: z of ln(rMSSD_M) vs the 60 days before M (median / MAD, floor 0.07,
 *       ≥ 14 days) — the same scale as the recovery index. 1 SWC = 0.5 z.
 *     - Resting HR: bpm above the 30-day median before M (≥ 7 days).
 *     - Sleep: minutes vs the 30-day mean before M (≥ 7 nights).
 *
 *   Distributed-lag regression, so overlapping habits are separated (a leg day
 *   followed by pickleball, chest days that always come after a leg day):
 *     outcome(M) = a + Σ_f Σ_{k=1..3} b[f,k] · [f happened on day M−k]
 *   fitted on mornings whose 3 previous days are all known (context saved, or
 *   activity-derived factors), with a light ridge penalty (λ = 1) for
 *   stability. b[f,k] is "the change on the k-th morning after f, other
 *   recorded factors held equal". 95 % interval from the ridge sandwich
 *   covariance and a t value for the residual degrees of freedom.
 *   Factors with < 4 event days are not fitted ("chưa đủ dữ liệu").
 *
 *   Confidence (from the lag-1 HRV coefficient). Many factors × 3 lags are
 *   tested at once, so "clear" uses a stricter 99 % interval:
 *     clear:    ≥ 8 events, 99 % interval excludes 0, |effect| ≥ 1 SWC
 *     possible: |effect| ≥ 1 SWC but fewer events or the interval touches 0
 *     none:     ≥ 8 events, |effect| < 0.5 SWC and interval within ±1 SWC
 *     unclear:  everything else
 *   Inseparable: when the factor's lag-1 column is almost identical (|r| ≥ 0.9)
 *   to another column — e.g. a rigid weekly plan where "leg 1 day ago" always
 *   equals "shoulders 3 days ago" — no method can split them. The factor is
 *   then marked "chưa tách được" and never called clear or none.
 *   Affected days: consecutive lags from 1 with an HRV drop ≥ 1 SWC.
 *   "Often with": another factor on the same or next day in ≥ 40 % of cases
 *   and ≥ 1.5× its usual rate, shown so the reader knows two habits travel together.
 *   Sick days (check-in "sick") are excluded from outcomes and baselines.
 *
 *   Dose factors (drinks, hours late/early to bed, watch load of pickleball and
 *   gym days): the column holds dose ÷ the person's usual dose (median over
 *   their event days, capped at 3×), so b[f,k] is the change at the USUAL
 *   amount and the ridge penalty stays on the same scale as yes/no factors.
 *   Per-unit effect = b ÷ usual dose (assumes a straight line).
 */
import { robustStats, plausible, HRV_LN_SPREAD_FLOOR, addDays, hrvSourceOf, sameHrvSource } from './signals.mjs';
import { FACTORS, buildDayFacts, addBedtimeDeviation, PRIVATE_FIELDS } from './context.mjs';

export const PATTERN_RULES = Object.freeze({
  lags: [1, 2, 3], minEvents: 4, maxDoseRatio: 3, clearEvents: 8, minObsExtra: 10, ridge: 1, swcZ: 0.5, oftenWithShare: 0.4,
  hrvWindow: 60, hrvMin: 14, rhrWindow: 30, rhrMin: 7, sleepWindow: 30, sleepMin: 7,
});

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1); };
const T99 = [null, 63.66, 9.92, 5.84, 4.6, 4.03, 3.71, 3.5, 3.36, 3.25, 3.17, 3.11, 3.05, 3.01, 2.98, 2.95, 2.92, 2.9, 2.88, 2.86, 2.85];
export const tCrit99 = (df) => (df < 1 ? Infinity : df <= 20 ? T99[Math.floor(df)] : df <= 30 ? 2.75 : df <= 60 ? 2.66 : 2.62);
const T95 = [null, 12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.2, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.1, 2.09, 2.09];
export const tCrit = (df) => (df < 1 ? Infinity : df <= 20 ? T95[Math.floor(df)] : df <= 30 ? 2.05 : df <= 60 ? 2.0 : 1.98);

/** Welch difference of means with 95 % interval (kept for simple comparisons). */
export function welch(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const va = variance(a) / a.length;
  const vb = variance(b) / b.length;
  const se = Math.sqrt(va + vb);
  const diff = mean(a) - mean(b);
  const df = se === 0 ? a.length + b.length - 2 : (va + vb) ** 2 / ((va ** 2) / (a.length - 1) + (vb ** 2) / (b.length - 1));
  const h = tCrit(df) * se;
  return { diff, lo: diff - h, hi: diff + h, se, df, nA: a.length, nB: b.length };
}

/* ------------------------------------------------- small linear algebra -- */

function invert(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row.slice(n));
}
const matMul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));

/**
 * Ridge regression with intercept (intercept not penalised).
 * @returns {{ beta: number[], se: number[], df: number, sigma: number }|null}
 */
export function ridgeFit(X, y, lambda = 1) {
  const n = X.length;
  const p = X[0].length;
  if (n < p + 2) return null;
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const A = XtX.map((row, i) => row.map((v, j) => v + (i === j && i > 0 ? lambda : 0)));
  const Ainv = invert(A);
  if (!Ainv) return null;
  const Xty = Array.from({ length: p }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  const beta = Ainv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  const resid = y.map((yy, k) => yy - X[k].reduce((s, v, j) => s + v * beta[j], 0));
  const df = Math.max(1, n - p);
  const sigma2 = resid.reduce((s, r) => s + r * r, 0) / df;
  const cov = matMul(matMul(Ainv, XtX), Ainv);
  return { beta, se: cov.map((row, i) => Math.sqrt(Math.max(0, row[i] * sigma2))), df, sigma: Math.sqrt(sigma2) };
}

/* ----------------------------------------------------------- outcomes -- */

/** Per-morning outcomes, each against its own prior baseline. */
export function morningOutcomes(wellness, { sickDates = null } = {}) {
  const R = PATTERN_RULES;
  const rows = [...wellness].sort((a, b) => (a.date < b.date ? -1 : 1));
  const prior = (i, field, window) => {
    const start = addDays(rows[i].date, -window);
    // HRV z is read against the same kind of HRV only (Apple night vs Intervals.icu day mean).
    const src = field === 'hrv_rmssd' ? hrvSourceOf(rows[i]) : null;
    const out = [];
    for (let j = i - 1; j >= 0 && rows[j].date >= start; j--) {
      const r = rows[j];
      if (sickDates && sickDates.has(r.date)) continue;
      if (src && src !== 'manual' && !sameHrvSource(r, src)) continue;
      if (plausible(field, r[field])) out.push(r[field]);
    }
    return out;
  };
  const out = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (sickDates && sickDates.has(r.date)) continue;
    const o = {};
    if (plausible('hrv_rmssd', r.hrv_rmssd)) {
      const ln = prior(i, 'hrv_rmssd', R.hrvWindow).map(Math.log);
      if (ln.length >= R.hrvMin) {
        const st = robustStats(ln);
        const spread = Math.max(st.spread, HRV_LN_SPREAD_FLOOR);
        o.hrvZ = (Math.log(r.hrv_rmssd) - st.median) / spread;
        o.hrvSpread = spread;
      }
    }
    if (plausible('resting_hr', r.resting_hr)) {
      const v = prior(i, 'resting_hr', R.rhrWindow);
      if (v.length >= R.rhrMin) o.rhrDelta = r.resting_hr - robustStats(v).median;
    }
    if (plausible('sleep_secs', r.sleep_secs)) {
      const v = prior(i, 'sleep_secs', R.sleepWindow);
      if (v.length >= R.sleepMin) o.sleepDeltaMin = (r.sleep_secs - mean(v)) / 60;
    }
    if (Object.keys(o).length) out.set(r.date, o);
  }
  return out;
}

function confidenceOf(c, nEvents, inseparable = false) {
  const R = PATTERN_RULES;
  if (!c || nEvents < R.minEvents) return 'insufficient';
  if (inseparable) return 'unclear';
  const big = Math.abs(c.est) >= R.swcZ;
  if (nEvents >= R.clearEvents && (c.lo99 > 0 || c.hi99 < 0) && big) return 'clear';
  if (big) return 'possible';
  if (nEvents >= R.clearEvents && Math.abs(c.est) < R.swcZ / 2 && c.lo > -R.swcZ && c.hi < R.swcZ) return 'none';
  return 'unclear';
}

export const CONFIDENCE_LABEL = Object.freeze({
  clear: 'rõ', possible: 'có thể', none: 'chưa thấy ảnh hưởng', unclear: 'chưa rõ', insufficient: 'chưa đủ dữ liệu',
});

const fmt = (n, d = 0) => (n == null ? '—' : n.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = (n, d = 0) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), d)}`);

const UNIT_TEXT = { ly: 'ly', 'giờ': 'giờ', load: 'load', 'phút': 'phút' };
function doseText(d) {
  if (!d) return '';
  if (d.unit === 'load') return `${fmt(d.usual, 0)} load${d.usualMinutes ? `, khoảng ${fmt(d.usualMinutes, 0)} phút` : ''}`;
  return `${fmt(d.usual, d.unit === 'giờ' ? 1 : 0)} ${UNIT_TEXT[d.unit] || d.unit}`;
}

function summarize(f) {
  const l1 = f.lags[0];
  if (f.confidence === 'insufficient') {
    return f.nEvents < PATTERN_RULES.minEvents
      ? `${f.label}: mới có ${f.nEvents} lần, cần ít nhất ${PATTERN_RULES.minEvents} lần để so sánh.`
      : `${f.label}: có ${f.nEvents} lần nhưng chưa đủ ngày ghi bối cảnh liền nhau để tách khỏi các yếu tố khác.`;
  }
  const parts = [];
  if (l1.hrv) parts.push(`HRV sáng hôm sau ${signed(l1.hrv.pct, 0)}% (${signed(l1.hrv.swc, 1)} SWC)`);
  if (l1.rhr) parts.push(`nhịp tim nghỉ ${signed(l1.rhr.diff, 1)} bpm`);
  if (l1.sleep) parts.push(`ngủ ${signed(l1.sleep.diff, 0)} phút`);
  let s = `Sau ngày ${f.label.toLowerCase()}${f.dose ? ` (mức thường của bạn: ${doseText(f.dose)})` : ''}: ${parts.join(', ')}, đã tách ảnh hưởng của các yếu tố khác.`;
  if (f.dose?.perUnit && f.dose.hrvPctPerUnit != null) s += ` Tính ra mỗi ${f.dose.unit} HRV ${signed(f.dose.hrvPctPerUnit, 1)}%.`;
  if (f.affectedDays >= 2) s += ` HRV còn thấp ${f.affectedDays > 3 ? 'hơn 3' : f.affectedDays} ngày.`;
  if (f.inseparable) s += ` Chưa tách được: luôn trùng với ${f.inseparable.label.toLowerCase()} ${f.inseparable.lag === 1 ? 'cùng ngày' : `${f.inseparable.lag - 1} ngày trước đó`}; muốn biết riêng thì thỉnh thoảng đổi lịch.`;
  else if (f.oftenWith) s += ` Thường đi kèm ${f.oftenWith.label.toLowerCase()} (${Math.round(f.oftenWith.share * 100)}% số lần).`;
  return `${s} (${f.nEvents} lần, ${CONFIDENCE_LABEL[f.confidence]})`;
}

/**
 * @returns {{ factors: object[], rules: object, loggedDays: number, observations: number, symptomDays: number, note: string }}
 */
export function computePatterns({ wellness, contexts, checkins = [], activities = [], sickDates = null, today, symptomWindowDays = 90 }) {
  const R = PATTERN_RULES;
  const outcomes = morningOutcomes(wellness, { sickDates });
  const days = addBedtimeDeviation(buildDayFacts({ contexts, checkins, activities }));
  const spreads = [...outcomes.values()].map((o) => o.hrvSpread).filter(Boolean);
  const typicalSpread = spreads.length ? mean(spreads) : HRV_LN_SPREAD_FLOOR;

  const known = (f, d) => { const x = days.get(d); return f.source === 'activity' ? true : Boolean(x && x._logged); };
  const has = (f, d) => { const x = days.get(d); return Boolean(x && f.test(x)); };
  const eventDays = new Map(FACTORS.map((f) => [f.id, [...days.keys()].filter((d) => known(f, d) && has(f, d)).sort()]));
  const fitted = FACTORS.filter((f) => eventDays.get(f.id).length >= R.minEvents);

  // Usual dose per dose factor = median over its event days with a known dose.
  const median = (xs) => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const usualDose = new Map();
  const usualMin = new Map();
  for (const f of FACTORS) {
    if (!f.dose) continue;
    const ds = eventDays.get(f.id).map((d) => f.dose(days.get(d))).filter((v) => Number.isFinite(v) && v > 0);
    if (ds.length) usualDose.set(f.id, median(ds));
    if (f.minutes) {
      const ms = eventDays.get(f.id).map((d) => f.minutes(days.get(d))).filter((v) => Number.isFinite(v) && v > 0);
      if (ms.length) usualMin.set(f.id, median(ms));
    }
  }
  /** Column value of factor f on day d: 0 if it did not happen, else dose ÷ usual dose (1 for yes/no factors). */
  const value = (f, d) => {
    if (!has(f, d)) return 0;
    const usual = usualDose.get(f.id);
    if (!usual) return 1;
    const v = f.dose(days.get(d));
    return Number.isFinite(v) && v > 0 ? Math.min(v / usual, R.maxDoseRatio) : 1;
  };

  // Mornings whose previous 3 days are known for every fitted factor.
  const usable = [...outcomes.keys()].filter((m) => fitted.every((f) => R.lags.every((k) => known(f, addDays(m, -k)))));
  const design = (m) => [1, ...fitted.flatMap((f) => R.lags.map((k) => value(f, addDays(m, -k))))];

  const fit = (key) => {
    const ms = usable.filter((m) => typeof outcomes.get(m)[key] === 'number');
    const p = 1 + fitted.length * R.lags.length;
    if (!fitted.length || ms.length < p + R.minObsExtra) return null;
    const res = ridgeFit(ms.map(design), ms.map((m) => outcomes.get(m)[key]), R.ridge);
    return res && { ...res, n: ms.length };
  };
  const fits = { hrv: fit('hrvZ'), rhr: fit('rhrDelta'), sleep: fit('sleepDeltaMin') };

  // Columns that are (almost) the same cannot be told apart.
  const hrvMornings = usable.filter((m) => typeof outcomes.get(m).hrvZ === 'number');
  const cols = fitted.flatMap((f) => R.lags.map((k) => ({ f, k, v: hrvMornings.map((m) => value(f, addDays(m, -k))) })));
  const corr = (a, b) => {
    const ma = mean(a); const mb = mean(b);
    let sab = 0; let saa = 0; let sbb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  };
  const inseparableOf = (f) => {
    const mine = cols.find((c) => c.f === f && c.k === 1);
    if (!mine || !hrvMornings.length) return null;
    let worst = null;
    for (const c of cols) {
      if (c.f === f) continue;
      const r = Math.abs(corr(mine.v, c.v));
      if (r >= 0.9 && (!worst || r > worst.r)) worst = { id: c.f.id, label: c.f.label, lag: c.k, r };
    }
    return worst;
  };
  const coef = (fitRes, fi, li) => {
    if (!fitRes) return null;
    const j = 1 + fi * R.lags.length + li;
    const h = tCrit(fitRes.df) * fitRes.se[j];
    const h99 = tCrit99(fitRes.df) * fitRes.se[j];
    return { est: fitRes.beta[j], lo: fitRes.beta[j] - h, hi: fitRes.beta[j] + h, lo99: fitRes.beta[j] - h99, hi99: fitRes.beta[j] + h99 };
  };

  const results = [];
  for (const f of FACTORS) {
    const events = eventDays.get(f.id);
    if (!events.length) continue;
    const fi = fitted.indexOf(f);
    const lags = R.lags.map((k, li) => {
      const h = fi >= 0 ? coef(fits.hrv, fi, li) : null;
      const r = fi >= 0 ? coef(fits.rhr, fi, li) : null;
      const s = fi >= 0 ? coef(fits.sleep, fi, li) : null;
      return {
        k,
        hrv: h && { diffZ: h.est, swc: h.est / R.swcZ, pct: (Math.exp(h.est * typicalSpread) - 1) * 100, ci: [h.lo, h.hi] },
        rhr: r && { diff: r.est, ci: [r.lo, r.hi] },
        sleep: s && { diff: s.est, ci: [s.lo, s.hi] },
        _h: h,
      };
    });
    const nUsed = fits.hrv ? usable.filter((m) => has(f, addDays(m, -1)) && typeof outcomes.get(m).hrvZ === 'number').length : 0;
    const inseparable = fi >= 0 && fits.hrv ? inseparableOf(f) : null;
    const confidence = confidenceOf(lags[0]._h, Math.min(events.length, nUsed || events.length), Boolean(inseparable));
    let affectedDays = 0;
    for (const l of lags) { if (l.hrv && l.hrv.diffZ <= -R.swcZ) affectedDays++; else break; }
    if (affectedDays === R.lags.length) affectedDays = R.lags.length + 1;

    // "Often with": clearly more often than that habit's usual rate (≥ 40 % and ≥ 1.5× base rate).
    let oftenWith = null;
    if (events.length >= R.minEvents) {
      const allDays = [...days.keys()].filter((d) => days.get(d)._logged);
      for (const g of FACTORS) {
        if (g.id === f.id) continue;
        const near = (d) => has(g, d) || has(g, addDays(d, 1));
        const share = events.filter(near).length / events.length;
        const base = allDays.length ? allDays.filter(near).length / allDays.length : 0;
        if (share >= R.oftenWithShare && share >= 1.5 * base && (!oftenWith || share > oftenWith.share)) oftenWith = { id: g.id, label: g.label, share };
      }
    }

    const usual = usualDose.get(f.id);
    const l1hrv = lags[0].hrv;
    const dose = usual ? {
      unit: f.unit,
      usual,
      usualMinutes: usualMin.get(f.id) ?? null,
      perUnit: Boolean(f.perUnit),
      hrvPctPerUnit: l1hrv ? (Math.exp((l1hrv.diffZ / usual) * typicalSpread) - 1) * 100 : null,
      rhrPerUnit: lags[0].rhr ? lags[0].rhr.diff / usual : null,
    } : null;

    const item = {
      id: f.id,
      label: f.label,
      dose,
      nEvents: events.length,
      nUsed,
      lags: lags.map(({ _h, ...rest }) => rest),
      confidence,
      confidenceLabel: CONFIDENCE_LABEL[confidence],
      affectedDays: confidence === 'insufficient' ? null : affectedDays,
      oftenWith,
      inseparable: inseparable ? { id: inseparable.id, label: inseparable.label, lag: inseparable.lag } : null,
    };
    item.summary = summarize(item);
    results.push(item);
  }

  const order = { clear: 0, possible: 1, none: 2, unclear: 3, insufficient: 4 };
  results.sort((a, b) => order[a.confidence] - order[b.confidence] || (a.lags[0].hrv?.diffZ ?? 0) - (b.lags[0].hrv?.diffZ ?? 0));

  const since = today ? addDays(today, -symptomWindowDays) : '0000-00-00';
  let symptomDays = 0;
  for (const [d, c] of contexts) if (d >= since && PRIVATE_FIELDS.some((k) => c[k])) symptomDays++;

  return {
    factors: results,
    rules: R,
    loggedDays: [...days.values()].filter((d) => d._logged).length,
    observations: fits.hrv ? fits.hrv.n : 0,
    symptomDays,
    symptomWindowDays,
    note: 'Mỗi con số đã tách ảnh hưởng của các yếu tố khác đã ghi. Đây là so sánh trên chính dữ liệu của bạn, không phải quan hệ nhân quả. 1 SWC = mức thay đổi HRV nhỏ nhất có ý nghĩa.',
  };
}
