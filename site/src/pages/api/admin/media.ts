// The media library. The browser converts an upload to WebP (JPEG where the browser cannot write WebP, e.g. Safari) in
// the same widths the site always used (360/720/1200/1800, never wider than the original) and sends them here with the
// original; they go to R2 under a new random id, so every file name is immutable. An image that is still used somewhere
// (a page, an entry, or the site's own templates) cannot be deleted.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, who } from '../../../lib/api';
import { newId } from '../../../lib/content';

const MAX_VARIANT = 6 << 20, MAX_ORIGINAL = 15 << 20;
// images the templates use directly (decorations, the default photos); grep "/media/" in src to update
const BUILT_IN = new Set(['art/bell_only.png', 'art/bells_cluster.png', 'art/book.png', 'art/iceberg.png', 'art/lectern.png', 'art/letter.png',
  'art/og-plate.jpg', 'art/orchid.png', 'art/ripples.png', 'articles/testimonials.jpg', 'book/growing-the-orchids.jpg',
  'photos/ofer-tedx-letters.jpg', 'photos/ofer-tedx-stage.jpg']);

function sniff(b: Uint8Array): { ext: string; type: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (String.fromCharCode(...b.slice(0, 4)) === 'GIF8') return { ext: 'gif', type: 'image/gif' };
  return null;
}

export const GET: APIRoute = async () => {
  const r = await env.DB.prepare(`SELECT rel, id, w, h, variants, full, name, bytes, created_at, created_by FROM media ORDER BY created_at DESC, rel`).all();
  return json({ ok: true, items: r.results.map((m) => ({ ...m, variants: JSON.parse(String(m.variants)), builtIn: BUILT_IN.has(String(m.rel)) })) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  let form: FormData;
  try { form = await request.formData(); } catch { return fail(400, 'ההעלאה נכשלה'); }
  const meta = (() => { try { return JSON.parse(String(form.get('meta') || '')); } catch { return null; } })() as { name?: string; w?: number; h?: number } | null;
  const w = Math.round(Number(meta?.w)), h = Math.round(Number(meta?.h));
  if (!meta || !(w > 0 && w <= 20000 && h > 0 && h <= 20000)) return fail(400, 'פרטי התמונה חסרים');
  const variants: { w: number; bytes: Uint8Array; ext: string; type: string }[] = [];
  for (const [k, v] of form.entries()) {
    const m = k.match(/^v(\d{2,4})$/);
    if (!m || typeof v === 'string') continue;
    if (v.size > MAX_VARIANT) return fail(413, 'התמונה גדולה מדי');
    const bytes = new Uint8Array(await v.arrayBuffer());
    const t = sniff(bytes);
    if (!t || (t.ext !== 'webp' && t.ext !== 'jpg')) return fail(415, 'סוג קובץ לא נתמך');
    variants.push({ w: Number(m[1]), bytes, ...t });
  }
  if (!variants.length || variants.length > 6) return fail(400, 'לא התקבלו גדלים של התמונה');
  variants.sort((a, b) => a.w - b.w);
  const orig = form.get('original');
  let original: { bytes: Uint8Array; ext: string; type: string } | null = null;
  if (orig && typeof orig !== 'string' && orig.size <= MAX_ORIGINAL) {
    const bytes = new Uint8Array(await orig.arrayBuffer());
    const t = sniff(bytes);
    if (t) original = { bytes, ...t };
  }
  const id = newId().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  const rel = `uploads/${month}/${id}.${original?.ext ?? variants[0].ext}`;
  const list = variants.map((v) => ({ w: v.w, src: `/m/${id}-${v.w}.${v.ext}` }));
  await Promise.all([
    ...variants.map((v) => env.MEDIA.put(`m/${id}-${v.w}.${v.ext}`, v.bytes, { httpMetadata: { contentType: v.type } })),
    original ? env.MEDIA.put(`media/${rel}`, original.bytes, { httpMetadata: { contentType: original.type } }) : Promise.resolve(),
  ]);
  const name = String(meta.name || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 120);
  await env.DB.prepare(`INSERT INTO media (rel, id, w, h, variants, full, name, bytes, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(rel, id, w, h, JSON.stringify(list), list.at(-1)!.src, name, original?.bytes.length ?? null, Date.now(), who(locals.user)).run();
  return json({ ok: true, item: { rel, id, w, h, variants: list, full: list.at(-1)!.src, name, builtIn: false } });
};

export const DELETE: APIRoute = async ({ url }) => {
  const rel = url.searchParams.get('rel') || '';
  const db = env.DB;
  const m = await db.prepare(`SELECT rel, variants FROM media WHERE rel = ?1`).bind(rel).first<{ rel: string; variants: string }>();
  if (!m) return fail(404, 'התמונה לא נמצאה');
  if (BUILT_IN.has(rel)) return fail(409, 'התמונה הזאת היא חלק מהעיצוב של האתר ואי אפשר למחוק אותה.');
  const needle = `media/${rel}`;
  const used = await db.prepare(`SELECT 'page' AS kind, id FROM singletons WHERE instr(data, ?1) > 0
    UNION ALL SELECT collection AS kind, id FROM entries WHERE instr(data, ?1) > 0 LIMIT 10`).bind(needle).all<{ kind: string; id: string }>();
  if (used.results.length) return fail(409, 'התמונה בשימוש, ולכן לא נמחקה. קודם מחליפים אותה במקומות האלה:', { usedIn: used.results });
  const keys = (JSON.parse(m.variants) as { src: string }[]).map((v) => v.src.replace(/^\//, ''));
  await env.MEDIA.delete([...keys, `media/${rel}`]);
  await db.prepare(`DELETE FROM media WHERE rel = ?1`).bind(rel).run();
  return json({ ok: true });
};
