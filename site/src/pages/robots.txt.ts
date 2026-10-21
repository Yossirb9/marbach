import type { APIRoute } from 'astro';
import { settings, withBase } from '../lib/data';

// noindex until the owner approves going live (settings.noindex)
export const GET: APIRoute = ({ site }) => new Response(settings.noindex
  ? 'User-agent: *\nDisallow: /\n'
  : `User-agent: *\nAllow: /\nSitemap: ${new URL(withBase('/sitemap.xml'), site).href}\n`, { headers: { 'content-type': 'text/plain' } });
