/* Nhịp Sống — responsive health dashboard. Vanilla JS, no build, no dependencies. */

const app = document.getElementById('app');
const toast = document.getElementById('toast');
const state = { view: 'today', user: null, trendsRange: 30, actRange: 30 };
let uid = 0;

/* ---------------- primitives ---------------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toastMsg(s) {
  toast.textContent = s;
  toast.classList.add('show');
  clearTimeout(toastMsg._t);
  toastMsg._t = setTimeout(() => toast.classList.remove('show'), 3600);
}
async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.body !== undefined) {
    if (typeof opts.body === 'string') { init.body = opts.body; init.headers['Content-Type'] = opts.raw ? 'text/csv' : 'application/json'; }
    else { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  }
  const r = await fetch(path, init);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw Object.assign(new Error(data?.error || 'Lỗi mạng'), { status: r.status, data });
  return data;
}
function value(id) { return document.getElementById(id).value; }

function fmtNum(n, digits = 0) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).length === 10 ? s + 'T12:00:00' : s);
  if (Number.isNaN(+d)) return String(s);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtShort(s) {
  if (!s) return '—';
  const d = new Date(String(s).length === 10 ? s + 'T12:00:00' : s);
  if (Number.isNaN(+d)) return String(s);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
function fmtLong(s) {
  if (!s) return '—';
  const d = new Date(String(s).length === 10 ? s + 'T12:00:00' : s);
  if (Number.isNaN(+d)) return String(s);
  const txt = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(+d)) return String(s);
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function hm(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}
function minutesToClock(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function parseClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 390;
}
function levelLabel(l) { return ({ ok: 'Bình thường', tired: 'Mệt', sick: 'Bệnh', serious: 'Nặng' })[l] || l || '—'; }
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}
function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/* ---------------- icons / logo ---------------- */
const ICONS = {
  today: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.3 3.3a1 1 0 0 1 1.4 0l8 7.4a1 1 0 0 1-.7 1.8H19v7a1.5 1.5 0 0 1-1.5 1.5H15a1 1 0 0 1-1-1v-4.5a2 2 0 0 0-4 0V20a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 19.5v-7H4a1 1 0 0 1-.7-1.8l8-7.4z"/></svg>',
  trends: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 20v-7M12 20V5M18 20v-10"/></svg>',
  activities: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="14.5" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2.5V22M6 11.5l3.5-3.5 4 .5 2.5 3.5 3 1"/><path d="M13.5 8.5L11 15"/></svg>',
  journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  recovery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v8.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5V11z"/><path d="M12 17.5s-3.2-1.9-3.2-4.1a1.8 1.8 0 0 1 3.2-1.1 1.8 1.8 0 0 1 3.2 1.1c0 2.2-3.2 4.1-3.2 4.1z"/></svg>',
  hrv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l2.5-6 4 13 3-9 1.5 2H22"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>',
  bed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-9-1 2.5-2.5 3.5-3.5 3.5C10 7.5 9 6 9 6c-2 2.5-3 5-3 9a6 6 0 0 0 6 6z"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15"/><path d="M5 19c3-4 6-7 10-9"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l5-6 4 3 7-9"/><path d="M4 21h16"/></svg>',
  sun: '<svg class="pill-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
};
let logoN = 0;
function logo() { const n = ++logoN; return `<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lfA${n}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8f5cf"/><stop offset="1" stop-color="#2fae6a"/></linearGradient><linearGradient id="lfB${n}" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ff0b6"/><stop offset="1" stop-color="#22995a"/></linearGradient></defs><path d="M19.5 36c0-9 .5-15 3-20" fill="none" stroke="#3fcf84" stroke-width="2.4" stroke-linecap="round"/><path d="M20.5 22C9 23 4 15 5 4c10 0 16.5 6 15.5 18z" fill="url(#lfA${n})"/><path d="M21.5 19c-.5-9 4.5-15 14-15 .5 10-4.5 15.5-14 15z" fill="url(#lfB${n})"/></svg>`; }

const NAV = [
  { id: 'today', label: 'Hôm nay', icon: 'today' },
  { id: 'trends', label: 'Xu hướng', icon: 'trends' },
  { id: 'activities', label: 'Tập', icon: 'activities' },
  { id: 'journal', label: 'Nhật ký', icon: 'journal' },
  { id: 'settings', label: 'Cài đặt', icon: 'settings' },
];

/* ---------------- charts ---------------- */
function sparkline(values, hex) {
  const iv = ++uid;
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v != null && Number.isFinite(p.v));
  if (pts.length < 2) return `<svg class="spark" viewBox="0 0 120 38" aria-hidden="true"></svg>`;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const range = max - min || 1;
  const x = (i) => 3 + (i / Math.max(1, values.length - 1)) * 114;
  const y = (v) => 34 - ((v - min) / range) * 29;
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = `${d}L${x(last.i).toFixed(1)},38 L${x(first.i).toFixed(1)},38 Z`;
  return `<svg class="spark" viewBox="0 0 120 38" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="sg${iv}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex}" stop-opacity=".3"/><stop offset="1" stop-color="${hex}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#sg${iv})"/>
    <path d="${d}" fill="none" stroke="${hex}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="2.4" fill="${hex}"/>
  </svg>`;
}

