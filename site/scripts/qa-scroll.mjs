// The home page's pinned scroll scene ("קולות פעמונים"), at 390, 412x640 and 1440:
//  - frames: the scene at 0%, 10% … 100% of the pinned scroll → ../qa/scroll/<w>-<nn>.png + a contact sheet
//  - checks: pinned; at the first paint (before any script runs) the scene is already in its STARTING state (title
//    letters and lines invisible: the html.js lesson from the Shahar Mor site); at 0% the lines are hidden and the
//    rings are small; at 100% every line, the title, the sub-line and the CTA are visible and inside the viewport, and
//    the title letters are in place; reduced motion shows the final scene with no pin.
//  - the mobile menu at 412x640: opens to the full height under the header and its last item can be reached.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { serve } from './serve.mjs';

const OUT = path.resolve(import.meta.dirname, '../../qa/scroll');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4622;
const server = await serve(path.resolve(import.meta.dirname, '../dist'), PORT);
const browser = await chromium.launch();
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(ok ? 'OK  ' : 'FAIL', name, info); };
const BASE = `http://localhost:${PORT}/`;

for (const vp of [{ w: 390, h: 844, mobile: true }, { w: 412, h: 640, mobile: true }, { w: 1440, h: 900, mobile: false }]) {
  const tag = vp.w === 412 ? '412x640' : String(vp.w);
  // first paint, scripts blocked: the starting state must already be there
  {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile, javaScriptEnabled: true });
    const page = await ctx.newPage();
    await page.route(/\.js$/, (r) => r.abort()); // the module never runs; only the inline html.js line does
    await page.goto(BASE, { waitUntil: 'load' });
    await page.evaluate(() => document.querySelector('[data-bell-scene]').scrollIntoView());
    const st = await page.evaluate(() => ({
      title: Math.max(...[...document.querySelectorAll('[data-bs-ch]')].map((e) => +getComputedStyle(e).opacity)),
      lines: Math.max(...[...document.querySelectorAll('[data-bs-line]')].map((e) => +getComputedStyle(e).opacity)),
      js: document.documentElement.classList.contains('js'),
    }));
    check(`${tag}: first paint shows the STARTING state (no flash of the final scene)`, st.js && st.title === 0 && st.lines === 0, JSON.stringify(st));
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const geo = await page.evaluate(() => {
    const s = document.querySelector('[data-bell-scene]');
    const sp = s.closest('.pin-spacer');
    return { top: (sp || s).getBoundingClientRect().top + scrollY, span: sp ? sp.offsetHeight - innerHeight : 0 };
  });
  check(`${tag}: scene is pinned`, geo.span > vp.h * 1.4, `pinned scroll ${geo.span}px`);
  const frames = [];
  for (let i = 0; i <= 10; i++) {
    const y = Math.round(geo.top + (geo.span * i) / 10);
    await page.evaluate((y) => { window.__lenis ? window.__lenis.scrollTo(y, { immediate: true }) : window.scrollTo(0, y); }, y);
    await page.waitForTimeout(1400); // scrub catch-up
    const f = path.join(OUT, `${tag}-${String(i * 10).padStart(3, '0')}.png`);
    await page.screenshot({ path: f });
    frames.push(f);
    if (i === 0) {
      const s = await page.evaluate(() => ({
        lines: Math.max(...[...document.querySelectorAll('[data-bs-line]')].map((e) => +getComputedStyle(e).opacity)),
        title: Math.max(...[...document.querySelectorAll('[data-bs-ch]')].map((e) => +getComputedStyle(e).opacity)),
      }));
      check(`${tag}: at 0% the lines and the title are not shown yet`, s.lines < 0.05 && s.title < 0.05, JSON.stringify(s));
    }
    if (i === 10) {
      const vis = await page.evaluate(() => [...document.querySelectorAll('[data-bs-line],[data-bs-sub],[data-bs-cta],[data-bs-intro],.bs-title')].map((e) => {
        const r = e.getBoundingClientRect(); return +getComputedStyle(e).opacity > 0.95 && r.bottom <= innerHeight + 1 && r.top >= 0 && r.width > 0 && r.right <= innerWidth + 1 && r.left >= -1;
      }));
      check(`${tag}: at 100% every line, the title, sub-line and CTA are visible and inside the viewport`, vis.every(Boolean), JSON.stringify(vis));
      const placed = await page.evaluate(() => [...document.querySelectorAll('[data-bs-ch]')].every((e) => +getComputedStyle(e).opacity > 0.95 && getComputedStyle(e).transform.replace(/\s/g, '') in { 'none': 1, 'matrix(1,0,0,1,0,0)': 1 }));
      check(`${tag}: at 100% the title letters are gathered in place`, placed);
    }
  }
  check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '));
  // contact sheet
  const thumbs = await Promise.all(frames.map((f) => sharp(f).resize({ width: Math.round(vp.w / 2.5) }).toBuffer()));
  const tw = Math.round(vp.w / 2.5), th = Math.round(vp.h / 2.5), cols = vp.w > 800 ? 4 : 6, rows = Math.ceil(frames.length / cols);
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#ffffff' } })
    .composite(thumbs.map((b, i) => ({ input: b, left: (i % cols) * tw, top: Math.floor(i / cols) * th }))).jpeg({ quality: 80 }).toFile(path.join(OUT, `${tag}-sheet.jpg`));

  // mobile menu (only on the phones)
  if (vp.mobile) {
    await page.evaluate(() => { window.__lenis?.scrollTo?.(0, { immediate: true }); window.scrollTo(0, 0); });
    await page.waitForTimeout(400);
    await page.click('[data-burger]');
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const n = document.querySelector('[data-nav]'); const r = n.getBoundingClientRect(); const h = document.querySelector('[data-header]').getBoundingClientRect();
      n.scrollTop = n.scrollHeight;
      return { top: r.top, bottom: r.bottom, headerBottom: h.bottom, vh: innerHeight, scrollable: n.scrollHeight > n.clientHeight, lenis: n.hasAttribute('data-lenis-prevent') };
    });
    await page.waitForTimeout(300);
    const last = await page.evaluate(() => { const els = document.querySelectorAll('[data-nav] .nav-foot .btn'); const r = els[els.length - 1].getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; });
    await page.screenshot({ path: path.join(OUT, `${tag}-menu.png`) });
    check(`${tag}: menu fills the screen under the header`, Math.abs(m.top - m.headerBottom) < 2 && Math.abs(m.bottom - m.vh) < 2, JSON.stringify(m));
    check(`${tag}: menu has data-lenis-prevent and its last button is reachable`, m.lenis && last.bottom <= last.vh + 1 && last.top >= 0, JSON.stringify(last));
  }
  await ctx.close();
}

// reduced motion: the final scene, no pin
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => ({ pinned: !!document.querySelector('.pin-spacer'),
    vis: [...document.querySelectorAll('[data-bs-line],[data-bs-ch],[data-bs-sub],[data-bs-cta]')].every((e) => +getComputedStyle(e).opacity > 0.95) }));
  await page.evaluate(() => document.querySelector('[data-bell-scene]').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, 'reduced-motion-1440.png') });
  check('reduced motion: no pin, final scene fully visible', !r.pinned && r.vis, JSON.stringify(r));
  await ctx.close();
}
await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} check(s) failed` : `\nall ${results.length} checks passed`);
process.exitCode = bad.length ? 1 : 0;
