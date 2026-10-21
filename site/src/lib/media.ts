// The responsive images (/m/<id>-<width>.webp), served from R2. A file name never changes its content (a new upload
// gets a new id), so browsers and Cloudflare's edge may keep them for a year. Called from the middleware for /m/*.
import { env } from 'cloudflare:workers';

const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };

export async function serveVariant(file: string, request: Request, waitUntil: (p: Promise<unknown>) => void): Promise<Response> {
  const ext = file.match(/^[\w-]{1,80}\.(webp|jpg|png)$/)?.[1];
  if (!ext || (request.method !== 'GET' && request.method !== 'HEAD')) return new Response('not found', { status: 404 });
  // Cloudflare's edge cache (active on a custom domain; a no-op on *.workers.dev, where the browser cache does the work)
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(new URL(request.url).origin + '/m/' + file);
  if (cache && request.method === 'GET') {
    const hit = await cache.match(cacheKey);
    if (hit) return request.headers.get('if-none-match') === hit.headers.get('etag') ? new Response(null, { status: 304, headers: hit.headers }) : hit;
  }
  const obj = await env.MEDIA.get(`m/${file}`, { onlyIf: request.headers });
  if (!obj) return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const headers = new Headers({
    'content-type': obj.httpMetadata?.contentType || TYPES[ext],
    'cache-control': 'public, max-age=31536000, immutable',
    etag: obj.httpEtag,
    'x-content-type-options': 'nosniff',
  });
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });
  if (request.method === 'HEAD') return new Response(null, { headers });
  const res = new Response(obj.body, { headers });
  if (cache) waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
