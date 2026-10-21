// Where a document shows on the public site (the "view on the site" link and the preview in the admin).
import { withBase } from './data';

export const SINGLETON_PATH: Record<string, string> = {
  home: '/', lectures: '/lectures/', book: '/kolot-paamonim/', video: '/video/', writing: '/writing/', about: '/about/',
  contact: '/contact/', recommend: '/recommend/', accessibility: '/accessibility/', settings: '/', layout: '/',
};
export const COLLECTION_PATH: Record<string, string> = { talks: '/lectures/', videos: '/video/', testimonials: '/', articles: '/writing/' };

export function publicPath(kind: 'singleton' | 'entry', ref: string, data?: Record<string, unknown>) {
  if (kind === 'singleton') return withBase(SINGLETON_PATH[ref] ?? '/');
  const c = ref.split('/')[0];
  if (c === 'articles' && data && typeof data.slug === 'string' && /^[a-z0-9-]+$/.test(data.slug)) return withBase(`/writing/${data.slug}/`);
  return withBase(COLLECTION_PATH[c] ?? '/');
}
