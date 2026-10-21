// Every request passes here.
// - Public pages: served from the HTML cache in D1 when it holds this page for the current content version (one D1
//   query); otherwise rendered from the content snapshot and stored. Every save bumps the version and empties the
//   cache, so a change is on the site at once. Browsers revalidate with the version as ETag (304 when nothing changed).
// - ?preview=<id> (admin only): the page rendered with the unsaved changes from the editor, never cached.
// - /admin and /api/admin: a valid session is required (except the login itself); every state-changing request must come
//   from our own origin and carry the session's CSRF token. Never indexed, never cached.
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { getVersion, loadSnapshot } from './lib/content';
import { siteData, type Snapshot } from './lib/data';
import { SINGLETONS, COLLECTIONS, isCollection, isSingleton } from './lib/schema';
import { getSession, sameOrigin, safeEqual } from './lib/auth';
import { serveVariant } from './lib/media';

const ADMIN_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://i.ytimg.com",
    "font-src 'self'", "connect-src 'self'", "frame-src 'self'", "frame-ancestors 'none'", "form-action 'self'", "base-uri 'none'", "object-src 'none'",
  ].join('; '),
};
const PUBLIC_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};
// this deploy's id (set at build time in astro.config.mjs): pages rendered by an older deploy are not served
const BUILD: string = import.meta.env.BUILD_ID || 'dev';
const CACHEABLE = /^(text\/html|application\/xml|text\/plain)/;
const OPEN_ADMIN = new Set(['/admin/login/', '/api/admin/login/', '/api/admin/login']);

