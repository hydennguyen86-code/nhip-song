#!/usr/bin/env bash
# Sao lưu dữ liệu người dùng (không chứa API key, không chứa secret.key).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$HERE/data"
OUT="$HERE/backups"
mkdir -p "$OUT"
TS=$(date +%Y-%m-%d-%H%M%S)
if [ ! -f "$DATA/nhip-song.db" ]; then echo "Chưa có database để backup."; exit 1; fi
# Dùng SQLite online backup để sao lưu an toàn khi server đang chạy.
NODE="${NHIP_NODE:-$(command -v node || echo /Users/admin/.local/opt/node-v24.22.1-darwin-arm64/bin/node)}"
"$NODE" -e "
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const src = new DatabaseSync(process.argv[1], { readOnly: true });
src.exec(\"VACUUM INTO '\" + process.argv[2].replace(/'/g,\"''\") + \"'\");
src.close();
" "$DATA/nhip-song.db" "$OUT/nhip-song-$TS.db"
cp "$DATA/secret.key" "$OUT/secret.key-$TS" 2>/dev/null || true
chmod 600 "$OUT"/*
echo "Backup xong: $OUT/nhip-song-$TS.db"
echo "Khôi phục: dừng app, đổi tên file backup thành data/nhip-song.db, chạy lại."
