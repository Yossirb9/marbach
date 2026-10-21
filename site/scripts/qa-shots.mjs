// Full-page screenshots of every page at 390 and 1440 → ../qa/shots/<page>-<width>.png, plus the checks that run on
// every page: console errors, broken images, horizontal overflow, internal links that 404.
// Scrolls through the page first so lazy images load and reveals have fired; the home page's pinned scene is
// captured in its finished state (scrolled past), which is what a full-page shot can show.
// usage: node scripts/qa-shots.mjs [pageName]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const MOTION = !!process.env.MOTION; // MOTION=1: the animated site (pins, parallax) for console/overflow checks; shots go to qa/shots-motion
const OUT = path.resolve(import.meta.dirname, MOTION ? '../../qa/shots-motion' : '../../qa/shots');
fs.mkdirSync(OUT, { recursive: true });
const PAGES = { home: '/', lectures: '/lectures/', book: '/kolot-paamonim/', video: '/video/', writing: '/writing/', article: '/writing/regulation/',
  'article-ynet': '/writing/ynet-cameras/', about: '/about/', contact: '/contact/', recommend: '/recommend/', accessibility: '/accessibility/', '404': '/nope/' };
const only = process.argv[2];
const PORT = 4621;
const server = await serve(path.resolve(import.meta.dirname, '../dist'), PORT);
const browser = await chromium.launch();
const problems = [];
const seenLinks = new Set();
for (const width of [390, 1440]) {
  // reduced motion: the static, final composition (no pin spacer, no hidden reveals); the scene itself is filmed by qa-scroll.mjs
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500, reducedMotion: MOTION ? 'no-preference' : 'reduce' });
  for (const [name, url] of Object.entries(PAGES)) {
    if (only && only !== name) continue;
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/404 \(Not Found\)/.test(m.text()) && errors.push(m.text()));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(`http://localhost:${PORT}`) && !r.url().endsWith('/nope/')) errors.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'networkidle' });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h + 2000; y += 350) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(70); }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1300);
    await page.evaluate(async () => { await Promise.all([...document.images].map((i) => (i.loading = 'eager', i.decode().catch(() => {})))); });
    const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src));
    const overflow = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > W + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.clip,.hero,.bs,.page-hero,.contact-band,[aria-hidden=true],svg'); })
        .slice(0, 5).map((e) => `${e.tagName}.${[...e.classList].join('.')} → ${Math.round(e.getBoundingClientRect().right)}`);
      return { scrollW: document.documentElement.scrollWidth, W, wide };
    });
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.startsWith(location.origin)));
    for (const l of links) if (!l.includes('/nope/')) seenLinks.add(l.split('#')[0]);
    // freeze the header for the stitched full-page shot, then scroll back to the top
    await page.addStyleTag({ content: '.site-header{position:absolute!important}' });
    await page.evaluate(() => { window.__lenis?.scrollTo?.(0, { immediate: true }); window.scrollTo(0, 0); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
    const bad = [...errors, ...broken.map((b) => 'broken image ' + b), ...(overflow.scrollW > overflow.W ? [`horizontal overflow ${overflow.scrollW}>${overflow.W} ${overflow.wide.join(', ')}`] : [])];
    if (bad.length) problems.push(`${name}@${width}: ${bad.join(' | ')}`);
    console.log(name, width, bad.length ? 'PROBLEMS: ' + bad.join(' | ') : 'ok');
    await page.close();
  }
  await ctx.close();
}
// internal links: every one must answer 200
const lp = await browser.newPage();
for (const l of seenLinks) {
  const r = await lp.request.get(l);
  if (r.status() !== 200) { problems.push(`link ${l} → ${r.status()}`); console.log('LINK', l, r.status()); }
}
console.log(`links checked: ${seenLinks.size}`);
await browser.close();
server.close();
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nALL OK');
