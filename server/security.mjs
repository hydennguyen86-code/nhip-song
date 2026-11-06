/**
 * Hardening for running behind Cloudflare Tunnel (public HTTPS hostname →
 * cloudflared on the Mac → http://127.0.0.1:8899).
 *
 *   TRUST_PROXY=1   trust Cloudflare's headers (CF-Connecting-IP, X-Forwarded-*)
 *                   for the client IP and for "is this HTTPS?". Only set it when
 *                   the app is reachable ONLY through the tunnel (HOST=127.0.0.1),
 *                   otherwise anyone could spoof these headers.
 *   COOKIE_SECURE=1 always mark the session cookie Secure.
 */

const env = (k) => String(process.env[k] || '').trim();
const trustProxy = () => env('TRUST_PROXY') === '1';

export function clientIp(req) {
  if (trustProxy()) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

/** True when the request came through a proxy/tunnel, whatever TRUST_PROXY says. */
export function viaProxy(req) {
  return Boolean(req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto']);
}

export function isHttps(req) {
  if (env('COOKIE_SECURE') === '1') return true;
  if (!trustProxy()) return false;
  if (String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') return true;
  return /"scheme"\s*:\s*"https"/.test(String(req.headers['cf-visitor'] || ''));
}

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

/**
 * Failed-login limiter, per client IP and per username (so a spoofed IP does
 * not help). 8 failures in 15 minutes → locked until the window passes.
 */
export function createLoginLimiter({ max = 8, windowMs = 15 * 60_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  const prune = (key) => {
    const list = (hits.get(key) || []).filter((t) => now() - t < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  return {
    blocked(keys) { return keys.some((k) => prune(k).length >= max); },
    fail(keys) { for (const k of keys) { const l = prune(k); l.push(now()); hits.set(k, l); } },
    reset(keys) { for (const k of keys) hits.delete(k); },
    retryAfterSec(keys) {
      const oldest = keys.map((k) => prune(k)).filter((l) => l.length >= max).map((l) => l[0]);
      return oldest.length ? Math.ceil((Math.min(...oldest) + windowMs - now()) / 1000) : 0;
    },
  };
}
