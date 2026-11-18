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
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 4.8-9 4.8-9-4.8L12 3z"/><path d="M3 12.2l9 4.8 9-4.8"/><path d="M3 16.4l9 4.8 9-4.8"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  alarm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.4 1.6M4 5.5L6.8 3M20 5.5L17.2 3"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="13" r="7.5"/><circle cx="11" cy="13" r="3.5"/><path d="M11 13l8-8M16 5h3v3"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 3l1.6 4.6L16 9.2l-4.4 1.6L10 15.4 8.4 10.8 4 9.2l4.4-1.6L10 3zM17.5 13l.9 2.5 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.5z"/></svg>',
  bike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="16" r="3.6"/><circle cx="18" cy="16" r="3.6"/><path d="M6 16l4-7h5l3 7M10 9l3 7h-3M14 5.5h2.5"/></svg>',
  swim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="16.5" cy="6.5" r="1.8"/><path d="M5 12l4-3 3 2.5 2.5-1.5M2.5 16.5c1.6 0 1.6 1.2 3.2 1.2s1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3-1.2"/></svg>',
  racket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="14" cy="9" rx="6" ry="6.5" transform="rotate(35 14 9)"/><path d="M9.6 13.6L4 20M17.5 19.5a1.6 1.6 0 1 0 0-.1"/></svg>',
  yoga: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.9"/><path d="M12 8v6M6 10.5l6 1.5 6-1.5M7 19.5c1.5-2.5 3-3.5 5-3.5s3.5 1 5 3.5M4 19.5h16"/></svg>',
  sun: '<svg class="pill-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
};
let logoN = 0;
function logo() {
  const n = ++logoN;
  return `<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lgH${n}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9a8ff"/><stop offset=".55" stop-color="#a45cff"/><stop offset="1" stop-color="#ff5fa8"/></linearGradient></defs><path d="M20 35S4.5 25.6 4.5 14.6A8.2 8.2 0 0 1 20 10a8.2 8.2 0 0 1 15.5 4.6C35.5 25.6 20 35 20 35z" fill="url(#lgH${n})"/><path d="M7.5 19.5h6l2.6-5.2 3.8 10 3.3-7.2 1.9 2.4h7.4" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" opacity=".95"/></svg>`;
}

const NAV = [
  { id: 'today', label: 'Hôm nay', icon: 'today', color: '#a46bff' },
  { id: 'trends', label: 'Xu hướng', icon: 'trends', color: '#4f8dff' },
  { id: 'activities', label: 'Tập', icon: 'dumbbell', color: '#ff8a3d' },
  { id: 'journal', label: 'Quy luật', icon: 'layers', color: '#ff5fa8' },
  { id: 'settings', label: 'Cài đặt', icon: 'settings', color: '#25d0c4' },
];

/* ---------------- charts ---------------- */
function lineChart(series, { color = '#b48cff', digits = 1, unit = '' } = {}) {
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
    <text x="${W - P.r}" y="${P.t - 5}" text-anchor="end" fill="#a69cc9" font-size="10">TB ${fmtNum(mean, digits)}${unit ? ' ' + esc(unit) : ''}</text>
  </svg>`;
}

function recoveryBars(history) {
  const W = 720, H = 190, P = { l: 34, r: 12, t: 14, b: 24 };
  const innerW = W - P.l - P.r;
  const innerH = H - P.t - P.b;
  const n = history.length;
  const gap = n > 45 ? 1 : n > 20 ? 2 : 4;
  const bw = Math.max(1.5, (innerW - gap * (n - 1)) / n);
  const colors = { green: '#3fe0a8', yellow: '#ffc04d', red: '#ff6b8f', unknown: '#2a2350' };
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
    ${avgY != null ? `<line x1="${P.l}" y1="${avgY.toFixed(1)}" x2="${W - P.r}" y2="${avgY.toFixed(1)}" stroke="rgba(255,255,255,.26)" stroke-width="1" stroke-dasharray="4 5"/><text x="${W - P.r}" y="${(avgY - 5).toFixed(1)}" text-anchor="end" fill="#a69cc9" font-size="9.5">TB ${Math.round(avg)}</text>` : ''}
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
function navButton(n) {
  return `<button class="nav-item ${state.view === n.id ? 'active' : ''}" data-view="${n.id}" style="--nc:${n.color}">${ICONS[n.icon]}<span>${n.label}</span></button>`;
}

function renderShell() {
  const me = state.user;
  const todayTxt = new Date().toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
  app.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="brand brand-side">${logo()}<div class="brand-name">Nhịp Sống</div><div class="brand-sub">Sức khỏe · Vận động · Giấc ngủ</div></div>
      <nav class="side-nav">${NAV.map((n) => navButton(n)).join('')}</nav>
      <div class="sidebar-foot">
        <div class="avatar">${esc(initials(me.displayName))}</div>
        <div class="who"><b>${esc(me.displayName)}</b><span>${me.role === 'admin' ? 'Quản trị' : 'Thành viên'}</span></div>
        <button class="icon-btn" id="logout" title="Đăng xuất" aria-label="Đăng xuất">${ICONS.logout}</button>
      </div>
    </aside>
    <div class="main-wrap">
      <header class="mobile-head">
        <div class="brand">${logo()}<div><div class="brand-name">Nhịp Sống</div><div class="brand-sub">Sức khỏe hôm nay, phong độ ngày mai</div></div></div>
        <div class="mobile-head-right">
          <span class="mobile-date">${esc(todayTxt)}</span>
          <button class="icon-btn" id="syncMobile" title="Đồng bộ" aria-label="Đồng bộ">${ICONS.sync}</button>
          <div class="avatar">${esc(initials(me.displayName))}</div>
        </div>
      </header>
      <nav class="tile-nav" id="tileNav">${NAV.map((n) => navButton(n)).join('')}</nav>
      <main class="view" id="view"></main>
    </div>
    <nav class="bottom-nav" aria-label="Điều hướng nhanh">${NAV.map((n) => navButton(n)).join('')}</nav>
  </div>`;
  app.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  // Phone: the coloured tile row sits at the top (as in the design); once it scrolls away,
  // a compact bar slides in at the bottom so navigation is always one tap away.
  const tiles = document.getElementById('tileNav');
  if (tiles && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => document.body.classList.toggle('tiles-away', !e.isIntersecting), { threshold: 0 }).observe(tiles);
  }
  const out = document.getElementById('logout');
  if (out) out.onclick = logout;
  const syncM = document.getElementById('syncMobile');
  if (syncM) syncM.onclick = () => runSync(syncM);
  renderView();
}

