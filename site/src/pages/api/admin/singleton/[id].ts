// One fixed document (a page, the settings, the menu/header/footer): read it raw for the form, save it validated.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, readJson, who } from '../../../../lib/api';
import { getRaw, saveSingleton } from '../../../../lib/content';
import { isSingleton } from '../../../../lib/schema';
import { checkDoc } from '../../../../lib/validate';
import { publicPath } from '../../../../lib/publicUrl';

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  if (!isSingleton(id)) return fail(404, 'לא נמצא');
  const r = await getRaw(env.DB, 'singleton', '', id);
  return json({ ok: true, data: r?.data ?? {}, updated_at: r?.updated_at ?? 0, updated_by: r?.updated_by ?? '' });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = params.id ?? '';
  if (!isSingleton(id)) return fail(404, 'לא נמצא');
  const b = await readJson<{ data?: unknown; updated_at?: number }>(request);
  if (!b) return fail(400, 'נתונים לא תקינים');
  const c = checkDoc('singleton', id, b.data);
  if (!c.ok) return fail(422, 'יש שדות שצריך לתקן', { issues: c.issues });
  // someone else saved this page since it was opened: do not overwrite silently
  const cur = await getRaw(env.DB, 'singleton', '', id);
  if (cur && b.updated_at && cur.updated_at > b.updated_at && cur.updated_by !== who(locals.user)) {
    return fail(409, `${cur.updated_by || 'מישהו אחר'} שמר/ה את העמוד הזה בינתיים. רעננו את העמוד כדי לראות את הגרסה החדשה.`);
  }
  await saveSingleton(env.DB, id, c.data, who(locals.user));
  const after = await getRaw(env.DB, 'singleton', '', id);
  return json({ ok: true, url: publicPath('singleton', id), updated_at: after?.updated_at ?? Date.now() });
};
