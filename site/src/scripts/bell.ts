// "קולות פעמונים": the pinned, scroll-scrubbed scene of the home page (see components/BellScene.astro).
// CSS holds the final state, html.js CSS the starting state; here gsap.set() repeats that starting state as inline
// styles (identical values, so nothing jumps) and the scroll scrubs towards the final one. transform + opacity only.
// Not called at all under prefers-reduced-motion.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function initBellScene(scene: HTMLElement) {
  const q = <T extends Element = HTMLElement>(s: string) => scene.querySelector(s) as T;
  const qa = (s: string) => [...scene.querySelectorAll<HTMLElement>(s)];
  const bell = q('[data-bs-bell]'), intro = q('[data-bs-intro]'), sub = q('[data-bs-sub]'), cta = q('[data-bs-cta]');
  const hint = q('[data-bs-hint]'), ripples = q('[data-bs-ripples]');
  const lines = qa('[data-bs-line]'), rings = qa('[data-bs-ring]'), chars = qa('[data-bs-ch]');

  const mm = gsap.matchMedia();
  mm.add({ mobile: '(max-width: 860px)', desktop: '(min-width: 861px)' }, (ctx) => {
    const mobile = !!ctx.conditions?.mobile;
    // the same starting state as the html.js CSS, now as inline styles GSAP owns
    gsap.set(rings, { opacity: 0, scale: 0.2, transformOrigin: '50% 50%' });
    gsap.set([intro, ...lines, sub, cta], { opacity: 0, y: 22 });
    chars.forEach((c) => gsap.set(c, { opacity: 0, x: `${c.dataset.x}vw`, y: `${c.dataset.y}vh`, rotate: +(c.dataset.r || 0) }));
    gsap.set(hint, { opacity: 1 });
    gsap.set(ripples, { opacity: 0.12, scale: 0.92 });
    gsap.set(bell, { rotate: 0, transformOrigin: '50% 0%' });

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: scene, start: 'top top', end: mobile ? '+=200%' : '+=300%', pin: true, scrub: mobile ? 0.5 : 0.8, anticipatePin: 1, invalidateOnRefresh: true,
        onToggle: (self) => document.documentElement.classList.toggle('scene-pinned', self.isActive) },
    });
    tl.to(hint, { opacity: 0, duration: 0.25 }, 0)
      .to(intro, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0.05);

    // three strikes: each swings the bell harder, sends a wider wave and writes one louder line
    const swing = [5, 10, 17];
    const peak = [0.55, 0.75, 0.95];
    let t = 0.45;
    lines.forEach((line, i) => {
      tl.to(bell, { rotate: swing[i], duration: 0.22, ease: 'sine.out' }, t)
        .to(bell, { rotate: -swing[i] * 0.7, duration: 0.3, ease: 'sine.inOut' }, t + 0.22)
        .to(bell, { rotate: swing[i] * 0.3, duration: 0.28, ease: 'sine.inOut' }, t + 0.52);
      tl.fromTo(rings[i], { opacity: 0, scale: 0.2 }, { opacity: peak[i], scale: 1.08, duration: 0.6, ease: 'power2.out', immediateRender: false }, t + 0.08)
        .to(rings[i], { opacity: 0.16, scale: 1.0, duration: 0.35, ease: 'sine.inOut' }, t + 0.68);
      tl.to(line, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, t + 0.12);
      t += 1;
    });
    tl.to(ripples, { opacity: 0.32, scale: 1, duration: 1.2 }, 0.4);

    // resolution: the bell stills, the waves settle into even circles, the letters gather into the title
    tl.to(bell, { rotate: 0, duration: 0.5, ease: 'power2.out' }, t)
      .to(rings, { opacity: 0.4, scale: 1, duration: 0.6, ease: 'sine.inOut' }, t);
    chars.forEach((c, i) => {
      tl.to(c, { opacity: 1, x: 0, y: 0, rotate: 0, duration: 0.7, ease: 'power3.out' }, t + 0.05 + i * 0.035);
    });
    t += 0.05 + chars.length * 0.035 + 0.45;
    tl.to(sub, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, t)
      .to(cta, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, t + 0.2)
      .to({}, { duration: 0.6 }); // hold the finished picture before the page scrolls on
  });
  ScrollTrigger.refresh();
}
