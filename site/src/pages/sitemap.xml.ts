import type { APIRoute } from 'astro';
import { useData, withBase, siteOrigin } from '../lib/data';

export const GET: APIRoute = (ctx) => {
  const { articles } = useData(ctx.locals);
  const site = siteOrigin(ctx);
  const PATHS = ['/', '/lectures/', '/kolot-paamonim/', '/video/', '/writing/', '/about/', '/contact/', '/recommend/', '/accessibility/', ...articles.map((a) => `/writing/${a.slug}/`)];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PATHS.map((p) => `<url><loc>${new URL(withBase(p), site).href}</loc></url>`).join('\n')}\n</urlset>\n`,
    { headers: { 'content-type': 'application/xml' } });
};
