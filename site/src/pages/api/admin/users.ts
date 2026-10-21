// Users (admins only): add a user, reset a password, change the role, block / unblock, delete. A new or reset password
// is generated here and returned once, to be passed on by hand; it is never stored in clear text.
// There is no mail service: "forgot my password" = an admin resets it here.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, readJson } from '../../../lib/api';
import { generatePassword, hashPassword } from '../../../lib/auth';

export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'admin') return fail(403, 'רק מנהל/ת יכול/ה לנהל משתמשים');
  const r = await env.DB.prepare(`SELECT id, username, display_name, role, disabled, created_at, last_login FROM users ORDER BY id`).all();
  return json({ ok: true, items: r.results });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const me = locals.user!;
  if (me.role !== 'admin') return fail(403, 'רק מנהל/ת יכול/ה לנהל משתמשים');
  const db = env.DB;
  const iter = Math.min(100000, Number(env.PBKDF2_ITERATIONS) || 100000);
  const b = await readJson<{ action?: string; id?: number; username?: string; display_name?: string; role?: string }>(request, 5000);
  if (!b) return fail(400, 'נתונים לא תקינים');
  const role = b.role === 'admin' ? 'admin' : 'editor';
  if (b.action === 'create') {
    const username = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return fail(422, 'שם משתמש: 3–32 אותיות באנגלית, ספרות, נקודה או מקף');
    if (await db.prepare(`SELECT id FROM users WHERE username = ?1`).bind(username).first()) return fail(409, 'שם המשתמש תפוס');
    const password = generatePassword();
    const h = await hashPassword(password, iter);
    await db.prepare(`INSERT INTO users (username, display_name, role, pw_hash, pw_salt, pw_iter, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(username, String(b.display_name || '').trim().slice(0, 60), role, h.hash, h.salt, h.iterations, Date.now()).run();
    return json({ ok: true, username, password });
  }
  const id = Number(b.id);
  const u = await db.prepare(`SELECT id, username FROM users WHERE id = ?1`).bind(id).first<{ id: number; username: string }>();
  if (!u) return fail(404, 'המשתמש לא נמצא');
  const self = u.id === me.id;
  switch (b.action) {
    case 'reset': {
      const password = generatePassword();
      const h = await hashPassword(password, iter);
      await db.batch([
        db.prepare(`UPDATE users SET pw_hash = ?2, pw_salt = ?3, pw_iter = ?4 WHERE id = ?1`).bind(id, h.hash, h.salt, h.iterations),
        // a reset signs the user out everywhere (but not the admin doing it, when resetting their own)
        db.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND id != ?2`).bind(id, me.sid),
        db.prepare(`DELETE FROM rate_limits WHERE key = ?1`).bind(`login-user:${u.username}`),
      ]);
      return json({ ok: true, username: u.username, password });
    }
    case 'role':
      if (self) return fail(422, 'אי אפשר לשנות את התפקיד של עצמך');
      await db.prepare(`UPDATE users SET role = ?2 WHERE id = ?1`).bind(id, role).run();
      return json({ ok: true });
    case 'disable':
    case 'enable':
      if (self) return fail(422, 'אי אפשר לחסום את עצמך');
      await db.batch([
        db.prepare(`UPDATE users SET disabled = ?2 WHERE id = ?1`).bind(id, b.action === 'disable' ? 1 : 0),
        db.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(b.action === 'disable' ? id : -1),
      ]);
      return json({ ok: true });
    case 'delete':
      if (self) return fail(422, 'אי אפשר למחוק את עצמך');
      await db.batch([db.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id), db.prepare(`DELETE FROM users WHERE id = ?1`).bind(id)]);
      return json({ ok: true });
  }
  return fail(400, 'פעולה לא מוכרת');
};
