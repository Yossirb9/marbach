// The inbox of recommendations from /recommend/: approve (→ a new testimonial on the site, with the editor's corrections),
// reject (hidden from the inbox, can be restored) or restore.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, readJson, who } from '../../../../lib/api';
import { saveEntry, newId } from '../../../../lib/content';
import { checkDoc } from '../../../../lib/validate';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const db = env.DB;
  const id = Number(params.id);
  const b = await readJson<{ action?: string; name?: string; role?: string; quote?: string }>(request, 20_000);
  if (!id || !b) return fail(400, 'נתונים לא תקינים');
  const s = await db.prepare(`SELECT * FROM submissions WHERE id = ?1`).bind(id).first<{ id: number; name: string; role: string; text: string; status: string }>();
  if (!s) return fail(404, 'לא נמצא');
  const by = who(locals.user), now = Date.now();
  if (b.action === 'approve') {
    if (s.status === 'approved') return fail(409, 'ההמלצה כבר אושרה');
    // after the quotes already on the site (videos of participants have their own, higher numbers)
    const max = await db.prepare(`SELECT MAX(CAST(json_extract(data, '$.order') AS REAL)) AS m FROM entries WHERE collection = 'testimonials'
      AND COALESCE(json_extract(data, '$.quote'), '') != ''`).first<{ m: number | null }>();
    const c = checkDoc('entry', 'testimonials', { name: b.name ?? s.name, role: b.role ?? s.role, quote: b.quote ?? s.text, order: Math.floor(max?.m ?? 0) + 1, hidden: false });
    if (!c.ok) return fail(422, 'יש שדות שצריך לתקן', { issues: c.issues });
    const tid = newId();
    await saveEntry(db, 'testimonials', tid, c.data, by);
    await db.prepare(`UPDATE submissions SET status = 'approved', testimonial_id = ?2, decided_at = ?3, decided_by = ?4 WHERE id = ?1`).bind(id, tid, now, by).run();
    return json({ ok: true, testimonial: tid });
  }
  if (b.action === 'reject' || b.action === 'restore') {
    await db.prepare(`UPDATE submissions SET status = ?2, decided_at = ?3, decided_by = ?4 WHERE id = ?1`).bind(id, b.action === 'reject' ? 'rejected' : 'pending', now, by).run();
    return json({ ok: true });
  }
  if (b.action === 'delete' && s.status === 'rejected') {
    await db.prepare(`DELETE FROM submissions WHERE id = ?1`).bind(id).run();
    return json({ ok: true });
  }
  return fail(400, 'פעולה לא מוכרת');
};
