// The admin's own login: no outside service. Users in D1 (table `users`), passwords as PBKDF2-SHA256 (WebCrypto) with a
// random salt per user; the number of iterations is stored with each hash, so it can change without breaking logins.
// A session is a random token in an HttpOnly + Secure + SameSite cookie; the database keeps only its SHA-256.
// Every state-changing request carries the session's CSRF token (header X-CSRF-Token) and must come from our own origin.
// Failed logins are limited per IP and per user name (table `rate_limits`).
import type { AstroCookies } from 'astro';

export const SESSION_COOKIE = '__Host-mb_session';
export const LOGIN_CSRF_COOKIE = '__Host-mb_login';
const SESSION_DAYS = 14;
/** Workers caps PBKDF2 at 100,000 iterations */
export const DEFAULT_ITERATIONS = 100_000;

const enc = new TextEncoder();
export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
export const randomToken = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS, saltHex?: string) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return { hash: hex(bits), salt: hex(salt), iterations };
}

/** constant-time comparison of two hex strings */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verifyPassword(password: string, u: { pw_hash: string; pw_salt: string; pw_iter: number }) {
  const { hash } = await hashPassword(password, u.pw_iter, u.pw_salt);
  return safeEqual(hash, u.pw_hash);
}

/** a password a person can type: 4 groups of 4, without look-alike characters (≈ 95 bits) */
export function generatePassword() {
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out: string[] = [];
  const buf = crypto.getRandomValues(new Uint32Array(16));
  for (let i = 0; i < 16; i++) out.push(A[buf[i] % A.length]);
  return out.join('').replace(/(.{4})(?!$)/g, '$1-');
}

export const passwordProblem = (p: string) =>
  p.length < 10 ? 'סיסמה של 10 תווים לפחות' : p.length > 200 ? 'סיסמה ארוכה מדי' : null;

export interface SessionUser { id: number; username: string; display_name: string; role: 'admin' | 'editor'; csrf: string; sid: string }

export async function createSession(db: D1Database, cookies: AstroCookies, userId: number, ip: string, ua: string) {
  const token = randomToken();
  const csrf = randomToken(24);
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO sessions (id, user_id, csrf, created_at, expires_at, ip, ua) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(await sha256(token), userId, csrf, now, now + SESSION_DAYS * 864e5, ip, ua.slice(0, 200)),
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?1`).bind(now),
    db.prepare(`DELETE FROM rate_limits WHERE reset_at < ?1`).bind(now),
    db.prepare(`UPDATE users SET last_login = ?2 WHERE id = ?1`).bind(userId, now),
  ]);
  cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_DAYS * 86400 });
}

export async function getSession(db: D1Database, cookies: AstroCookies): Promise<SessionUser | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const sid = await sha256(token);
  const r = await db.prepare(`SELECT u.id, u.username, u.display_name, u.role, s.csrf, s.id AS sid FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ?1 AND s.expires_at > ?2 AND u.disabled = 0`).bind(sid, Date.now()).first<SessionUser>();
  return r ?? null;
}

export async function destroySession(db: D1Database, cookies: AstroCookies) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) await db.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(await sha256(token)).run();
  cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
}

/**
 * Fixed-window limiter in D1. hit() counts one attempt and says whether the key is over its limit.
 * Used for failed logins (per IP and per user name) and for the public recommendation form (per IP).
 */
export async function rateHit(db: D1Database, key: string, limit: number, windowMs: number): Promise<{ blocked: boolean; retryAfter: number }> {
  const now = Date.now();
  const r = await db.prepare(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
    RETURNING count, reset_at`).bind(key, now + windowMs, now).first<{ count: number; reset_at: number }>();
  const count = r?.count ?? 1;
  return { blocked: count > limit, retryAfter: Math.max(0, Math.ceil(((r?.reset_at ?? now) - now) / 1000)) };
}

export async function rateBlocked(db: D1Database, key: string, limit: number): Promise<{ blocked: boolean; retryAfter: number }> {
  const now = Date.now();
  const r = await db.prepare(`SELECT count, reset_at FROM rate_limits WHERE key = ?1`).bind(key).first<{ count: number; reset_at: number }>();
  if (!r || r.reset_at <= now) return { blocked: false, retryAfter: 0 };
  return { blocked: r.count >= limit, retryAfter: Math.ceil((r.reset_at - now) / 1000) };
}

export const rateClear = (db: D1Database, key: string) => db.prepare(`DELETE FROM rate_limits WHERE key = ?1`).bind(key).run();

/** the request comes from a page of this site (Origin, or Referer when a browser leaves Origin out) */
export function sameOrigin(request: Request, url: URL) {
  const o = request.headers.get('origin');
  if (o) return o === url.origin;
  const r = request.headers.get('referer');
  if (r) { try { return new URL(r).origin === url.origin; } catch { return false; } }
  return false;
}

export const clientIp = (request: Request) => request.headers.get('cf-connecting-ip') || 'local';
