// Earlier versions of a document (kept on every save): ?ref=home lists them, ?id=12 returns one to load into the form.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail } from '../../../lib/api';

export const GET: APIRoute = async ({ url }) => {
  const db = env.DB;
  const id = Number(url.searchParams.get('id'));
  if (id) {
    const r = await db.prepare(`SELECT ref, data, at, by FROM revisions WHERE id = ?1`).bind(id).first<{ ref: string; data: string; at: number; by: string }>();
    return r ? json({ ok: true, ref: r.ref, data: JSON.parse(r.data), at: r.at, by: r.by }) : fail(404, 'לא נמצא');
  }
  const ref = url.searchParams.get('ref') || '';
  if (!/^[\w-]+(\/[\w-]+)?$/.test(ref)) return fail(400, 'נתונים לא תקינים');
  const r = await db.prepare(`SELECT id, at, by FROM revisions WHERE ref = ?1 ORDER BY id DESC LIMIT 20`).bind(ref).all();
  return json({ ok: true, items: r.results });
};