function lineChart(series, { color = '#5fe39a', digits = 1, unit = '' } = {}) {
  const valid = series.filter((s) => s.value != null && Number.isFinite(s.value));
  if (!valid.length) return '<div class="empty">Chưa có dữ liệu trong khoảng này.</div>';
  const W = 720, H = 220, P = { l: 44, r: 14, t: 18, b: 28 };
  const innerW = W - P.l - P.r;
  const innerH = H - P.t - P.b;
  let min = Math.min(...valid.map((s) => s.value));
  let max = Math.max(...valid.map((s) => s.value));
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;
  const n = series.length;
  const x = (i) => P.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => P.t + (1 - (v - min) / (max - min)) * innerH;
  let d = '';
  let pen = false;
  series.forEach((s, i) => {
    if (s.value == null || !Number.isFinite(s.value)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.value).toFixed(1)} `;
    pen = true;
  });
  const firstIdx = series.findIndex((s) => s.value != null);
  const lastIdx = series.length - 1 - [...series].reverse().findIndex((s) => s.value != null);
  const area = `${d}L${x(lastIdx).toFixed(1)},${(P.t + innerH).toFixed(1)} L${x(firstIdx).toFixed(1)},${(P.t + innerH).toFixed(1)} Z`;
  const mean = valid.reduce((a, s) => a + s.value, 0) / valid.length;
  const grid = [0, 0.5, 1].map((t) => {
    const gy = P.t + innerH * t;
    const val = max - (max - min) * t;
    return `<line x1="${P.l}" y1="${gy.toFixed(1)}" x2="${W - P.r}" y2="${gy.toFixed(1)}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>
      <text x="${P.l - 8}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end" fill="#7d9187" font-size="10">${fmtNum(val, digits)}</text>`;
  }).join('');
  const last = series[lastIdx];
  const lastX = x(lastIdx), lastY = y(last.value);
  const iv = ++uid;
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ">
    <defs><linearGradient id="lg${iv}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <line x1="${P.l}" y1="${y(mean).toFixed(1)}" x2="${W - P.r}" y2="${y(mean).toFixed(1)}" stroke="rgba(255,255,255,.22)" stroke-width="1" stroke-dasharray="4 5"/>
    <path d="${area}" fill="url(#lg${iv})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4.5" fill="${color}" opacity=".22"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.4" fill="${color}"/>
    <text x="${P.l}" y="${H - 8}" fill="#7d9187" font-size="10">${esc(fmtShort(series[0].date))}</text>
    <text x="${W - P.r}" y="${H - 8}" text-anchor="end" fill="#7d9187" font-size="10">${esc(fmtShort(series[n - 1].date))}</text>
    <text x="${W - P.r}" y="${P.t - 5}" text-anchor="end" fill="#9bb0a4" font-size="10">TB ${fmtNum(mean, digits)}${unit ? ' ' + esc(unit) : ''}</text>
  </svg>`;
}

function recoveryBars(history) {
  const W = 720, H = 190, P = { l: 34, r: 12, t: 14, b: 24 };
  const innerW = W - P.l - P.r;
  const innerH = H - P.t - P.b;
  const n = history.length;
  const gap = n > 45 ? 1 : n > 20 ? 2 : 4;
  const bw = Math.max(1.5, (innerW - gap * (n - 1)) / n);
  const colors = { green: '#5fe39a', yellow: '#f6c445', red: '#ff7a6e', unknown: '#26372e' };
  const bars = history.map((h, i) => {
    const bx = P.l + i * (bw + gap);
    const score = h.score == null ? 0 : h.score;
    const bh = h.score == null ? 2 : Math.max(3, (score / 100) * innerH);
    const by = P.t + innerH - bh;
    return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${colors[h.band] || colors.unknown}"><title>${esc(fmtDate(h.date))}: ${h.score == null ? 'chưa đủ dữ liệu' : h.score}</title></rect>`;
  }).join('');
  const valid = history.filter((h) => h.score != null);
  const avg = valid.length ? valid.reduce((a, h) => a + h.score, 0) / valid.length : null;
  const avgY = avg == null ? null : P.t + innerH - (avg / 100) * innerH;
  const yLabels = [0, 50, 100].map((v) => {
    const gy = P.t + innerH - (v / 100) * innerH;
    return `<line x1="${P.l}" y1="${gy}" x2="${W - P.r}" y2="${gy}" stroke="rgba(255,255,255,.055)" stroke-width="1"/><text x="${P.l - 7}" y="${gy + 3.5}" text-anchor="end" fill="#7d9187" font-size="9">${v}</text>`;
  }).join('');
  return `<svg class="bar-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lịch sử điểm hồi phục">
    ${yLabels}
    ${avgY != null ? `<line x1="${P.l}" y1="${avgY.toFixed(1)}" x2="${W - P.r}" y2="${avgY.toFixed(1)}" stroke="rgba(255,255,255,.26)" stroke-width="1" stroke-dasharray="4 5"/><text x="${W - P.r}" y="${(avgY - 5).toFixed(1)}" text-anchor="end" fill="#9bb0a4" font-size="9.5">TB ${Math.round(avg)}</text>` : ''}
    ${bars}
    <text x="${P.l}" y="${H - 6}" fill="#7d9187" font-size="9.5">${esc(fmtShort(history[0]?.date))}</text>
    <text x="${W - P.r}" y="${H - 6}" text-anchor="end" fill="#7d9187" font-size="9.5">${esc(fmtShort(history[n - 1]?.date))}</text>
  </svg>`;
}

function loadBars(days, items, color = '#7cc4ff') {
  const totals = new Map();
  for (const a of items) {
    const d = String(a.start_date_local).slice(0, 10);
    totals.set(d, (totals.get(d) || 0) + (a.training_load || 0));
  }
  const W = 720, H = 180, P = { l: 36, r: 12, t: 14, b: 24 };
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b;
  const n = days.length;
  const gap = n > 45 ? 1 : 3;
  const bw = Math.max(1.5, (innerW - gap * (n - 1)) / n);
  const max = Math.max(1, ...days.map((d) => totals.get(d) || 0));
  const bars = days.map((d, i) => {
    const v = totals.get(d) || 0;
    const bh = v ? Math.max(2, (v / max) * innerH) : 0;
    const bx = P.l + i * (bw + gap);
    return `<rect x="${bx.toFixed(1)}" y="${(P.t + innerH - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${color}" opacity="${v ? .9 : 0}"><title>${esc(fmtDate(d))}: ${Math.round(v)} tải</title></rect>`;
  }).join('');
  const grid = [0, 0.5, 1].map((t) => {
    const gy = P.t + innerH * t;
    return `<line x1="${P.l}" y1="${gy}" x2="${W - P.r}" y2="${gy}" stroke="rgba(255,255,255,.055)" stroke-width="1"/><text x="${P.l - 7}" y="${gy + 3.5}" text-anchor="end" fill="#7d9187" font-size="9">${Math.round(max * (1 - t))}</text>`;
  }).join('');
  return `<svg class="bar-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tải tập theo ngày">${grid}${bars}
    <text x="${P.l}" y="${H - 6}" fill="#7d9187" font-size="9.5">${esc(fmtShort(days[0]))}</text>
    <text x="${W - P.r}" y="${H - 6}" text-anchor="end" fill="#7d9187" font-size="9.5">${esc(fmtShort(days[days.length - 1]))}</text>
  </svg>`;
}

/* ---------------- auth ---------------- */
async function boot() {
  let me = null;
  try { me = (await api('/api/me')).user; } catch { me = null; }
  if (!me) {
    try {
      const status = await api('/api/setup-status');
      if (status.needSetup) return renderSetupAdmin();
    } catch {}
    return renderLogin();
  }
  if (me.mustChangePw) return renderChangePassword(true);
  state.user = me;
  renderShell();
}

function authFrame(inner, sub) {
  app.innerHTML = `<div class="auth-screen"><div class="auth-wrap">
    <div class="auth-brand">${logo()}<div><div class="brand-name">Nhịp Sống</div><div class="brand-sub">${esc(sub)}</div></div></div>
    <div class="auth-card">${inner}</div>
    <div class="auth-foot">Chỉ chạy trong mạng riêng của gia đình. Không phải thiết bị y tế.</div>
  </div></div>`;
}

function renderLogin() {
  authFrame(`
    <h2>Đăng nhập</h2>
    <p class="auth-lead">Dữ liệu sức khoẻ của riêng bạn, lưu trên máy chủ trong nhà.</p>
    <label class="field"><span>Tên đăng nhập</span><input id="username" type="text" autocomplete="username" autocapitalize="none"></label>
    <label class="field"><span>Mật khẩu</span><input id="password" type="password" autocomplete="current-password"></label>
    <button class="btn primary block" id="go">Đăng nhập</button>
    <p class="hint" style="margin-top:14px">Không có cửa sổ "quên mật khẩu". Hãy hỏi người quản trị trong nhà.</p>
  `, 'Sức khoẻ cá nhân');
  const submit = async () => {
    try { await api('/api/login', { method: 'POST', body: { username: value('username'), password: value('password') } }); await boot(); }
    catch (e) { toastMsg(e.message); }
  };
  document.getElementById('go').onclick = submit;
  document.getElementById('password').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

function renderSetupAdmin() {
  authFrame(`
    <h2>Tạo tài khoản quản trị</h2>
    <p class="auth-lead">Đây là tài khoản đầu tiên trên máy này. Bạn dùng nó để tạo hồ sơ cho người nhà.</p>
    <label class="field"><span>Tên đăng nhập</span><input id="username" type="text" autocomplete="username" autocapitalize="none"></label>
    <label class="field"><span>Tên hiển thị</span><input id="displayName" type="text"></label>
    <label class="field"><span>Mật khẩu (tối thiểu 6 ký tự)</span><input id="password" type="password" autocomplete="new-password"></label>
    <button class="btn primary block" id="go">Tạo admin</button>
  `, 'Bắt đầu');
  document.getElementById('go').onclick = async () => {
    try {
      await api('/api/setup-admin', { method: 'POST', body: { username: value('username'), displayName: value('displayName'), password: value('password') } });
      await boot();
    } catch (e) { toastMsg(e.message); }
  };
}

function renderChangePassword(firstTime) {
  authFrame(`
    <h2>${firstTime ? 'Đổi mật khẩu lần đầu' : 'Đổi mật khẩu'}</h2>
    <p class="auth-lead">${firstTime ? 'Mật khẩu tạm do quản trị đặt. Hãy đổi sang mật khẩu chỉ mình bạn biết.' : 'Chọn mật khẩu mới tối thiểu 6 ký tự.'}</p>
    <label class="field"><span>Mật khẩu hiện tại</span><input id="current" type="password" autocomplete="current-password"></label>
    <label class="field"><span>Mật khẩu mới</span><input id="next" type="password" autocomplete="new-password"></label>
    <button class="btn primary block" id="go">Lưu</button>
    <button class="btn ghost block" id="out" style="margin-top:8px">Đăng xuất</button>
  `, 'Bảo mật');
  document.getElementById('go').onclick = async () => {
    try { await api('/api/change-password', { method: 'POST', body: { current: value('current'), next: value('next') } }); await boot(); }
    catch (e) { toastMsg(e.message); }
  };
  document.getElementById('out').onclick = logout;
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  location.reload();
}

/* ---------------- shell ---------------- */
function navButton(n, mobile = false) {
  return `<button class="nav-item ${state.view === n.id ? 'active' : ''}" data-view="${n.id}">${ICONS[n.icon]}<span>${n.label}</span></button>`;
}

function renderShell() {
  const me = state.user;
  const todayTxt = new Date().toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
  app.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="brand">${logo()}<div><div class="brand-name">Nhịp Sống</div><div class="brand-sub">Sống khỏe mỗi ngày</div></div></div>
      <nav class="side-nav">${NAV.map((n) => navButton(n)).join('')}</nav>
      <div class="sidebar-foot">
        <div class="avatar">${esc(initials(me.displayName))}</div>
        <div class="who"><b>${esc(me.displayName)}</b><span>${me.role === 'admin' ? 'Quản trị' : 'Thành viên'}</span></div>
        <button class="icon-btn" id="logout" title="Đăng xuất" aria-label="Đăng xuất">${ICONS.logout}</button>
      </div>
    </aside>
    <div class="main-wrap">
      <header class="mobile-head">
        <div class="brand">${logo()}<div><div class="brand-name">Nhịp Sống</div><div class="brand-sub">Sống khỏe mỗi ngày</div></div></div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="mobile-date">${esc(todayTxt)}</span>
          <div class="avatar">${esc(initials(me.displayName))}</div>
        </div>
      </header>
      <main class="view" id="view"></main>
    </div>
    <nav class="bottom-nav">${NAV.map((n) => navButton(n, true)).join('')}</nav>
  </div>`;
  app.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  const out = document.getElementById('logout');
  if (out) out.onclick = logout;
  renderView();
}

function go(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo(0, 0);
  renderView();
}

function skeleton() {
  return '<div class="skeleton"><div class="sk-card tall"></div><div class="sk-card"></div><div class="sk-card"></div></div>';
}

async function renderView() {
  const view = document.getElementById('view');
  if (!view) return;
  view.innerHTML = skeleton();
  try {
    if (state.view === 'today') await renderToday(view);
    else if (state.view === 'trends') await renderTrends(view);
    else if (state.view === 'activities') await renderActivities(view);
    else if (state.view === 'journal') await renderJournal(view);
    else if (state.view === 'settings') await renderSettings(view);
  } catch (e) {
    view.innerHTML = `<div class="card"><div class="section-label">Lỗi</div><h2>${esc(e.message)}</h2><p class="hint" style="margin-top:8px">Thử tải lại trang. Nếu lỗi vẫn còn, xem log máy chủ.</p></div>`;
  }
}

/* ---------------- today ---------------- */
function deltaChip(value, mean, { digits = 0, higherBetter = true, unit = '' } = {}) {
  if (value == null || mean == null) return '<span class="mini-delta flat"><span class="arrow">–</span>—</span>';
  const diff = value - mean;
  const abs = Math.abs(diff);
  const threshold = digits > 0 ? 0.15 : 0.6;
  const kind = abs < threshold ? 'flat' : (diff > 0) === higherBetter ? 'good' : 'bad';
  const sign = kind === 'flat' ? '' : diff > 0 ? '+' : '−';
  const arrow = kind === 'flat' ? '–' : diff > 0 ? '↑' : '↓';
  const txt = digits > 0 ? abs.toFixed(digits) : String(Math.round(abs));
  return `<span class="mini-delta ${kind}"><span class="arrow">${arrow}</span>${sign}${txt}${unit}</span>`;
}

function miniCard({ label, value, unit, basis, delta, spark, color, icon }) {
  return `<div class="mini" data-go="trends" role="button" tabindex="0" style="--chip:${color}">
    <div class="mini-top"><span class="ico-chip">${ICONS[icon] || ''}</span><span class="mini-label">${esc(label)}</span>${ICONS.chev}</div>
    <div class="mini-value">${value == null ? '—' : esc(value)}<small>${esc(unit || '')}</small></div>
    <div class="mini-delta-row"><div>${delta}<div class="mini-basis">${esc(basis || '')}</div></div></div>
    ${sparkline(spark, color)}
  </div>`;
}

function factorRow(f) {
  if (f.flag) {
    return `<div class="factor ${f.status === 'bad' ? '' : 'missing'}">
      <div class="factor-top"><span class="factor-name">${esc(f.label)}</span><span class="factor-value">${esc(f.valueText)}</span></div>
      ${f.status === 'bad' || f.status === 'neutral' ? `<div class="factor-mid"><span>${esc(f.basis)} · trung vị ${esc(f.meanText)}</span><span class="z-chip ${f.status}">${f.status === 'bad' ? 'tăng' : 'ổn'}</span></div>` : ''}
      <div class="factor-bottom"><span>${esc(f.text)}</span><span class="pts muted">cờ cảnh báo</span></div>
    </div>`;
  }
  if (f.subscore == null) {
    return `<div class="factor missing ${f.disabled ? 'disabled' : ''}">
      <div class="factor-top"><span class="factor-name">${esc(f.label)}</span><span class="factor-value">${f.disabled ? 'đã tắt' : 'thiếu'}</span></div>
      <div class="factor-bottom"><span>${esc(f.text)}</span></div>
    </div>`;
  }
  const fill = Math.min(Math.abs(f.z) / 3, 1) * 50;
  const left = f.z >= 0 ? 50 : 50 - fill;
  const z = f.chip || `${f.z >= 0 ? '+' : ''}${f.z.toFixed(1)}σ`;
  const hasPts = Number.isFinite(f.contribution);
  const pts = hasPts ? `${f.contribution > 0 ? '+' : ''}${f.contribution} đ` : '';
  return `<div class="factor">
    <div class="factor-top"><span class="factor-name">${esc(f.label)}</span><span class="factor-value">${esc(f.valueText)}</span></div>
    <div class="factor-mid"><span>${esc(f.basis)} · nền ${esc(f.meanText)}</span><span class="z-chip ${f.status}">${esc(z)}</span></div>
    <div class="zbar"><span class="zbar-zero"></span><span class="zbar-fill ${f.status}" style="left:${left.toFixed(1)}%;width:${fill.toFixed(1)}%"></span></div>
    <div class="factor-bottom"><span>${esc(f.text)}</span>${hasPts ? `<span class="pts ${f.contribution >= 0 ? 'up' : 'down'}">${esc(pts)}</span>` : '<span class="pts muted">bổ sung</span>'}</div>
  </div>`;
}

function weekStrip(history) {
  const last = (history || []).slice(-7);
  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const day = (iso) => { const t = new Date(String(iso) + 'T12:00:00'); return Number.isNaN(+t) ? '' : DOW[t.getDay()]; };
  const bars = last.map((h, i) => {
    const today = i === last.length - 1;
    const hgt = h.score == null ? 6 : Math.max(8, h.score);
    return `<div class="wb ${today ? 'today' : ''}" title="${esc(fmtDate(h.date))}: ${h.score == null ? 'chưa đủ dữ liệu' : h.score}">
      <span class="wb-val">${h.score == null ? '–' : h.score}</span>
      <span class="wb-bar ${h.score == null ? 'none' : ''}" style="height:${hgt}%"></span>
    </div>`;
  }).join('');
  return `<div class="week">
    <div class="week-label">7 ngày qua</div>
    <div class="week-bars">${bars}</div>
    <div class="week-days">${last.map((h) => `<span>${day(h.date)}</span>`).join('')}</div>
  </div>`;
}

function heroCard(d) {
  const r = d.recovery;
  const R = 92;
  const circ = 2 * Math.PI * R;
  const dash = r.score == null ? 0 : (r.score / 100) * circ;
  const emergency = r.band === 'emergency';
  const hex = { green: '#5fe39a', yellow: '#f6c445', red: '#ff7a6e', unknown: '#9bb0a4', emergency: '#ff3c3c' }[r.band] || '#9bb0a4';
  const hex2 = { green: '#c8fadc', yellow: '#ffe6a0', red: '#ffbdb5', unknown: '#c3d2c9', emergency: '#ffbdb5' }[r.band] || '#c3d2c9';
  return `<section class="hero card band-${r.band} ${emergency ? 'hero-emergency' : ''}">
    <div class="hero-glow"></div>
    <svg class="hero-hills" viewBox="0 0 800 200" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 120 C90 70 160 95 240 60 C320 25 380 80 460 55 C540 30 610 70 690 45 C740 30 780 40 800 35 V200 H0Z" fill="rgba(150,210,175,0.05)"/>
      <path d="M0 150 C110 115 190 140 290 105 C380 75 450 125 540 100 C630 78 700 110 800 90 V200 H0Z" fill="rgba(110,180,140,0.06)"/>
      <path d="M0 200 V170 C120 150 210 175 330 150 C430 130 520 165 620 145 C700 130 760 140 800 135 V200Z" fill="rgba(4,14,9,0.35)"/>
      <path class="hill-line" d="M420 178 C520 150 600 168 700 120" fill="none" stroke="${hex}" stroke-opacity=".35" stroke-width="1.5"/>
    </svg>
    <div class="hero-head">
      <div class="card-title"><span class="ico-chip">${ICONS.recovery}</span><div><h3>Điểm phục hồi</h3><div class="small">${esc(fmtLong(d.today))}</div></div></div>
      <button class="icon-btn" id="syncBtn" title="Đồng bộ Intervals.icu" aria-label="Đồng bộ">${ICONS.sync}</button>
    </div>
    <div class="hero-body">
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 220 220" role="img" aria-label="Chỉ số hồi phục ${r.score == null ? 'chưa đủ dữ liệu' : r.score + ' trên 100'}">
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hex2}"/><stop offset="1" stop-color="${hex}"/></linearGradient></defs>
          <circle class="ring-track" cx="110" cy="110" r="${R}"/>
          <circle class="ring-value" cx="110" cy="110" r="${R}" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" style="stroke:url(#ringGrad);filter:drop-shadow(0 0 10px ${hex}88)"/>
        </svg>
        <div class="ring-center">
          <div class="ring-score ${r.score == null ? 'empty' : ''}">${r.score == null ? '—' : r.score}</div>
          <div class="ring-unit">/ 100</div>
        </div>
      </div>
      <div class="hero-info">
        <div class="hero-band">${esc(r.bandLabel)}</div>
        <div class="hero-verdict"><span class="dot"></span>${esc(d.advice.label)}</div>
        <p class="hero-action">${esc(r.action)}</p>
        <div class="hero-cta"><button class="btn small" data-go="trends">Xem xu hướng ${ICONS.chev}</button></div>
      </div>
      ${weekStrip(d.history)}
    </div>
    ${emergency && d.advice.emergency?.show ? `<div class="emergency-box">${esc(d.advice.emergency.text)}</div>` : ''}
    ${r.capped ? `<div class="cap-note">Điểm bị giới hạn vì ${esc(r.capped)}. Cảm giác của bạn thắng đồng hồ.</div>` : ''}
    <div class="hero-foot">
      <span>${r.used}/${r.total} yếu tố · tin cậy ${esc(r.confidence)}</span>
      <span>${d.data.days} ngày dữ liệu</span>
      <span>${d.lastSync ? 'đồng bộ ' + esc(fmtDateTime(d.lastSync)) : 'chưa đồng bộ'}</span>
    </div>
  </section>`;
}

function miniWrap(d) {
  const m = d.metrics;
  const spark = (key) => m.spark.map((p) => p[key]);
  const hrvDelta = m.hrv.value != null && m.hrv.mean != null
    ? deltaChip(m.hrv.value, m.hrv.mean, { digits: 0, higherBetter: true })
    : '<span class="mini-delta flat"><span class="arrow">–</span>—</span>';
  return `<div class="mini-wrap">
    ${miniCard({ label: 'HRV', value: m.hrv.value == null ? null : fmtNum(m.hrv.value, 1), unit: 'ms', basis: m.hrv.basis, delta: hrvDelta, spark: spark('hrv'), color: '#5fe39a', icon: 'hrv' })}
    ${miniCard({ label: 'Nhịp tim nghỉ', value: m.rhr.value == null ? null : fmtNum(m.rhr.value), unit: 'bpm', basis: m.rhr.basis, delta: deltaChip(m.rhr.value, m.rhr.mean, { higherBetter: false }), spark: spark('rhr'), color: '#ff8577', icon: 'heart' })}
    ${miniCard({ label: 'Giấc ngủ', value: m.sleep.value == null ? null : fmtNum(m.sleep.value, 1), unit: 'giờ', basis: m.sleep.score != null ? `Điểm ngủ ${fmtNum(m.sleep.score)}` : m.sleep.basis, delta: deltaChip(m.sleep.value, m.sleep.mean, { digits: 1, higherBetter: true, unit: 'h' }), spark: spark('sleep'), color: '#a99bff', icon: 'moon' })}
    ${miniCard({ label: 'Nhịp thở', value: m.resp.value == null ? null : fmtNum(m.resp.value, 1), unit: '/ph', basis: m.resp.basis, delta: m.resp.state === 'elevated' ? deltaChip(m.resp.value, m.resp.mean, { digits: 1, higherBetter: false }) : `<span class="mini-delta flat"><span class="arrow">–</span>${m.resp.value == null ? '—' : 'ổn'}</span>`, spark: spark('resp'), color: '#7cc4ff', icon: 'wind' })}
  </div>`;
}

function factorsCard(d) {
  return `<div class="card factors-card">
    <div class="card-head"><div class="card-title"><span class="ico-chip" style="--chip:#f6c445">${ICONS.bulb}</span><div><div class="eyebrow">Phân rã</div><h3>Vì sao điểm này?</h3></div></div><span class="confidence-chip ${d.recovery.confidence === 'cao' ? 'green' : d.recovery.confidence === 'vừa' ? 'amber' : 'red'}">${esc(d.recovery.confidence)}</span></div>
    ${d.recovery.factors.map(factorRow).join('')}
    ${d.recovery.capped && d.recovery.rawScore != null ? `<div class="cap-line">Điểm thô ${d.recovery.rawScore} bị giới hạn còn ${d.recovery.score} vì ${esc(d.recovery.capped)}.</div>` : ''}
    ${d.recovery.score == null && d.recovery.factors.length ? `<div class="cap-line note-line">${esc(d.recovery.note)}</div>` : ''}
    <div class="formula hint">Điểm = trung bình có trọng số: HRV 45%, nhịp tim nghỉ 25%, ngủ so với nhu cầu 30%. Nhịp thở chỉ là cờ cảnh báo, không cộng điểm. Thiếu yếu tố nào thì chia lại trọng số. Không phải thuật toán WHOOP.</div>
  </div>`;
}

function historyCard(d) {
  const valid = d.history.filter((h) => h.score != null);
  const avg = valid.length ? Math.round(valid.reduce((a, h) => a + h.score, 0) / valid.length) : null;
  return `<div class="card history-card">
    <div class="chart-head"><div class="card-title"><span class="ico-chip">${ICONS.chart}</span><div><div class="chart-title">30 ngày hồi phục</div><div class="chart-meta">${avg == null ? 'Chưa đủ dữ liệu' : `TB ${avg} · ${valid.length} ngày có điểm`}</div></div></div></div>
    ${recoveryBars(d.history)}
    <div class="chart-legend"><span><i class="sw" style="background:#5fe39a"></i>Sẵn sàng (67–100)</span><span><i class="sw" style="background:#f6c445"></i>Trung bình (34–66)</span><span><i class="sw" style="background:#ff7a6e"></i>Cần hồi phục (0–33)</span></div>
  </div>`;
}

function sleepCard(d) {
  const p = d.sleepPlan;
  const wake = localStorage.getItem('nhipWake') || '06:30';
  const wakeMin = parseClock(wake);
  const bed = (mins) => minutesToClock(wakeMin - mins - 15);
  const tiers = [
    { key: 'peak', name: 'Peak', mins: p.tiers.peak, note: p.tierLabels.peak },
    { key: 'perform', name: 'Perform', mins: p.tiers.perform, note: p.tierLabels.perform, rec: true },
    { key: 'getBy', name: 'Get By', mins: p.tiers.getBy, note: p.tierLabels.getBy },
  ];
  return `<div class="card sleep-card">
    <div class="card-head">
      <div class="card-title"><span class="ico-chip" style="--chip:#a99bff">${ICONS.bed}</span><div><div class="eyebrow">Kế hoạch ngủ</div><h3>Ngủ bao nhiêu tối nay?</h3></div></div>
      <label class="wake"><span>Thức dậy</span><input type="time" id="wakeTime" value="${esc(wake)}"></label>
    </div>
    <div class="tiers">
      ${tiers.map((t) => `<div class="tier ${t.rec ? 'recommended' : ''}">
        <div class="tier-label">${t.name}</div>
        <div class="tier-time">${hm(t.mins)}</div>
        <div class="tier-bed" data-mins="${t.mins}">ngủ ${bed(t.mins)}</div>
        <div class="tier-sub">${esc(t.note)}</div>
      </div>`).join('')}
    </div>
    <div class="sleep-foot">
      <span>Nợ ngủ 7 ngày <b>${hm(p.debtMinutes)}</b></span>
      <span>Tập hôm qua <b>${fmtNum(p.yesterdayMinutes)} phút</b></span>
      <span>Điều chỉnh <b>+${fmtNum(p.strainBumpMinutes)} phút</b></span>
    </div>
    <div class="hint" style="margin-top:8px">${esc(p.note)}</div>
  </div>`;
}

function loadCard(d) {
  const l = d.load;
  const target = l.target;
  const scale = 150;
  const pct = l.pct;
  const fill = pct == null ? 0 : Math.min(Math.max(pct, 0), scale) / scale * 100;
  const high = pct != null && target && pct > target.max;
  const zone = target ? `<span class="load-zone" style="left:${(target.min / scale) * 100}%;width:${((target.max - target.min) / scale) * 100}%"></span>` : '';
  return `<div class="card load-card">
    <div class="card-head">
      <div class="card-title"><span class="ico-chip">${ICONS.activities}</span><div><div class="eyebrow">Tải vận động</div><h3>Mục tiêu tuần này</h3></div></div>
      ${target ? `<span class="confidence-chip ${high ? 'red' : 'green'}">${esc(target.label)}</span>` : ''}
    </div>
    <div class="load-big">${pct == null ? '—' : pct + '%'}<small>${pct == null ? 'chưa đủ nền tập' : 'so với nền tuần 28 ngày'}</small></div>
    <div class="load-track">${zone}<span class="load-fill ${high ? 'high' : ''}" style="width:${fill.toFixed(1)}%"></span></div>
    <div class="load-legend"><span>0%</span><span>${target ? `mục tiêu ${target.min}–${target.max}%` : 'chưa có mục tiêu'}</span><span>150%</span></div>
    <div class="stat-row">
      <div class="stat"><b>${l.sessions}</b><span>buổi / 7 ngày</span></div>
      <div class="stat"><b>${fmtNum(l.minutes)}</b><span>phút / 7 ngày</span></div>
      <div class="stat"><b>${fmtNum(l.last7Load)}</b><span>tải / 7 ngày</span></div>
    </div>
    <div class="hint" style="margin-top:10px">${esc(l.note)}</div>
  </div>`;
}

/* Hand-entered readings for what the sync cannot deliver, one form per day. */
const MANUAL_FIELDS = [
  { col: 'resting_hr', label: 'Nhịp tim nghỉ', unit: 'bpm', min: 30, max: 110, example: '55' },
  { col: 'sleep_secs', label: 'Giờ ngủ', sleep: true },
  { col: 'hrv_rmssd', label: 'HRV rMSSD', unit: 'ms', min: 1, max: 300, example: '65' },
  { col: 'respiration', label: 'Nhịp thở khi ngủ', unit: 'lần/phút', min: 6, max: 30, example: '15' },
  { col: 'sleep_score', label: 'Điểm ngủ', unit: '/100', min: 0, max: 100, example: '80' },
  { col: 'steps', label: 'Số bước', unit: 'bước', min: 0, max: 200000, example: '8000' },
  { col: 'spo2', label: 'SpO2', unit: '%', min: 70, max: 100, example: '97' },
  { col: 'weight', label: 'Cân nặng', unit: 'kg', min: 20, max: 300, example: '60' },
];

function sleepText(secs) {
  const mins = Math.round(secs / 60);
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
}

function manualRows(days) {
  return days.slice(0, 7).map((x) => {
    const filled = MANUAL_FIELDS.filter((f) => x.values[f.col] != null);
    const b = !filled.length ? { cls: 'red', text: 'thiếu' }
      : filled.some((f) => x.manual[f.col]) ? { cls: 'amber', text: 'tự nhập' }
        : { cls: 'green', text: 'đồng bộ' };
    const rhr = x.values.resting_hr;
    const sleep = x.values.sleep_secs;
    return `<button type="button" class="manual-row" data-manual-day="${esc(x.date)}">
      <span class="manual-date">${esc(fmtShort(x.date))}</span>
      <span class="manual-num">${rhr == null ? '—' : fmtNum(rhr)}<small>bpm</small> ${sleep == null ? '—' : sleepText(sleep)}</span>
      <span class="confidence-chip ${b.cls}">${b.text}</span>
    </button>`;
  }).join('');
}

function manualBaselineText(baseline) {
  const names = { resting_hr: 'Nhịp tim nghỉ', hrv_rmssd: 'HRV', respiration: 'Nhịp thở' };
  return Object.keys(names).map((k) => `${names[k]} ${baseline?.[k]?.have ?? 0}/${baseline?.[k]?.need ?? 0}`).join(' · ');
}

function manualChip(baseline) {
  const rhr = baseline?.resting_hr;
  return rhr && rhr.have >= rhr.need ? { cls: 'green', text: 'đủ nền nhịp tim' } : { cls: 'amber', text: `nền nhịp tim ${rhr?.have ?? 0}/${rhr?.need ?? 7}` };
}

function manualFieldHtml(f) {
  const inputs = f.sleep
    ? `<div class="manual-sleep">
        <input data-manual-sleep="h" type="number" min="0" max="16" step="1" inputmode="numeric" placeholder="giờ" aria-label="Giờ">
        <input data-manual-sleep="m" type="number" min="0" max="59" step="1" inputmode="numeric" placeholder="phút" aria-label="Phút">
      </div>`
    : `<input data-manual-col="${f.col}" type="number" min="${f.min}" max="${f.max}" step="any" inputmode="decimal" placeholder="ví dụ ${esc(f.example)}">`;
  return `<label class="field manual-field">
    <span>${esc(f.label)}${f.unit ? ` <small>(${esc(f.unit)})</small>` : ''} <em data-manual-state="${f.col}"></em></span>
    ${inputs}
  </label>`;
}

function manualCard(d) {
  const log = d.manualLog || { days: [], baseline: {} };
  const chip = manualChip(log.baseline);
  const isadmin = state.user?.role === 'admin';
  return `<div class="card manual-card" data-manual>
    <div class="card-head">
      <div class="card-title"><span class="ico-chip">${ICONS.hrv}</span><div><div class="eyebrow">Nhập tay</div><h3>Chỉ số khi đồng bộ thiếu</h3></div></div>
      <span class="confidence-chip ${chip.cls}" data-manual-chip>${esc(chip.text)}</span>
    </div>
    <div class="manual-body">
      <form class="manual-form" novalidate>
        <div class="manual-who">
          ${isadmin ? `<label class="field manual-user"><span>Ghi cho</span><select data-manual-user><option value="${esc(state.user.id)}">${esc(state.user.displayName || state.user.username)}</option></select></label>` : ''}
          <label class="field"><span>Ngày thức dậy</span><input data-manual-date type="date" min="${esc(log.days[log.days.length - 1]?.date || '')}" max="${esc(d.today)}" required></label>
        </div>
        <div class="manual-fields">${MANUAL_FIELDS.map(manualFieldHtml).join('')}</div>
        <div class="manual-actions"><button class="btn primary small" type="submit" data-manual-save>Lưu ngày này</button></div>
      </form>
      <div class="manual-log">
        <div class="manual-log-head"><span>7 ngày gần nhất</span><span>chạm để sửa</span></div>
        <div data-manual-log></div>
        <div class="hint manual-baseline">Số ngày đã có để tính nền: <span data-manual-baseline></span></div>
      </div>
    </div>
    <details class="manual-guide">
      <summary>Mi Band: lấy số ở đâu trong Mi Fitness?</summary>
      <ul>
        <li><b>Giờ ngủ, điểm ngủ:</b> mục Giấc ngủ, lấy đêm kết thúc vào buổi sáng của ngày đang nhập.</li>
        <li><b>Nhịp tim nghỉ:</b> mục Nhịp tim, số nhịp tim lúc nghỉ.</li>
        <li><b>SpO2:</b> mục SpO2, nếu vòng có đo trong đêm.</li>
        <li><b>Số bước:</b> nhập khi ngày đã kết thúc, chọn đúng ngày đó.</li>
        <li><b>HRV, nhịp thở:</b> Mi Band thường không có số này thì để trống. Điểm hồi phục vẫn tính từ nhịp tim nghỉ và giấc ngủ, độ tin cậy tối đa là "vừa".</li>
      </ul>
      <p>Tên mục có thể khác tuỳ phiên bản Mi Fitness. Mỗi người nên dùng một thiết bị cố định, vì số của hai loại vòng không so được với nhau.</p>
    </details>
    <div class="hint manual-note">Chỉ cần điền ô bạn có. Để trống ô tự nhập rồi lưu là xoá số đó. Khi Intervals.icu có số thật cho đúng ngày, số đồng bộ sẽ thay số tay.</div>
  </div>`;
}

function attachManualCard(view, d) {
  const card = view.querySelector('[data-manual]');
  if (!card) return;
  const form = card.querySelector('form');
  const dateEl = form.querySelector('[data-manual-date]');
  const saveBtn = form.querySelector('[data-manual-save]');
  const userEl = form.querySelector('[data-manual-user]');
  const logEl = card.querySelector('[data-manual-log]');
  const chipEl = card.querySelector('[data-manual-chip]');
  const baselineEl = card.querySelector('[data-manual-baseline]');
  const hoursEl = form.querySelector('[data-manual-sleep="h"]');
  const minsEl = form.querySelector('[data-manual-sleep="m"]');
  let days = [];
  const target = () => (userEl ? Number(userEl.value) : state.user.id);
  const who = () => (userEl ? userEl.options[userEl.selectedIndex]?.text : state.user.displayName) || '';
  const logUrl = () => `/api/wellness/manual?user=${encodeURIComponent(target())}`;

  // Only what the person changed is sent, so a rounded display never rewrites a synced number.
  const readValues = () => {
    const values = {};
    for (const el of form.querySelectorAll('[data-manual-col]')) {
      if (el.value !== el.dataset.initial) values[el.dataset.manualCol] = el.value;
    }
    const sleepKey = `${hoursEl.value}:${minsEl.value}`;
    if (sleepKey !== hoursEl.dataset.initial) {
      values.sleep_secs = hoursEl.value === '' && minsEl.value === '' ? '' : Number(hoursEl.value || 0) * 3600 + Number(minsEl.value || 0) * 60;
    }
    return values;
  };
  const loadDay = () => {
    state.manualDate = dateEl.value;
    const entry = days.find((x) => x.date === dateEl.value) || { values: {}, manual: {} };
    for (const el of form.querySelectorAll('[data-manual-col]')) {
      const v = entry.values[el.dataset.manualCol];
      el.value = v == null ? '' : String(Math.round(v * 10) / 10);
      el.dataset.initial = el.value;
    }
    const secs = entry.values.sleep_secs;
    const mins = secs == null ? null : Math.round(secs / 60);
    hoursEl.value = mins == null ? '' : String(Math.floor(mins / 60));
    minsEl.value = mins == null ? '' : String(mins % 60);
    hoursEl.dataset.initial = `${hoursEl.value}:${minsEl.value}`;
    for (const el of form.querySelectorAll('[data-manual-state]')) {
      const col = el.dataset.manualState;
      el.textContent = entry.values[col] == null ? '' : entry.manual[col] ? 'tự nhập' : 'đồng bộ';
      el.className = entry.manual[col] ? 'is-manual' : '';
    }
  };
  const paint = (log) => {
    days = log.days || [];
    logEl.innerHTML = manualRows(days);
    const chip = manualChip(log.baseline);
    chipEl.className = `confidence-chip ${chip.cls}`;
    chipEl.textContent = chip.text;
    baselineEl.textContent = manualBaselineText(log.baseline);
    loadDay();
  };
  // Only your own numbers feed this page; for someone else just refresh the card.
  const refresh = async () => {
    if (target() === state.user.id) {
      const y = window.scrollY;
      await renderView();
      window.scrollTo(0, y);
    } else {
      paint(await api(logUrl()));
    }
  };
  if (userEl) {
    api('/api/users')
      .then(async (r) => {
        for (const u of r.users || []) {
          if (String(u.id) === userEl.value) continue;
          const opt = document.createElement('option');
          opt.value = u.id;
          opt.textContent = u.display_name || u.username;
          userEl.appendChild(opt);
        }
        const saved = state.manualUser;
        if (saved && saved !== state.user.id && [...userEl.options].some((o) => Number(o.value) === saved)) {
          userEl.value = String(saved);
          paint(await api(logUrl()));
        }
      })
      .catch(() => {});
    userEl.onchange = async () => {
      state.manualUser = target();
      try {
        paint(await api(logUrl()));
      } catch (err) {
        toastMsg(err.message);
      }
    };
  }
  logEl.onclick = (e) => {
    const row = e.target.closest('.manual-row');
    if (!row) return;
    dateEl.value = row.dataset.manualDay;
    loadDay();
    form.querySelector('[data-manual-col]').focus();
  };
  dateEl.onchange = loadDay;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = readValues();
    if (!Object.keys(values).length) { toastMsg('Chưa có gì thay đổi.'); return; }
    saveBtn.disabled = true;
    try {
      const r = await api('/api/wellness/manual', { method: 'POST', body: { user: target(), date: dateEl.value, values } });
      toastMsg(r.changed.length ? `Đã lưu ${r.changed.length} chỉ số cho ${who()}, ngày ${fmtShort(dateEl.value)}.` : 'Chưa có gì thay đổi.');
      await refresh();
    } catch (err) { toastMsg(err.message); }
    saveBtn.disabled = false;
  };
  dateEl.value = state.manualDate && state.manualDate <= d.today ? state.manualDate : d.today;
  paint(d.manualLog || { days: [], baseline: {} });
}


function checkinFormHtml(tags, current) {
  const level = current?.level || 'ok';
  const chosen = new Set(current?.tags || []);
  return `<div class="checkin-form">
    <div class="today-note">${current ? `Hôm nay đã ghi: <b>${esc(levelLabel(current.level))}</b>${current.tags?.length ? ' · ' + current.tags.map((t) => esc(tagLabel(tags, t))).join(', ') : ''}` : 'Chưa ghi cảm giác hôm nay.'}</div>
    <div class="level-grid" data-levels>
      ${[['ok', 'Bình thường'], ['tired', 'Mệt / ngủ kém'], ['sick', 'Đang bệnh'], ['serious', 'Triệu chứng nặng']].map(([id, label]) => `<button type="button" class="level-btn ${level === id ? 'selected' : ''}" data-level="${id}"><span class="dot"></span>${label}</button>`).join('')}
    </div>
    <div class="tag-row" data-tags>
      ${tags.map((t) => `<button type="button" class="tag-btn ${chosen.has(t.id) ? 'selected' : ''}" data-tag="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>
    <textarea data-note placeholder="Ghi chú: cảm giác, triệu chứng, giấc ngủ… (không bắt buộc)">${esc(current?.note || current?.symptoms || '')}</textarea>
    <div class="checkin-actions">
      <span class="hint">Cảm giác của bạn thắng số đồng hồ.</span>
      <button class="btn primary small" type="button" data-save>Lưu</button>
    </div>
  </div>`;
}

function tagLabel(tags, id) { return tags.find((t) => t.id === id)?.label || id; }

function attachCheckin(root, tags) {
  const box = root.querySelector('.checkin-form');
  if (!box) return;
  let level = box.querySelector('.level-btn.selected')?.dataset.level || 'ok';
  const chosen = new Set([...box.querySelectorAll('.tag-btn.selected')].map((b) => b.dataset.tag));
  box.querySelectorAll('.level-btn').forEach((b) => {
    b.onclick = () => {
      level = b.dataset.level;
      box.querySelectorAll('.level-btn').forEach((x) => x.classList.toggle('selected', x === b));
    };
  });
  box.querySelectorAll('.tag-btn').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.tag;
      if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
      b.classList.toggle('selected', chosen.has(id));
    };
  });
  const save = box.querySelector('[data-save]');
  save.onclick = async () => {
    if (level === 'serious' && !confirm('Bạn báo triệu chứng nặng (đau ngực, khó thở, ngất). Ghi nhận và ưu tiên hỗ trợ y tế?')) return;
    save.disabled = true;
    const note = box.querySelector('[data-note]').value;
    try {
      await api('/api/checkin', { method: 'POST', body: { level, note, symptoms: note, tags: [...chosen], redFlag: level === 'serious' ? 1 : 0 } });
      toastMsg(level === 'serious' ? 'Đã ghi nhận. Hãy tìm hỗ trợ y tế.' : 'Đã lưu cảm giác hôm nay.');
      await renderView();
    } catch (e) { toastMsg(e.message); save.disabled = false; }
  };
}

function checkinCard(d) {
  return `<div class="card checkin-card">
    <div class="card-head"><div class="card-title"><span class="ico-chip">${ICONS.leaf}</span><div><div class="eyebrow">Tinh thần</div><h3>Cảm giác hôm nay</h3></div></div></div>
    ${checkinFormHtml(d.journalTags || [], d.checkin)}
  </div>`;
}

function recentCard(d) {
  const items = d.recent || [];
  return `<div class="card recent-card">
    <div class="card-head"><div class="card-title"><span class="ico-chip" style="--chip:#ff9f6e">${ICONS.flame}</span><div><div class="eyebrow">Vận động</div><h3>Buổi tập gần đây</h3></div></div><button class="card-link" data-go="activities">Xem tất cả ${ICONS.chev}</button></div>
    ${items.length ? items.map(actRow).join('') : '<div class="empty">Chưa có buổi tập. Bấm Đồng bộ hoặc nhập CSV trong Cài đặt.</div>'}
  </div>`;
}

function actType(a) {
  const t = String(a.type || '');
  if (/run/i.test(t)) return 'RUN';
  if (/ride|bike|cycl/i.test(t)) return 'RIDE';
  if (/swim/i.test(t)) return 'SWIM';
  if (/walk|hike/i.test(t)) return 'WALK';
  if (/weight|workout|strength/i.test(t)) return 'GYM';
  if (/hiit|interval/i.test(t)) return 'HIIT';
  return (t || 'TẬP').slice(0, 4).toUpperCase();
}
function actRow(a) {
  const date = String(a.start_date_local || '').slice(0, 10);
  return `<div class="act-row">
    <div class="act-icon">${esc(actType(a))}</div>
    <div class="act-main"><b>${esc(a.name || a.type || 'Buổi tập')}</b><span>${esc(fmtDate(date))} · ${Math.round((a.moving_time || 0) / 60)} phút</span></div>
    <div class="act-load"><b>${a.training_load != null ? Math.round(a.training_load) : '—'}</b><span>tải</span></div>
  </div>`;
}

async function renderToday(view) {
  const d = await api('/api/dashboard');
  view.innerHTML = `
    <div class="view-head">
      <div class="greet">
        <div class="greet-date">${esc(fmtLong(d.today))}</div>
        <h1>${esc(greeting())}, ${esc((state.user.displayName || '').split(' ').slice(-1)[0])}</h1>
        <div class="view-sub">${esc(subline(d))}</div>
      </div>
      <div class="head-actions">
        <div class="head-pill glass">${ICONS.sun}<span>Sức khỏe tốt hôm nay là nền tảng cho những ngày tuyệt vời phía trước.</span></div>
        <button class="btn small" id="syncTop">${ICONS.sync} Đồng bộ</button>
      </div>
    </div>
    <div class="today-grid">
      ${heroCard(d)}
      ${miniWrap(d)}
      ${manualCard(d)}
      ${factorsCard(d)}
      ${historyCard(d)}
      ${sleepCard(d)}
      ${loadCard(d)}
      ${checkinCard(d)}
      ${recentCard(d)}
    </div>`;
  const sync = async (btn) => {
    if (btn) btn.classList.add('spin');
    toastMsg('Đang đồng bộ…');
    try {
      const r = await api('/api/sync', { method: 'POST', body: {} });
      toastMsg(`Xong: ${r.stats.wellness.written} ngày wellness, ${r.stats.activities.written} buổi tập.`);
      await renderView();
    } catch (e) { toastMsg('Đồng bộ lỗi: ' + e.message); if (btn) btn.classList.remove('spin'); }
  };
  const syncBtn = view.querySelector('#syncBtn');
  if (syncBtn) syncBtn.onclick = () => sync(syncBtn);
  const syncTop = view.querySelector('#syncTop');
  if (syncTop) syncTop.onclick = () => sync(syncTop.querySelector('svg'));
  const wake = view.querySelector('#wakeTime');
  if (wake) {
    const wakeMin = parseClock(wake.value);
    view.querySelectorAll('.tier-bed').forEach((el) => {
      el.textContent = `ngủ ${minutesToClock(wakeMin - Number(el.dataset.mins) - 15)}`;
    });
    wake.onchange = () => {
      localStorage.setItem('nhipWake', wake.value);
      const wm = parseClock(wake.value);
      view.querySelectorAll('.tier-bed').forEach((el) => {
        el.textContent = `ngủ ${minutesToClock(wm - Number(el.dataset.mins) - 15)}`;
      });
    };
  }
  attachCheckin(view, d.journalTags || []);
  attachManualCard(view, d);
  view.querySelectorAll('[data-go]').forEach((b) => {
    b.onclick = () => go(b.dataset.go);
    if (b.getAttribute('role') === 'button') b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(b.dataset.go); } };
  });
}

