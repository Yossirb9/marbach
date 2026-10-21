// Data layer: shapes the content (loaded from D1 for this request by src/lib/content.ts) for the templates.
// Every template gets its data through useData(Astro.locals): the middleware puts the snapshot of the current content
// version there. Same helpers as before (img() for the responsive WebP library, withBase() for BASE_PATH), only the
// source changed: the database instead of the files in src/content.
import { env } from 'cloudflare:workers';
import type { Entry, Singleton, SingletonId } from './schema';
import { sanitizeHtml } from './sanitize';

export interface ImageInfo { id: string; w: number; h: number; variants: { w: number; src: string }[]; full: string }

/** everything stored, already parsed through the schemas (defaults applied) */
export interface Snapshot {
  version: number;
  singletons: { [K in SingletonId]: Singleton<K> };
  articles: (Entry<'articles'> & { id: string })[];
  talks: (Entry<'talks'> & { id: string })[];
  videos: (Entry<'videos'> & { id: string })[];
  testimonials: (Entry<'testimonials'> & { id: string })[];
  images: Record<string, ImageInfo>;
}

/** the folder the site is served from ("/" or e.g. "/marbach/", from BASE_PATH in astro.config.mjs) */
export const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
/** "/contact/" → "/marbach/contact/": every root-relative URL of the site goes through here (external URLs, #, mailto: untouched) */
export const withBase = (p: string) => (p.startsWith('/') && !p.startsWith('//') && !p.startsWith(BASE) ? BASE + p.slice(1) : p);
/** "/media/art/orchid.png" (as the content stores it) → "art/orchid.png" (key of the media library) */
export const mediaRel = (v: string) => v.replace(/^\/?media\//, '');
export const AUDIENCE: Record<string, string> = { staff: 'לצוותי חינוך', principals: 'למנהלים', parents: 'להורים', all: 'למחנכים ולהורים' };
export const articleUrl = (slug: string) => withBase(`/writing/${slug}/`);
export type Video = { title: string; youtube: string; poster?: string; channel?: string; date?: string; duration?: string };
/** a quote without the quotation marks the editor may have typed (the templates add ״…״) */
export const bareQuote = (q: string) => q.trim().replace(/^["״“”'׳]+|["״“”'׳]+$/g, '').trim();
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
/** "2026-10-17" → "17 באוקטובר 2026" */
export const heDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ב${HE_MONTHS[m - 1]} ${y}`; };
export const heMonth = (iso: string) => { const [y, m] = iso.split('-').map(Number); return `${HE_MONTHS[m - 1]} ${y}`; };
/** "" → undefined, so an emptied field drops the element instead of rendering an empty tag */
export const has = (s?: string | null) => !!s && s.trim().length > 0;
/** canonical/OG host: SITE_URL (wrangler var) → the build's site → the host the page was requested on */
export const siteOrigin = (A: { site?: URL; url: URL }) => new URL(env.SITE_URL || A.site?.href || A.url.origin);
/** JSON for <script type="application/ld+json">: "<" escaped, so no text can close the script tag */
export const jsonForScript = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');

const byOrder = <T extends { order?: number }>(a: T, b: T) => (a.order ?? 1e9) - (b.order ?? 1e9);
// a missing image (deleted from the library while still in use) renders as an empty, transparent picture instead of
// breaking the page
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const MISSING: ImageInfo = { id: 'missing', w: 16, h: 9, variants: [{ w: 1, src: BLANK }], full: BLANK };

function build(s: Snapshot, opts: { drafts?: boolean } = {}) {
  const images = s.images;
  function img(src: string, sizes = '(max-width: 760px) 100vw, 720px') {
    const m = images[mediaRel(src)] ?? MISSING;
    const mid = m.variants.find((v) => v.w >= 720) ?? m.variants[m.variants.length - 1];
    return {
      src: withBase(mid.src), srcset: m.variants.map((v) => `${withBase(v.src)} ${v.w}w`).join(', '), sizes,
      width: mid.w, height: Math.round((m.h / m.w) * mid.w), full: withBase(m.full), ratio: m.w / m.h,
      /** smallest variant ≥ w, for posters/backgrounds */
      at: (w: number) => withBase((m.variants.find((v) => v.w >= w) ?? m.variants[m.variants.length - 1]).src),
    };
  }
  const settings = s.singletons.settings;
  const layout = s.singletons.layout;
  const digits = settings.phone.replace(/\D/g, '');
  const CONTACT = {
    phone: settings.phone,
    tel: `tel:+972${digits.replace(/^0/, '')}`,
    whatsapp: (text = layout.whatsappMessage) => `https://wa.me/972${digits.replace(/^0/, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`,
    /** the bare chat link (the recommendation form appends its own ?text=) */
    waBase: `https://wa.me/972${digits.replace(/^0/, '')}`,
    email: settings.email,
    mailto: `mailto:${settings.email}`,
  };
  const talks = [...s.talks].sort(byOrder);
  // drafts are not published (the admin's preview shows them)
  const articles = s.articles.filter((a) => opts.drafts || !a.draft).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const videos = [...s.videos].sort(byOrder);
  const testimonials = s.testimonials.filter((t) => !t.hidden).sort((a, b) => byOrder(a, b) || a.name.localeCompare(b.name, 'he'));
  type Testimonial = (typeof testimonials)[number];
  /** a testimonial with a video, in the shape the YouTube facade takes */
  const testimonialVideo = (t: Testimonial) => ({ title: t.name, youtube: t.youtube!, poster: t.poster, channel: t.role, date: undefined, duration: undefined });
  /** the texts of one fixed page */
  const page = <C extends SingletonId>(id: C) => s.singletons[id];
  /** the menu, in one place (header, mobile nav, footer) */
  const MENU = layout.menu.map((m) => ({ ...m, path: m.link, href: withBase(m.link) }));
  /** "{phone}" and "{email}" in a text are replaced by the details from the settings, so they change everywhere at once */
  const fill = (t: string) => t.replaceAll('{phone}', settings.phone).replaceAll('{email}', settings.email);
  /** rich text: cleaned (sanitize.ts); an image inserted into an article points at the original in /media/ (which is not
   *  published): point it at the WebP variants instead, lazy-loaded and with its real proportions */
  const richHtml = (html: string) => sanitizeHtml(fill(html)).replace(/<img\b([^>]*?)\ssrc="(\/?media\/[^"]+)"([^>]*)>/g, (tag, before: string, src: string, after: string) => {
    if (!images[mediaRel(src)]) return tag;
    const a = img(src, '(max-width: 760px) 100vw, 760px');
    const rest = `${before} ${after}`.replace(/\s(?:srcset|sizes|width|height|loading|decoding)="[^"]*"/g, '').replace(/\s+$/, '');
    return `<img${rest} src="${a.src}" srcset="${a.srcset}" sizes="${a.sizes}" width="${a.width}" height="${a.height}" loading="lazy" decoding="async">`;
  });
  return { version: s.version, settings, layout, CONTACT, talks, articles, videos, testimonials, testimonialVideo, page, MENU, img, richHtml, fill, images };
}

export type SiteData = ReturnType<typeof build>;
const cache = new WeakMap<Snapshot, SiteData>();
const cacheDrafts = new WeakMap<Snapshot, SiteData>();
export function siteData(s: Snapshot, opts: { drafts?: boolean } = {}): SiteData {
  const c = opts.drafts ? cacheDrafts : cache;
  let d = c.get(s);
  if (!d) { d = build(s, opts); c.set(s, d); }
  return d;
}

/** in a template: const { settings, img, … } = useData(Astro.locals) */
export function useData(locals: App.Locals): SiteData {
  if (!locals.site) throw new Error('site data missing (middleware did not run)');
  return locals.site;
}
