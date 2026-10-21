// The media library in the browser: list, upload (converted here to WebP in the site's widths), pick, delete.
import { api, h, toast, dialog, confirmDlg, url } from './ui';

export interface MediaItem { rel: string; id: string; w: number; h: number; variants: { w: number; src: string }[]; full: string; name?: string; builtIn?: boolean; created_at?: number }

let cache: MediaItem[] | null = null;
export async function library(force = false): Promise<MediaItem[]> {
  if (cache && !force) return cache;
  const r = await api('/api/admin/media/');
  cache = r.ok ? (r.items as MediaItem[]) : [];
  return cache;
}
export const relOf = (v: string) => v.replace(/^\/?media\//, '');
export const thumb = (m: MediaItem, w = 360) => url((m.variants.find((v) => v.w >= w) ?? m.variants[m.variants.length - 1]).src);
export const findMedia = (value: string) => (cache ?? []).find((m) => m.rel === relOf(value));

const WIDTHS = [360, 720, 1200, 1800];

async function encode(canvas: HTMLCanvasElement, alpha: boolean): Promise<{ blob: Blob; ext: string }> {
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.78));
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  // browsers that cannot write WebP (Safari): JPEG, on white where the picture was transparent
  if (alpha) {
    const c2 = document.createElement('canvas');
    c2.width = canvas.width; c2.height = canvas.height;
    const x = c2.getContext('2d')!;
    x.fillStyle = '#fff'; x.fillRect(0, 0, c2.width, c2.height); x.drawImage(canvas, 0, 0);
    canvas = c2;
  }
  const jpg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.84));
  if (!jpg) throw new Error('encode');
  return { blob: jpg, ext: 'jpg' };
}

/** one file → the responsive variants, then the upload; returns the new library item */
export async function upload(file: File, onProgress?: (s: string) => void): Promise<MediaItem | null> {
  if (!file.type.startsWith('image/')) { toast(`${file.name}: זה לא קובץ תמונה`, 'error'); return null; }
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { toast(`${file.name}: הדפדפן לא הצליח לפתוח את התמונה. נסו לשמור אותה כ-JPG ולהעלות שוב.`, 'error'); return null; }
  const { width: w, height: hgt } = bmp;
  const widths = WIDTHS.filter((x) => x < w);
  if (!widths.length || w <= WIDTHS[WIDTHS.length - 1]) widths.push(Math.min(w, WIDTHS[WIDTHS.length - 1]));
  const alpha = /png|gif|webp/.test(file.type);
  const form = new FormData();
  form.append('meta', JSON.stringify({ name: file.name, w, h: hgt }));
  for (const vw of [...new Set(widths)]) {
    onProgress?.(`מכינים גודל ${vw}…`);
    const c = document.createElement('canvas');
    c.width = vw; c.height = Math.max(1, Math.round((hgt / w) * vw));
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const { blob, ext } = await encode(c, alpha);
    form.append(`v${vw}`, blob, `${vw}.${ext}`);
  }
  bmp.close();
  if (file.size <= 15 << 20 && /jpe?g|png|webp|gif/.test(file.type)) form.append('original', file, file.name);
  onProgress?.('מעלים…');
  const r = await api('/api/admin/media/', { method: 'POST', body: form });
  if (!r.ok) { toast(`${file.name}: ${r.error || 'ההעלאה נכשלה'}`, 'error'); return null; }
  const item = r.item as MediaItem;
  cache = [item, ...(cache ?? [])];
  return item;
}

export function uploadButton(label: string, onDone: (items: MediaItem[]) => void, multiple = true) {
  const input = h('input', { type: 'file', accept: 'image/*', multiple, class: 'sr-only' }) as HTMLInputElement;
  const status = h('span', { class: 'upload-status muted' });
  const btn = h('label', { class: 'btn btn-primary upload-btn' }, label, input);
  input.addEventListener('change', async () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    const done: MediaItem[] = [];
    btn.classList.add('busy');
    for (const [i, f] of files.entries()) {
      const item = await upload(f, (s) => { status.textContent = `${files.length > 1 ? `${i + 1}/${files.length}: ` : ''}${s}`; });
      if (item) done.push(item);
    }
    btn.classList.remove('busy');
    status.textContent = '';
    if (done.length) toast(done.length > 1 ? `${done.length} תמונות הועלו` : 'התמונה הועלתה');
    onDone(done);
  });
  return h('span', { class: 'upload-wrap' }, btn, status);
}

