/**
 * Loads <repo>/.env into process.env before anything else reads it.
 * Zero dependencies. Existing environment variables always win, so a value
 * set by launchd or the shell is never overridden by the file.
 *
 * .env holds secrets (ANTHROPIC_API_KEY) and is in .gitignore — never commit it.
 * Import this module FIRST in server/index.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) out[k] = v;
  }
  return out;
}

export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return {};
  const vars = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return Object.keys(vars);
}

if (!process.env.NHIP_SKIP_DOTENV) loadEnv();
