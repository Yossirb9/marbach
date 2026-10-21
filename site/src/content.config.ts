// The site's content: plain JSON files in src/content/, edited through Pages CMS (/.pages.yml at the repo root).
// This file is the source of truth for what a valid entry looks like: a CMS save that breaks it fails the build and
// the live site stays on the previous version. Pages CMS drops empty values when it saves (empty strings, empty lists,
// empty objects all disappear from the file), so everything that may be left empty is optional with a default, and the
// templates skip an element whose text is empty (lesson from the Zohar Aviv and Shahar Mor sites).
// Every text on the site lives here, page by page: each page has its own JSON file and its own schema below.
import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

const str = z.string().trim();
const txt = str.default('');
const opt = str.optional();
const html = z.string().default('');
const num = z.coerce.number();
const media = str.refine((v) => /^\/?media\//.test(v), 'תמונה צריכה להיות מספריית המדיה (/media/…)');
const date = str.regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך בפורמט 2026-10-17');
// the CMS accepts a pasted YouTube link or the bare 11-character id; the site keeps the id
const ytId = (v: string) => v.match(/(?:[?&]v=|youtu\.be\/|\/(?:shorts|embed|live)\/)([\w-]{11})/)?.[1] ?? v;
const youtubeId = str.transform(ytId).pipe(z.string().regex(/^[\w-]{11}$/, 'מזהה יוטיוב: 11 תווים מהקישור (watch?v=…)'));
const texts = z.array(str).default([]);
/** a section object; when the CMS drops it entirely (all fields empty) it still parses */
const section = <T extends z.ZodRawShape>(shape: T) => z.object(shape).prefault({});
const stat = z.object({ value: txt, label: txt });
const audience = z.enum(['staff', 'principals', 'parents', 'all']);
const seo = { seoTitle: opt, seoDescription: opt, note: opt };

// הרצאות וסדנאות: one entry per topic / audience
const talks = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/talks' }),
  schema: z.object({
    title: str.min(1),
    audience,
    order: num.optional(),
    summary: txt,
    topics: texts,
    format: txt,
    quote: opt,
    quoteSource: opt,
    art: media.optional(),
    sources: z.array(z.object({ label: str, url: z.url() })).default([]),
  }),
});

// מאמרים ומחשבות: posts Dr. Marbach published (Facebook) or writes for the site
const articles = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/articles' }),
  schema: z.object({
    title: str.min(1),
    slug: str.regex(/^[a-z0-9-]+$/),
    date,
    draft: z.boolean().default(false),
    dateApprox: z.boolean().default(false),
    excerpt: txt,
    body: html,
    image: media.optional(),
    imageAlt: txt,
    sourceUrl: z.url().optional(),
    sourceLabel: str.default('פייסבוק'),
    truncated: z.boolean().default(false),
  }),
});

const videos = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/videos' }),
  schema: z.object({
    title: str.min(1),
    youtube: youtubeId,
    kind: z.enum(['talk', 'lecture']),
    order: num.optional(),
    featured: z.boolean().default(false),
    poster: media.optional(),
    date: date.optional(),
    duration: opt,
    channel: opt,
    description: txt,
  }),
});

// המלצות: a quote, a video, or both. Shown on the home page, the lectures page, "קולות פעמונים" (quotes) and the
// video page (videos), unless hidden.
const testimonials = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/testimonials' }),
  schema: z.object({
    name: str.min(1),
    role: txt,
    quote: txt,
    youtube: youtubeId.optional(),
    poster: media.optional(),
    order: num.optional(),
    hidden: z.boolean().default(false),
  }),
});

// ---------- the fixed pages: src/content/pages/<id>.json, one schema each ----------
const pageFile = <T extends z.ZodRawShape>(id: string, shape: T) => defineCollection({
  loader: file(`./src/content/pages/${id}.json`, { parser: (text) => ({ [id]: JSON.parse(text) }) }),
  schema: z.object({ title: str.min(1), kicker: txt, intro: txt, ...seo, ...shape }),
});

