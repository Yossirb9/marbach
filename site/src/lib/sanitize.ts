// Rich text (articles, the accessibility statement) is HTML written in the admin's editor. It is cleaned here on every
// save and again on every render: only the tags the editor produces survive, links only to web/mail/phone addresses,
// images only from the site's own media library. Scripts, styles, event handlers, iframes and the like are removed.
import xss from 'xss';

// (a CommonJS package: the default import works in the Worker bundle and in Node alike)
const { FilterXSS, escapeAttrValue } = xss;

const TAGS: Record<string, string[]> = {
  p: [], br: [], strong: [], b: [], em: [], i: [], u: [], s: [], sub: [], sup: [],
  h2: [], h3: [], h4: [], ul: [], ol: ['start'], li: [], blockquote: [], hr: [],
  a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height', 'title'], figure: [], figcaption: [],
};
const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;
const SAFE_SRC = /^\/?(?:media|m)\/[\w\-./]+$/;
// control characters and spaces hidden inside a URL ("java\tscript:") are removed before it is checked
const CTRL = /[\u0000- \u007f-\u009f]+/g;

const filter = new FilterXSS({
  whiteList: TAGS,
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'textarea', 'select', 'form'],
  allowCommentTag: false,
  css: false,
  // every allowed attribute is checked here; returning '' drops it
  onTagAttr(_tag, name, value, isWhite) {
    if (!isWhite) return '';
    const v = value.replace(CTRL, '');
    let out = '';
    if (name === 'href') out = SAFE_HREF.test(v) ? escapeAttrValue(v) : '';
    else if (name === 'src') out = SAFE_SRC.test(v) ? escapeAttrValue(v) : '';
    else if (name === 'target') out = v === '_blank' ? '_blank' : '';
    else if (name === 'rel') out = 'noopener';
    else if (name === 'width' || name === 'height' || name === 'start') out = /^\d{1,5}$/.test(v) ? v : '';
    else out = escapeAttrValue(value);
    return out ? `${name}="${out}"` : '';
  },
});

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  let out = filter.process(html);
  // an <img> without a src (it pointed outside the library) is useless; a link opened in a new tab gets rel=noopener
  out = out.replace(/<img\b(?![^>]*\ssrc=)[^>]*>/gi, '');
  out = out.replace(/<a\b([^>]*\starget="_blank"[^>]*)>/gi, (t, attrs: string) => (/\srel=/.test(attrs) ? t : `<a${attrs} rel="noopener">`));
  return out;
}
