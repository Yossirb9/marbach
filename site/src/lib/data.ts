// Data layer: reads the content collections (src/content/, edited in Pages CMS) and shapes them for the templates.
// Same infrastructure as the Shahar Mor site: img() for the responsive WebP library, withBase() for BASE_PATH.
import { getCollection, getEntry } from 'astro:content';
import imagesJson from '../data/images.json';

export interface ImageInfo { id: string; w: number; h: number; variants: { w: number; src: string }[]; full: string }
export const images = imagesJson as Record<string, ImageInfo>;
const fail = (msg: string): never => { throw new Error(msg); };

/** the folder the site is served from ("/" or e.g. "/marbach/", from BASE_PATH in astro.config.mjs) */
export const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
/** "/contact/" → "/marbach/contact/": every root-relative URL of the site goes through here (external URLs, #, mailto: untouched) */
export const withBase = (p: string) => (p.startsWith('/') && !p.startsWith('//') && !p.startsWith(BASE) ? BASE + p.slice(1) : p);

/** "/media/art/orchid.png" (as the CMS writes it) → "art/orchid.png" (key in images.json) */
export const mediaRel = (v: string) => v.replace(/^\/?media\//, '');

export function img(src: string, sizes = '(max-width: 760px) 100vw, 720px') {
  const rel = mediaRel(src);
  const m = images[rel] ?? fail(`image missing from media/: ${rel}`);
  const mid = m.variants.find((v) => v.w >= 720) ?? m.variants[m.variants.length - 1];
  return {
    src: withBase(mid.src), srcset: m.variants.map((v) => `${withBase(v.src)} ${v.w}w`).join(', '), sizes,
    width: mid.w, height: Math.round((m.h / m.w) * mid.w), full: withBase(m.full), ratio: m.w / m.h,
    /** smallest variant ≥ w, for posters/backgrounds */
    at: (w: number) => withBase((m.variants.find((v) => v.w >= w) ?? m.variants[m.variants.length - 1]).src),
  };
}

export const settings = ((await getEntry('settings', 'settings')) ?? fail('src/content/settings.json missing')).data;

export const layout = ((await getEntry('layout', 'layout')) ?? fail('src/content/layout.json missing')).data;

const digits = settings.phone.replace(/\D/g, '');
export const CONTACT = {
  phone: settings.phone,
  tel: `tel:+972${digits.replace(/^0/, '')}`,
  whatsapp: (text = layout.whatsappMessage) => `https://wa.me/972${digits.replace(/^0/, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`,
  /** the bare chat link (the recommendation form appends its own ?text=) */
  waBase: `https://wa.me/972${digits.replace(/^0/, '')}`,
  email: settings.email,
  mailto: `mailto:${settings.email}`,
};

const byOrder = <T extends { data: { order?: number } }>(a: T, b: T) => (a.data.order ?? 1e9) - (b.data.order ?? 1e9);

export const talks = (await getCollection('talks')).sort(byOrder).map((e) => ({ ...e.data, id: e.id }));
export const AUDIENCE: Record<string, string> = { staff: 'לצוותי חינוך', principals: 'למנהלים', parents: 'להורים', all: 'למחנכים ולהורים' };

// drafts ("טיוטה" in the CMS) are not published
export const articles = (await getCollection('articles')).map((e) => e.data).filter((a) => !a.draft).sort((a, b) => b.date.localeCompare(a.date));
export const articleUrl = (slug: string) => withBase(`/writing/${slug}/`);

export const videos = (await getCollection('videos')).sort(byOrder).map((e) => ({ ...e.data, id: e.id }));
export type Video = { title: string; youtube: string; poster?: string; channel?: string; date?: string; duration?: string };

// testimonials ("המלצות"): a quote, a YouTube video, or both
export const testimonials = (await getCollection('testimonials')).filter((e) => !e.data.hidden)
  .sort((a, b) => byOrder(a, b) || a.data.name.localeCompare(b.data.name, 'he')).map((e) => ({ ...e.data, id: e.id }));
export type Testimonial = (typeof testimonials)[number];
/** a quote without the quotation marks the editor may have typed (the templates add ״…״) */
export const bareQuote = (q: string) => q.trim().replace(/^["״“”'׳]+|["״“”'׳]+$/g, '').trim();
/** a testimonial with a video, in the shape the YouTube facade takes */
export const testimonialVideo = (t: Testimonial) => ({ title: t.name, youtube: t.youtube!, poster: t.poster, channel: t.role, date: undefined, duration: undefined });

type PageId = 'home' | 'book' | 'lectures' | 'video' | 'about' | 'contact' | 'writing' | 'recommend' | 'accessibility';
/** the texts of one fixed page (src/content/pages/<id>.json) */
export const page = async <C extends PageId>(id: C) => ((await getEntry(id, id)) ?? fail(`page missing: ${id}`)).data;

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
/** "2026-10-17" → "17 באוקטובר 2026" */
export const heDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ב${HE_MONTHS[m - 1]} ${y}`; };
export const heMonth = (iso: string) => { const [y, m] = iso.split('-').map(Number); return `${HE_MONTHS[m - 1]} ${y}`; };

/** the menu, in one place (header, mobile nav, footer); edited in the CMS under "תפריט, כותרת ותחתית" */
export const MENU = layout.menu.map((m) => ({ ...m, path: m.link, href: withBase(m.link) }));

/** "" → undefined, so an emptied CMS field drops the element instead of rendering an empty tag */
export const has = (s?: string | null) => !!s && s.trim().length > 0;

/** rich text from the CMS: an image inserted into an article points at the original in /media/ (which is not published);
 *  point it at the WebP variants instead, lazy-loaded and with its real proportions */
export const richHtml = (html: string) => html.replace(/<img\b([^>]*?)\ssrc="(\/?media\/[^"]+)"([^>]*)>/g, (tag, before: string, src: string, after: string) => {
  if (!images[mediaRel(src)]) return tag;
  const a = img(src, '(max-width: 760px) 100vw, 760px');
  const rest = `${before} ${after}`.replace(/\s(?:srcset|sizes|width|height|loading|decoding)="[^"]*"/g, '');
  return `<img${rest} src="${a.src}" srcset="${a.srcset}" sizes="${a.sizes}" width="${a.width}" height="${a.height}" loading="lazy" decoding="async">`;
});