async function runSync(btn) {
  if (btn) btn.classList.add('spin');
  toastMsg('Đang đồng bộ…');
  try {
    const r = await api('/api/sync', { method: 'POST', body: {} });
    toastMsg(`Xong: ${r.stats.wellness.written} ngày wellness, ${r.stats.activities.written} buổi tập.`);
    await renderView();
  } catch (e) { toastMsg('Đồng bộ lỗi: ' + e.message); }
  if (btn) btn.classList.remove('spin');
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
    <div class="factor-top"><span class="factor-name">${esc(f.label)}${f.suspectHigh ? '<span class="chip-suspect">cao bất thường · không cộng điểm</span>' : ''}</span><span class="factor-value">${esc(f.valueText)}</span></div>
    <div class="factor-mid"><span>${esc(f.basis)} · nền ${esc(f.meanText)}</span><span class="z-chip ${f.status}">${esc(z)}</span></div>
    <div class="zbar"><span class="zbar-zero"></span><span class="zbar-fill ${f.status}" style="left:${left.toFixed(1)}%;width:${fill.toFixed(1)}%"></span></div>
    <div class="factor-bottom"><span>${esc(f.text)}</span>${hasPts ? `<span class="pts ${f.contribution >= 0 ? 'up' : 'down'}">${esc(pts)}</span>` : '<span class="pts muted">bổ sung</span>'}</div>
  </div>`;
}

function hrvGateBody(d) {
  const g = d.recovery.hrvGate || d.advice?.hrvGate || {};
  const text = g.text || d.recovery.note || 'Cần HRV rMSSD để có kết luận.';
  const syncBtn = d.sync?.hasKey ? `<button class="btn small" type="button" data-auto-sync-hero>${ICONS.sync} Đồng bộ</button>` : '';
  const manualBtn = '<button class="btn primary small" type="button" data-gate-manual>Nhập HRV bằng tay</button>';
  if (g.state === 'no_device_hrv') {
    return `<div class="hero-gate gate-warn">
      <div class="gate-title">App này cần HRV</div>
      <p>${esc(text)}</p>
      <div class="gate-cta">${manualBtn}${syncBtn}</div>
    </div>`;
  }
  if (g.state === 'hrv_building') {
    const have = Number(g.nights ?? g.daysAvailable) || 0;
    const need = Number(g.minDays) || 1;
    const pct = Math.max(0, Math.min(100, Math.round((have / need) * 100)));
    return `<div class="hero-gate gate-info">
      <div class="gate-title">Đang xây mức nền HRV</div>
      <div class="gate-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${need}" aria-valuenow="${have}"><span style="width:${pct}%"></span></div>
      <div class="gate-count">${have}/${need} đêm</div>
      <p>${esc(text)}</p>
    </div>`;
  }
  return `<div class="hero-gate gate-warn">
    <div class="gate-title">Chưa có HRV gần đây</div>
    <p>${esc(text)}</p>
    <div class="gate-cta">${syncBtn}${manualBtn}</div>
  </div>`;
}

/* ---------------- today: aurora dashboard (v4) ---------------- */
function smoothD(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Glowing smooth line of real values (nulls skipped), soft fill under it, dot on the last value. */
function waveChart(values, hex, { w = 260, h = 74, fill = true, dot = true } = {}) {
  const iv = ++uid;
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v != null && Number.isFinite(p.v));
  if (pts.length < 2) return `<svg class="wave" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const range = max - min || 1;
  const n = Math.max(1, values.length - 1);
  const xy = pts.map((p) => ({ x: 6 + (p.i / n) * (w - 14), y: h - 8 - ((p.v - min) / range) * (h - 22) }));
  const d = smoothD(xy);
  const last = xy[xy.length - 1];
  const area = `${d} L${last.x.toFixed(1)},${h} L${xy[0].x.toFixed(1)},${h} Z`;
  return `<svg class="wave" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="wf${iv}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex}" stop-opacity=".42"/><stop offset="1" stop-color="${hex}" stop-opacity="0"/></linearGradient>
      <filter id="wg${iv}" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    ${fill ? `<path d="${area}" fill="url(#wf${iv})"/>` : ''}
    <path d="${d}" fill="none" stroke="${hex}" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke" filter="url(#wg${iv})"/>
    ${dot ? `<circle class="wave-dot" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" fill="#fff" stroke="${hex}" stroke-width="2.5" filter="url(#wg${iv})"/>` : ''}
  </svg>`;
}

/** 7-day recovery line inside the hero: fixed 40–100 scale (lower if a day fell below 40). */
function trend7(history) {
  const last = (history || []).slice(-7);
  if (!last.length) return '';
  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const day = (iso) => { const t = new Date(String(iso) + 'T12:00:00'); return Number.isNaN(+t) ? '' : DOW[t.getDay()]; };
  const scores = last.map((h) => h.score).filter((v) => v != null);
  const lo = Math.min(40, ...scores.map((v) => Math.floor(v / 20) * 20));
  const W = 320, H = 150, L = 30, R = 14, T = 18, B = 26;
  const x = (i) => L + (last.length === 1 ? 0 : (i / (last.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (100 - lo)) * (H - T - B);
  const grid = [];
  for (let g = lo; g <= 100; g += 20) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}"/><text x="${L - 8}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end">${g}</text>`);
  const pts = last.map((h, i) => (h.score == null ? null : { x: x(i), y: y(h.score), v: h.score, i })).filter(Boolean);
  const d = smoothD(pts);
  const iv = ++uid;
  const lp = pts[pts.length - 1];
  const todayLast = lp && lp.i === last.length - 1;
  return `<div class="trend7">
    <div class="trend7-head"><span>Xu hướng 7 ngày</span><button class="chip-btn" data-go="trends">7 ngày ${ICONS.chev}</button></div>
    <svg viewBox="0 0 ${W} ${H}" class="trend7-svg" role="img" aria-label="Điểm hồi phục 7 ngày">
      <defs>
        <linearGradient id="tf${iv}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b98cff" stop-opacity=".38"/><stop offset="1" stop-color="#b98cff" stop-opacity="0"/></linearGradient>
        <filter id="tg${iv}" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <g class="trend7-grid">${grid.join('')}</g>
      ${pts.length > 1 ? `<path d="${d} L${lp.x.toFixed(1)},${H - B} L${pts[0].x.toFixed(1)},${H - B} Z" fill="url(#tf${iv})"/><path d="${d}" fill="none" stroke="#c9a2ff" stroke-width="2.4" filter="url(#tg${iv})"/>` : ''}
      ${pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p === lp ? 5 : 3.6}" class="${p === lp ? 'last' : ''}"/>`).join('')}
      ${lp ? `<g class="trend7-pill" transform="translate(${Math.min(lp.x, W - 24).toFixed(1)},${Math.max(lp.y - 24, 4).toFixed(1)})"><rect x="-17" y="-12" width="34" height="22" rx="8"/><text y="4" text-anchor="middle">${lp.v}</text></g>` : ''}
      ${last.map((h, i) => `<text class="dow ${i === last.length - 1 && todayLast ? 'on' : ''}" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${day(h.date)}</text>`).join('')}
    </svg>
  </div>`;
}

function deltaPill(diff, { higherBetter = true, text, flatBelow = 0 } = {}) {
  if (diff == null || !Number.isFinite(diff)) return '<span class="dpill flat">—</span>';
  const kind = Math.abs(diff) <= flatBelow ? 'flat' : (diff > 0) === higherBetter ? 'good' : 'bad';
  const arrow = kind === 'flat' ? '' : diff > 0 ? '<i class="tri up"></i>' : '<i class="tri down"></i>';
  return `<span class="dpill ${kind}">${arrow}${esc(text)}</span>`;
}
const signed = (v, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

function tileHead(icon, title, tip) {
  return `<div class="tile-head"><span class="tile-ico">${ICONS[icon] || ''}</span><h3>${esc(title)}</h3>${tip ? `<span class="tip" title="${esc(tip)}">${ICONS.info}</span>` : ''}</div>`;
}
function hmParts(min) {
  if (min == null || !Number.isFinite(min)) return '<b>—</b>';
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `<span class="hm-long"><b>${h}</b><small>giờ</small> <b>${mm}</b><small>phút</small></span><span class="hm-short"><b>${h}<i>h</i>${mm}</b></span>`;
}

function hrvTile(d) {
  const m = d.metrics.hrv;
  const pct = m.value != null && m.mean ? ((m.value - m.mean) / m.mean) * 100 : null;
  return `<article class="tile c-teal hrv-tile" data-go="trends" role="button" tabindex="0">
    ${tileHead('hrv', 'HRV', `${m.basis || ''}${m.mean != null ? ` · nền ${fmtNum(m.mean, 1)} ms` : ''}`)}
    <div class="tile-row"><div class="tile-val">${m.value == null ? '—' : fmtNum(m.value, m.value < 100 ? 0 : 0)}<small>ms</small></div>
    ${deltaPill(pct, { higherBetter: true, text: pct == null ? '' : `${signed(pct)}%`, flatBelow: 1 })}</div>
    <div class="tile-sub">${esc(m.tier ? `Xu hướng ${m.tier}` : (m.basis || ''))}</div>
    ${waveChart(d.metrics.spark.map((p) => p.hrv), '#3ff3e0')}
  </article>`;
}
function rhrTile(d) {
  const m = d.metrics.rhr;
  const r = d.metrics.resp;
  const diff = m.value != null && m.mean != null ? m.value - m.mean : null;
  return `<article class="tile c-pink rhr-tile" data-go="trends" role="button" tabindex="0">
    ${tileHead('heart', 'Nhịp tim nghỉ', `${m.basis || ''}${m.mean != null ? ` · nền ${fmtNum(m.mean)} bpm` : ''}`)}
    <div class="tile-row"><div class="tile-val">${m.value == null ? '—' : fmtNum(m.value)}<small>bpm</small></div>
    ${deltaPill(diff, { higherBetter: false, text: diff == null ? '' : `${signed(diff)} bpm`, flatBelow: 0.6 })}</div>
    <div class="tile-sub">${r.value == null ? '&nbsp;' : `Nhịp thở ${fmtNum(r.value, 1)}/ph · <span class="${r.state === 'elevated' ? 'warn' : ''}">${r.state === 'elevated' ? 'tăng' : 'ổn'}</span>`}</div>
    ${waveChart(d.metrics.spark.map((p) => p.rhr), '#ff6b8f')}
  </article>`;
}
function sleepTile(d) {
  const m = d.metrics.sleep;
  const n = d.sleepDetail?.night;
  const mins = m.value == null ? null : m.value * 60;
  const diff = m.value != null && m.mean != null ? (m.value - m.mean) * 60 : null;
  let body;
  if (n && n.hasStages) {
    const total = n.deepMin + n.coreMin + n.remMin + n.awakeMin + (n.unspecifiedMin || 0);
    const seg = (k, v) => (v > 0 && total > 0 ? `<span style="flex:${v};background:${STAGE_COLORS[k] || '#6c6494'}"></span>` : '');
    body = `<div class="stage-bar">${seg('deep', n.deepMin)}${seg('core', n.coreMin)}${seg('rem', n.remMin)}${seg('awake', n.awakeMin)}</div>
      <div class="stage-leg">
        <span><i style="background:${STAGE_COLORS.deep}"></i>Sâu<b>${hm(n.deepMin).replace('h', ':')}</b></span>
        <span><i style="background:${STAGE_COLORS.core}"></i><em class="wide-only">Ngủ nhẹ</em><em class="narrow-only">Nhẹ</em><b>${hm(n.coreMin).replace('h', ':')}</b></span>
        <span><i style="background:${STAGE_COLORS.rem}"></i>REM<b>${hm(n.remMin).replace('h', ':')}</b></span>
      </div>`;
  } else {
    body = `${m.score != null ? `<div class="tile-sub"><span class="soft-chip">${ICONS.bed} Điểm ngủ ${fmtNum(m.score)}</span></div>` : ''}
      ${waveChart(d.metrics.spark.map((p) => p.sleep), '#8f8bff')}`;
  }
  return `<article class="tile c-indigo sleep-tile" data-go="trends" role="button" tabindex="0">
    <svg class="moon-deco" viewBox="0 0 100 100" aria-hidden="true"><defs><mask id="mm${++uid}"><rect width="100" height="100" fill="#fff"/><circle cx="36" cy="40" r="34" fill="#000"/></mask><radialGradient id="mg${uid}" cx=".6" cy=".4" r=".7"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#c9c0ff"/></radialGradient></defs><circle cx="56" cy="46" r="34" fill="url(#mg${uid})" mask="url(#mm${uid})"/></svg>
    ${tileHead('moon', 'Giấc ngủ', m.basis || '')}
    <div class="tile-row"><div class="tile-val hm">${hmParts(mins)}</div>
    ${deltaPill(diff, { higherBetter: true, text: diff == null ? '' : `${signed(diff)} phút`, flatBelow: 4 })}</div>
    ${n?.bedStart ? `<div class="tile-sub">${esc(n.bedStart)} → ${esc(n.bedEnd || '—')}${m.basis ? `<span class="wide-only"> · ${esc(m.basis)}</span>` : ''}</div>` : `<div class="tile-sub">${esc(m.basis || '')}</div>`}
    ${body}
  </article>`;
}

function actKind(a) {
  const t = String(a.type || '');
  if (/padel|pickle|tennis|squash|racquet|badminton/i.test(t)) return 'racket';
  if (/yoga|pilates/i.test(t)) return 'yoga';
  if (/ride|bike|cycl/i.test(t)) return 'bike';
  if (/swim/i.test(t)) return 'swim';
  if (/weight|strength|crossfit/i.test(t)) return 'dumbbell';
  if (/run|walk|hike/i.test(t)) return 'activities';
  return 'flame';
}
function relDay(iso) {
  const day = String(iso || '').slice(0, 10);
  if (!day) return '—';
  const t = todayIso();
  const y = new Date(`${t}T12:00:00`); y.setDate(y.getDate() - 1);
  if (day === t) return 'Hôm nay';
  if (day === new Intl.DateTimeFormat('en-CA').format(y)) return 'Hôm qua';
  return fmtLong(day);
}
function workoutCard(d) {
  const items = d.recent || [];
  const a = items[0];
  const st = d.strain && Array.isArray(d.strain.last7) ? d.strain.last7 : [];
  const chart = st.length > 1 ? `<div class="work-chart">${waveChart(st.map((x) => (x && Number.isFinite(Number(x.strain)) ? Number(x.strain) : 0)), '#ff9a3c', { w: 420, h: 96, dot: false })}<span class="work-chart-cap">Strain 7 ngày</span></div>` : '';
  const head = `<div class="tile-head">${'<span class="tile-ico">' + ICONS.activities + '</span>'}<h3>Buổi tập gần đây</h3><button class="chip-btn" data-go="activities">Xem tất cả ${ICONS.chev}</button></div>`;
  if (!a) {
    return `<article class="tile c-orange work-card">${head}<div class="empty">Chưa có buổi tập. Bấm Đồng bộ hoặc nhập CSV trong Cài đặt.</div>${chart}</article>`;
  }
  const start = String(a.start_date_local || '');
  const time = start.slice(11, 16);
  const mins = Math.round((a.moving_time || 0) / 60);
  return `<article class="tile c-orange work-card">
    ${head}
    <div class="work-main">
      <div class="work-badge">${ICONS[actKind(a)]}</div>
      <div class="work-name"><b>${esc(a.name || a.type || 'Buổi tập')}</b><span>${esc(relDay(start))}${time ? `, ${esc(time)}` : ''}</span></div>
    </div>
    <div class="work-stats">
      <div>${ICONS.clock}<b>${fmtNum(mins)}</b><small>phút</small><span>Thời lượng</span></div>
      <div>${ICONS.flame}<b>${a.training_load != null ? fmtNum(a.training_load) : '—'}</b><span>Tải tập</span></div>
    </div>
    ${chart}
    ${items.length > 1 ? `<div class="work-more">${items.slice(1, 4).map((x) => `<span>${ICONS[actKind(x)]}${esc(x.name || x.type || 'Buổi tập')} · ${Math.round((x.moving_time || 0) / 60)}′</span>`).join('')}</div>` : ''}
  </article>`;
}

function sleepPlanCard(d) {
  const p = d.sleepPlan;
  if (!p) return '';
  const wake = localStorage.getItem('nhipWake') || '06:30';
  const wakeMin = parseClock(wake);
  const bed = (mins) => minutesToClock(wakeMin - mins - 15);
  const target = p.tiers.perform;
  return `<article class="tile c-night plan-card">
    <svg class="plan-scene" viewBox="0 0 400 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <circle cx="330" cy="46" r="26" fill="url(#moonG)"/>
      <defs><radialGradient id="moonG" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#e3dcff"/><stop offset="1" stop-color="#b6a6ff" stop-opacity=".6"/></radialGradient></defs>
      <path d="M0 120 C60 92 110 108 170 86 C230 64 280 98 340 80 C370 72 390 76 400 74 V150 H0Z" fill="rgba(122,96,255,.28)"/>
      <path d="M0 136 C80 116 150 132 230 112 C300 96 350 122 400 108 V150 H0Z" fill="rgba(40,24,110,.65)"/>
    </svg>
    <div class="tile-head"><span class="tile-ico">${ICONS.bed}</span><h3>Kế hoạch ngủ</h3></div>
    <p class="plan-lead">Ngủ đủ và đúng giờ để phục hồi tốt hơn.</p>
    <div class="plan-box">
      <div class="plan-goal"><span class="plan-ico">${ICONS.target}</span><div><span>Mục tiêu tối nay</span><div class="plan-big">${hmParts(target)}</div></div></div>
      <div class="plan-times">
        <div><span class="plan-ico sm">${ICONS.bed}</span><div><span>Đi ngủ</span><b data-bed-mins="${target}">${bed(target)}</b></div></div>
        ${ICONS.chev}
        <label class="plan-wake"><span class="plan-ico sm">${ICONS.alarm}</span><div><span>Thức dậy</span><b data-wake-text>${esc(wake)}</b><input type="time" id="wakeTime" value="${esc(wake)}" aria-label="Giờ thức dậy (chạm để đổi)"></div></label>
      </div>
    </div>
    <div class="plan-tiers">
      <span title="${esc(p.tierLabels.getBy)}">Tối thiểu <b>${hm(p.tiers.getBy)}</b> · ngủ <b data-bed-mins="${p.tiers.getBy}">${bed(p.tiers.getBy)}</b></span>
      <span title="${esc(p.tierLabels.peak)}">Đỉnh <b>${hm(p.tiers.peak)}</b> · ngủ <b data-bed-mins="${p.tiers.peak}">${bed(p.tiers.peak)}</b></span>
      <span>Nợ ngủ 7 ngày <b>${hm(p.debtMinutes)}</b>${p.strainBumpMinutes ? ` · +${fmtNum(p.strainBumpMinutes)} phút vì tập` : ''}</span>
    </div>
  </article>`;
}

function heroCard(d) {
  const r = d.recovery;
  if (r.needsHrv) {
    return `<section class="hero tile c-violet band-unknown hero-gated">
    <div class="hero-head">
      <div class="tile-head"><span class="tile-ico">${ICONS.leaf}</span><h3>Phục hồi tổng thể</h3></div>
      <button class="icon-btn" id="syncBtn" title="Đồng bộ Intervals.icu" aria-label="Đồng bộ">${ICONS.sync}</button>
    </div>
    ${hrvGateBody(d)}
    <div class="hero-foot">
      <span>${d.data.days} ngày dữ liệu</span>
      <span>${d.lastSync ? 'đồng bộ ' + esc(fmtDateTime(d.lastSync)) : 'chưa đồng bộ'}</span>
    </div>
  </section>`;
  }
  const R = 92;
  const circ = 2 * Math.PI * R;
  const dash = r.score == null ? 0 : (r.score / 100) * circ;
  const emergency = r.band === 'emergency';
  const warn = r.band === 'red' || emergency;
  const c1 = warn ? '#ffb3a8' : '#e7c8ff';
  const c2 = warn ? '#ff5d52' : '#9a5cff';
  const c3 = warn ? '#ff3c6e' : '#d070ff';
  return `<section class="hero tile c-violet band-${r.band} ${emergency ? 'hero-emergency' : ''}">
    <div class="hero-head">
      <div class="tile-head"><span class="tile-ico">${ICONS.leaf}</span><h3>Phục hồi tổng thể</h3><button class="tip tip-btn" type="button" data-explain-tip title="Vì sao điểm này?">${ICONS.info}</button></div>
    </div>
    <div class="hero-main">
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 220 220" role="img" aria-label="Chỉ số hồi phục ${r.score == null ? 'chưa đủ dữ liệu' : r.score + ' trên 100'}">
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".5" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient></defs>
          <circle class="ring-halo" cx="110" cy="110" r="${R}"/>
          <circle class="ring-track" cx="110" cy="110" r="${R}"/>
          <circle class="ring-value" cx="110" cy="110" r="${R}" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" style="stroke:url(#ringGrad);filter:drop-shadow(0 0 12px ${c2})"/>
        </svg>
        <div class="ring-center">
          <div class="ring-score ${r.score == null ? 'empty' : ''}">${r.score == null ? '—' : r.score}</div>
          <div class="ring-unit">/ 100</div>
        </div>
      </div>
      <div class="hero-info">
        <div class="hero-eyebrow">${ICONS.leaf}Phục hồi</div>
        <div class="hero-band"><span class="hero-band-ico">${ICONS.sparkle}</span>${esc(r.bandLabel)}</div>
        <p class="hero-action">${esc(r.action)}</p>
        <div class="hero-verdict"><span class="dot"></span>${esc(d.advice.label)}</div>
        <div class="hero-cta"><button class="btn small" type="button" data-explain hidden>Vì sao hôm nay?</button></div>
      </div>
    </div>
    ${trend7(d.history)}
    ${emergency && d.advice.emergency?.show ? `<div class="emergency-box">${esc(d.advice.emergency.text)}</div>` : ''}
    ${r.capped ? `<div class="cap-note">Điểm bị giới hạn vì ${esc(r.capped)}. Cảm giác của bạn thắng đồng hồ.</div>` : ''}
    ${r.provisional ? `<div class="cap-note">Chỉ số tạm tính từ ${r.provisional.nights} đêm HRV. Đủ ${r.provisional.fullDays} đêm app tự dùng mức nền đầy đủ.</div>` : ''}
    <div class="hero-foot">
      <span>${r.used}/${r.total} yếu tố · tin cậy ${esc(r.confidence)}</span>
      <span>${d.data.days} ngày dữ liệu</span>
      <span>${d.lastSync ? 'đồng bộ ' + esc(fmtDateTime(d.lastSync)) : 'chưa đồng bộ'}</span>
    </div>
  </section>`;
}

function factorsCard(d) {
  return `<div class="card factors-card">
    <div class="card-head"><div class="card-title"><span class="ico-chip" style="--chip:#ffc04d">${ICONS.bulb}</span><div><div class="eyebrow">Phân rã</div><h3>Vì sao điểm này?</h3></div></div><span class="confidence-chip ${d.recovery.confidence === 'cao' ? 'green' : d.recovery.confidence === 'vừa' ? 'amber' : 'red'}">${esc(d.recovery.confidence)}</span></div>
    ${d.recovery.factors.map(factorRow).join('')}
    ${d.recovery.capped && d.recovery.rawScore != null ? `<div class="cap-line">Điểm thô ${d.recovery.rawScore} bị giới hạn còn ${d.recovery.score} vì ${esc(d.recovery.capped)}.</div>` : ''}
    ${d.recovery.score == null && d.recovery.factors.length ? `<div class="cap-line note-line">${esc(d.recovery.note)}</div>` : ''}
    <div class="formula hint">Điểm = trung bình có trọng số: HRV 45%, nhịp tim nghỉ 25%, giấc ngủ 30%. Giấc ngủ dùng điểm HUAWEI đồng bộ qua Intervals.icu; nếu thiếu điểm thì dùng thời lượng so với nhu cầu. HRV lấy lúc ngủ từ Apple Health khi có, nếu không thì dùng HRV trung bình ngày từ Intervals.icu (hai nguồn không bao giờ trộn). Nhu cầu ngủ tăng theo strain hôm qua. Nhịp thở chỉ là cờ cảnh báo, không cộng điểm. Không có HRV thì không có điểm; thiếu nhịp tim nghỉ hoặc giấc ngủ thì chia lại trọng số. Không phải thuật toán WHOOP.</div>
  </div>`;
}

function historyCard(d) {
  const valid = d.history.filter((h) => h.score != null);
  const avg = valid.length ? Math.round(valid.reduce((a, h) => a + h.score, 0) / valid.length) : null;
  return `<div class="card history-card">
    <div class="chart-head"><div class="card-title"><span class="ico-chip">${ICONS.chart}</span><div><div class="chart-title">30 ngày hồi phục</div><div class="chart-meta">${avg == null ? 'Chưa đủ dữ liệu' : `TB ${avg} · ${valid.length} ngày có điểm`}</div></div></div></div>
    ${recoveryBars(d.history)}
    <div class="chart-legend"><span><i class="sw" style="background:#3fe0a8"></i>Sẵn sàng (67–100)</span><span><i class="sw" style="background:#ffc04d"></i>Trung bình (34–66)</span><span><i class="sw" style="background:#ff6b8f"></i>Cần hồi phục (0–33)</span></div>
  </div>`;
}

/* Sleep structure pushed from Apple Health by the iPhone Shortcut. Shown, not scored. */
const STAGE_COLORS = { deep: '#4f6bff', core: '#a07bff', rem: '#62cdff', awake: '#ff7fb6' };
function durText(min) {
  if (min == null || !Number.isFinite(Number(min))) return '—';
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} phút`;
}
function pctText(x) { return x == null ? '—' : `${Math.round(x * 100)}%`; }
function vsNorm(value, norm, { higherBetter = true, neutral = false, unit = '%', scale = 100, digits = 0 } = {}) {
  if (value == null || norm == null) return '';
  const diff = (value - norm) * scale;
  const shown = Math.abs(diff).toFixed(digits);
  if (Number(shown) === 0) return '<span class="sd-vs flat">như thường</span>';
  const good = higherBetter ? diff > 0 : diff < 0;
  return `<span class="sd-vs ${neutral ? '' : good ? 'up' : 'down'}">${diff > 0 ? '+' : '−'}${shown}${unit} so với thường</span>`;
}
const APPLE_FIELD_LABEL = { hrv_rmssd: 'HRV', resting_hr: 'nhịp tim nghỉ', respiration: 'nhịp thở', spo2: 'SpO2', steps: 'số bước', avg_sleeping_hr: 'nhịp tim khi ngủ', sleep_secs: 'giờ ngủ', sleep_score: 'điểm ngủ' };
function consistencyHtml(c) {
  if (!c || typeof c !== 'object') return '';
  const has = c.score != null && Number.isFinite(Number(c.score));
  const hint = has
    ? `lệch giờ ngủ ±${fmtNum(c.bedSdMin ?? 0)} phút`
    : `cần ${fmtNum(c.need || 4)} đêm (đang có ${fmtNum(c.nights || 0)})`;
  return `<div class="stat-row two"><div class="stat"><b>${has ? `${fmtNum(c.score)}<small>/100</small>` : '—'}</b><span>độ đều giờ ngủ · ${esc(hint)}</span></div>${has ? `<div class="stat"><b>${fmtNum(c.nights)}</b><span>đêm dùng để tính</span></div>` : ''}</div>`;
}
const HRV_METHOD_TEXT = { deep: 'trong ngủ sâu', sleep: 'cả giấc ngủ', window: '21:00–11:00' };
function hrvNightHtml(h) {
  if (!h || h.value == null || !Number.isFinite(Number(h.value))) return '';
  const m = HRV_METHOD_TEXT[h.method] || '';
  return `<div class="hint sd-hrv">HRV lúc ngủ: <b>${fmtNum(h.value, 1)} ms</b>${h.n ? ` (trung vị ${fmtNum(h.n)} lần đo${m ? ` ${m}` : ''})` : m ? ` (${m})` : ''}</div>`;
}
function sleepDetailCard(sd) {
  if (!sd || (!sd.connected && !sd.lastDate)) return '';
  const n = sd.night;
  const head = `<div class="card-head">
      <div class="card-title"><span class="ico-chip" style="--chip:#6f7dff">${ICONS.moon}</span><div><div class="eyebrow">Apple Health · đêm qua</div><h3>Cấu trúc giấc ngủ</h3></div></div>
      ${n?.sleepScore != null ? `<span class="confidence-chip">điểm ngủ ${fmtNum(n.sleepScore)}</span>` : ''}
    </div>`;
  if (!n) {
    return `<div class="card sleepd-card">${head}
      <div class="hint">${sd.lastDate ? `Chưa nhận đêm qua. Lần gần nhất: ${esc(fmtDate(sd.lastDate))}. Mở khoá iPhone để phím tắt chạy, hoặc chạy tay phím tắt "Nhịp Sống – Giấc ngủ".` : 'Đã tạo mã nhưng chưa nhận đêm nào. Chạy thử phím tắt "Nhịp Sống – Giấc ngủ" trên iPhone.'}</div>
    </div>`;
  }
  const total = n.deepMin + n.coreMin + n.remMin + n.awakeMin + (n.unspecifiedMin || 0);
  const seg = (k, v) => (v > 0 && total > 0 ? `<span style="width:${(v / total * 100).toFixed(2)}%;background:${STAGE_COLORS[k] || '#6c6494'}" title="${esc(k)}"></span>` : '');
  const nm = sd.norm && sd.norm.deepPct != null ? sd.norm : null;
  const row = (color, label, min, pct, normPct, neutral = false) => `<div class="sd-row"><span class="sd-dot" style="background:${color}"></span><span class="sd-k">${label}</span><span class="sd-v">${durText(min)}<small>${pctText(pct)}</small></span>${nm ? vsNorm(pct, normPct, { neutral }) : ''}</div>`;
  const cmp = sd.compare && Math.abs(sd.compare.diffMin) >= 20
    ? `<div class="hint" style="margin-top:8px">Intervals ghi ${durText(sd.compare.intervalsMin)}, Apple Health ghi ${durText(sd.compare.appleMin)} (lệch ${sd.compare.diffMin > 0 ? '+' : '−'}${Math.abs(sd.compare.diffMin)} phút).</div>`
    : '';
  return `<div class="card sleepd-card">${head}
    <div class="sd-bar">${seg('deep', n.deepMin)}${seg('core', n.coreMin)}${seg('rem', n.remMin)}${seg('unspecified', n.unspecifiedMin)}${seg('awake', n.awakeMin)}</div>
    <div class="sd-times"><span>${esc(n.bedStart || '—')}</span><span>ngủ ${durText(n.asleepMin)}</span><span>${esc(n.bedEnd || '—')}</span></div>
    ${n.hasStages ? `
      ${row(STAGE_COLORS.deep, 'Ngủ sâu', n.deepMin, n.deepPct, nm?.deepPct)}
      ${row(STAGE_COLORS.core, 'Ngủ nông (lõi)', n.coreMin, n.corePct, nm?.corePct, true)}
      ${row(STAGE_COLORS.rem, 'REM', n.remMin, n.remPct, nm?.remPct)}
      ${n.restorativeMin != null ? row('#8fa7ff', 'Ngủ phục hồi (sâu + REM)', n.restorativeMin, n.restorativePct, nm?.restorativePct) : ''}` : '<div class="hint">Đêm này không có giai đoạn ngủ, chỉ có tổng thời gian ngủ.</div>'}
    <div class="stat-row">
      <div class="stat"><b>${fmtNum(n.awakeMin)}</b><span>phút thức giữa đêm${nm ? ` · thường ${fmtNum(nm.awakeMin)}` : ''}</span></div>
      <div class="stat"><b>${fmtNum(n.awakenings)}</b><span>lần tỉnh ≥ 5 phút${nm ? ` · thường ${fmtNum(nm.awakenings, 1)}` : ''}</span></div>
      <div class="stat"><b>${pctText(n.efficiency)}</b><span>hiệu suất ngủ${nm?.efficiency != null ? ` · thường ${pctText(nm.efficiency)}` : ''}</span></div>
    </div>
    ${consistencyHtml(sd.consistency)}
    ${hrvNightHtml(sd.hrvNight)}
    ${sd.extras && [sd.extras.sleep_hr, sd.extras.spo2, sd.extras.resp].some((x) => x != null) ? `<div class="sd-extras">
      ${sd.extras.sleep_hr != null ? `<span><b>${fmtNum(sd.extras.sleep_hr)}</b> nhịp tim khi ngủ</span>` : ''}
      ${sd.extras.spo2 != null ? `<span><b>${fmtNum(sd.extras.spo2, 1)}%</b> SpO2</span>` : ''}
      ${sd.extras.resp != null ? `<span><b>${fmtNum(sd.extras.resp, 1)}</b> nhịp thở/phút</span>` : ''}
    </div>` : ''}
    ${n.napMin > 0 ? `<div class="hint" style="margin-top:8px">Ngủ trưa ${durText(n.napMin)}.</div>` : ''}
    ${cmp}
    ${sd.appleFields?.length ? `<div class="hint" style="margin-top:8px">Điểm hôm nay dùng từ Apple Health: ${esc(sd.appleFields.map((f) => APPLE_FIELD_LABEL[f] || f).join(', '))}.</div>` : ''}
    <div class="hint" style="margin-top:10px">${nm ? `So với trung bình ${nm.nights} đêm gần nhất của chính bạn.` : `Cần ${sd.norm?.need || 7} đêm có giai đoạn ngủ để so với thói quen của bạn (đang có ${sd.norm?.nights || 0}).`} Giai đoạn ngủ từ đồng hồ đeo tay có sai số; xem xu hướng nhiều đêm, đừng xét một đêm.</div>
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

/* Strain tập luyện 0–21 (từ load Intervals.icu). */
function strainLabel(v) {
  if (v == null) return '';
  return v < 10 ? 'Nhẹ' : v < 14 ? 'Vừa' : v < 18 ? 'Cao' : 'Rất cao';
}
const WEEKDAY_VN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function strainCard(d) {
  const st = d && d.strain;
  if (!st || typeof st !== 'object') return '';
  const num = (x) => (x != null && Number.isFinite(Number(x)) ? Number(x) : null);
  const today = st.today || {};
  const val = num(today.strain);
  const tg = st.target && num(st.target.min) != null && num(st.target.max) != null ? st.target : null;
  const pos = (v) => `${(Math.min(Math.max(v, 0), 21) / 21 * 100).toFixed(2)}%`;
  const zone = tg ? `<span class="strain-zone" style="left:${pos(tg.min)};width:${(((Math.min(tg.max, 21) - Math.max(tg.min, 0)) / 21) * 100).toFixed(2)}%"></span>` : '';
  const fill = val == null ? '' : `<span class="strain-fill" style="width:${pos(val)}"></span>`;
  const marker = val == null ? '' : `<span class="strain-marker" style="left:${pos(val)}"></span>`;
  const last7 = Array.isArray(st.last7) ? st.last7.slice(-7) : [];
  const maxBar = Math.max(21, ...last7.map((x) => num(x && x.strain) || 0));
  const bars = last7.map((x, i) => {
    const v = num(x && x.strain);
    const dt = x && x.date ? new Date(`${x.date}T12:00:00`) : null;
    const wd = dt && !Number.isNaN(+dt) ? WEEKDAY_VN[dt.getDay()] : '';
    const h = v ? Math.max(4, v / maxBar * 100) : 0;
    return `<div class="sb ${i === last7.length - 1 ? 'today' : ''}" title="${esc(x && x.date || '')}: ${v == null ? '—' : fmtNum(v, 1)}"><div class="sb-plot">${v ? `<span style="height:${h.toFixed(1)}%"></span>` : '<span class="none"></span>'}</div><div class="sb-d">${esc(wd)}</div></div>`;
  }).join('');
  const y = st.yesterday || {};
  const yv = num(y.strain);
  const sessions = num(today.sessions);
  const mins = num(today.minutes);
  return `<div class="card strain-card">
    <div class="card-head">
      <div class="card-title"><span class="ico-chip" style="--chip:#ffb35c">${ICONS.flame}</span><div><div class="eyebrow">Strain tập luyện</div><h3>Hôm nay</h3></div></div>
      ${val != null ? `<span class="confidence-chip strain-chip">${esc(strainLabel(val))}</span>` : ''}
    </div>
    <div class="strain-big">${val == null ? '—' : fmtNum(val, 1)}<small>/21</small></div>
    <div class="strain-track">${zone}${fill}${marker}</div>
    <div class="load-legend"><span>0</span><span>${tg ? `vùng mục tiêu ${fmtNum(tg.min)}–${fmtNum(tg.max)}` : ''}</span><span>21</span></div>
    <div class="strain-target">${tg ? `Mục tiêu hôm nay: <b>${fmtNum(tg.min)}–${fmtNum(tg.max)}</b>${tg.label ? ` · ${esc(tg.label)}` : ''}` : 'Chưa có mục tiêu'}</div>
    ${last7.length ? `<div class="strain-week">${bars}</div>` : ''}
    <div class="stat-row two">
      <div class="stat"><b>${yv == null ? '—' : fmtNum(yv, 1)}</b><span>hôm qua${yv != null ? ` · ${esc(strainLabel(yv))}` : ''}</span></div>
      <div class="stat"><b>${sessions == null ? '—' : fmtNum(sessions)}</b><span>buổi tập hôm nay${mins ? ` · ${fmtNum(mins)} phút` : ''}</span></div>
    </div>
    ${st.note ? `<div class="hint" style="margin-top:10px">${esc(st.note)}</div>` : ''}
  </div>`;
}

/* Hand-entered readings for what the sync cannot deliver, one form per day. */
const MANUAL_FIELDS = [
  { col: 'resting_hr', label: 'Nhịp tim nghỉ', unit: 'bpm', min: 30, max: 110, example: '55' },
  { col: 'sleep_secs', label: 'Giờ ngủ', sleep: true },
  { col: 'hrv_rmssd', label: 'HRV rMSSD đêm qua', unit: 'ms', min: 1, max: 300, example: '65', required: true },
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

const ENTRY_MODES = ['auto', 'manual'];
const ENTRY_RETRY_MS = 15 * 60 * 1000;

function entryModeKey() { return `nhipEntryMode:${state.user.id}`; }

/** The person's choice on this device; without one, follow whether a key is connected. */
function savedEntryMode(d) {
  const saved = localStorage.getItem(entryModeKey());
  return ENTRY_MODES.includes(saved) ? saved : d.sync?.hasKey ? 'auto' : 'manual';
}

/** The numbers a morning verdict rests on. HRV rMSSD is required. */
function morningFields(log) {
  return MANUAL_FIELDS.filter((f) => f.col === 'resting_hr' || f.col === 'sleep_secs' || f.col === 'hrv_rmssd');
}

function morningMissing(log) {
  const today = log.days?.[0];
  return morningFields(log).filter((f) => today?.values?.[f.col] == null);
}

function autoPaneHtml(d, log) {
  const today = log.days?.[0] || { values: {}, manual: {} };
  const missing = morningMissing(log);
  const rows = morningFields(log).map((f) => {
    const v = today.values[f.col];
    const chip = v == null ? { cls: 'red', text: 'chưa có' } : today.manual[f.col] ? { cls: 'amber', text: 'tự nhập' } : { cls: 'green', text: 'đồng bộ' };
    return `<div class="auto-row"><span>${esc(f.label)}</span><b>${v == null ? '—' : f.sleep ? sleepText(v) : `${fmtNum(v, f.col === 'hrv_rmssd' ? 1 : 0)} ${esc(f.unit)}`}</b><span class="confidence-chip ${chip.cls}">${chip.text}</span></div>`;
  }).join('');
  const names = missing.map((f) => f.label.toLowerCase()).join(', ');
  const message = !missing.length
    ? 'Đã đủ số cho sáng nay.'
    : !d.sync?.hasKey
      ? 'Chưa kết nối Intervals.icu nên chưa có số tự động. Bạn có thể kết nối, hoặc nhập tay để có kết luận ngay.'
      : `Intervals.icu chưa có ${names} hôm nay. Nhập tay để có kết luận ngay. Khi có số thật, đồng bộ sẽ thay số tay.`;
  return `<div class="auto-rows">${rows}</div>
    <p class="auto-message" data-auto-message>${esc(message)}</p>
    ${d.sync?.error ? `<p class="auto-error">Lần đồng bộ trước bị lỗi: ${esc(d.sync.error)}</p>` : ''}
    <div class="manual-actions">
      ${d.sync?.hasKey ? `<button class="btn small" type="button" data-auto-sync>${ICONS.sync} Đồng bộ ngay</button>` : '<button class="btn small" type="button" data-go="settings">Kết nối Intervals.icu</button>'}
      ${missing.length ? `<button class="btn primary small" type="button" data-auto-fill>Nhập tay phần thiếu</button>` : ''}
    </div>
    <div class="hint auto-last">${d.lastSync ? `Đồng bộ gần nhất ${esc(fmtDateTime(d.lastSync))}` : 'Chưa đồng bộ lần nào'}</div>`;
}

function manualFieldHtml(f) {
  const inputs = f.sleep
    ? `<div class="manual-sleep">
        <input data-manual-sleep="h" type="number" min="0" max="16" step="1" inputmode="numeric" placeholder="giờ" aria-label="Giờ">
        <input data-manual-sleep="m" type="number" min="0" max="59" step="1" inputmode="numeric" placeholder="phút" aria-label="Phút">
      </div>`
    : `<input data-manual-col="${f.col}" type="number" min="${f.min}" max="${f.max}" step="any" inputmode="decimal" placeholder="ví dụ ${esc(f.example)}">`;
  return `<label class="field manual-field">
    <span>${esc(f.label)}${f.unit ? ` <small>(${esc(f.unit)})</small>` : ''}${f.required ? ' <small class="req">· bắt buộc để có kết luận</small>' : ''} <em data-manual-state="${f.col}"></em></span>
    ${inputs}
  </label>`;
}

function manualCard(d) {
  const log = d.manualLog || { days: [], baseline: {} };
  const mode = state.entryView || savedEntryMode(d);
  const isadmin = state.user?.role === 'admin';
  return `<div class="card manual-card" data-manual>
    <div class="card-head">
      <div class="card-title"><span class="ico-chip">${ICONS.hrv}</span><div><div class="eyebrow">Nguồn dữ liệu</div><h3>Số của hôm nay</h3></div></div>
      <div class="range-row entry-tabs" role="tablist">
        <button type="button" role="tab" data-entry-tab="auto" class="${mode === 'auto' ? 'active' : ''}" aria-selected="${mode === 'auto'}">Tự động</button>
        <button type="button" role="tab" data-entry-tab="manual" class="${mode === 'manual' ? 'active' : ''}" aria-selected="${mode === 'manual'}">Nhập tay</button>
      </div>
    </div>
    <div class="auto-pane" data-entry-pane="auto" ${mode === 'auto' ? '' : 'hidden'}>${autoPaneHtml(d, log)}</div>
    <div data-entry-pane="manual" ${mode === 'manual' ? '' : 'hidden'}>
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
    <div class="hint manual-note">HRV rMSSD đêm qua là bắt buộc để có kết luận. Vòng không đo HRV (Mi Band, Xiaomi Smart Band 10 trở về trước) không dùng được app này.</div>
    <div class="hint manual-note">Các ô khác điền nếu có. Để trống ô tự nhập rồi lưu là xoá số đó. Khi Intervals.icu có số thật cho đúng ngày, số đồng bộ sẽ thay số tay.</div>
    </div>
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
    baselineEl.textContent = manualBaselineText(log.baseline);
    loadDay();
  };
  // Only your own numbers feed this page; for someone else just refresh the card.
  const refresh = async () => {
    if (target() === state.user.id) {
      await refreshKeepingScroll();
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

  const showPane = (mode) => {
    state.entryView = mode;
    for (const pane of card.querySelectorAll('[data-entry-pane]')) pane.hidden = pane.dataset.entryPane !== mode;
    for (const tab of card.querySelectorAll('[data-entry-tab]')) {
      tab.classList.toggle('active', tab.dataset.entryTab === mode);
      tab.setAttribute('aria-selected', String(tab.dataset.entryTab === mode));
    }
  };
  for (const tab of card.querySelectorAll('[data-entry-tab]')) {
    tab.onclick = () => {
      localStorage.setItem(entryModeKey(), tab.dataset.entryTab);
      showPane(tab.dataset.entryTab);
    };
  }
  // Filling a gap is for this visit only; tomorrow still opens on the chosen mode.
  const fillBtn = card.querySelector('[data-auto-fill]');
  if (fillBtn) {
    fillBtn.onclick = () => {
      showPane('manual');
      dateEl.value = d.today;
      loadDay();
      const first = morningMissing(d.manualLog)[0];
      form.querySelector(first?.sleep ? '[data-manual-sleep="h"]' : `[data-manual-col="${first?.col}"]`)?.focus();
    };
  }
  const gateBtn = view.querySelector('[data-gate-manual]');
  if (gateBtn) {
    gateBtn.onclick = () => {
      showPane('manual');
      dateEl.value = d.today;
      loadDay();
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form.querySelector('[data-manual-col="hrv_rmssd"]')?.focus({ preventScroll: true });
    };
  }
  const syncBtn = card.querySelector('[data-auto-sync]');
  if (syncBtn) {
    syncBtn.onclick = async () => {
      syncBtn.disabled = true;
      toastMsg('Đang đồng bộ…');
      try {
        const r = await api('/api/sync', { method: 'POST', body: {} });
        toastMsg(`Xong: ${r.stats.wellness.written} ngày wellness, ${r.stats.activities.written} buổi tập.`);
      } catch (err) { toastMsg('Đồng bộ lỗi: ' + err.message); }
      await refreshKeepingScroll();
    };
  }
  autoSyncIfMissing(view, d);
}

async function refreshKeepingScroll() {
  const y = window.scrollY;
  await renderView();
  window.scrollTo(0, y);
}

/**
 * Morning check: in Tự động with numbers still missing, ask Intervals.icu once
 * without waiting for a button. Never reloads the page under someone typing.
 */
async function autoSyncIfMissing(view, d) {
  const log = d.manualLog;
  const mode = state.entryView || savedEntryMode(d);
  if (mode !== 'auto' || !d.sync?.hasKey || !morningMissing(log).length) return;
  const last = Math.max(state.autoSyncAt || 0, d.lastSync ? Date.parse(`${d.lastSync}+07:00`) : 0);
  if (Date.now() - last < ENTRY_RETRY_MS) return;
  state.autoSyncAt = Date.now();
  const message = view.querySelector('[data-auto-message]');
  const waitingFor = message?.textContent;
  if (message) message.textContent = 'Đang hỏi Intervals.icu số mới nhất…';
  try {
    await api('/api/sync', { method: 'POST', body: {} });
  } catch { /* the refreshed card shows the stored sync error */ }
  if (state.view !== 'today') return;
  const fresh = await api('/api/wellness/manual');
  const changed = JSON.stringify(fresh.days?.[0]?.values) !== JSON.stringify(log.days?.[0]?.values);
  const typing = view.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (typing) {
    if (message) message.textContent = waitingFor;
    if (changed) toastMsg('Có số mới từ Intervals.icu. Tải lại trang để xem.');
    return;
  }
  await refreshKeepingScroll();
}


function checkinFormHtml(current) {
  const level = current?.level || 'ok';
  return `<div class="checkin-form">
    <div class="today-note">${current ? `Hôm nay đã ghi: <b>${esc(levelLabel(current.level))}</b>` : 'Chưa ghi cảm giác hôm nay.'}</div>
    <div class="level-grid" data-levels>
      ${[['ok', 'Bình thường'], ['tired', 'Mệt / ngủ kém'], ['sick', 'Đang bệnh'], ['serious', 'Triệu chứng nặng']].map(([id, label]) => `<button type="button" class="level-btn ${level === id ? 'selected' : ''}" data-level="${id}"><span class="dot"></span>${label}</button>`).join('')}
    </div>
    <textarea data-note placeholder="Ghi chú: cảm giác, triệu chứng, giấc ngủ… (không bắt buộc)">${esc(current?.note || current?.symptoms || '')}</textarea>
    <div class="checkin-actions">
      <span class="hint">Cảm giác của bạn thắng số đồng hồ.</span>
      <button class="btn primary small" type="button" data-save>Lưu</button>
    </div>
  </div>`;
}

function tagLabel(tags, id) { return tags.find((t) => t.id === id)?.label || id; }

function attachCheckin(root) {
  const box = root.querySelector('.checkin-form');
  if (!box) return;
  let level = box.querySelector('.level-btn.selected')?.dataset.level || 'ok';
  box.querySelectorAll('.level-btn').forEach((b) => {
    b.onclick = () => {
      level = b.dataset.level;
      box.querySelectorAll('.level-btn').forEach((x) => x.classList.toggle('selected', x === b));
    };
  });
  const save = box.querySelector('[data-save]');
  save.onclick = async () => {
    if (level === 'serious' && !confirm('Bạn báo triệu chứng nặng (đau ngực, khó thở, ngất). Ghi nhận và ưu tiên hỗ trợ y tế?')) return;
    save.disabled = true;
    const note = box.querySelector('[data-note]').value;
    try {
      await api('/api/checkin', { method: 'POST', body: { level, note, symptoms: note, tags: [], redFlag: level === 'serious' ? 1 : 0 } });
      toastMsg(level === 'serious' ? 'Đã ghi nhận. Hãy tìm hỗ trợ y tế.' : 'Đã lưu cảm giác hôm nay.');
      await renderView();
    } catch (e) { toastMsg(e.message); save.disabled = false; }
  };
}

function checkinCard(d) {
  return `<div class="card checkin-card">
    <div class="card-head"><div class="card-title"><span class="ico-chip">${ICONS.leaf}</span><div><div class="eyebrow">Tinh thần</div><h3>Cảm giác hôm nay</h3></div></div></div>
    ${checkinFormHtml(d.checkin)}
  </div>`;
}

async function renderToday(view) {
  const d = await api('/api/dashboard');
  const name = (state.user.displayName || '').split(' ').slice(-1)[0];
  view.innerHTML = `
    <div class="view-head today-head">
      <div class="greet">
        <div class="eyebrow">Hôm nay</div>
        <h1>${esc(greeting())}, ${esc(name)}! <span class="wave-hand" aria-hidden="true">👋</span></h1>
        <div class="view-sub">${esc(subline(d))}</div>
      </div>
      <div class="head-actions">
        <div class="date-pill">${esc(fmtLong(d.today))}</div>
        <button class="icon-btn" id="syncTop" title="Đồng bộ" aria-label="Đồng bộ">${ICONS.sync}</button>
        <div class="avatar orb" title="${esc(state.user.displayName || '')}">${esc(initials(state.user.displayName))}</div>
      </div>
    </div>
    ${doctorBanner(d)}
    <div class="dash-top">
      ${heroCard(d)}
      ${hrvTile(d)}
      ${rhrTile(d)}
      ${sleepTile(d)}
      ${workoutCard(d)}
      ${sleepPlanCard(d)}
    </div>
    <div id="aiExplain"></div>
    <div class="today-grid">
      ${manualCard(d)}
      ${contextCardHtml()}
      ${d.recovery.needsHrv ? '' : factorsCard(d)}
      ${historyCard(d)}
      ${sleepDetailCard(d.sleepDetail)}
      ${d.recovery.needsHrv ? '' : loadCard(d)}
      ${strainCard(d)}
      ${checkinCard(d)}
    </div>`;
  const sync = runSync;
  const gateSync = view.querySelector('[data-auto-sync-hero]');
  if (gateSync) gateSync.onclick = () => sync(gateSync);
  const syncTop = view.querySelector('#syncTop');
  if (syncTop) syncTop.onclick = () => sync(syncTop);
  const tip = view.querySelector('[data-explain-tip]');
  const factors = view.querySelector('.factors-card');
  if (tip && factors) tip.onclick = (e) => { e.stopPropagation(); factors.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const wake = view.querySelector('#wakeTime');
  if (wake) {
    const paint = () => {
      const wm = parseClock(wake.value);
      view.querySelectorAll('[data-bed-mins]').forEach((el) => { el.textContent = minutesToClock(wm - Number(el.dataset.bedMins) - 15); });
      const wt = view.querySelector('[data-wake-text]');
      if (wt) wt.textContent = minutesToClock(wm);
    };
    wake.onclick = (e) => e.stopPropagation();
    wake.onchange = () => { localStorage.setItem('nhipWake', wake.value); paint(); };
  }
  attachCheckin(view);
  attachManualCard(view, d);
  attachContext(view);
  attachExplain(view);
  view.querySelectorAll('[data-go]').forEach((b) => {
    b.onclick = () => go(b.dataset.go);
    if (b.getAttribute('role') === 'button') b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(b.dataset.go); } };
  });
}

function subline(d) {
  const b = d.recovery?.band;
  if (d.recovery?.provisional && (b === 'green' || b === 'yellow' || b === 'red')) return `Chỉ số tạm tính (${d.recovery.provisional.nights}/${d.recovery.provisional.fullDays} đêm) — tập vừa sức trong lúc app làm quen với bạn.`;
  if (b === 'green') return 'Cơ thể sẵn sàng — một ngày tốt để vận động.';
  if (b === 'yellow') return 'Một ngày mới, một cơ hội để sống khỏe hơn.';
  if (b === 'red') return 'Hôm nay ưu tiên nghỉ ngơi và hồi phục.';
  if (b === 'emergency') return 'Hãy ưu tiên hỗ trợ y tế trước.';
  if (d.recovery?.needsHrv) return d.recovery.hrvGate?.state === 'hrv_building'
    ? `Đang dựng nền HRV: ${d.recovery.hrvGate.nights ?? d.recovery.hrvGate.daysAvailable}/${d.recovery.hrvGate.minDays} đêm.`
    : 'Chưa có HRV nên hôm nay chưa có kết luận.';
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
  const [trend, dash, baseline, body] = await Promise.all([
    api(`/api/trends?days=${range}`),
    api(`/api/dashboard?history=${range}`),
    api('/api/baseline'),
    api('/api/body').catch(() => null),
  ]);
  const byDate = new Map(trend.wellness.map((w) => [w.date, w]));
  const series = (field, scale = 1) => days.map((d) => {
    const w = byDate.get(d);
    const v = w && w[field] != null ? w[field] * scale : null;
    return { date: d, value: v };
  });

  const defs = [
    { title: 'HRV rMSSD', field: 'hrv_rmssd', color: '#3ff3e0', unit: 'ms', digits: 1 },
    { title: 'Nhịp tim nghỉ', field: 'resting_hr', color: '#ff6b8f', unit: 'bpm', digits: 0 },
    { title: 'Giấc ngủ', field: 'sleep_secs', scale: 1 / 3600, color: '#8f8bff', unit: 'giờ', digits: 1 },
    { title: 'Điểm ngủ', field: 'sleep_score', color: '#ffc04d', unit: '/100', digits: 0 },
    { title: 'Số bước', field: 'steps', color: '#62b8ff', unit: 'bước', digits: 0 },
    { title: 'Nhịp thở', field: 'respiration', color: '#4fd1c5', unit: '/ph', digits: 1 },
    { title: 'SpO2', field: 'spo2', color: '#62b8ff', unit: '%', digits: 0 },
    { title: 'Cân nặng', field: 'weight', color: '#b48cff', unit: 'kg', digits: 1 },
  ];

  view.innerHTML = `
    <div class="view-head">
      <div><div class="page-title"><span class="page-ico" style="--pc:#4f8dff">${ICONS.trends}</span><h1>Xu hướng</h1></div><div class="view-sub">So với đường cơ sở cá nhân, không so với chuẩn chung.</div></div>
      <div class="range-row" id="rangeRow">
        ${[7, 30, 90].map((n) => `<button data-d="${n}" class="${range === n ? 'active' : ''}">${n} ngày</button>`).join('')}
      </div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="chart-head"><div><div class="chart-title">Điểm hồi phục</div><div class="chart-meta">${range} ngày · trung bình và các dải màu</div></div></div>
      ${recoveryBars(dash.history)}
      <div class="chart-legend"><span><i class="sw" style="background:#3fe0a8"></i>Sẵn sàng</span><span><i class="sw" style="background:#ffc04d"></i>Trung bình</span><span><i class="sw" style="background:#ff6b8f"></i>Cần hồi phục</span><span>Đường đứt = trung bình</span></div>
    </div>
    <div class="charts-grid">
      ${defs.map((def) => `<div class="card">
        <div class="chart-head"><div class="chart-title">${def.title}</div></div>
        ${lineChart(series(def.field, def.scale || 1), { color: def.color, unit: def.unit, digits: def.digits })}
      </div>`).join('')}
    </div>
    ${baselineCard(baseline)}
    ${bodyCard(body)}`;
  attachBodyCard(view, body);
  view.querySelectorAll('#rangeRow button').forEach((b) => {
    b.onclick = () => { state.trendsRange = Number(b.dataset.d); renderView(); };
  });
}

/* ---------------- body composition (weekly smart scale) ---------------- */
const Z_SEGMENTS = [['ra', 'Tay phải'], ['la', 'Tay trái'], ['tr', 'Thân'], ['rl', 'Chân phải'], ['ll', 'Chân trái']];
const BODY_MAIN = ['weight', 'fat_pct', 'skeletal_kg', 'lean_kg'];
function bodyCard(b) {
  if (!b) return '';
  const s = b.summary || {};
  const F = Object.fromEntries(b.fields.map((f) => [f.col, f]));
  const rows = [...b.rows].sort((x, y) => (x.date < y.date ? 1 : -1));
  const chg = (col) => {
    const c = s.change?.[col];
    if (c == null) return '';
    return `<span class="type-note">${c > 0 ? '+' : c < 0 ? '−' : ''}${fmtNum(Math.abs(c), F[col].digits)} so với ${s.weeksApart} tuần trước</span>`;
  };
  const stat = (col) => {
    const f = F[col];
    const v = s.recent?.[col];
    return `<div class="body-stat"><span class="k">${esc(f.label)}</span><b>${v == null ? '—' : fmtNum(v, f.digits)}<small> ${esc(f.unit)}</small></b>${chg(col)}</div>`;
  };
  const chartCol = rows.some((r) => r.skeletal_kg != null) ? 'skeletal_kg' : rows.some((r) => r.lean_kg != null) ? 'lean_kg' : 'weight';
  const series = [...rows].reverse().filter((r) => r.standard && r[chartCol] != null).map((r) => ({ date: r.date, value: r[chartCol] }));
  const chip = s.last
    ? `<span class="confidence-chip ${s.due ? 'amber' : 'green'}">${s.due ? 'đến lúc đo' : `đo ${esc(fmtShort(s.last.date))}`}</span>`
    : '<span class="confidence-chip amber">chưa đo</span>';
  const src = (r) => ({ manual: 'nhập tay', apple: 'Apple Health', 'manual+apple': 'tay + Apple' })[r.source] || '—';
  const table = rows.length
    ? `<div class="table-wrap"><table class="compare-table body-table"><thead><tr><th>Ngày</th><th class="num">Cân</th><th class="num">Mỡ %</th><th class="num">Cơ xương</th><th>Nguồn</th></tr></thead><tbody>
        ${rows.slice(0, 10).map((r) => `<tr data-body-row="${esc(r.date)}" class="${r.standard ? '' : 'muted'}"><td class="nowrap">${esc(fmtShort(r.date))}${r.standard ? '' : ' <small>(ngoài điều kiện)</small>'}</td><td class="num">${fmtNum(r.weight, 1)}</td><td class="num">${fmtNum(r.fat_pct, 1)}</td><td class="num">${fmtNum(r.skeletal_kg, 1)}</td><td class="small">${src(r)}</td></tr>`).join('')}
      </tbody></table></div><div class="hint">Chạm một dòng để sửa.</div>`
    : '';
  const fieldHtml = (f) => `<label class="field manual-field"><span>${esc(f.label)} <small>(${esc(f.unit)})</small></span><input data-body-col="${f.col}" type="number" min="${f.min}" max="${f.max}" step="any" inputmode="decimal"></label>`;
  const zGrid = `<table class="z-grid"><thead><tr><th></th>${Z_SEGMENTS.map(([, n]) => `<th>${n}</th>`).join('')}</tr></thead><tbody>
      ${['z20', 'z100'].map((fq) => `<tr><th>${fq === 'z20' ? '20 kHz' : '100 kHz'}</th>${Z_SEGMENTS.map(([k, n]) => `<td><input data-body-z="${fq}.${k}" type="number" step="any" inputmode="decimal" aria-label="${n} ${fq}"></td>`).join('')}</tr>`).join('')}
    </tbody></table>`;
  return `<div class="card" style="margin-top:14px" data-body>
    <div class="card-head"><div><div class="eyebrow">Cân thành phần cơ thể · mỗi tuần</div><h3>Thành phần cơ thể</h3></div>${chip}</div>
    ${s.recent ? `<div class="body-stats">${BODY_MAIN.map(stat).join('')}</div><div class="hint" style="margin:6px 0 10px">Trung bình ${s.recent.n} lần đo đúng điều kiện gần nhất, không phải một lần đo lẻ.</div>` : ''}
    ${(s.messages || []).map((m) => `<p class="body-msg ${s.state === 'changed' ? 'is-changed' : ''}">${esc(m)}</p>`).join('')}
    ${s.protein ? `<p class="body-msg">Đạm mục tiêu khoảng <b>${fmtNum(s.protein.gPerDay)} g/ngày</b> (1,6 g × ${fmtNum(s.protein.weight, 1)} kg). Ăn nhiều hơn mức này không giúp tăng cơ thêm; chia đều cho các bữa trong ngày.</p>` : ''}
    ${series.length >= 2 ? `<div class="chart-head" style="margin-top:8px"><div class="chart-title">${esc(F[chartCol].label)} qua các lần đo</div></div>${lineChart(series, { color: '#a99bff', unit: 'kg', digits: 1 })}` : ''}
    ${table}
    <div class="manual-actions" style="margin-top:10px"><button class="btn primary small" type="button" data-body-new>Nhập lần đo</button></div>
    <form class="manual-form body-form" data-body-form hidden novalidate>
      <div class="manual-who"><label class="field"><span>Ngày đo</span><input data-body-date type="date" max="${esc(b.today)}" required></label></div>
      <div class="manual-fields">${b.fields.map(fieldHtml).join('')}</div>
      <label class="check-label body-check"><input type="checkbox" data-body-standard checked> Đo đúng điều kiện: buổi sáng, sau khi đi vệ sinh, trước khi ăn uống, không ngay sau xông hơi hay tập</label>
      <details class="body-z"><summary>Trở kháng gốc Z (Ω), cuối bảng báo cáo · không bắt buộc</summary>${zGrid}<div class="hint">Đây là số cân đo thật; cơ và mỡ là kết quả tính từ các số này.</div></details>
      <label class="field"><span>Ghi chú</span><input data-body-note type="text" maxlength="200" placeholder="ví dụ: tối qua uống bia"></label>
      <div class="manual-actions"><button class="btn primary small" type="submit">Lưu lần đo</button><button class="btn small ghost" type="button" data-body-cancel>Đóng</button><button class="btn small ghost" type="button" data-body-delete hidden>Xoá lần đo này</button></div>
    </form>
    <div class="hint" style="margin-top:10px">Nếu cân đồng bộ được sang Apple Health, phím tắt sẽ tự gửi cân nặng, % mỡ và khối không mỡ; số nhập tay luôn được ưu tiên. Chỉ cần nhập tay phần còn lại (cơ xương, mỡ nội tạng, trở kháng).</div>
  </div>`;
}

function attachBodyCard(view, b) {
  const card = view.querySelector('[data-body]');
  if (!card) return;
  const form = card.querySelector('[data-body-form]');
  const delBtn = form.querySelector('[data-body-delete]');
  const fill = (date) => {
    const r = b.rows.find((x) => x.date === date) || {};
    form.querySelector('[data-body-date]').value = date;
    form.querySelectorAll('[data-body-col]').forEach((el) => { const v = r[el.dataset.bodyCol]; el.value = v == null ? '' : v; });
    form.querySelectorAll('[data-body-z]').forEach((el) => { const [fq, k] = el.dataset.bodyZ.split('.'); const v = r.impedance?.[fq]?.[k]; el.value = v == null ? '' : v; });
    form.querySelector('[data-body-standard]').checked = r.standard !== false;
    form.querySelector('[data-body-note]').value = r.note || '';
    delBtn.hidden = !r.date;
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  card.querySelector('[data-body-new]').onclick = () => fill(b.today);
  form.querySelector('[data-body-date]').onchange = (e) => fill(e.target.value);
  card.querySelectorAll('[data-body-row]').forEach((tr) => { tr.style.cursor = 'pointer'; tr.onclick = () => fill(tr.dataset.bodyRow); });
  form.querySelector('[data-body-cancel]').onclick = () => { form.hidden = true; };
  delBtn.onclick = async () => {
    const date = form.querySelector('[data-body-date]').value;
    if (!confirm(`Xoá lần đo ngày ${fmtDate(date)}?`)) return;
    try { await api(`/api/body?date=${encodeURIComponent(date)}`, { method: 'DELETE' }); toastMsg('Đã xoá.'); renderView(); }
    catch (e) { toastMsg(e.message); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = { standard: form.querySelector('[data-body-standard]').checked, note: form.querySelector('[data-body-note]').value, impedance: {} };
    form.querySelectorAll('[data-body-col]').forEach((el) => { data[el.dataset.bodyCol] = el.value === '' ? null : el.value; });
    form.querySelectorAll('[data-body-z]').forEach((el) => { if (el.value === '') return; const [fq, k] = el.dataset.bodyZ.split('.'); (data.impedance[fq] ||= {})[k] = el.value; });
    try {
      await api('/api/body', { method: 'POST', body: { date: form.querySelector('[data-body-date]').value, data } });
      toastMsg('Đã lưu lần đo.');
      renderView();
    } catch (err) { toastMsg(err.message); }
  };
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
    <div class="baseline-row"><span class="k">Ngủ</span><span class="v">${b.sleepMinutes.count >= 7 ? `${fmtNum(b.sleepMinutes.mean / 60, 2)} giờ/đêm · ${b.sleepMinutes.count} đêm` : `chưa đủ (${b.sleepMinutes.count}/7)`}</span></div>
    <div class="baseline-row"><span class="k">Điểm ngủ</span><span class="v">${b.sleepScore.count >= 7 ? `${fmtNum(b.sleepScore.mean)}/100` : `chưa đủ (${b.sleepScore.count}/7)`}</span></div>
    <div class="baseline-row"><span class="k">Bước / ngày</span><span class="v">${b.steps.count >= 7 ? `${fmtNum(b.steps.mean)} bước` : `chưa đủ (${b.steps.count}/7)`}</span></div>
    <div class="baseline-row"><span class="k">Nhịp thở</span><span class="v">${b.respiration.count >= 7 ? `${fmtNum(b.respiration.mean, 1)} /ph` : `chưa đủ (${b.respiration.count}/7)`}</span></div>
    <div class="hint" style="margin-top:12px">Ngày ${esc(b.targetDate)} không tự tính vào mức nền của chính nó. HRV chỉ dùng rMSSD. sleepSecs có thể gồm cả ngủ trưa nếu nguồn gộp chung.</div>
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
      <div><div class="page-title"><span class="page-ico" style="--pc:#ff8a3d">${ICONS.dumbbell}</span><h1>Buổi tập</h1></div><div class="view-sub">Tải từ Intervals.icu; không phản ánh đủ sức mạnh, bơi, yoga.</div></div>
      <div class="range-row" id="rangeRow">${[30, 90, 180].map((n) => `<button data-d="${n}" class="${range === n ? 'active' : ''}">${n} ngày</button>`).join('')}</div>
    </div>
    <div class="stat-tiles">
      <div class="stat-tile st-orange"><b>${items.length}</b><span>buổi</span></div>
      <div class="stat-tile st-orange"><b>${fmtNum(totalMin)}</b><span>phút</span></div>
      <div class="stat-tile st-orange"><b>${fmtNum(totalLoad)}</b><span>tổng tải</span></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="chart-head"><div><div class="chart-title">Tải theo ngày</div><div class="chart-meta">${range} ngày gần nhất</div></div></div>
      ${items.length ? loadBars(days, items, '#ff9a3c') : '<div class="empty">Chưa có buổi tập trong khoảng này.</div>'}
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

/* ---------------- AI helpers ---------------- */
function getAiStatus(force) {
  if (force || !state.aiStatusP) {
    state.aiStatusP = api('/api/ai/status').catch(() => ({ configured: false, failed: true }));
  }
  return state.aiStatusP;
}
function aiErrText(e) {
  const k = e?.data?.kind;
  return ({
    not_configured: 'Chưa bật AI trên máy chủ.',
    cap_user: 'Bạn đã dùng hết lượt hỏi AI hôm nay.',
    cap_global: 'Máy chủ đã hết lượt AI hôm nay.',
    cap_deep: 'Đã hết lượt phân tích quý của tháng này.',
    auth: 'Khoá API của AI không hợp lệ.',
    rate: 'AI đang bận. Thử lại sau ít phút.',
    http: 'Không gọi được AI. Thử lại sau.',
    network: 'Không gọi được AI. Kiểm tra mạng của máy chủ.',
  })[k] || e?.message || 'Có lỗi. Thử lại sau.';
}
function aiTextBox(r, title) {
  const foot = r.local ? 'Viết sẵn trên máy, không gọi AI.' : `AI chỉ diễn giải số do app tính. Không thay lời khuyên y tế.${r.cached ? ' (đã lưu)' : ''}`;
  return `<div class="ai-card card">${title ? `<h3>${esc(title)}</h3>` : ''}<div class="ai-text">${esc(r.text)}</div><div class="ai-foot">${esc(foot)}</div></div>`;
}

/* ---------------- today: doctor + explain ---------------- */
function doctorBanner(d) {
  const t = d.recovery?.alerts?.doctor?.text;
  return t ? `<div class="doctor-banner" role="status">${esc(t)}</div>` : '';
}

async function attachExplain(view) {
  const btn = view.querySelector('[data-explain]');
  const slot = view.querySelector('#aiExplain');
  if (!btn || !slot) return;
  const st = await getAiStatus();
  if (!st.configured || !btn.isConnected) return;
  btn.hidden = false;
  btn.onclick = async () => {
    btn.disabled = true;
    const old = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>Đang hỏi…';
    try {
      const r = await api('/api/ai/explain', { method: 'POST', body: {} });
      slot.innerHTML = aiTextBox(r, 'Giải thích (AI)');
    } catch (e) {
      slot.innerHTML = `<div class="ai-card card"><div class="ai-err">${esc(aiErrText(e))}</div></div>`;
    }
    btn.disabled = false;
    btn.textContent = old;
  };
}

/* ---------------- today: Bối cảnh ---------------- */
function contextCardHtml() {
  return `<div class="card context-card" data-ctx>
    <div class="card-head"><div class="card-title"><span class="ico-chip" style="--chip:#7cc4ff">${ICONS.journal}</span><div><div class="eyebrow">Bối cảnh</div><h3>Hôm qua bạn đã làm gì?</h3></div></div></div>
    <div data-ctx-body><div class="hint">Đang tải…</div></div>
  </div>`;
}

function attachContext(view) {
  const root = view.querySelector('[data-ctx-body]');
  if (!root) return;
  const S = { date: null, today: null, fields: [], recent: [], activities: [], draft: {}, labels: null, error: null, tok: 0 };

  const dowOf = (iso) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(iso + 'T12:00:00').getDay()];
  const minDate = () => {
    const t = new Date(S.today + 'T12:00:00'); t.setDate(t.getDate() - 60);
    return new Intl.DateTimeFormat('en-CA').format(t);
  };

  function fieldHtml(f) {
    const v = S.draft[f.id];
    const label = `<div class="ctx-label">${esc(f.label)}</div>`;
    let body = '';
    if (f.type === 'multi' || f.type === 'choice') {
      const sel = f.type === 'multi' ? (Array.isArray(v) ? v : []) : (v == null ? [] : [v]);
      const chip = (o) => `<button type="button" class="ctx-chip ${sel.includes(o.id) ? 'selected' : ''}" data-f="${esc(f.id)}" data-opt="${esc(o.id)}" aria-pressed="${sel.includes(o.id)}">${esc(o.label)}</button>`;
      const opts = (f.options || []).filter((o) => !o.legacy || sel.includes(o.id));
      const gym = opts.filter((o) => o.group === 'gym');
      body = gym.length
        ? `<div class="ctx-sub">Gym</div><div class="ctx-chips">${gym.map(chip).join('')}</div><div class="ctx-sub">Môn khác</div><div class="ctx-chips">${opts.filter((o) => o.group !== 'gym').map(chip).join('')}</div>`
        : `<div class="ctx-chips">${opts.map(chip).join('')}</div>`;
    } else if (f.type === 'count') {
      const min = f.min ?? 0, max = f.max ?? 99;
      body = `<div class="ctx-stepper"><button type="button" data-f="${esc(f.id)}" data-step="-1" aria-label="Giảm">−</button><output>${v ?? min}</output><button type="button" data-f="${esc(f.id)}" data-step="1" aria-label="Tăng">+</button></div>`;
      void max;
    } else if (f.type === 'bool') {
      body = `<div class="ctx-chips"><button type="button" class="ctx-chip ${v ? 'selected' : ''}" data-f="${esc(f.id)}" data-bool="1" aria-pressed="${!!v}">${esc(f.label)}</button></div>`;
      return `<div class="ctx-field ${f.private ? 'ctx-private' : ''}">${body}</div>`;
    } else if (f.type === 'time') {
      const auto = f.id === 'bedtime' && !v && S.apple?.bedtime ? S.apple.bedtime : '';
      body = `<input type="time" data-f="${esc(f.id)}" data-time="1" value="${esc(v || auto)}">`;
      if (auto) body += `<div class="hint" style="margin-top:6px">Tự lấy từ đồng hồ (Apple Health): ngủ lúc ${esc(auto)}${S.apple.wake ? `, thức ${esc(S.apple.wake)}` : ''}. Không cần nhập tay; sửa nếu sai.</div>`;
    } else if (f.type === 'scale') {
      body = `<div class="ctx-chips">${(f.labels || []).map((l, i) => `<button type="button" class="ctx-chip ${v === i ? 'selected' : ''}" data-f="${esc(f.id)}" data-scale="${i}" aria-pressed="${v === i}">${esc(l)}</button>`).join('')}</div>`;
    }
    return `<div class="ctx-field ${f.private ? 'ctx-private' : ''}">${label}${body}${f.private ? '<div class="hint" style="margin-top:6px">Chỉ để bạn đếm và báo bác sĩ. Không phân tích, không gửi AI.</div>' : ''}</div>`;
  }

  function stripHtml() {
    const days = [...S.recent].reverse();
    if (!days.length) return '';
    return `<div class="ctx-strip" aria-label="14 ngày gần đây">${days.map((r) => `<button type="button" class="ctx-day ${r.logged ? 'logged' : ''} ${r.date === S.date ? 'current' : ''}" data-day="${esc(r.date)}" title="${esc(fmtDate(r.date))}${r.logged ? ': ' + esc((r.labels || []).join(', ')) : ': chưa ghi'}"><i></i><span>${esc(r.date.slice(8, 10))}</span></button>`).join('')}</div>`;
  }

  function render() {
    const normal = S.fields.filter((f) => !f.private);
    const priv = S.fields.filter((f) => f.private);
    const act = S.activities.length
      ? `<div class="ctx-intervals">Intervals.icu: ${S.activities.map((a) => `${esc(a.name)}${a.start ? ' ' + esc(a.start) : ''} · ${esc(a.minutes)} phút${a.load != null ? ' · tải ' + esc(a.load) : ''}`).join(' · ')}</div>`
      : '';
    root.innerHTML = `
      <div class="ctx-date-row"><input type="date" data-ctx-date value="${esc(S.date)}" min="${esc(minDate())}" max="${esc(S.today)}"><span class="small muted">${esc(dowOf(S.date))}</span></div>
      ${act}
      ${normal.map(fieldHtml).join('')}
      ${priv.map(fieldHtml).join('')}
      ${S.error ? `<div class="ai-err">${esc(S.error)}</div>` : ''}
      <div class="ctx-actions"><button class="btn primary small" type="button" data-ctx-save>Lưu bối cảnh</button></div>
      ${S.labels ? `<div class="ctx-saved">${S.labels.length ? 'Đã ghi: ' + esc(S.labels.join(', ')) : 'Ngày này để trống.'}</div>` : ''}
      ${stripHtml()}`;
  }

  async function load(date) {
    const tok = ++S.tok;
    try {
      const r = await api('/api/context' + (date ? `?date=${encodeURIComponent(date)}` : ''));
      if (tok !== S.tok || !root.isConnected) return;
      Object.assign(S, { date: r.date, today: r.today, fields: r.fields || [], recent: r.recent || [], activities: r.activities || [], apple: r.apple || null, draft: JSON.parse(JSON.stringify(r.data || {})), labels: null, error: null });
    } catch (e) {
      if (tok !== S.tok || !root.isConnected) return;
      S.error = e.message;
      if (!S.fields.length) { root.innerHTML = `<div class="ai-err">${esc(e.message)}</div>`; return; }
    }
    render();
  }

  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t || !root.contains(t)) return;
    if (t.dataset.day) return load(t.dataset.day);
    if (t.hasAttribute('data-ctx-save')) {
      t.disabled = true;
      const data = {};
      for (const [k, v] of Object.entries(S.draft)) if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) data[k] = v;
      try {
        const r = await api('/api/context', { method: 'POST', body: { date: S.date, data } });
        S.draft = JSON.parse(JSON.stringify(r.data || {}));
        S.labels = r.labels || [];
        S.error = null;
        const row = S.recent.find((x) => x.date === S.date);
        const logged = Object.keys(S.draft).length > 0;
        if (row) { row.logged = logged; row.labels = S.labels; }
        toastMsg(logged ? 'Đã lưu' : 'Đã xoá bối cảnh ngày này');
      } catch (e) { S.error = e.message; }
      render();
      return;
    }
    const f = S.fields.find((x) => x.id === t.dataset.f);
    if (!f) return;
    if (t.dataset.opt !== undefined) {
      const id = t.dataset.opt;
      if (f.type === 'choice') {
        if (S.draft[f.id] === id) delete S.draft[f.id]; else S.draft[f.id] = id;
      } else {
        let arr = Array.isArray(S.draft[f.id]) ? [...S.draft[f.id]] : [];
        if (arr.includes(id)) arr = arr.filter((x) => x !== id);
        else if (id === 'rest') arr = ['rest'];
        else arr = arr.filter((x) => x !== 'rest').concat(id);
        if (arr.length) S.draft[f.id] = arr; else delete S.draft[f.id];
      }
    } else if (t.dataset.step) {
      const min = f.min ?? 0, max = f.max ?? 99;
      const cur = S.draft[f.id] ?? min;
      const next = Math.max(min, Math.min(max, cur + Number(t.dataset.step)));
      if (next === min) delete S.draft[f.id]; else S.draft[f.id] = next;
    } else if (t.dataset.bool) {
      if (S.draft[f.id]) delete S.draft[f.id]; else S.draft[f.id] = true;
    } else if (t.dataset.scale !== undefined) {
      const i = Number(t.dataset.scale);
      if (S.draft[f.id] === i) delete S.draft[f.id]; else S.draft[f.id] = i;
    } else return;
    S.labels = null;
    render();
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('[data-ctx-date]')) { if (t.value) load(t.value); else t.value = S.date; return; }
    if (t.matches('[data-time]')) {
      if (t.value) S.draft[t.dataset.f] = t.value; else delete S.draft[t.dataset.f];
      S.labels = null;
    }
  });
  load();
}

