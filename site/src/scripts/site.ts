// Site behaviour: smooth scroll (Lenis) + GSAP ScrollTrigger (the bell scene, layered parallax, reveals), the menu,
// YouTube facades and the contact form (mailto). Under prefers-reduced-motion: no Lenis, no pin, no parallax.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { initBellScene } from './bell';

gsap.registerPlugin(ScrollTrigger);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as T[];

// ---------- smooth scroll ----------
let lenis: Lenis | null = null;
if (!reduce) {
  lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
(window as unknown as { __lenis?: Lenis | null }).__lenis = lenis;
// in-page anchors go through Lenis too (so the pinned scene's spacer is respected)
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!a || !lenis) return;
  const id = a.getAttribute('href')!.slice(1);
  const el = id && document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  lenis.scrollTo(el, { offset: -80 });
});

// ---------- header: hide on scroll down, show on scroll up ----------
const header = $('[data-header]');
let lastY = scrollY;
addEventListener('scroll', () => {
  const y = scrollY;
  if (y < 240) { header?.classList.remove('hide'); lastY = y; return; }
  // while the bell scene is pinned the header keeps its state (set by bell.ts through html.scene-pinned)
  if (document.documentElement.classList.contains('scene-pinned') || document.body.classList.contains('menu-open')) { lastY = y; return; }
  if (y > lastY + 24) { header?.classList.add('hide'); lastY = y; }
  else if (y < lastY - 24) { header?.classList.remove('hide'); lastY = y; }
}, { passive: true });

// ---------- mobile menu ----------
const burger = $<HTMLButtonElement>('[data-burger]'), nav = $('[data-nav]');
const setMenu = (open: boolean) => {
  burger?.setAttribute('aria-expanded', String(open));
  nav?.classList.toggle('open', open);
  document.body.classList.toggle('menu-open', open);
  header?.classList.remove('hide');
  if (open) { lenis?.stop(); requestAnimationFrame(() => $<HTMLAnchorElement>('a', nav!)?.focus()); } else lenis?.start();
};
burger?.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav?.classList.contains('open')) { setMenu(false); burger?.focus(); } });
nav?.addEventListener('click', (e) => { if ((e.target as Element).closest('a')) setMenu(false); });
matchMedia('(min-width: 1101px)').addEventListener('change', (m) => { if (m.matches) setMenu(false); });

// ---------- the bell scene ----------
const scene = $('[data-bell-scene]');
if (scene && !reduce) initBellScene(scene);

// ---------- reveals + layered parallax ----------
if (!reduce) {
  // reveals: CSS (html.js) hides [data-reveal]; adding .in plays a CSS transition (opacity + transform)
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { (en.target as HTMLElement).classList.add('in'); io.unobserve(en.target); }
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  $$('[data-reveal]').forEach((el) => io.observe(el));
  // parallax: data-speed="0.2" moves the layer against the scroll by that fraction; negative = with the scroll.
  // Several layers with different speeds in one section give the depth.
  $$('[data-speed]').forEach((el) => {
    const s = parseFloat(el.dataset.speed || '0.1');
    const trigger = el.closest('[data-parallax]') || el.parentElement || el;
    gsap.fromTo(el, { yPercent: s * 60 }, { yPercent: -s * 60, ease: 'none', scrollTrigger: { trigger, start: 'top bottom', end: 'bottom top', scrub: true } });
  });
  // hero: the layers drift apart as the page leaves the first screen
  const hero = $('[data-hero]');
  if (hero) {
    $$('[data-depth]', hero).forEach((el) => {
      const d = parseFloat(el.dataset.depth || '0.2');
      gsap.to(el, { y: () => innerHeight * d, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } });
    });
  }
} else {
  $$('[data-reveal]').forEach((el) => el.classList.add('in'));
}
addEventListener('load', () => ScrollTrigger.refresh());

// ---------- YouTube facades ----------
$$('[data-yt]').forEach((box) => {
  $('button', box)?.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${box.dataset.yt}?autoplay=1&rel=0`;
    f.title = box.dataset.title || 'YouTube';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.allowFullscreen = true;
    box.replaceChildren(f);
    f.focus();
  });
});

// ---------- contact form: opens the visitor's mail app with the request already written ----------
$$<HTMLFormElement>('form[data-contact]').forEach((form) => {
  const err = $('[data-form-error]', form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      const bad = $$<HTMLInputElement>('[name]', form).find((el) => !el.checkValidity());
      if (err) err.textContent = bad ? `נא למלא: ${bad.dataset.label || bad.name}` : 'נא לבדוק את הטופס';
      bad?.focus();
      return;
    }
    if (err) err.textContent = '';
    const data = new FormData(form);
    const parts: string[] = [];
    for (const el of $$<HTMLInputElement>('[name]', form)) {
      const v = String(data.get(el.name) || '').trim();
      if (v) parts.push(`${el.dataset.label || el.name}: ${v}`);
    }
    const topic = String(data.get('topic') || '').trim();
    const subject = topic ? `פנייה מהאתר: ${topic}` : 'פנייה מהאתר';
    const url = `mailto:${form.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(parts.join('\n'))}`;
    (window as unknown as { __lastMailto?: string }).__lastMailto = url; // read by the QA script (mailto never hits the network)
    location.href = url;
  });
});

// ---------- "כתבו המלצה": the recommendation goes to Ofer on WhatsApp (or in an email), already written ----------
// No backend and no form service: nothing is stored. Ofer publishes it himself in the CMS (המלצות).
$$<HTMLFormElement>('form[data-recommend]').forEach((form) => {
  const err = $('[data-form-error]', form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const via = ((e as SubmitEvent).submitter as HTMLElement | null)?.dataset.send === 'mail' ? 'mail' : 'wa';
    if (!form.checkValidity()) {
      const bad = $$<HTMLInputElement>('[name]', form).find((el) => !el.checkValidity());
      if (err) err.textContent = bad ? `נא למלא: ${bad.dataset.label || bad.name}` : 'נא לבדוק את הטופס';
      bad?.focus();
      return;
    }
    if (err) err.textContent = '';
    const val = (name: string) => String(new FormData(form).get(name) || '').trim();
    const label = (name: string) => $<HTMLInputElement>(`[name="${name}"]`, form)?.dataset.label || name;
    const consent = $<HTMLInputElement>('[name="consent"]', form)?.checked;
    const lines = [form.dataset.intro || '', '', val('text'), '', `${label('name')}: ${val('name')}`];
    if (val('role')) lines.push(`${label('role')}: ${val('role')}`);
    lines.push(`${label('consent')}: ${consent ? 'כן' : 'לא'}`);
    const text = lines.join('\n').replace(/^\n+/, '');
    const url = via === 'wa'
      ? `${form.dataset.wa}?text=${encodeURIComponent(text)}`
      : `mailto:${form.dataset.email}?subject=${encodeURIComponent(form.dataset.subject || 'המלצה')}&body=${encodeURIComponent(text)}`;
    (window as unknown as { __lastRecommend?: string }).__lastRecommend = url; // read by the QA script
    // (window.open with 'noopener' always returns null, so the opener is cut by hand)
    if (via === 'wa') { const w = window.open(url, '_blank'); if (w) w.opener = null; else location.href = url; }
    else location.href = url;
  });
});