function subline(d) {
  const b = d.recovery?.band;
  if (b === 'green') return 'Cơ thể sẵn sàng — một ngày tốt để vận động.';
  if (b === 'yellow') return 'Một ngày mới, một cơ hội để sống khỏe hơn.';
  if (b === 'red') return 'Hôm nay ưu tiên nghỉ ngơi và hồi phục.';
  if (b === 'emergency') return 'Hãy ưu tiên hỗ trợ y tế trước.';
  return `Dữ liệu ${d.data?.days ?? 0} ngày — cần thêm để chấm điểm chính xác.`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

/* ---------------- trends ---------------- */
async function renderTrends(view) {
  const range = state.trendsRange;
  const days = Array.from({ length: range }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (range - 1 - i));
    return d.toISOString().slice(0, 10);
  });
  const [trend, dash, baseline] = await Promise.all([
    api(`/api/trends?days=${range}`),
    api(`/api/dashboard?history=${range}`),
    api('/api/baseline'),
  ]);
  const byDate = new Map(trend.wellness.map((w) => [w.date, w]));
  const series = (field, scale = 1) => days.map((d) => {
    const w = byDate.get(d);
    const v = w && w[field] != null ? w[field] * scale : null;
    return { date: d, value: v };
  });

  const defs = [
    { title: 'HRV rMSSD', field: 'hrv_rmssd', color: '#5fe39a', unit: 'ms', digits: 1 },
    { title: 'Nhịp tim nghỉ', field: 'resting_hr', color: '#ff8577', unit: 'bpm', digits: 0 },
    { title: 'Giấc ngủ', field: 'sleep_secs', scale: 1 / 3600, color: '#a78bfa', unit: 'giờ', digits: 1 },
    { title: 'Điểm ngủ', field: 'sleep_score', color: '#f6c445', unit: '/100', digits: 0 },
    { title: 'Số bước', field: 'steps', color: '#7cc4ff', unit: 'bước', digits: 0 },
    { title: 'Nhịp thở', field: 'respiration', color: '#4fd1c5', unit: '/ph', digits: 1 },
    { title: 'SpO2', field: 'spo2', color: '#7cc4ff', unit: '%', digits: 0 },
    { title: 'Cân nặng', field: 'weight', color: '#a99bff', unit: 'kg', digits: 1 },
  ];

  view.innerHTML = `
    <div class="view-head">
      <div><h1>Xu hướng</h1><div class="view-sub">So với đường cơ sở cá nhân, không so với chuẩn chung.</div></div>
      <div class="range-row" id="rangeRow">
        ${[7, 30, 90].map((n) => `<button data-d="${n}" class="${range === n ? 'active' : ''}">${n} ngày</button>`).join('')}
      </div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="chart-head"><div><div class="chart-title">Điểm hồi phục</div><div class="chart-meta">${range} ngày · trung bình và các dải màu</div></div></div>
      ${recoveryBars(dash.history)}
      <div class="chart-legend"><span><i class="sw" style="background:#5fe39a"></i>Sẵn sàng</span><span><i class="sw" style="background:#f6c445"></i>Trung bình</span><span><i class="sw" style="background:#ff7a6e"></i>Cần hồi phục</span><span>Đường đứt = trung bình</span></div>
    </div>
    <div class="charts-grid">
      ${defs.map((def) => `<div class="card">
        <div class="chart-head"><div class="chart-title">${def.title}</div></div>
        ${lineChart(series(def.field, def.scale || 1), { color: def.color, unit: def.unit, digits: def.digits })}
      </div>`).join('')}
    </div>
    ${baselineCard(baseline)}`;
  view.querySelectorAll('#rangeRow button').forEach((b) => {
    b.onclick = () => { state.trendsRange = Number(b.dataset.d); renderView(); };
  });
}