/* ---------------- Quy luật (journal route) ---------------- */
function confChip(c, label) {
  const cls = { clear: 'green', possible: 'amber', none: '', unclear: '', insufficient: 'outline' }[c] ?? '';
  const txt = { clear: 'rõ', possible: 'có thể', none: 'chưa thấy ảnh hưởng', unclear: 'chưa rõ', insufficient: 'chưa đủ dữ liệu' }[c] || label || c;
  return `<span class="confidence-chip ${cls}">${esc(txt)}</span>`;
}

function curveHtml(f) {
  const bars = [1, 2, 3].map((k) => {
    const swc = f.lags?.find((l) => l.k === k)?.hrv?.swc;
    const has = Number.isFinite(swc);
    const h = has ? Math.min(Math.abs(swc) / 3, 1) * 50 : 0;
    const cls = !has ? '' : swc <= -1 ? 'neg bad' : swc < 0 ? 'neg' : '';
    const pos = swc < 0 ? `top:50%;height:${h}%` : `bottom:50%;height:${h}%`;
    return `<div class="pat-bar" title="Ngày +${k}: ${has ? fmtNum(swc, 1) + ' SWC' : 'chưa có'}"><div class="plot">${has ? `<span class="${cls}" style="${pos}"></span>` : ''}</div><div>D+${k}</div><div>${has ? fmtNum(swc, 1) : '–'}</div></div>`;
  }).join('');
  return `<div class="pat-curve" aria-label="HRV theo SWC, ngày +1 đến +3"><div class="pat-bar" style="width:auto;justify-content:center;padding-right:2px"><div class="plot" style="display:flex;align-items:center">SWC</div><div>&nbsp;</div><div>&nbsp;</div></div>${bars}</div>`;
}

