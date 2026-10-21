import { defineConfig } from 'astro/config';

// SITE_URL is set at deploy time (canonical/OG URLs); the default is the GitHub Pages preview host.
const site = process.env.SITE_URL || 'https://yossirb9.github.io';
// BASE_PATH: the folder the site is served from (GitHub Pages project site → "/marbach/"). Default: the domain root.
// Every internal URL goes through withBase() in src/lib/data.ts, so links, images and the sitemap follow it.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  compressHTML: true,
});