function baselineCard(b) {
  const hrvRow = (name, x) => {
    const conf = x.baseline ? (x.tier === 'ổn định' ? 'green' : 'amber') : 'red';
    const v = x.baseline
      ? `${fmtNum(x.baseline.mean, 1)} ± ${fmtNum(x.baseline.sd, 1)} ms · ${x.baseline.count} ngày`
      : `chưa đủ 14 ngày (có ${x.daysAvailable})`;
    return `<div class="baseline-row"><span class="k">${name}</span><span class="v">${v} <span class="confidence-chip ${conf}">${esc(x.tier)}</span></span></div>`;
  };
  return `<div class="card" style="margin-top:14px">
    <div class="card-head"><div><div class="eyebrow">Đường cơ sở</div><h3>Mức nền cá nhân</h3></div><span class="confidence-chip">${esc(b.windowStart)} → ${esc(b.windowEnd)}</span></div>
    <div class="baseline-row"><span class="k">RHR trung bình 30 ngày</span><span class="v">${b.rhr.count >= 7 ? `${fmtNum(b.rhr.mean, 1)} bpm · ${b.rhr.count} ngày` : `chưa đủ (${b.rhr.count}/7)`}</span></div>
    ${hrvRow('HRV rMSSD', b.hrvRmssd)}
    ${hrvRow('HRV SDNN', b.hrvSdnn)}
    <div class="baseline-row"><span class="k">Ngủ</span><span class="v">${b.sleepMinutes.count >= 7 ? `${fmtNum(b.sleepMinutes.mean / 60, 2)} giờ/đêm · ${b.sleepMinutes.count} đêm` : `chưa đủ (${b.sleepMinutes.count}/7)`}</span></div>
    <div class="baseline-row"><span class="k">Điểm ngủ</span><span class="v">${b.sleepScore.count >= 7 ? `${fmtNum(b.sleepScore.mean)}/100` : `chưa đủ (${b.sleepScore.count}/7)`}</span></div>
    <div class="baseline-row"><span class="k">Bước / ngày</span><span class="v">${b.steps.count >= 7 ? `${fmtNum(b.steps.mean)} bước` : `chưa đủ (${b.steps.count}/7)`}</span></div>
    <div class="baseline-row"><span class="k">Nhịp thở</span><span class="v">${b.respiration.count >= 7 ? `${fmtNum(b.respiration.mean, 1)} /ph` : `chưa đủ (${b.respiration.count}/7)`}</span></div>
    <div class="hint" style="margin-top:12px">Ngày ${esc(b.targetDate)} không tự tính vào mức nền của chính nó. rMSSD và SDNN luôn tách biệt. sleepSecs có thể gồm cả ngủ trưa nếu nguồn gộp chung.</div>
  </div>`;
}

