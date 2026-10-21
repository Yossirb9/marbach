// "החשבון שלי": change your own password (the current one is required); other sessions of the user are signed out.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, readJson } from '../../../lib/api';
import { hashPassword, passwordProblem, verifyPassword, rateHit } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, locals }) => {
  const me = locals.user!;
  const db = env.DB;
  const b = await readJson<{ current?: string; next?: string }>(request, 5000);
  if (!b) return fail(400, 'נתונים לא תקינים');
  const lim = await rateHit(db, `pw-change:${me.id}`, 10, 3600e3);
  if (lim.blocked) return fail(429, 'יותר מדי ניסיונות. נסו שוב בעוד שעה.');
  const u = await db.prepare(`SELECT pw_hash, pw_salt, pw_iter FROM users WHERE id = ?1`).bind(me.id).first<{ pw_hash: string; pw_salt: string; pw_iter: number }>();
  if (!u || !(await verifyPassword(String(b.current || ''), u))) return fail(401, 'הסיסמה הנוכחית שגויה');
  const next = String(b.next || '');
  const p = passwordProblem(next);
  if (p) return fail(422, p);
  const h = await hashPassword(next, Math.min(100000, Number(env.PBKDF2_ITERATIONS) || 100000));
  await db.batch([
    db.prepare(`UPDATE users SET pw_hash = ?2, pw_salt = ?3, pw_iter = ?4 WHERE id = ?1`).bind(me.id, h.hash, h.salt, h.iterations),
    db.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND id != ?2`).bind(me.id, me.sid),
  ]);
  return json({ ok: true });
};
