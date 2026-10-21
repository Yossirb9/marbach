import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// The site runs on Cloudflare Workers: every page is rendered on request from the content in D1 (and kept in an HTML
// cache that every save empties, see src/middleware.ts). Images come from R2 (/m/…), the admin lives at /admin.
// SITE_URL (optional, at build time): canonical/OG host; at runtime the SITE_URL var in wrangler.jsonc, else the request's.
// BASE_PATH: the folder the site is served from. Default: the domain root. Every internal URL goes through withBase().
const site = process.env.SITE_URL || undefined;
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site,
  base,
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  // the admin has its own sessions (src/lib/auth.ts, in D1): no Astro sessions, so no KV namespace
  session: false,
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  compressHTML: true,
  security: { checkOrigin: true },
  // a new id for every build: the HTML cache keeps pages per content version AND per deploy
  vite: { define: { 'import.meta.env.BUILD_ID': JSON.stringify(Date.now().toString(36)) } },
});
