// Login: user name + password → a session cookie. Limits: 5 failed attempts per user name and 10 per IP address in
// 15 minutes; after that even the right password waits until the window ends. The login form carries a one-time CSRF
// token (double submit: cookie + body) and must come from our own origin (checked in the middleware too).
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, readJson } from '../../../lib/api';
import { LOGIN_CSRF_COOKIE, clientIp, createSession, hashPassword, rateBlocked, rateClear, rateHit, safeEqual, verifyPassword, sha256 } from '../../../lib/auth';

const WINDOW = 15 * 60e3;
const USER_LIMIT = 5, IP_LIMIT = 10;
const wait = (s: number) => `יותר מדי ניסיונות כושלים. אפשר לנסות שוב בעוד ${Math.max(1, Math.ceil(s / 60))} דקות.`;

export const POST: APIRoute = async ({ request, cookies }) => {
  const db = env.DB;
  const b = await readJson<{ username?: string; password?: string; csrf?: string }>(request, 5000);
  const cookie = cookies.get(LOGIN_CSRF_COOKIE)?.value || '';
  if (!b || !cookie || !b.csrf || !safeEqual(String(b.csrf), cookie)) return fail(403, 'פג תוקף הטופס. רעננו את העמוד ונסו שוב.');
  const username = String(b.username || '').trim().toLowerCase().slice(0, 64);
  const password = String(b.password || '').slice(0, 200);
  if (!username || !password) return fail(400, 'נא למלא שם משתמש וסיסמה');
  const ip = clientIp(request);
  const ipKey = `login-ip:${(await sha256(ip)).slice(0, 24)}`, userKey = `login-user:${username}`;
  const [bi, bu] = await Promise.all([rateBlocked(db, ipKey, IP_LIMIT), rateBlocked(db, userKey, USER_LIMIT)]);
  if (bi.blocked || bu.blocked) return fail(429, wait(Math.max(bi.retryAfter, bu.retryAfter)), { retryAfter: Math.max(bi.retryAfter, bu.retryAfter) });

  const u = await db.prepare(`SELECT id, pw_hash, pw_salt, pw_iter, disabled FROM users WHERE username = ?1`).bind(username)
    .first<{ id: number; pw_hash: string; pw_salt: string; pw_iter: number; disabled: number }>();
  // the same work whether or not the user exists, so the answer time does not reveal user names
  const ok = u ? await verifyPassword(password, u) : (await hashPassword(password, Number(env.PBKDF2_ITERATIONS) || 100000), false);
  if (!ok || !u || u.disabled) {
    const [hi, hu] = await Promise.all([rateHit(db, ipKey, IP_LIMIT, WINDOW), rateHit(db, userKey, USER_LIMIT, WINDOW)]);
    if (hi.blocked || hu.blocked) return fail(429, wait(Math.max(hi.retryAfter, hu.retryAfter)));
    return fail(401, 'שם המשתמש או הסיסמה שגויים');
  }
  await rateClear(db, userKey);
  await createSession(db, cookies, u.id, ip, request.headers.get('user-agent') || '');
  cookies.delete(LOGIN_CSRF_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'strict' });
  return json({ ok: true });
};
