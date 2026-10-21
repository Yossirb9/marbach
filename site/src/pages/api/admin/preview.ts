// "תצוגה מקדימה": the editor's unsaved version is kept for an hour; the returned address shows the public page with it
// (the middleware reads ?preview=… and only for the signed-in user who made it).
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, readJson } from '../../../lib/api';
import { isCollection, isSingleton } from '../../../lib/schema';
import { checkDoc } from '../../../lib/validate';
import { publicPath } from '../../../lib/publicUrl';
import { randomToken } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readJson<{ kind?: string; name?: string; id?: string; data?: unknown }>(request);
  if (!b) return fail(400, 'נתונים לא תקינים');
  const kind = b.kind === 'singleton' ? 'singleton' : 'entry';
  const name = String(b.name || '');
  if (kind === 'singleton' ? !isSingleton(name) : !isCollection(name)) return fail(404, 'לא נמצא');
  const c = checkDoc(kind, name, b.data);
  if (!c.ok) return fail(422, 'יש שדות שצריך לתקן לפני התצוגה המקדימה', { issues: c.issues });
  const id = randomToken(16);
  const ref = kind === 'singleton' ? name : `${name}/${/^[\w-]{1,64}$/.test(String(b.id)) ? b.id : 'preview'}`;
  const db = env.DB;
  await db.batch([
    db.prepare(`DELETE FROM previews WHERE created_at < ?1`).bind(Date.now() - 3600e3),
    db.prepare(`INSERT INTO previews (id, user_id, kind, ref, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(id, locals.user!.id, kind, ref, JSON.stringify(c.data), Date.now()),
  ]);
  const path = publicPath(kind, ref, c.data);
  return json({ ok: true, url: `${path}?preview=${id}` });
};