function patternCard(f) {
  return `<div class="card pat-card">
    <div class="pat-top"><b>${esc(f.label)}</b>${confChip(f.confidence, f.confidenceLabel)}</div>
    <div class="pat-sum">${esc(f.summary)}</div>
    <div class="pat-meta">${curveHtml(f)}<div class="pat-n">${esc(f.nEvents)} lần${f.nUsed ? `<br>${esc(f.nUsed)} sáng dùng được` : ''}</div></div>
  </div>`;
}

function askRemaining(st) {
  if (!st?.limits || !st.usage) return null;
  return Math.max(0, (st.limits.userDailyCalls ?? 0) - (st.usage.todayCalls ?? 0));
}

function sleepStructureCard(ss) {
  if (!ss || typeof ss !== 'object') return '';
  const head = '<div class="card-head"><div><div class="eyebrow">Apple Health</div><h3>Cấu trúc giấc ngủ có ảnh hưởng HRV?</h3></div></div>';
  const note = ss.note ? `<div class="hint" style="margin-top:10px">${esc(ss.note)}</div>` : '';
  const items = Array.isArray(ss.items) ? ss.items : [];
  if (!ss.ready || !items.length) {
    return `<div class="card" id="sleepStructCard">${head}<div class="hint">Cần ${fmtNum(ss.need ?? 21)} đêm có dữ liệu Apple (đang có ${fmtNum(ss.nights ?? 0)}).</div>${note}</div>`;
  }
  const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmtNum(Math.abs(x), 1)}%`;
  const row = (it) => {
    const has = it.pct != null && Number.isFinite(Number(it.pct));
    const iv = has && it.lo != null && it.hi != null ? `<span class="ss-iv">khoảng 95%: ${signed(Number(it.lo))} đến ${signed(Number(it.hi))}</span>` : '';
    return `<div class="ss-item">
      <div class="pat-top"><b>${esc(it.label || it.id)}</b>${confChip(it.confidence)}</div>
      <div class="ss-num">${has ? `<span class="ss-pct ${Number(it.pct) < 0 ? 'neg' : ''}">${signed(Number(it.pct))}</span>` : '<span class="ss-pct">—</span>'} ${iv}</div>
      ${it.summary ? `<div class="pat-sum">${esc(it.summary)}</div>` : ''}
      <div class="small">${fmtNum(it.events ?? 0)} đêm có dấu hiệu · ${fmtNum(it.others ?? 0)} đêm còn lại</div>
    </div>`;
  };
  return `<div class="card" id="sleepStructCard">${head}<div class="hint" style="margin-bottom:6px">Thay đổi HRV đêm kế tiếp, so với các đêm khác.</div>${items.map(row).join('')}${note}</div>`;
}

async function renderJournal(view) {
  const [st, pat, weekly, hist] = await Promise.all([
    getAiStatus(true),
    api('/api/patterns').catch((e) => ({ error: e.message })),
    api('/api/ai/weekly').catch((e) => ({ available: false, reason: 'error', error: aiErrText(e) })),
    api('/api/checkin').catch(() => null),
  ]);
  const dm = (x) => (x ? `${String(x).slice(8, 10)}/${String(x).slice(5, 7)}` : '—');
  const wk = (w) => `Tóm tắt tuần ${dm(w.weekStart)} – ${dm(w.weekEnd)}`;
  const rem = askRemaining(st);
  const noKey = '<div class="hint">Chưa bật AI: thêm ANTHROPIC_API_KEY vào file .env trên máy chủ rồi khởi động lại.</div>';
  const weeklyBody = (w) => w.available ? `<div class="ai-text">${esc(w.text)}</div><div class="ai-foot">AI chỉ diễn giải số do app tính. Không thay lời khuyên y tế.</div>`
    : w.reason === 'not_configured' ? noKey
    : w.reason === 'not_generated' && st.configured ? '<div class="hint"><span class="spinner"></span>Đang tạo tóm tắt tuần…</div>'
    : `<div class="hint">${esc(w.error || 'Chưa có tóm tắt tuần này.')}</div>`;

  const patHtml = pat.error ? `<div class="card pat-card"><div class="ai-err">${esc(pat.error)}</div></div>`
    : `<p class="pat-head">Đã ghi bối cảnh ${esc(pat.loggedDays ?? 0)} ngày</p>
      ${(pat.factors || []).map(patternCard).join('') || '<div class="card pat-card"><div class="empty">Chưa có thói quen nào để so sánh. Hãy ghi bối cảnh mỗi ngày ở trang Hôm nay.</div></div>'}
      ${pat.symptomDays > 0 ? `<p class="hint" style="margin-top:12px">Có cơn tê/run sau tập: ${esc(pat.symptomDays)} ngày trong ${esc(pat.symptomWindowDays)} ngày gần nhất. Ghi lại để báo bác sĩ.</p>` : ''}
      ${pat.note ? `<p class="hint" style="margin-top:10px">${esc(pat.note)}</p>` : ''}`;

  const ssHtml = sleepStructureCard(pat.error ? null : pat.sleepStructure);
  view.innerHTML = `
    <div class="view-head"><div><div class="page-title"><span class="page-ico" style="--pc:#ff5fa8">${ICONS.layers}</span><h1>Quy luật</h1></div><div class="view-sub">Thói quen nào ảnh hưởng đến hồi phục của riêng bạn.</div></div></div>
    <div class="settings-stack">
      <div class="card" id="weeklyCard">
        <div class="card-head"><div><div class="eyebrow">Tuần</div><h3>${esc(wk(weekly))}</h3></div></div>
        <div id="weeklyBody">${weeklyBody(weekly)}</div>
      </div>

      <div class="card" id="askCard">
        <div class="card-head"><div><div class="eyebrow">AI</div><h3>Hỏi AI</h3></div></div>
        ${st.configured ? '' : noKey}
        <textarea id="askQ" maxlength="500" placeholder="Ví dụ: Tuần này nên dồn buổi tập chân vào ngày nào?" ${st.configured ? '' : 'disabled'}></textarea>
        <div class="ask-row"><span class="hint" id="askLeft">${rem == null ? '' : `Còn ${rem} lượt hôm nay`}</span><button class="btn primary small" id="askGo" ${st.configured ? '' : 'disabled'}>Gửi</button></div>
        <div id="askOut"></div>
      </div>

      <div id="patterns">${patHtml}</div>
      ${ssHtml}

      <div class="card" id="quarterCard">
        <div class="card-head"><div><div class="eyebrow">Sâu hơn</div><h3>Cả quý</h3></div></div>
        <button class="btn small" id="quarterGo" ${st.configured ? '' : 'disabled'}>Phân tích cả quý (Sonnet)</button>
        <div class="hint" style="margin-top:8px">Tối đa ${esc(st.limits?.deepPerMonth ?? '—')} lần/tháng, chi phí cao hơn Haiku.</div>
        <div id="quarterOut"></div>
      </div>

      ${hist ? `<div class="card">
        <div class="card-head"><div><h3>Lịch sử cảm giác</h3></div><span class="confidence-chip">${hist.items.length} mục</span></div>
        ${hist.items.length ? `<div class="timeline">${hist.items.map((c) => {
          const tags = (c.tags || []).map((t) => `<span>${esc(tagLabel(hist.tags || [], t))}</span>`).join('');
          return `<div class="tl-item"><span class="tl-dot ${esc(c.level)}"></span><div class="tl-main">
            <b>${esc(fmtDate(c.local_date))}</b> · <span class="muted">${esc(levelLabel(c.level))}</span>
            ${c.note || c.symptoms ? `<div class="tl-meta">${esc(c.note || c.symptoms)}</div>` : ''}
            ${tags ? `<div class="tl-tags">${tags}</div>` : ''}
          </div><div class="small">${esc(fmtDateTime(c.created_at))}</div></div>`;
        }).join('')}</div>` : '<div class="empty">Chưa có mục nào.</div>'}
      </div>` : ''}
    </div>`;

  const alive = () => view.isConnected && state.view === 'journal';
  const refreshLeft = async () => {
    const s2 = await getAiStatus(true);
    const left = view.querySelector('#askLeft');
    const r = askRemaining(s2);
    if (left && r != null) left.textContent = `Còn ${r} lượt hôm nay`;
  };

  // weekly: generate once when AI is on but nothing was made yet
  if (!weekly.available && weekly.reason === 'not_generated' && st.configured) {
    api('/api/ai/weekly?generate=1').then((w) => {
      if (!alive()) return;
      view.querySelector('#weeklyBody').innerHTML = weeklyBody(w.available ? w : { ...w, available: false, reason: 'error', error: 'Chưa tạo được tóm tắt.' });
      refreshLeft();
    }).catch((e) => {
      if (alive()) view.querySelector('#weeklyBody').innerHTML = `<div class="ai-err">${esc(aiErrText(e))}</div>`;
    });
  }

  const askGo = view.querySelector('#askGo');
  askGo.onclick = async () => {
    const q = view.querySelector('#askQ').value.trim();
    const out = view.querySelector('#askOut');
    if (!q) { out.innerHTML = '<div class="ai-err">Hãy nhập câu hỏi trước.</div>'; return; }
    askGo.disabled = true;
    out.innerHTML = '<div class="hint" style="margin-top:10px"><span class="spinner"></span>Đang hỏi…</div>';
    try {
      const r = await api('/api/ai/ask', { method: 'POST', body: { question: q } });
      out.innerHTML = `<div style="margin-top:12px">${aiTextBox(r)}</div>`;
    } catch (e) { out.innerHTML = `<div class="ai-err">${esc(aiErrText(e))}</div>`; }
    askGo.disabled = false;
    refreshLeft();
  };

  const qGo = view.querySelector('#quarterGo');
  qGo.onclick = async () => {
    const out = view.querySelector('#quarterOut');
    qGo.disabled = true;
    out.innerHTML = '<div class="hint" style="margin-top:10px"><span class="spinner"></span>Đang phân tích…</div>';
    try {
      const r = await api('/api/ai/quarter', { method: 'POST', body: {} });
      out.innerHTML = `<div style="margin-top:12px">${aiTextBox(r)}</div>`;
    } catch (e) { out.innerHTML = `<div class="ai-err">${esc(aiErrText(e))}</div>`; }
    qGo.disabled = !st.configured;
    refreshLeft();
  };
}

function aiSettingsCard(ai) {
  if (!ai) return `<div class="card"><div class="card-head"><div><div class="eyebrow">AI</div><h3>AI phân tích</h3></div></div><div class="hint">Không đọc được trạng thái AI.</div></div>`;
  const u = ai.usage || {};
  const usd = (n) => '$' + Number(n || 0).toFixed(4);
  const sv = ai.server ? (ai.server.usage || ai.server) : null;
  return `<div class="card">
    <div class="card-head"><div><div class="eyebrow">AI</div><h3>AI phân tích</h3></div>${ai.configured ? '<span class="confidence-chip green">đã cấu hình</span>' : '<span class="confidence-chip red">chưa cấu hình</span>'}</div>
    <div class="set-row"><span class="k">Hằng ngày</span><span class="v">${esc(ai.model || '—')} (Haiku)</span></div>
    <div class="set-row"><span class="k">Phân tích quý</span><span class="v">${esc(ai.deepModel || '—')} (Sonnet)</span></div>
    <div class="set-row"><span class="k">Tháng này</span><span class="v">${esc(u.monthCalls ?? 0)} lượt · ${usd(u.monthCostUsd)}</span></div>
    <div class="set-row"><span class="k">Hôm nay</span><span class="v">${esc(u.todayCalls ?? 0)} / ${esc(ai.limits?.userDailyCalls ?? '—')} lượt</span></div>
    ${sv ? `<div class="set-sub"><div class="small muted" style="margin-bottom:2px">Toàn máy chủ</div>
      <div class="set-row"><span class="k">Tháng này</span><span class="v">${esc(sv.monthCalls ?? 0)} lượt · ${usd(sv.monthCostUsd)}</span></div>
      <div class="set-row"><span class="k">Hôm nay</span><span class="v">${esc(sv.todayCalls ?? 0)} / ${esc(ai.limits?.globalDailyCalls ?? '—')} lượt</span></div></div>` : ''}
    <div class="hint" style="margin-top:8px">API key nằm trong file .env trên máy chủ, không nhập trên web.</div>
  </div>`;
}

/* ---------------- settings ---------------- */
async function renderSettings(view) {
  const [icu, status, ai] = await Promise.all([api('/api/config/icu'), api('/api/status'), api('/api/ai/status').catch(() => null)]);
  const me = state.user;
  view.innerHTML = `
    <div class="view-head"><div><div class="page-title"><span class="page-ico" style="--pc:#25d0c4">${ICONS.settings}</span><h1>Cài đặt</h1></div><div class="view-sub">Kết nối dữ liệu, ngưỡng gợi ý, sao lưu và giải thích chỉ số.</div></div></div>
    <div class="settings-stack">
      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Hồ sơ</div><h3>${esc(me.displayName)}</h3></div><span class="confidence-chip">${me.role === 'admin' ? 'Quản trị' : 'Thành viên'}</span></div>
        <div class="set-row"><span class="k">Tên đăng nhập</span><span class="v">${esc(me.username)}</span></div>
        <div class="actions"><button class="btn ghost small" id="pw">Đổi mật khẩu</button><button class="btn ghost small" id="out">Đăng xuất</button></div>
      </div>

      ${aiSettingsCard(ai)}

      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Dữ liệu</div><h3>Intervals.icu</h3></div>${icu.hasKey ? '<span class="confidence-chip green">đã kết nối</span>' : '<span class="confidence-chip red">chưa kết nối</span>'}</div>
        ${icu.hasKey ? `
          <div class="set-row"><span class="k">Athlete ID</span><span class="v">${esc(icu.athleteId || '—')}</span></div>
          <div class="set-row"><span class="k">API key</span><span class="v">đã lưu (mã hoá AES-256-GCM)</span></div>
          <div class="set-row"><span class="k">Đồng bộ gần nhất</span><span class="v">${esc(fmtDateTime(icu.lastSync))}</span></div>
          ${icu.lastError ? `<div class="notice">Lần sync gần nhất lỗi: ${esc(icu.lastError)}</div>` : ''}
          <div class="actions"><button class="btn primary small" id="sync">${ICONS.sync} Đồng bộ ngay</button><button class="btn danger small" id="clear">Ngắt kết nối</button></div>` : `
          <p class="hint">Mỗi người tự nhập API key riêng. Key chỉ đi từ trình duyệt sang máy chủ trong nhà, được mã hoá, không vào Git hay log.</p>
          <label class="field"><span>Athlete ID (ví dụ i123456)</span><input id="athleteId" type="text" autocapitalize="none"></label>
          <label class="field"><span>API key (Intervals.icu → Settings → Developer Settings)</span><input id="apiKey" type="password" autocomplete="off"></label>
          <button class="btn primary small" id="saveKey">Lưu và thử kết nối</button>`}
      </div>

      <div class="card" id="appleCard">
        <div class="card-head"><div><div class="eyebrow">Dữ liệu</div><h3>Apple Health (iPhone)</h3></div><span id="appleChip" class="confidence-chip">đang tải</span></div>
        <div id="appleBox"><div class="hint">Đang tải…</div></div>
      </div>

      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Quy tắc</div><h3>Ngưỡng gợi ý buổi sáng</h3></div></div>
        <div id="adviceSettingsBox"><div class="hint">Đang tải…</div></div>
        <div class="hint" style="margin-top:10px">z = độ lệch so với nền tính bằng độ lệch chuẩn. Đây là quy tắc tham khảo, không phải ngưỡng chẩn đoán. Có thể tắt từng chỉ số.</div>
      </div>

      <div class="card">
        <div class="card-head"><div><div class="eyebrow">Công khai cách tính</div><h3>Chỉ số hồi phục là gì?</h3></div><span class="confidence-chip amber">tham khảo</span></div>
        <div class="formula-list">
          <div><b>1. HRV (45%)</b>: dùng ln(rMSSD). Nguồn là HRV lúc ngủ (ln rMSSD, trung vị các lần đo trong ngủ sâu) từ Apple Health khi có; nếu không, HRV trung bình ngày từ Intervals.icu. Hai nguồn không bao giờ trộn trong một mức nền. 60% đêm qua + 40% trung bình 7 ngày, so với trung vị 60 ngày (độ lệch tính bằng MAD, sàn 7%). Hiện vùng SWC = nền ± 0,5 độ lệch và cảnh báo khi dao động 7 ngày (CV) cao gấp 1,5 lần thường lệ.</div>
          <div><b>2. Nhịp tim nghỉ (25%)</b>: đêm qua so với trung vị 30 ngày; dấu đảo vì cao hơn là xấu.</div>
          <div><b>3. Giấc ngủ (30%)</b>: so với <i>nhu cầu</i>, không so với trung bình của bạn. Nhu cầu = nền 7,5–8,5h + 20% nợ ngủ 7 đêm (tối đa 60 phút) + tối đa 45 phút theo strain hôm qua (strain 10 → 0, mỗi điểm trên 10 thêm 5 phút). Đủ 85% nhu cầu = 50 điểm.</div>
          <div><b>4. Nhịp thở</b>: không cộng điểm. Chỉ là cờ cảnh báo một chiều khi tăng ≥ 1,5 lần/phút so với trung vị. Tăng cùng lúc với nhịp tim nghỉ tăng hoặc HRV giảm → điểm bị chặn ở 50.</div>
          <div><b>5.</b> Mỗi phần đổi thành điểm con 50 + z × 22, chặn 2–99, rồi lấy trung bình có trọng số. HRV là bắt buộc: không có HRV thì không có điểm và không có lời khuyên. Thiếu nhịp tim nghỉ hoặc giấc ngủ thì chia lại trọng số và hạ độ tin cậy. Giá trị vô lý (ngủ &lt; 3h, RHR ngoài 30–110) và ngày bạn báo ốm bị loại khỏi mức nền.</div>
          <div><b>Strain 0–21</b>: thang logarit tính từ load các buổi tập trên Intervals.icu, nên tập thêm thì điểm tăng chậm dần. 70 phút pickleball khoảng 12. Mục tiêu theo dải hồi phục: xanh 14–18, vàng 10–14, đỏ 0–10.</div>
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
  loadAppleHealth(view);
  if (me.role === 'admin') { loadUsers(view); loadSchedule(view); }
}

