// The shape of every piece of content on the site, page by page. The content itself lives in the D1 database
// (tables `singletons` and `entries`, imported once from src/content/* by scripts/seed.mjs) and is edited in /admin.
// Every save from the admin is validated here on the server before it is written; every page render parses the stored
// JSON through the same schema, so defaults apply exactly as they did when these were Astro content collections.
// Everything that may be left empty is optional with a default, and the templates skip an element whose text is empty.
import { z } from 'astro/zod';

const str = z.string().trim();
const txt = str.default('');
const opt = str.optional();
const html = z.string().default('');
const num = z.coerce.number();
// links that end up in href="…": only web addresses (z.url() alone would accept javascript:)
const url = z.url({ protocol: /^https?$/, error: 'קישור מלא, שמתחיל ב-https://' });
const media = str.refine((v) => /^\/?media\//.test(v), 'תמונה צריכה להיות מספריית המדיה (/media/…)');
const date = str.regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך בפורמט 2026-10-17');
// a pasted YouTube link or the bare 11-character id; the site keeps the id
export const ytId = (v: string) => v.match(/(?:[?&]v=|youtu\.be\/|\/(?:shorts|embed|live)\/)([\w-]{11})/)?.[1] ?? v;
const youtubeId = str.transform(ytId).pipe(z.string().regex(/^[\w-]{11}$/, 'מזהה יוטיוב: 11 תווים מהקישור (watch?v=…)'));
const texts = z.array(str).default([]);
/** a section object; when it is missing entirely it still parses */
const section = <T extends z.ZodRawShape>(shape: T) => z.object(shape).prefault({});
const stat = z.object({ value: txt, label: txt });
const audience = z.enum(['staff', 'principals', 'parents', 'all']);
const seo = { seoTitle: opt, seoDescription: opt, note: opt };
/** "" from an emptied form field → undefined, so optional fields stay optional */
const blank = (s: z.ZodType) => z.preprocess((v) => (v === '' || v === null ? undefined : v), s);

// הרצאות וסדנאות: one entry per topic / audience
const talks = z.object({
  title: str.min(1, 'חובה למלא כותרת'),
  audience,
  order: blank(num.optional()),
  summary: txt,
  topics: texts,
  format: txt,
  quote: opt,
  quoteSource: opt,
  art: blank(media.optional()),
  sources: z.array(z.object({ label: str, url })).default([]),
});

// מאמרים ומחשבות
const articles = z.object({
  title: str.min(1, 'חובה למלא כותרת'),
  slug: str.regex(/^[a-z0-9-]+$/, 'כתובת העמוד: רק אותיות באנגלית קטנות, מספרים ומקפים'),
  date,
  draft: z.boolean().default(false),
  dateApprox: z.boolean().default(false),
  excerpt: txt,
  body: html,
  image: blank(media.optional()),
  imageAlt: txt,
  sourceUrl: blank(url.optional()),
  sourceLabel: str.default('פייסבוק'),
  truncated: z.boolean().default(false),
});

const videos = z.object({
  title: str.min(1, 'חובה למלא כותרת'),
  youtube: youtubeId,
  kind: z.enum(['talk', 'lecture']),
  order: blank(num.optional()),
  featured: z.boolean().default(false),
  poster: blank(media.optional()),
  date: blank(date.optional()),
  duration: opt,
  channel: opt,
  description: txt,
});

// המלצות: a quote, a video, or both
const testimonials = z.object({
  name: str.min(1, 'חובה למלא שם'),
  role: txt,
  quote: txt,
  youtube: blank(youtubeId.optional()),
  poster: blank(media.optional()),
  order: blank(num.optional()),
  hidden: z.boolean().default(false),
});

// ---------- the fixed pages, one schema each ----------
const pageSchema = <T extends z.ZodRawShape>(shape: T) => z.object({ title: str.min(1, 'חובה למלא כותרת'), kicker: txt, intro: txt, ...seo, ...shape });

const home = pageSchema({
  heroImage: media.default('/media/photos/ofer-tedx-letters.jpg'),
  heroImageAlt: txt,
  heroButton: txt,
  heroButton2: txt,
  quote: txt,
  quoteBy: txt,
  bell: section({ kicker: txt, intro: txt, lines: texts, title: str.default('קולות פעמונים'), sub: txt, button: txt, link: txt, hint: txt }),
  signals: section({ kicker: txt, title: txt, lead: txt, items: z.array(z.object({ title: txt, sub: txt, text: txt })).default([]), link: txt }),
  about: section({ kicker: txt, title: txt, lead: txt, stats: z.array(stat).default([]), link: txt,
    image: media.default('/media/photos/ofer-tedx-stage.jpg'), imageAlt: txt }),
  tracks: section({ kicker: txt, title: txt, link: txt,
    items: z.array(z.object({ audience: z.enum(['staff', 'principals', 'parents']), title: txt, text: txt, art: media.default('/media/art/bells_cluster.png') })).default([]) }),
  tedx: section({ kicker: txt, title: txt, lead: txt, button: txt }),
  book: section({ kicker: txt, title: txt, lead: txt, text: txt, image: media.default('/media/book/growing-the-orchids.jpg'), imageAlt: txt, button: txt, button2: txt }),
  testimonials: section({ kicker: txt, title: txt, lead: txt, videosLink: txt, writeLink: txt }),
  writing: section({ kicker: txt, title: txt, lead: txt, link: txt }),
});

const book = pageSchema({
  book: section({ nav: txt, kicker: txt, title: txt, lead: txt, paragraphs: texts, image: media.default('/media/book/growing-the-orchids.jpg'),
    imageAlt: txt, imageCaption: txt, buttonHe: txt, buttonEn: txt }),
  sentences: section({ kicker: txt, items: z.array(z.object({ says: txt, answer: txt })).default([]) }),
  course: section({ nav: txt, kicker: txt, title: txt, lead: txt, paragraphs: texts, stats: z.array(stat).default([]), who: txt,
    steps: z.array(z.object({ title: txt, text: txt })).default([]), lessonsTitle: txt, lessons: texts, button: txt, videosLink: txt }),
  club: section({ nav: txt, kicker: txt, title: txt, text: txt }),
  contactTitle: opt,
  contactText: opt,
});

const lectures = pageSchema({
  tracks: z.array(z.object({ audience: z.enum(['staff', 'principals', 'parents']), title: txt, lead: txt })).default([]),
  testimonials: section({ kicker: txt, title: txt, writeLink: txt }),
  contactTitle: opt,
  contactText: opt,
});

const video = pageSchema({
  tedx: section({ kicker: txt, durationNote: txt }),
  lectures: section({ kicker: txt, title: txt }),
  voices: section({ kicker: txt, title: txt, youtubeLink: txt }),
  press: section({ kicker: txt, title: txt, items: z.array(z.object({ title: txt, text: txt, url })).default([]) }),
});

const about = pageSchema({
  story: section({
    title: txt,
    blocks: z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('paragraph'), text: txt }),
      z.object({ type: z.literal('quote'), text: txt, cite: txt }),
    ])).default([]),
    image: media.default('/media/photos/ofer-tedx-stage.jpg'),
    imageAlt: txt,
    button: txt,
  }),
  facts: section({ kicker: txt, title: txt, items: z.array(z.object({ title: txt, text: txt, source: opt })).default([]) }),
  field: section({ kicker: txt, title: txt, image: blank(media.optional()), imageAlt: txt }),
});