const home = pageFile('home', {
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

const book = pageFile('book', {
  book: section({ nav: txt, kicker: txt, title: txt, lead: txt, paragraphs: texts, image: media.default('/media/book/growing-the-orchids.jpg'),
    imageAlt: txt, imageCaption: txt, buttonHe: txt, buttonEn: txt }),
  sentences: section({ kicker: txt, items: z.array(z.object({ says: txt, answer: txt })).default([]) }),
  course: section({ nav: txt, kicker: txt, title: txt, lead: txt, paragraphs: texts, stats: z.array(stat).default([]), who: txt,
    steps: z.array(z.object({ title: txt, text: txt })).default([]), lessonsTitle: txt, lessons: texts, button: txt, videosLink: txt }),
  club: section({ nav: txt, kicker: txt, title: txt, text: txt }),
  contactTitle: opt,
  contactText: opt,
});

const lectures = pageFile('lectures', {
  tracks: z.array(z.object({ audience: z.enum(['staff', 'principals', 'parents']), title: txt, lead: txt })).default([]),
  testimonials: section({ kicker: txt, title: txt, writeLink: txt }),
  contactTitle: opt,
  contactText: opt,
});

const video = pageFile('video', {
  tedx: section({ kicker: txt, durationNote: txt }),
  lectures: section({ kicker: txt, title: txt }),
  voices: section({ kicker: txt, title: txt, youtubeLink: txt }),
  press: section({ kicker: txt, title: txt, items: z.array(z.object({ title: txt, text: txt, url: z.url() })).default([]) }),
});

const about = pageFile('about', {
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
  field: section({ kicker: txt, title: txt, image: media.optional(), imageAlt: txt }),
});

const contact = pageFile('contact', {
  form: section({ name: txt, org: txt, phone: txt, email: txt, topic: txt, topics: texts, message: txt, messagePlaceholder: txt, button: txt, note: txt }),
  direct: section({ title: txt, whatsapp: txt, facebook: txt }),
  recommend: section({ text: txt, link: txt }),
});

const writing = pageFile('writing', {
  facebookNote: txt,
  facebookButton: txt,
  article: section({ approx: txt, newer: txt, older: txt }),
});

const recommend = pageFile('recommend', {
  form: section({ name: txt, role: txt, rolePlaceholder: txt, text: txt, consent: txt, whatsappButton: txt, mailButton: txt, note: txt,
    messageIntro: txt, mailSubject: txt }),
});

const accessibility = pageFile('accessibility', { body: html });

const settings = defineCollection({
  loader: file('./src/content/settings.json', { parser: (text) => ({ settings: JSON.parse(text) }) }),
  schema: z.object({
    siteName: str,
    siteTagline: txt,
    role: txt,
    phone: str.regex(/^0\d{1,2}-?\d{3}-?\d{4}$/, 'מספר טלפון ישראלי, למשל 050-313-7261'),
    email: z.email(),
    facebook: z.url().optional(),
    youtube: z.url().optional(),
    courseUrl: z.url(),
    bookUrlHe: z.url().optional(),
    bookUrlEn: z.url().optional(),
    podcastUrl: z.url().optional(),
    noindex: z.boolean().default(true),
  }),
});

// menu, header, footer, the "contact" band at the bottom of pages, the 404 page
const PAGE_LINKS = ['/', '/lectures/', '/kolot-paamonim/', '/video/', '/writing/', '/about/', '/contact/', '/recommend/', '/accessibility/'] as const;
const layout = defineCollection({
  loader: file('./src/content/layout.json', { parser: (text) => ({ layout: JSON.parse(text) }) }),
  schema: z.object({
    menu: z.array(z.object({ link: z.enum(PAGE_LINKS), label: str.min(1), note: txt })).default([]),
    header: section({ button: txt, menuTitle: txt, menuWhatsapp: txt, menuPhone: txt, menuEmail: txt }),
    footer: section({ text: txt, pagesTitle: txt, contactTitle: txt, whatsapp: txt, form: txt, course: txt, recommend: txt, copyright: txt, accessibility: txt }),
    contactBand: section({ kicker: txt, title: txt, text: txt, whatsapp: txt, form: txt }),
    whatsappMessage: txt,
    notFound: section({ pageTitle: txt, kicker: txt, title: txt, text: txt, button: txt }),
  }),
});

export const collections = { talks, articles, videos, testimonials, settings, layout, home, book, lectures, video, about, contact, writing, recommend, accessibility };