/** the picker: the library as a grid + upload; resolves with the chosen item or null */
export async function pick(): Promise<MediaItem | null> {
  const items = await library();
  let chosen: MediaItem | null = null;
  const grid = h('div', { class: 'media-grid media-grid-pick' });
  const search = h('input', { type: 'search', class: 'input', placeholder: 'חיפוש לפי שם קובץ' }) as HTMLInputElement;
  let d: HTMLDialogElement;
  const render = () => {
    const q = search.value.trim().toLowerCase();
    grid.replaceChildren(...(cache ?? items).filter((m) => !q || `${m.rel} ${m.name ?? ''}`.toLowerCase().includes(q)).map((m) =>
      h('button', { type: 'button', class: 'media-tile', title: m.name || m.rel, onclick: () => { chosen = m; d.close('ok'); } },
        h('img', { src: thumb(m), alt: '', loading: 'lazy' }), h('span', { text: m.name || m.rel.split('/').pop() }))));
  };
  search.addEventListener('input', render);
  const up = uploadButton('העלאת תמונה חדשה', (done) => { if (done[0]) { chosen = done[0]; d.close('ok'); } }, false);
  render();
  const p = dialog('בחירת תמונה', h('div', { class: 'picker' }, h('div', { class: 'picker-bar' }, up, search), grid), [{ text: 'ביטול', value: '' }]);
  d = document.querySelector('dialog.dlg:last-of-type') as HTMLDialogElement;
  d.classList.add('dlg-wide');
  await p;
  return chosen;
}

/** the media page */
export async function initMediaPage(root: HTMLElement) {
  const grid = h('div', { class: 'media-grid' });
  const count = h('p', { class: 'muted' });
  const render = (items: MediaItem[]) => {
    count.textContent = `${items.length} תמונות בספרייה`;
    grid.replaceChildren(...items.map((m) => {
      const del = h('button', { type: 'button', class: 'btn btn-small btn-danger-ghost', text: 'מחיקה', disabled: m.builtIn, title: m.builtIn ? 'חלק מהעיצוב של האתר' : undefined,
        onclick: async () => {
          if (!(await confirmDlg('מחיקת תמונה', `למחוק את "${m.name || m.rel}"? אי אפשר לבטל את זה.`, 'מחיקה', true))) return;
          const r = await api(`/api/admin/media/?rel=${encodeURIComponent(m.rel)}`, { method: 'DELETE' });
          if (r.ok) { cache = (cache ?? []).filter((x) => x.rel !== m.rel); render(cache); toast('התמונה נמחקה'); return; }
          const used = (r.usedIn as { kind: string; id: string }[] | undefined) ?? [];
          await dialog('התמונה לא נמחקה', h('div', {}, h('p', { text: r.error || 'שגיאה' }),
            used.length ? h('ul', {}, ...used.map((u) => h('li', {}, h('a', { href: u.kind === 'page' ? url(`/admin/edit/${u.id}/`) : url(`/admin/entry/${u.kind}/${u.id}/`), text: `${KIND_HE[u.kind] ?? u.kind}: ${u.id}` })))) : null),
          [{ text: 'סגירה', value: '' }]);
        } });
      return h('figure', { class: 'media-card' },
        h('a', { href: url(m.full), target: '_blank', rel: 'noopener' }, h('img', { src: thumb(m), alt: '', loading: 'lazy' })),
        h('figcaption', {}, h('strong', { text: m.name || m.rel.split('/').pop() }), h('span', { class: 'muted', text: `${m.w}×${m.h}` }), m.builtIn ? h('span', { class: 'badge', text: 'עיצוב האתר' }) : null, del));
    }));
  };
  root.append(h('div', { class: 'toolbar' }, uploadButton('העלאת תמונות', () => render(cache ?? [])), count), grid);
  render(await library());
}

const KIND_HE: Record<string, string> = { page: 'עמוד', articles: 'מאמר', talks: 'הרצאה', videos: 'סרטון', testimonials: 'המלצה' };
