// The order of a list after dragging (talks, videos, testimonials): order = 1, 2, 3 … in the given sequence.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, readJson, who } from '../../../../lib/api';
import { reorder } from '../../../../lib/content';
import { isCollection } from '../../../../lib/schema';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const c = params.collection ?? '';
  if (!isCollection(c) || c === 'articles') return fail(404, 'לא נמצא');
  const b = await readJson<{ ids?: unknown }>(request);
  const ids = Array.isArray(b?.ids) ? b!.ids.filter((x): x is string => typeof x === 'string' && /^[\w-]{1,64}$/.test(x)).slice(0, 500) : null;
  if (!ids?.length) return fail(400, 'נתונים לא תקינים');
  await reorder(env.DB, c, ids, who(locals.user));
  return json({ ok: true });
};
