// One entry of a list (article, talk, video, testimonial): read, create (id "new"), save, delete.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, readJson, who } from '../../../../../lib/api';
import { deleteEntry, getRaw, newId, saveEntry, bumpStatements } from '../../../../../lib/content';
import { isCollection } from '../../../../../lib/schema';
import { checkDoc } from '../../../../../lib/validate';
import { publicPath } from '../../../../../lib/publicUrl';

export const GET: APIRoute = async ({ params }) => {
  const c = params.collection ?? '', id = params.id ?? '';
  if (!isCollection(c)) return fail(404, 'לא נמצא');
  const r = await getRaw(env.DB, 'entry', c, id);
  if (!r) return fail(404, 'לא נמצא');
  return json({ ok: true, data: r.data, updated_at: r.updated_at, updated_by: r.updated_by });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const c = params.collection ?? '';
  let id = params.id ?? '';
  if (!isCollection(c) || !/^(new|[\w-]{1,64})$/.test(id)) return fail(404, 'לא נמצא');
  const b = await readJson<{ data?: unknown; updated_at?: number }>(request);
  if (!b) return fail(400, 'נתונים לא תקינים');
  const ck = checkDoc('entry', c, b.data);
  if (!ck.ok) return fail(422, 'יש שדות שצריך לתקן', { issues: ck.issues });
  const db = env.DB;
  const data = ck.data;
  if (c === 'articles') {
    const taken = await db.prepare(`SELECT id FROM entries WHERE collection = 'articles' AND json_extract(data, '$.slug') = ?1 AND id != ?2`).bind(data.slug, id).first();
    if (taken) return fail(422, 'יש שדות שצריך לתקן', { issues: [{ path: 'slug', message: 'כבר יש מאמר עם הכתובת הזאת. בחרו כתובת אחרת.' }] });
  }
  if (id === 'new') {
    id = c === 'articles' && !(await getRaw(db, 'entry', c, String(data.slug))) ? String(data.slug) : newId();
  } else {
    const cur = await getRaw(db, 'entry', c, id);
    if (!cur) return fail(404, 'הפריט נמחק בינתיים');
    if (b.updated_at && cur.updated_at > b.updated_at && cur.updated_by !== who(locals.user)) {
      return fail(409, `${cur.updated_by || 'מישהו אחר'} שמר/ה את הפריט הזה בינתיים. רעננו את העמוד כדי לראות את הגרסה החדשה.`);
    }
  }
  // only one video is "featured" on the home page
  if (c === 'videos' && data.featured) {
    await db.batch([db.prepare(`UPDATE entries SET data = json_set(data, '$.featured', json('false')) WHERE collection = 'videos' AND id != ?1`).bind(id), ...bumpStatements(db)]);
  }
  await saveEntry(db, c, id, data, who(locals.user));
  const after = await getRaw(db, 'entry', c, id);
  return json({ ok: true, id, url: publicPath('entry', `${c}/${id}`, data), updated_at: after?.updated_at ?? Date.now() });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const c = params.collection ?? '', id = params.id ?? '';
  if (!isCollection(c)) return fail(404, 'לא נמצא');
  await deleteEntry(env.DB, c, id, who(locals.user));
  return json({ ok: true });
};