const APPLE_MODE_HINT = {
  off: 'Điểm chỉ dùng Intervals.icu. Dữ liệu Apple chỉ để xem và đối chiếu.',
  fill: 'Ngày hoặc chỉ số nào Intervals.icu trống thì lấy từ Apple Health.',
  prefer: 'Có số từ Apple Health là dùng số đó, Intervals.icu chỉ còn để dự phòng.',
};
function pairCell(pair, digits = 0, cls = '') {
  const [i, a] = pair || [];
  if (i == null && a == null) return `<td class="num muted ${cls}">—</td>`;
  const f = (x) => (x == null ? '<span class="muted">—</span>' : fmtNum(x, digits));
  const off = i != null && a != null && Math.abs(i - a) > Math.max(Math.abs(i) * 0.1, digits ? 0.3 : 1);
  return `<td class="num ${cls} ${off ? 'pair-off' : ''}">${f(i)}<span class="pair-sep">/</span>${f(a)}</td>`;
}
function hrvTrialHtml(c) {
  const t = c.hrvTrial;
  if (!t || !c.days.some((d) => d.hrv3 && (d.hrv3.deep != null || d.hrv3.sleep != null))) return '';
  const cell = (v, n) => (v == null ? '<td class="num muted">—</td>' : `<td class="num">${fmtNum(v, 1)}${n ? `<span class="type-note"> ${n} lần</span>` : ''}</td>`);
  const row = (label, x) => `<div class="set-row"><span class="k">${label}</span><span class="v">${x.noise == null ? 'chưa đủ đêm' : `dao động đêm-qua-đêm ±${fmtNum(x.noise * 100, 0)}%`}<span class="type-note">trung vị ${x.median == null ? '—' : fmtNum(x.median, 1)} ms${x.readings ? ` · ${fmtNum(x.readings, 0)} lần đo/đêm` : ''}</span></span></div>`;
  return `<div class="divider"></div>
    <div class="eyebrow" style="margin-bottom:6px">Thử nghiệm 3 cách tính HRV</div>
    <div class="table-wrap"><table class="compare-table"><thead><tr><th>Ngày</th><th class="num">Intervals</th><th class="num">Ngủ sâu</th><th class="num">Cả giấc ngủ</th></tr></thead><tbody>
      ${c.days.map((d) => `<tr><td class="nowrap">${esc(fmtShort(d.date))}</td>${cell(d.hrv3.icu)}${cell(d.hrv3.deep, d.hrv3.deepN)}${cell(d.hrv3.sleep, d.hrv3.sleepN)}</tr>`).join('')}
    </tbody></table></div>
    <div class="compare-stats">${row('Intervals', t.icu)}${row('Ngủ sâu', t.deep)}${row('Cả giấc ngủ', t.sleep)}</div>
    <div class="hint" style="margin-top:6px">Tính trên ${t.nights} đêm có đủ cả ba số trong ${t.days} ngày gần nhất. Dao động thấp hơn là ổn định hơn, nhưng chưa nói cách nào đúng hơn: còn phải xem cách nào tụt rõ sau đêm uống bia, ngủ trễ hay ngày ốm. Ba số này chỉ để so sánh, chưa ảnh hưởng điểm hồi phục.</div>`;
}
function appleCompareHtml(c) {
  if (!c || !c.days.some((d) => ['hrv', 'rhr', 'sleepH', 'steps', 'resp'].some((k) => d[k][1] != null))) return '';
  const st = (k, label, digits = 0, unit = '') => {
    const x = c.stats[k];
    if (!x.both && !x.onlyApple && !x.onlyIcu) return '';
    return `<div class="set-row"><span class="k">${label}</span><span class="v">${x.meanAbsDiff == null ? '—' : `lệch TB ±${fmtNum(x.meanAbsDiff, digits)}${unit}`}<span class="type-note">${x.both} ngày cả hai · ${x.onlyApple} chỉ Apple · ${x.onlyIcu} chỉ Intervals</span></span></div>`;
  };
  return `<div class="divider"></div>
    <div class="eyebrow" style="margin-bottom:6px">Đối chiếu 14 ngày · Intervals / Apple</div>
    <div class="table-wrap"><table class="compare-table"><thead><tr><th>Ngày</th><th class="num">HRV</th><th class="num">Tim nghỉ</th><th class="num">Ngủ (h)</th><th class="num">Thở</th><th class="num col-steps">Bước</th></tr></thead><tbody>
      ${c.days.map((d) => `<tr><td class="nowrap">${esc(fmtShort(d.date))}</td>${pairCell(d.hrv)}${pairCell(d.rhr)}${pairCell(d.sleepH, 1)}${pairCell(d.resp, 1)}${pairCell(d.steps, 0, 'col-steps')}</tr>`).join('')}
    </tbody></table></div>
    <div class="compare-stats">${st('hrv', 'HRV', 1, ' ms')}${st('rhr', 'Nhịp tim nghỉ', 1)}${st('sleepH', 'Giờ ngủ', 1, ' h')}${st('resp', 'Nhịp thở', 1)}${st('steps', 'Số bước')}</div>
    ${hrvTrialHtml(c)}
    <div class="hint" style="margin-top:6px">Ô tô màu là ngày hai nguồn lệch hơn 10%. Cột Ngủ: Apple = đêm chính + ngủ trưa cùng ngày, đúng cách HUAWEI/Intervals cộng. Cột HRV: Apple là HRV lúc ngủ, Intervals là trung bình cả ngày, nên lệch là bình thường; app không bao giờ trộn hai loại trong một mức nền.</div>`;
}
function appleWorkoutsHtml(ws) {
  if (!ws || !ws.length) return '';
  const t = (ms) => new Date(ms).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false });
  return `<div class="divider"></div>
    <div class="eyebrow" style="margin-bottom:6px">Buổi tập từ Apple Health · 14 ngày</div>
    <div class="table-wrap"><table><thead><tr><th>Buổi</th><th class="num">Phút</th><th class="num">Nhịp tim TB / max</th><th class="num">TRIMP</th><th class="num">Load Intervals</th></tr></thead><tbody>
      ${ws.map((w) => `<tr><td>${esc(w.name || 'Buổi tập')}<span class="type-note">${esc(fmtShort(w.date))} · ${t(w.start_ms)}</span></td><td class="num">${fmtNum(w.minutes)}</td><td class="num">${w.avg_hr == null ? '—' : `${fmtNum(w.avg_hr)} / ${fmtNum(w.max_hr)}`}</td><td class="num">${w.trimp == null ? '—' : fmtNum(w.trimp)}</td><td class="num">${w.icuLoad == null ? '—' : fmtNum(w.icuLoad)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="hint" style="margin-top:6px">TRIMP ước tính từ nhịp tim, khác thang với load của Intervals; dùng để xem hai số có lên xuống cùng nhau không. Tab Quy luật vẫn dùng load Intervals.</div>`;
}

const HRV_SOURCE_OPTS = [['auto', 'Tự động'], ['apple_night', 'HRV lúc ngủ (Apple)'], ['intervals', 'Intervals.icu']];
function hrvSourceHtml(h) {
  if (!h || typeof h !== 'object') return '';
  const using = h.source === 'apple_night' ? 'HRV lúc ngủ (Apple)' : h.source === 'intervals' ? 'Intervals.icu' : '—';
  return `<div class="divider"></div>
    <div class="eyebrow" style="margin-bottom:6px">Nguồn HRV cho điểm</div>
    <div class="seg" role="radiogroup">
      ${HRV_SOURCE_OPTS.map(([k, label]) => `<button type="button" class="seg-btn ${h.setting === k ? 'on' : ''}" data-hrv-source="${k}" role="radio" aria-checked="${h.setting === k}">${label}</button>`).join('')}
    </div>
    <div class="hint" style="margin-top:6px">Đang dùng: <b>${esc(using)}</b> · ${fmtNum(h.appleNights || 0)} đêm có HRV lúc ngủ. Tự động = dùng HRV lúc ngủ khi có ít nhất 15 đêm trong 60 ngày (đủ mức nền 14 đêm + đêm qua).</div>`;
}
async function loadAppleHealth(view, freshToken = null) {
  const box = view.querySelector('#appleBox');
  const chip = view.querySelector('#appleChip');
  if (!box) return;
  let a;
  try { a = await api('/api/apple-health'); } catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; }
  const url = `${location.origin}${a.endpoint}`;
  chip.className = `confidence-chip ${a.hasToken ? 'green' : ''}`;
  chip.textContent = a.hasToken ? 'đã có mã' : 'chưa kết nối';
  const nights = (a.nights || []).slice(0, 7);
  box.innerHTML = `
    <p class="hint">Phím tắt trên iPhone (hoặc app Health Auto Export) đọc Apple Health và gửi về đây: giấc ngủ chi tiết, HRV, nhịp tim nghỉ, nhịp tim khi ngủ, nhịp thở, SpO2, số bước, buổi tập.</p>
    <div class="set-row"><span class="k">Địa chỉ nhận</span><span class="v apple-url">${esc(url)}</span></div>
    ${a.hasToken ? `
      <div class="set-row"><span class="k">Mã tạo lúc</span><span class="v">${esc(fmtDateTime(a.createdAt))}</span></div>
      <div class="set-row"><span class="k">Phím tắt gửi gần nhất</span><span class="v">${a.lastUsedAt ? esc(fmtDateTime(a.lastUsedAt)) : 'chưa lần nào'}</span></div>` : ''}
    ${freshToken ? `
      <div class="notice">Mã chỉ hiện <b>một lần</b>. Sao chép và dán vào phím tắt ngay, ở dòng <b>Authorization</b> với dạng <code>Bearer ${esc(freshToken.slice(0, 6))}…</code></div>
      <label class="field"><span>Mã cho phím tắt</span><input id="appleToken" type="text" readonly value="Bearer ${esc(freshToken)}"></label>` : ''}
    <div class="actions">
      <button class="btn ghost small" id="appleCopyUrl">Sao chép địa chỉ</button>
      ${freshToken ? '<button class="btn primary small" id="appleCopyToken">Sao chép mã</button>' : `<button class="btn ${a.hasToken ? 'ghost' : 'primary'} small" id="appleNew">${a.hasToken ? 'Tạo mã mới' : 'Tạo mã cho phím tắt'}</button>`}
      ${a.hasToken ? '<button class="btn danger small" id="appleRevoke">Thu hồi mã</button>' : ''}
    </div>
    <div class="divider"></div>
    <div class="eyebrow" style="margin-bottom:6px">Dùng dữ liệu Apple cho điểm hồi phục (trừ HRV)</div>
    <div class="seg" role="radiogroup">
      ${[['off', 'Chỉ so sánh'], ['fill', 'Bù chỗ Intervals thiếu'], ['prefer', 'Ưu tiên Apple']].map(([k, label]) => `<button type="button" class="seg-btn ${a.mode === k ? 'on' : ''}" data-apple-mode="${k}" role="radio" aria-checked="${a.mode === k}">${label}</button>`).join('')}
    </div>
    <div class="hint" style="margin-top:6px">${esc(APPLE_MODE_HINT[a.mode] || '')} Giá trị nhập tay luôn được giữ.</div>
    ${hrvSourceHtml(a.hrvSource)}
    ${appleCompareHtml(a.compare)}
    ${appleWorkoutsHtml(a.workouts)}
    <div class="divider"></div>
    <div class="hint" style="margin-top:8px">iPhone phải bật Tailscale. Nếu đang mở app bằng địa chỉ trong nhà (192.168…), hãy dùng địa chỉ Tailscale của máy Mac trong phím tắt. Hướng dẫn: README → "Dữ liệu từ Apple Health".</div>
    ${nights.length ? `<div class="divider"></div>
      <div class="eyebrow" style="margin-bottom:6px">7 đêm gần nhất</div>
      <div class="apple-nights">${nights.map((r) => `<div class="set-row"><span class="k">${esc(fmtShort(r.date))}</span><span class="v">${durText(r.asleep_min)} · sâu ${durText(r.deep_min)} · REM ${durText(r.rem_min)} · thức ${fmtNum(r.awake_min)}′</span></div>`).join('')}</div>` : ''}`;
  const copy = async (txt, ok) => { try { await navigator.clipboard.writeText(txt); toastMsg(ok); } catch { toastMsg('Không sao chép được, hãy chọn và sao chép tay.'); } };
  box.querySelector('#appleCopyUrl').onclick = () => copy(url, 'Đã sao chép địa chỉ.');
  const ct = box.querySelector('#appleCopyToken');
  if (ct) ct.onclick = () => copy(`Bearer ${freshToken}`, 'Đã sao chép mã.');
  const nb = box.querySelector('#appleNew');
  if (nb) nb.onclick = async () => {
    if (a.hasToken && !confirm('Tạo mã mới? Mã cũ trong phím tắt sẽ ngừng hoạt động, phải dán mã mới vào.')) return;
    try { const r = await api('/api/apple-health/token', { method: 'POST', body: {} }); loadAppleHealth(view, r.token); }
    catch (e) { toastMsg(e.message); }
  };
  box.querySelectorAll('[data-apple-mode]').forEach((btn) => {
    btn.onclick = async () => {
      try { await api('/api/apple-health/mode', { method: 'POST', body: { mode: btn.dataset.appleMode } }); toastMsg('Đã đổi cách dùng dữ liệu Apple.'); loadAppleHealth(view); }
      catch (e) { toastMsg(e.message); }
    };
  });
  box.querySelectorAll('[data-hrv-source]').forEach((btn) => {
    btn.onclick = async () => {
      try { await api('/api/apple-health/hrv-source', { method: 'POST', body: { source: btn.dataset.hrvSource } }); toastMsg('Đã đổi nguồn HRV. Điểm sẽ tính lại.'); loadAppleHealth(view); }
      catch (e) { toastMsg(e.message); }
    };
  });
  const rv = box.querySelector('#appleRevoke');
  if (rv) rv.onclick = async () => {
    if (!confirm('Thu hồi mã? Phím tắt sẽ không gửi được nữa. Dữ liệu đã nhận vẫn giữ.')) return;
    await api('/api/apple-health/token', { method: 'DELETE' });
    loadAppleHealth(view);
  };
}

async function loadAdviceSettings(view) {
  try {
    const s = await api('/api/advice-settings');
    const box = view.querySelector('#adviceSettingsBox');
    const row = (key, label, zKey) => `<div class="threshold-row">
      <span class="k">${esc(label)}</span>
      <span class="threshold-controls">
        ${key === 'hrv' ? '' : `<label class="check-label"><input type="checkbox" id="on-${key}" ${s[key + '_on'] ? 'checked' : ''}> bật</label>`}
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
        rhr_on: box.querySelector('#on-rhr').checked, sleep_on: box.querySelector('#on-sleep').checked,
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
