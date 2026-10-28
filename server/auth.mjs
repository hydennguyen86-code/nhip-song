import crypto from 'node:crypto';

// Passwords are salted scrypt hashes; nothing is ever stored in plaintext.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * SCRYPT.N * SCRYPT.r * SCRYPT.p * 2,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(N) * Number(r) * Number(p) * 2,
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const SESSION_DAYS = 30;

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date();
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(
    tokenHash,
    userId,
    now.toISOString(),
    new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString(),
  );
  return token;
}

export function sessionUser(db, token) {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(tokenHash, new Date().toISOString());
  return row || null;
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(crypto.createHash('sha256').update(String(token)).digest('hex'));
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export const SESSION_COOKIE = 'nhipsong';

export function sessionCookie(token, { secure = false, maxAge = SESSION_DAYS * 86400 } = {}) {
  // The app runs on the LAN over plain HTTP; SameSite=Lax plus HttpOnly keeps the
  // session out of scripts and cross-site requests. If it is ever put behind HTTPS,
  // pass secure: true so the cookie is only sent over TLS.
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/** Every data query must be scoped to the signed-in account. Passing a user id
 * from the URL is never enough on its own. */
export function ownedUserId(req) {
  return req.user ? req.user.id : null;
}