/* ---------------- activities ---------------- */
async function renderActivities(view) {
  const range = state.actRange;
  const d = await api(`/api/activities?days=${range}`);
  const items = d.items;
  const totalMin = items.reduce((a, x) => a + (x.moving_time || 0), 0) / 60;
  const totalLoad = items.reduce((a, x) => a + (x.training_load || 0), 0);
  const days = Array.from({ length: range }, (_, i) => {
    const dt = new Date();
    dt.setDate(dt.getDate() - (range - 1 - i));
    return dt.toISOString().slice(0, 10);
  });
  view.innerHTML = `
    <div class="view-head">
      <div><h1>Buổi tập</h1><div class="view-sub">Tải từ Intervals.icu; không phản ánh đủ sức mạnh, bơi, yoga.</div></div>
      <div class="range-row" id="rangeRow">${[30, 90, 180].map((n) => `<button data-d="${n}" class="${range === n ? 'active' : ''}">${n} ngày</button>`).join('')}</div>
    </div>
    <div class="stat-tiles">
      <div class="stat-tile"><b>${items.length}</b><span>buổi</span></div>
      <div class="stat-tile"><b>${fmtNum(totalMin)}</b><span>phút</span></div>
      <div class="stat-tile"><b>${fmtNum(totalLoad)}</b><span>tổng tải</span></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="chart-head"><div><div class="chart-title">Tải theo ngày</div><div class="chart-meta">${range} ngày gần nhất</div></div></div>
      ${items.length ? loadBars(days, items) : '<div class="empty">Chưa có buổi tập trong khoảng này.</div>'}
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Danh sách</h3></div></div>
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Buổi</th><th class="num">Phút</th><th class="num">Tải</th></tr></thead><tbody>
        ${items.map((a) => {
          const date = String(a.start_date_local || '').slice(0, 10);
          const hiit = /HIIT/i.test(a.type || '') ? '<span class="type-note">Nhãn HIIT tự đặt — không chắc cường độ thực.</span>' : '';
          return `<tr><td>${esc(fmtShort(date))}</td><td>${esc(a.name || '—')}${hiit}</td><td class="num">${Math.round((a.moving_time || 0) / 60)}</td><td class="num">${a.training_load != null ? Math.round(a.training_load) : '—'}</td></tr>`;
        }).join('')}
      </tbody></table></div>` : '<div class="empty">Chưa có dữ liệu. Bấm Đồng bộ hoặc nhập CSV.</div>'}
    </div>`;
  view.querySelectorAll('#rangeRow button').forEach((b) => {
    b.onclick = () => { state.actRange = Number(b.dataset.d); renderView(); };
  });
}

/* ---------------- journal ---------------- */
async function renderJournal(view) {
  const d = await api('/api/checkin');
  const ins = d.insights;
  const journalDays = new Set(d.items.map((c) => c.local_date)).size;
  const pendingHtml = ins.pending.length
    ? `<div class="pending-list">${ins.pending.map((p) => `<div class="pending-row">
        <span>${esc(p.label)}</span>
        <span class="track"><span style="width:${Math.round((p.days / p.need) * 100)}%"></span></span>
        <span class="small">${p.days}/${p.need}</span>
      </div>`).join('')}</div>`
    : '';
  const emptyHtml = `<div class="journal-guide">
    <p>Cần ít nhất <b>3 ngày</b> có cùng một thói quen để so sánh điểm hồi phục sáng hôm sau.</p>
    <ol class="guide-steps">
      <li><span>1</span><div><b>Ghi cảm giác mỗi sáng</b><small>Bình thường, mệt hoặc đang bệnh — mất khoảng 10 giây.</small></div></li>
      <li><span>2</span><div><b>Gắn thói quen tối qua</b><small>Rượu, cà phê sau 14h, tập muộn, căng thẳng, ăn muộn…</small></div></li>
      <li><span>3</span><div><b>Đối chiếu sau 3 lần</b><small>App so sánh điểm hồi phục hôm sau giữa ngày có và không có thói quen.</small></div></li>
    </ol>
    ${pendingHtml}
  </div>`;
  view.innerHTML = `
    <div class="view-head"><div><h1>Nhật ký</h1><div class="view-sub">Ghi cảm giác và thói quen để đối chiếu với điểm hồi phục.</div></div></div>
    <div class="charts-grid">
      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Hôm nay</div><h3>Ghi cảm giác</h3></div></div>
        ${checkinFormHtml(d.tags, d.items.find((x) => x.local_date === todayIso()))}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Đối chiếu</div><h3>Thói quen và hôm sau</h3></div><span class="confidence-chip">${ins.insights.length ? `${ins.insights.length} thói quen` : `${journalDays} ngày ghi`}</span></div>
        ${ins.insights.length ? ins.insights.map((i) => insightRow(i)).join('') : emptyHtml}
        <div class="hint" style="margin-top:10px">${esc(ins.note)}</div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="card-head"><div><h3>Lịch sử</h3></div><span class="confidence-chip">${d.items.length} mục</span></div>
      ${d.items.length ? `<div class="timeline">${d.items.map((c) => {
        const tags = (c.tags || []).map((t) => `<span>${esc(tagLabel(d.tags, t))}</span>`).join('');
        return `<div class="tl-item"><span class="tl-dot ${esc(c.level)}"></span><div class="tl-main">
          <b>${esc(fmtDate(c.local_date))}</b> · <span class="muted">${esc(levelLabel(c.level))}</span>
          ${c.note || c.symptoms ? `<div class="tl-meta">${esc(c.note || c.symptoms)}</div>` : ''}
          ${tags ? `<div class="tl-tags">${tags}</div>` : ''}
        </div><div class="small">${esc(fmtDateTime(c.created_at))}</div></div>`;
      }).join('')}</div>` : '<div class="empty">Chưa có mục nào.</div>'}
    </div>`;
  attachCheckin(view, d.tags);
}

function insightRow(i) {
  const down = i.delta < 0;
  return `<div class="insight">
    <div class="insight-head"><b>${esc(i.label)}</b><span class="delta ${down ? 'down' : 'up'}">${i.delta > 0 ? '+' : ''}${i.delta} điểm</span></div>
    <div class="insight-bars">
      <div class="insight-bar"><span style="width:92px">Có ${esc(i.label.toLowerCase())}</span><span class="track"><span class="fill tag" style="width:${Math.max(2, i.avgTagged)}%"></span></span><span>${i.avgTagged}</span></div>
      <div class="insight-bar"><span style="width:92px">Ngày khác</span><span class="track"><span class="fill other" style="width:${Math.max(2, i.avgOther)}%"></span></span><span>${i.avgOther}</span></div>
    </div>
    <div class="small" style="margin-top:4px">${i.days} ngày có thói quen · điểm hồi phục sáng hôm sau</div>
  </div>`;
}

/* ---------------- settings ---------------- */
async function renderSettings(view) {
  const [icu, status] = await Promise.all([api('/api/config/icu'), api('/api/status')]);
  const me = state.user;
  view.innerHTML = `
    <div class="view-head"><div><h1>Cài đặt</h1><div class="view-sub">Kết nối dữ liệu, ngưỡng gợi ý, sao lưu và giải thích chỉ số.</div></div></div>
    <div class="settings-stack">
      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Hồ sơ</div><h3>${esc(me.displayName)}</h3></div><span class="confidence-chip">${me.role === 'admin' ? 'Quản trị' : 'Thành viên'}</span></div>
        <div class="set-row"><span class="k">Tên đăng nhập</span><span class="v">${esc(me.username)}</span></div>
        <div class="actions"><button class="btn ghost small" id="pw">Đổi mật khẩu</button><button class="btn ghost small" id="out">Đăng xuất</button></div>
      </div>

      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Dữ liệu</div><h3>Intervals.icu</h3></div>${icu.hasKey ? '<span class="confidence-chip green">đã kết nối</span>' : '<span class="confidence-chip red">chưa kết nối</span>'}</div>
        ${icu.hasKey ? `
          <div class="set-row"><span class="k">Athlete ID</span><span class="v">${esc(icu.athleteId || '—')}</span></div>
          <div class="set-row"><span class="k">API key</span><span class="v">đã lưu (mã hoá AES-256-GCM)</span></div>
          <div class="set-row"><span class="k">Đồng bộ gần nhất</span><span class="v">${esc(fmtDateTime(icu.lastSync))}</span></div>
          ${icu.lastError ? `<div class="notice">Lần sync gần nhất lỗi: ${esc(icu.lastError)}</div>` : ''}
          <div class="actions"><button class="btn primary small" id="sync">${ICONS.sync} Đồng bộ ngay</button><button class="btn danger small" id="clear">Ngắt kết nối</button></div>` : `
          <p class="hint">Mỗi người tự nhập API key riêng. Key chỉ đi từ trình duyệt sang máy chủ trong nhà, được mã hoá, không vào Git hay log.</p>
          <label class="field"><span>Athlete ID (ví dụ i771592)</span><input id="athleteId" type="text" autocapitalize="none"></label>
          <label class="field"><span>API key (Intervals.icu → Settings → Developer Settings)</span><input id="apiKey" type="password" autocomplete="off"></label>
          <button class="btn primary small" id="saveKey">Lưu và thử kết nối</button>`}
      </div>

      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Quy tắc</div><h3>Ngưỡng gợi ý buổi sáng</h3></div></div>
        <div id="adviceSettingsBox"><div class="hint">Đang tải…</div></div>
        <div class="hint" style="margin-top:10px">z = độ lệch so với nền tính bằng độ lệch chuẩn. Đây là quy tắc tham khảo, không phải ngưỡng chẩn đoán. Có thể tắt từng chỉ số.</div>
      </div>

      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Công khai cách tính</div><h3>Chỉ số hồi phục là gì?</h3></div><span class="confidence-chip amber">tham khảo</span></div>
        <div class="formula-list">
          <div><b>1. HRV (45%)</b>: dùng ln(rMSSD). 60% đêm qua + 40% trung bình 7 ngày, so với trung vị 60 ngày (độ lệch tính bằng MAD, sàn 7%). Hiện vùng SWC = nền ± 0,5 độ lệch và cảnh báo khi dao động 7 ngày (CV) cao gấp 1,5 lần thường lệ.</div>
          <div><b>2. Nhịp tim nghỉ (25%)</b>: đêm qua so với trung vị 30 ngày; dấu đảo vì cao hơn là xấu.</div>
          <div><b>3. Giấc ngủ (30%)</b>: so với <i>nhu cầu</i>, không so với trung bình của bạn. Nhu cầu = nền 7,5–8,5h + 20% nợ ngủ 7 đêm (tối đa 60 phút) + tối đa 45 phút nếu hôm qua tập nhiều. Đủ 85% nhu cầu = 50 điểm.</div>
          <div><b>4. Nhịp thở</b>: không cộng điểm. Chỉ là cờ cảnh báo một chiều khi tăng ≥ 1,5 lần/phút so với trung vị. Tăng cùng lúc với nhịp tim nghỉ tăng hoặc HRV giảm → điểm bị chặn ở 50.</div>
          <div><b>5.</b> Mỗi phần đổi thành điểm con 50 + z × 22, chặn 2–99, rồi lấy trung bình có trọng số. Thiếu phần nào thì chia lại trọng số và hạ độ tin cậy. Giá trị vô lý (ngủ &lt; 3h, RHR ngoài 30–110) và ngày bạn báo ốm bị loại khỏi mức nền.</div>
          <div><b>6.</b> Dải màu: 67–100 xanh, 34–66 vàng, 0–33 đỏ. Đây là mốc hiển thị, không phải ngưỡng y khoa.</div>
          <div><b>Giới hạn:</b> WHOOP không công bố trọng số thật; chỉ số này không sao chép WHOOP. Đồng hồ quang học ở cổ tay có sai số; mọi so sánh chỉ có ý nghĩa với chính bạn. Cảm giác chủ quan luôn thắng.</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Nhập tay</div><h3>CSV từ Intervals.icu</h3></div></div>
        <label class="field"><span>CSV Wellness</span><input id="csvW" type="file" accept=".csv,text/csv"></label>
        <button class="btn ghost small" id="prevW">Xem trước & nhập</button>
        <label class="field"><span>CSV Activities</span><input id="csvA" type="file" accept=".csv,text/csv"></label>
        <button class="btn ghost small" id="prevA">Xem trước & nhập</button>
        <div id="csvPreview"></div>
      </div>

      ${me.role === 'admin' ? `
      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Gia đình</div><h3>Quản lý người dùng</h3></div></div>
        <div id="userList"><div class="hint">Đang tải…</div></div>
        <div class="divider"></div>
        <label class="field"><span>Tên đăng nhập mới</span><input id="newUser" type="text" autocapitalize="none"></label>
        <label class="field"><span>Tên hiển thị</span><input id="newName" type="text"></label>
        <label class="field"><span>Mật khẩu tạm (≥ 6 ký tự)</span><input id="newPass" type="password"></label>
        <button class="btn primary small" id="addUser">Tạo tài khoản</button>
        <div class="hint" style="margin-top:8px">Người mới bị buộc đổi mật khẩu lần đầu. Admin tạo tài khoản nhưng không mặc định xem được dữ liệu sức khoẻ của họ.</div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Tự động</div><h3>Lịch đồng bộ</h3></div></div>
        <div id="schedBox"><div class="hint">Đang tải…</div></div>
        <div class="hint" style="margin-top:8px">Máy Mac phải bật và app phải chạy. Múi giờ Asia/Ho_Chi_Minh.</div>
      </div>` : ''}

      <div class="card">
        <div class="card-head"><div><div class="eyebrow">An toàn dữ liệu</div><h3>Sao lưu</h3></div></div>
        <div class="actions">
          <button class="btn ghost small" id="backup">Tải backup JSON</button>
          <label class="btn ghost small" style="margin:0">Khôi phục<input id="restoreFile" type="file" accept=".json" style="display:none"></label>
        </div>
        <div class="hint" style="margin-top:8px">Backup chỉ chứa dữ liệu của bạn, không chứa API key. Khôi phục ghi đè theo từng dòng (upsert).</div>
      </div>
    </div>`;

  view.querySelector('#out').onclick = logout;
  view.querySelector('#pw').onclick = () => renderChangePassword(false);
  const syncBtn = view.querySelector('#sync');
  if (syncBtn) syncBtn.onclick = async () => {
    syncBtn.classList.add('spin');
    try { const r = await api('/api/sync', { method: 'POST', body: {} }); toastMsg(`Xong: ${r.stats.wellness.written} ngày, ${r.stats.activities.written} buổi.`); await renderView(); }
    catch (e) { toastMsg(e.message); syncBtn.classList.remove('spin'); }
  };
  const clear = view.querySelector('#clear');
  if (clear) clear.onclick = async () => { if (!confirm('Ngắt kết nối Intervals.icu? Dữ liệu đã đồng bộ vẫn giữ nguyên.')) return; await api('/api/config/icu', { method: 'DELETE' }); renderView(); };
  const saveKey = view.querySelector('#saveKey');
  if (saveKey) saveKey.onclick = async () => {
    try {
      const r = await api('/api/config/icu', { method: 'POST', body: { athleteId: view.querySelector('#athleteId').value, apiKey: view.querySelector('#apiKey').value } });
      toastMsg('Kết nối thành công' + (r.name ? ` cho ${r.name}` : '')); renderView();
    } catch (e) { toastMsg(e.message); }
  };
  view.querySelector('#prevW').onclick = () => handleCsv('wellness', view.querySelector('#csvW').files[0], view);
  view.querySelector('#prevA').onclick = () => handleCsv('activities', view.querySelector('#csvA').files[0], view);
  view.querySelector('#backup').onclick = () => { window.location.href = '/api/backup'; };
  view.querySelector('#restoreFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await api('/api/restore', { method: 'POST', body: JSON.parse(await f.text()) }); toastMsg('Đã khôi phục.'); }
    catch (err) { toastMsg(err.message); }
  };

  loadAdviceSettings(view);
  if (me.role === 'admin') { loadUsers(view); loadSchedule(view); }
}

async function loadAdviceSettings(view) {
  try {
    const s = await api('/api/advice-settings');
    const box = view.querySelector('#adviceSettingsBox');
    const row = (key, label, zKey) => `<div class="threshold-row">
      <span class="k">${esc(label)}</span>
      <span class="threshold-controls">
        <label class="check-label"><input type="checkbox" id="on-${key}" ${s[key + '_on'] ? 'checked' : ''}> bật</label>
        <input type="${zKey === 'sleep_z' ? 'hidden' : 'number'}" step="0.1" min="0.2" max="5" id="z-${key}" value="${s[zKey]}">
      </span>
    </div>`;
    box.innerHTML = row('rhr', 'RHR cảnh báo khi cao hơn nền', 'rhr_z') +
      row('hrv', 'HRV cảnh báo khi thấp hơn nền', 'hrv_z') +
      row('sleep', 'Ngủ cảnh báo khi < 85% nhu cầu (cố định)', 'sleep_z') +
      `<div class="threshold-row"><span class="k">Lệch rõ rệt (bất kỳ chỉ số)</span><span class="threshold-controls"><input type="number" step="0.1" min="0.2" max="5" id="z-strong" value="${s.strong_z}"></span></div>
      <div class="actions"><button class="btn primary small" id="saveAdvice">Lưu ngưỡng</button><button class="btn ghost small" id="resetAdvice">Về mặc định</button></div>`;
    box.querySelector('#saveAdvice').onclick = async () => {
      const body = {
        rhr_on: box.querySelector('#on-rhr').checked, hrv_on: box.querySelector('#on-hrv').checked, sleep_on: box.querySelector('#on-sleep').checked,
        rhr_z: Number(box.querySelector('#z-rhr').value), hrv_z: Number(box.querySelector('#z-hrv').value),
        sleep_z: Number(box.querySelector('#z-sleep').value), strong_z: Number(box.querySelector('#z-strong').value),
      };
      try { await api('/api/advice-settings', { method: 'POST', body }); toastMsg('Đã lưu ngưỡng.'); }
      catch (e) { toastMsg(e.message); }
    };
    box.querySelector('#resetAdvice').onclick = async () => {
      try { await api('/api/advice-settings', { method: 'POST', body: { rhr_on: 1, hrv_on: 1, sleep_on: 1, rhr_z: 1, hrv_z: 1, sleep_z: 1, strong_z: 2 } }); toastMsg('Đã về mặc định.'); loadAdviceSettings(view); }
      catch (e) { toastMsg(e.message); }
    };
  } catch (e) { toastMsg(e.message); }
}

async function loadUsers(view) {
  try {
    const us = await api('/api/users');
    view.querySelector('#userList').innerHTML = us.users.map((u) => `<div class="user-row"><div><b>${esc(u.display_name)}</b> <span class="small">(${esc(u.username)})</span><div class="meta">${u.has_key ? 'đã kết nối ICU' : 'chưa kết nối'} · ${esc(fmtDateTime(u.last_sync_at))}</div></div><span class="confidence-chip">${u.role === 'admin' ? 'admin' : 'thành viên'}</span></div>`).join('');
  } catch {}
  view.querySelector('#addUser').onclick = async () => {
    try {
      await api('/api/users', { method: 'POST', body: { username: view.querySelector('#newUser').value, displayName: view.querySelector('#newName').value, password: view.querySelector('#newPass').value } });
      toastMsg('Đã tạo tài khoản.'); renderView();
    } catch (e) { toastMsg(e.message); }
  };
}

async function loadSchedule(view) {
  try {
    const s = await api('/api/schedule');
    const box = view.querySelector('#schedBox');
    box.innerHTML = `
      <div class="set-row"><span class="k">Trạng thái</span><span class="v">${s.enabled ? 'bật' : 'tắt'}</span></div>
      <div class="set-row"><span class="k">Giờ chạy</span><span class="v">${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}</span></div>
      <div class="set-row"><span class="k">Lần chạy gần nhất</span><span class="v">${esc(s.lastRun || 'chưa chạy')}</span></div>
      <label class="field"><span>Giờ (0–23)</span><input id="h" type="number" min="0" max="23" value="${s.hour}"></label>
      <label class="field"><span>Phút (0–59)</span><input id="m" type="number" min="0" max="59" value="${s.minute}"></label>
      <div class="actions"><button class="btn primary small" id="saveSched">Lưu lịch</button><button class="btn ghost small" id="toggleSched">${s.enabled ? 'Tắt lịch' : 'Bật lịch'}</button></div>`;
    box.querySelector('#saveSched').onclick = async () => {
      await api('/api/schedule', { method: 'POST', body: { hour: Number(box.querySelector('#h').value), minute: Number(box.querySelector('#m').value) } });
      toastMsg('Đã lưu.'); renderView();
    };
    box.querySelector('#toggleSched').onclick = async () => { await api('/api/schedule', { method: 'POST', body: { enabled: !s.enabled } }); renderView(); };
  } catch {}
}

async function handleCsv(kind, file, view) {
  const previewBox = view.querySelector('#csvPreview');
  if (!file) { previewBox.innerHTML = '<div class="hint" style="margin-top:10px">Chọn file trước.</div>'; return; }
  try {
    const text = await file.text();
    const r = await api(`/api/csv/preview?kind=${kind}`, { method: 'POST', body: text, raw: true });
    previewBox.innerHTML = `<div class="card" style="margin-top:12px;background:rgba(255,255,255,.03)">
      <div class="card-head"><div><div class="eyebrow">Xem trước</div><h3>${kind === 'wellness' ? 'Wellness' : 'Activities'}</h3></div><span class="confidence-chip">${r.total} dòng</span></div>
      ${r.dates ? `<div class="set-row"><span class="k">Khoảng ngày</span><span class="v">${esc(r.dates.oldest)} → ${esc(r.dates.newest)}</span></div>` : ''}
      ${r.error ? `<div class="notice">${esc(r.error)}</div>` : ''}
      <div class="actions">${r.error ? '' : '<button class="btn primary small" id="commit">Xác nhận nhập</button>'}<button class="btn ghost small" id="cancel">Huỷ</button></div>
      <div class="hint" style="margin-top:8px">Ngày / activity ID trùng sẽ cập nhật, không tạo bản sao. Trường trống không xoá dữ liệu cũ.</div>
    </div>`;
    previewBox.querySelector('#cancel').onclick = () => { previewBox.innerHTML = ''; };
    const commit = previewBox.querySelector('#commit');
    if (commit) commit.onclick = async () => {
      try { const res = await api('/api/csv/commit', { method: 'POST', body: { token: r.token } }); toastMsg(`Đã nhập ${res.written} dòng.`); renderView(); }
      catch (e) { toastMsg(e.message); }
    };
  } catch (e) { toastMsg(e.message); }
}

boot();