const withHeaders = (res: Response, h: Record<string, string>) => {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(h)) out.headers.set(k, v);
  return out;
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...ADMIN_HEADERS } });

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { url, request } = ctx;
  const path = url.pathname;
  const db = env.DB;
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const rel = '/' + path.slice(base.length).replace(/^\/+/, '');

  // ---------- images from R2 ----------
  if (rel.startsWith('/m/')) return serveVariant(rel.slice(3), request, (p) => ctx.locals.cfContext.waitUntil(p));
  // an image inserted into rich text points at /media/<path> (the original, which is not published): the editor and old
  // links get the large variant instead
  if (rel.startsWith('/media/')) {
    const m = await db.prepare(`SELECT variants FROM media WHERE rel = ?1`).bind(decodeURIComponent(rel.slice(7))).first<{ variants: string }>();
    if (!m) return new Response('not found', { status: 404 });
    const vs = JSON.parse(m.variants) as { w: number; src: string }[];
    return new Response(null, { status: 302, headers: { Location: base + (vs.find((v) => v.w >= 1200) ?? vs[vs.length - 1]).src.slice(1), 'Cache-Control': 'public, max-age=300' } });
  }
  // the 404 page (rendered for any unknown address, also under /admin and /api) needs the site's texts
  const withSite = async () => { ctx.locals.site ??= siteData(await loadSnapshot(db, await getVersion(db))); };

  // ---------- admin ----------
  if (rel.startsWith('/admin') || rel.startsWith('/api/admin')) {
    const isApi = rel.startsWith('/api/');
    const user = await getSession(db, ctx.cookies);
    ctx.locals.user = user;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (!OPEN_ADMIN.has(rel)) {
      if (!user) {
        if (isApi) return json(401, { error: 'צריך להתחבר מחדש' });
        return withHeaders(ctx.redirect(`${base}admin/login/?next=${encodeURIComponent(path)}`, 303), ADMIN_HEADERS);
      }
      if (unsafe) {
        const token = request.headers.get('x-csrf-token') || '';
        if (!sameOrigin(request, url) || !safeEqual(token, user.csrf)) return json(403, { error: 'הבקשה נחסמה (CSRF). רעננו את העמוד ונסו שוב.' });
      }
    } else if (unsafe && !sameOrigin(request, url)) {
      return json(403, { error: 'הבקשה נחסמה' });
    }
    await withSite();
    return withHeaders(await next(), ADMIN_HEADERS);
  }
  if (rel.startsWith('/api/')) { await withSite(); return next(); }

  // ---------- public pages ----------
  if (request.method !== 'GET' && request.method !== 'HEAD') { await withSite(); return next(); }

  const previewId = url.searchParams.get('preview');
  if (previewId) {
    const user = await getSession(db, ctx.cookies);
    if (!user) return ctx.redirect(`${base}admin/login/`, 303);
    const snap = await previewSnapshot(db, previewId, user.id);
    if (!snap) return new Response('התצוגה המקדימה פגה. לחצו שוב על "תצוגה מקדימה" בעורך.', { status: 410, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    ctx.locals.site = siteData(snap, { drafts: true });
    return withHeaders(await next(), { ...PUBLIC_HEADERS, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'SAMEORIGIN' });
  }

  const row = await db.prepare(`SELECT m.value AS v, c.status, c.ctype, c.body FROM meta m
    LEFT JOIN html_cache c ON c.path = ?1 AND c.version = CAST(m.value AS INTEGER) AND c.build = ?2 WHERE m.key = 'version'`).bind(path, BUILD)
    .first<{ v: string; status: number | null; ctype: string | null; body: string | null }>();
  const version = Number(row?.v ?? 0);
  const etag = `W/"v${version}-${BUILD}"`;
  const headers = { ...PUBLIC_HEADERS, 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: etag, 'X-Cache': 'HIT' };
  if (row?.body != null) {
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : row.body, { status: row.status ?? 200, headers: { ...headers, 'Content-Type': row.ctype ?? 'text/html; charset=utf-8' } });
  }

  ctx.locals.site = siteData(await loadSnapshot(db, version));
  const res = await next();
  let ctype = res.headers.get('content-type') || '';
  if (ctype === 'text/html') ctype = 'text/html; charset=utf-8';
  if (res.status !== 200 || !CACHEABLE.test(ctype)) return withHeaders(res, PUBLIC_HEADERS);
  const body = await res.text();
  // stored only under the version the render was based on (a save in between makes this row simply unused)
  ctx.locals.cfContext.waitUntil(db.prepare(`INSERT INTO html_cache (path, version, status, ctype, body, at, build) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(path) DO UPDATE SET version = excluded.version, status = excluded.status, ctype = excluded.ctype, body = excluded.body, at = excluded.at, build = excluded.build`)
    .bind(path, version, res.status, ctype, body, Date.now(), BUILD).run().catch((e) => console.error('cache write', e)));
  const out = new Response(request.method === 'HEAD' ? null : body, { status: res.status, headers: res.headers });
  for (const [k, v] of Object.entries({ ...headers, 'X-Cache': 'MISS', 'Content-Type': ctype })) out.headers.set(k, v);
  return out;
});

/** the current content with one document replaced by the editor's unsaved version */
async function previewSnapshot(db: D1Database, id: string, userId: number): Promise<Snapshot | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const p = await db.prepare(`SELECT kind, ref, data FROM previews WHERE id = ?1 AND user_id = ?2 AND created_at > ?3`)
    .bind(id, userId, Date.now() - 3600e3).first<{ kind: string; ref: string; data: string }>();
  if (!p) return null;
  const base = await loadSnapshot(db, await getVersion(db));
  const data = JSON.parse(p.data);
  if (p.kind === 'singleton' && isSingleton(p.ref)) {
    const r = SINGLETONS[p.ref].safeParse(data);
    if (!r.success) return null;
    return { ...base, singletons: { ...base.singletons, [p.ref]: r.data } };
  }
  const [c, eid] = p.ref.split('/');
  if (p.kind === 'entry' && isCollection(c)) {
    const r = COLLECTIONS[c].safeParse(data);
    if (!r.success) return null;
    const list = (base[c] as { id: string }[]).filter((e) => e.id !== eid);
    return { ...base, [c]: [...list, { ...r.data, id: eid }] };
  }
  return null;
}
