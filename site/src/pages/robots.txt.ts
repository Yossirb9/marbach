import type { APIRoute } from 'astro';
import { useData, withBase, siteOrigin } from '../lib/data';

// noindex until the owner approves going live (settings.noindex); the admin is never indexed
export const GET: APIRoute = (ctx) => {
  const { settings } = useData(ctx.locals);
  return new Response(settings.noindex
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nDisallow: ${withBase('/admin/')}\nDisallow: ${withBase('/api/')}\nSitemap: ${new URL(withBase('/sitemap.xml'), siteOrigin(ctx)).href}\n`, { headers: { 'content-type': 'text/plain' } });
};
