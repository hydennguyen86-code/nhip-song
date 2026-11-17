#!/usr/bin/env node
/**
 * Import typed body-composition readings from a JSON file into Nhịp Sống.
 * Usage: node scripts/import-body.mjs [file.json] [data-dir]
 * File: { "username": "hyden", "readings": [ { "date": "YYYY-MM-DD", "weight": 69.4, ..., "impedance": {...} } ] }
 * Runs on the server machine itself (SQLite must be opened by local processes only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, localDate } from '../server/db.mjs';
import { saveManualBody } from '../server/body.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(root, 'data', 'body-import.json');
const dir = process.argv[3] || path.join(root, 'data');
const input = JSON.parse(fs.readFileSync(file, 'utf8'));
const db = openDb(dir);
const user = db.prepare('SELECT id, display_name FROM users WHERE username = ?').get(String(input.username || '').toLowerCase());
if (!user) { console.error(`Không có tài khoản "${input.username}".`); process.exit(1); }
let ok = 0;
for (const r of input.readings || []) {
  const { date, ...data } = r;
  try {
    const row = saveManualBody(db, user.id, date, data, { today: localDate() });
    console.log(`✓ ${date}: cân ${row.weight} kg, mỡ ${row.fat_pct}%, cơ xương ${row.skeletal_kg} kg`);
    ok++;
  } catch (e) {
    console.error(`✗ ${date}: ${e.message}`);
  }
}
console.log(`Đã nhập ${ok}/${(input.readings || []).length} lần đo cho ${user.display_name}.`);
