/**
 * Dữ liệu giả để demo. Tạo một admin và một thành viên kèm lịch sử 45 ngày,
 * một vài buổi tập và một cảm giác "tired".
 *
 * CHẠY: node scripts/seed-demo.mjs
 * LƯU Ý: xoá toàn bộ database hiện tại. Không dùng khi đã có dữ liệu thật.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb, localDate, localIso } from '../server/db.mjs';
import { createUser, upsertWellness, upsertActivity, saveIcuKey, addCheckin } from '../server/store.mjs';
import { dataKey } from '../server/db.mjs';

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

const adminRows = [];
for (let i = 45; i >= 1; i--) {
  const wig = Math.sin(i / 3);
  adminRows.push(mk(i, 52 + Math.round(wig * 2), 78 + Math.round(wig * 8), 410 + Math.round(wig * 30), 9800 + Math.round(wig * 2000), 82 + Math.round(wig * 6)));
}
adminRows.push(mk(0, 52, 80, 425, 0, 85)); // hôm nay (chưa hoàn tất → steps=0)
for (const r of adminRows) upsertWellness(db, adminId, r);

for (let i = 45; i >= 15; i--) {
  const r = { date: dayIso(i), restingHR: 58 + (i % 3), hrv: null, hrvSDNN: 30 + (i % 5), sleepSecs: (7 * 60 + i) * 60, sleepScore: 75 + (i % 10), steps: 7000 + i * 50, respiration: 15 + (i % 3) * 0.5 };
  upsertWellness(db, memberId, r);
}
const memberRows = [];
for (let i = 14; i >= 0; i--) memberRows.push({ date: dayIso(i), restingHR: 58 + (i % 3), hrv: null, hrvSDNN: 30 + (i % 5), sleepSecs: (7 * 60 + i) * 60, sleepScore: 75 + (i % 10), steps: 7000 + i * 50, respiration: 15 + (i % 3) * 0.5 });
for (const r of memberRows) upsertWellness(db, memberId, r);

const acts = [
  { id: 'demo-1', start_date_local: dayIso(1) + 'T07:00:00', name: 'Chạy nhẹ', type: 'Run', moving_time: 2400, icu_training_load: 60, average_heartrate: 132, distance: 5000 },
  { id: 'demo-2', start_date_local: dayIso(3) + 'T18:30:00', name: 'Đạp xe', type: 'Ride', moving_time: 4200, icu_training_load: 130, average_heartrate: 138 },
  { id: 'demo-3', start_date_local: dayIso(5) + 'T06:15:00', name: 'Phòng gym', type: 'WorkOut', moving_time: 3000, icu_training_load: 80 },
  { id: 'demo-4', start_date_local: dayIso(7) + 'T07:00:00', name: 'Chạy dài', type: 'Run', moving_time: 4800, icu_training_load: 180, average_heartrate: 145 },
];
for (const a of acts) upsertActivity(db, adminId, a);

addCheckin(db, adminId, { level: 'ok', note: 'Demo checkin' });
console.log(`Đã seed dữ liệu giả.
  · admin  / demo-1234   (quản trị, ~45 ngày nền)
  · demo   / demo-1234   (thành viên, chỉ SDNN → không bao giờ tính baseline rMSSD)
  · mở    http://127.0.0.1:8899  (xem README để biết cổng thật)
  · demo  KHÔNG đồng bộ Intervals.icu (chưa cấu hình key).`);