const contact = pageSchema({
  form: section({ name: txt, org: txt, phone: txt, email: txt, topic: txt, topics: texts, message: txt, messagePlaceholder: txt, button: txt, note: txt }),
  direct: section({ title: txt, whatsapp: txt, facebook: txt }),
  recommend: section({ text: txt, link: txt }),
});

const writing = pageSchema({
  facebookNote: txt,
  facebookButton: txt,
  article: section({ approx: txt, newer: txt, older: txt }),
});

const recommend = pageSchema({
  form: section({ name: txt, role: txt, rolePlaceholder: txt, text: txt, consent: txt, whatsappButton: txt, mailButton: txt, note: txt,
    messageIntro: txt, mailSubject: txt }),
});

const accessibility = pageSchema({ body: html });

const settings = z.object({
  siteName: str.min(1, 'חובה למלא את שם האתר'),
  siteTagline: txt,
  role: txt,
  phone: str.regex(/^0\d{1,2}-?\d{3}-?\d{4}$/, 'מספר טלפון ישראלי, למשל 050-313-7261'),
  email: z.email('כתובת מייל לא תקינה'),
  facebook: blank(url.optional()),
  youtube: blank(url.optional()),
  courseUrl: url,
  bookUrlHe: blank(url.optional()),
  bookUrlEn: blank(url.optional()),
  podcastUrl: blank(url.optional()),
  noindex: z.boolean().default(true),
});

// menu, header, footer, the "contact" band at the bottom of pages, the 404 page
export const PAGE_LINKS = ['/', '/lectures/', '/kolot-paamonim/', '/video/', '/writing/', '/about/', '/contact/', '/recommend/', '/accessibility/'] as const;
const layout = z.object({
  menu: z.array(z.object({ link: z.enum(PAGE_LINKS), label: str.min(1, 'חובה למלא שם בתפריט'), note: txt })).default([]),
  header: section({ button: txt, menuTitle: txt, menuWhatsapp: txt, menuPhone: txt, menuEmail: txt }),
  footer: section({ text: txt, pagesTitle: txt, contactTitle: txt, whatsapp: txt, form: txt, course: txt, recommend: txt, copyright: txt, accessibility: txt }),
  contactBand: section({ kicker: txt, title: txt, text: txt, whatsapp: txt, form: txt }),
  whatsappMessage: txt,
  notFound: section({ pageTitle: txt, kicker: txt, title: txt, text: txt, button: txt }),
});

/** the fixed documents: the nine pages, the site settings, the menu/header/footer */
export const SINGLETONS = { home, book, lectures, video, about, contact, writing, recommend, accessibility, settings, layout };
/** the lists of entries */
export const COLLECTIONS = { articles, talks, videos, testimonials };
export type SingletonId = keyof typeof SINGLETONS;
export type CollectionId = keyof typeof COLLECTIONS;
export type Singleton<K extends SingletonId> = z.output<(typeof SINGLETONS)[K]>;
export type Entry<K extends CollectionId> = z.output<(typeof COLLECTIONS)[K]>;
export const isSingleton = (k: string): k is SingletonId => Object.hasOwn(SINGLETONS, k);
export const isCollection = (k: string): k is CollectionId => Object.hasOwn(COLLECTIONS, k);

/** zod issues → [{ path: 'bell.lines.0', message }] for the admin form */
export const issues = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path.join('.'), message: hebrew(i) }));
/** zod's own (English) messages → Hebrew; the messages written in this file are Hebrew already */
function hebrew(i: z.core.$ZodIssue): string {
  if (/[֐-׿]/.test(i.message)) return i.message;
  switch (i.code) {
    case 'invalid_type': return 'חובה למלא את השדה';
    case 'invalid_value': return 'יש לבחור אחת מהאפשרויות';
    case 'invalid_format': return 'הערך לא בפורמט הנכון';
    case 'too_small': return 'קצר מדי, או חסר';
    case 'too_big': return 'ארוך מדי';
    default: return 'ערך לא תקין';
  }
}
