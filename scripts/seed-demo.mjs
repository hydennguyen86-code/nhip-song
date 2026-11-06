/**
 * Dữ liệu giả để demo. Tạo một admin (120 ngày, có bối cảnh và hiệu ứng tập chân cài sẵn) và một thành viên,
 * một vài buổi tập, một cảm giác "tired" và một người không có HRV (app hiện "Cần HRV").
 *
 * CHẠY: node scripts/seed-demo.mjs
 * LƯU Ý: xoá toàn bộ database hiện tại. Không dùng khi đã có dữ liệu thật.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb, localDate, localIso } from '../server/db.mjs';
import { createUser, upsertWellness, upsertActivity, saveIcuKey, addCheckin, saveManualDay } from '../server/store.mjs';
import { dataKey } from '../server/db.mjs';
import { saveContext } from '../server/context.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = process.env.NHIP_DATA_DIR || path.join(ROOT, 'data');

if (process.argv.includes('--fresh')) {
  for (const f of ['nhip-song.db', 'nhip-song.db-wal', 'nhip-song.db-shm']) {
    try { fs.unlinkSync(path.join(DIR, f)); } catch {}
  }
}
fs.mkdirSync(DIR, { recursive: true });
const db = openDb(DIR);
const key = dataKey(DIR);
const existing = db.prepare('SELECT id FROM users WHERE username=?').get('admin');
const adminId = existing?.id || createUser(db, { username: 'admin', displayName: 'Quản trị demo', password: 'demo-1234', role: 'admin' });
const memberId = db.prepare('SELECT id FROM users WHERE username=?').get('demo')?.id || createUser(db, { username: 'demo', displayName: 'Người dùng demo', password: 'demo-1234', role: 'member', mustChangePw: 0 });

function dayIso(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}
function mk(offset, rhr, hrv, sleep, steps, score) {
  return { date: dayIso(offset), restingHR: rhr, hrv, sleepSecs: sleep * 60, sleepScore: score, steps, respiration: 14 + (offset % 3) * 0.5 };
}

// Admin: 120 ngày, có bối cảnh mỗi ngày và hiệu ứng cài sẵn để trang Quy luật có số thật:
// tập chân → HRV sáng hôm sau −15 %, hôm sau nữa −8 %, nhịp tim nghỉ +3; rượu bia → HRV −12 %;
// pickleball → nhịp tim nghỉ +2; xông hơi tối, tập ngực/lưng → không ảnh hưởng.
const DAYS = 120;
const jitter = (i, salt) => { const x = Math.sin(i * 12.9898 * salt + salt * 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
const u01 = (i, salt) => (jitter(i, salt) + 1) / 2;
// Lịch không cứng theo tuần (như đời thật), để app tách được từng yếu tố.
const plan = (i) => {
  const r = u01(i, 19);
  const c = r < 0.16 ? { workout: ['leg'], load: 'le50' }
    : r < 0.36 ? { workout: ['chest_back'], load: '50_70' }
    : r < 0.5 ? { workout: ['shoulder_arm'], load: 'le50' }
    : r < 0.64 ? { workout: ['pickleball'] }
    : { workout: ['rest'] };
  c.sauna = u01(i, 23) > 0.55 ? 'evening' : 'none';
  c.coffee_cups = 1 + Math.floor(u01(i, 31) * 3);
  if (u01(i, 29) > 0.88) c.alcohol = 2;
  c.bedtime = u01(i, 37) > 0.7 ? '23:45' : '22:50';
  c.work_stress = u01(i, 41) > 0.8 ? 2 : 1;
  return c;
};
const adminRows = [];
for (let i = DAYS; i >= 0; i--) {
  const y = i + 1 <= DAYS ? plan(i + 1) : {};
  const y2 = i + 2 <= DAYS ? plan(i + 2) : {};
  let hrv = 62 * Math.exp(0.06 * jitter(i, 3));
  let rhr = 52 + 0.9 * jitter(i, 7);
  if (y.workout?.includes('leg')) { hrv *= 0.85; rhr += 3; }
  if (y2.workout?.includes('leg')) hrv *= 0.92;
  if (y.alcohol) hrv *= 0.88;
  if (y.workout?.includes('pickleball')) rhr += 2;
  const sleep = 440 + 25 * jitter(i, 11);
  adminRows.push(mk(i, Math.round(rhr * 10) / 10, Math.round(hrv * 10) / 10, Math.round(sleep), i === 0 ? 0 : 9000 + Math.round(1500 * jitter(i, 13)), 80 + Math.round(6 * jitter(i, 17))));
}
for (const r of adminRows) upsertWellness(db, adminId, r);
for (let i = DAYS; i >= 1; i--) saveContext(db, adminId, dayIso(i), plan(i));

for (let i = 45; i >= 15; i--) {
  const r = { date: dayIso(i), restingHR: 58 + (i % 3), hrv: 46 + (i % 6), hrvSDNN: null, sleepSecs: (7 * 60 + i) * 60, sleepScore: 75 + (i % 10), steps: 7000 + i * 50, respiration: 15 + (i % 3) * 0.5 };
  upsertWellness(db, memberId, r);
}
const memberRows = [];
for (let i = 14; i >= 0; i--) memberRows.push({ date: dayIso(i), restingHR: 58 + (i % 3), hrv: 46 + (i % 6), hrvSDNN: null, sleepSecs: (7 * 60 + i) * 60, sleepScore: 75 + (i % 10), steps: 7000 + i * 50, respiration: 15 + (i % 3) * 0.5 });
for (const r of memberRows) upsertWellness(db, memberId, r);

const acts = [
  { id: 'demo-1', start_date_local: dayIso(1) + 'T07:00:00', name: 'Chạy nhẹ', type: 'Run', moving_time: 2400, icu_training_load: 60, average_heartrate: 132, distance: 5000 },
  { id: 'demo-2', start_date_local: dayIso(3) + 'T18:30:00', name: 'Đạp xe', type: 'Ride', moving_time: 4200, icu_training_load: 130, average_heartrate: 138 },
  { id: 'demo-3', start_date_local: dayIso(5) + 'T06:15:00', name: 'Phòng gym', type: 'WorkOut', moving_time: 3000, icu_training_load: 80 },
  { id: 'demo-4', start_date_local: dayIso(7) + 'T07:00:00', name: 'Chạy dài', type: 'Run', moving_time: 4800, icu_training_load: 180, average_heartrate: 145 },
];
for (const a of acts) upsertActivity(db, adminId, a);

addCheckin(db, adminId, { level: 'ok', note: 'Demo checkin' });

// Người dùng thiết bị không đo HRV: chỉ có nhịp tim nghỉ và giấc ngủ → app hiện "Cần HRV", không chấm điểm.
const bandId = db.prepare('SELECT id FROM users WHERE username=?').get('khonghrv')?.id || createUser(db, { username: 'khonghrv', displayName: 'Trần Văn Khang', password: 'demo-1234', role: 'member', mustChangePw: 0 });
for (let i = 20; i >= 1; i--) {
  saveManualDay(db, bandId, { date: dayIso(i), values: { resting_hr: 61 + (i % 3), sleep_secs: (410 + i * 3) * 60, sleep_score: 74 + (i % 9), steps: 6800 + i * 90, spo2: 96 + (i % 2) } });
}
console.log(`Đã seed dữ liệu giả.
  · admin    / demo-1234   (quản trị, 120 ngày, có bối cảnh → trang Quy luật có số)
  · demo     / demo-1234   (thành viên, HRV rMSSD ~45 ngày)
  · khonghrv / demo-1234   (thiết bị không đo HRV → app hiện "Cần HRV")
  · mở    http://127.0.0.1:8899  (xem README để biết cổng thật)
  · demo  KHÔNG đồng bộ Intervals.icu (chưa cấu hình key).`);
