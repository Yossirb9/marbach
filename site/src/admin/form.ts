// The form generator: builds an editing form for any document from its field list (src/admin/formspec.json, the labels
// and help texts in Hebrew) and keeps the values in one object. Lists can be added to, deleted from and reordered by
// dragging (or with the arrows, on a phone). Empty fields are left out of the saved document, so the site falls back to
// its defaults exactly as before. The server validates everything again (src/lib/validate.ts).
import Sortable from 'sortablejs';
import { h, confirmDlg } from './ui';
import { richEditor } from './rich';
import { pick, library, findMedia, thumb, relOf } from './media';

export interface Field {
  name: string; label?: string; description?: string; type: string; required?: boolean; default?: unknown;
  list?: boolean | { min?: number; max?: number; summary?: string };
  fields?: Field[]; blocks?: { name: string; label: string; fields: Field[] }[]; blockKey?: string;
  options?: { values: { value: string; label: string }[] };
}
type Path = (string | number)[];
type Obj = Record<string, unknown>;

const isObjType = (f: Field) => f.type === 'object' || f.type === 'block';
const listOpts = (f: Field) => (typeof f.list === 'object' ? f.list : {});

/** a new, empty value for a field (defaults from the spec) */
export function emptyValue(f: Field): unknown {
  if (f.default !== undefined && f.default !== '') return structuredClone(f.default);
  if (f.list) return [];
  if (f.type === 'object') return Object.fromEntries((f.fields ?? []).map((s) => [s.name, emptyValue(s)]).filter(([, v]) => v !== undefined));
  if (f.type === 'boolean') return false;
  if (f.type === 'select' && f.required) return f.options?.values[0]?.value;
  return undefined;
}
const itemValue = (f: Field): unknown => (isObjType(f) ? emptyValue({ ...f, list: undefined }) ?? {} : '');

/** the saved shape: no empty strings, nulls or empty list rows (like the CMS before) */
export function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune).filter((x) => x !== undefined && x !== '');
  if (v && typeof v === 'object') {
    const o: Obj = {};
    for (const [k, x] of Object.entries(v as Obj)) { const p = prune(x); if (p !== undefined && p !== '' && p !== null) o[k] = p; }
    return o;
  }
  if (typeof v === 'string') return v.trim() === '' ? undefined : v;
  return v === null ? undefined : v;
}

export function buildForm(fields: Field[], initial: Obj, onChange: () => void) {
  const doc: Obj = structuredClone(initial ?? {});
  const get = (p: Path): unknown => p.reduce<unknown>((o, k) => (o == null ? undefined : (o as Obj)[k as string]), doc);
  const set = (p: Path, v: unknown) => {
    let o: Obj = doc;
    p.slice(0, -1).forEach((k, i) => {
      const nk = p[i + 1];
      if (o[k as string] == null || typeof o[k as string] !== 'object') o[k as string] = typeof nk === 'number' ? [] : {};
      o = o[k as string] as Obj;
    });
    o[p[p.length - 1] as string] = v;
    onChange();
  };
  const pathKey = (p: Path) => p.join('.');
  let uid = 0;

  function labelEl(f: Field, forId?: string) {
    return h('label', { class: 'label', for: forId }, f.label || f.name, f.required ? h('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null);
  }
  function wrap(f: Field, p: Path, control: HTMLElement, id?: string, bare = false) {
    return h('div', { class: `field field-${f.type}`, 'data-path': pathKey(p) },
      bare ? null : labelEl(f, id),
      bare || !f.description ? null : h('p', { class: 'help', text: f.description }),
      control,
      h('p', { class: 'err', role: 'alert' }));
  }

  function scalar(f: Field, p: Path, bare = false): HTMLElement {
    const id = `f${++uid}`;
    const v = get(p);
    switch (f.type) {
      case 'text': {
        const t = h('textarea', { id, class: 'input', rows: 3, dir: 'auto', required: f.required }) as HTMLTextAreaElement;
        t.value = v == null ? '' : String(v);
        const fit = () => { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight + 2, 640)}px`; };
        t.addEventListener('input', () => { set(p, t.value); fit(); });
        requestAnimationFrame(fit);
        return wrap(f, p, t, id, bare);
      }
      case 'html': {
        const r = richEditor(v == null ? '' : String(v), (html) => set(p, html));
        return wrap(f, p, r.el, undefined, bare);
      }
      case 'boolean': {
        const c = h('input', { id, type: 'checkbox', class: 'switch', checked: !!v }) as HTMLInputElement;
        c.addEventListener('change', () => set(p, c.checked));
        return h('div', { class: 'field field-boolean', 'data-path': pathKey(p) },
          h('label', { class: 'check', for: id }, c, h('span', { text: f.label || f.name })),
          f.description ? h('p', { class: 'help', text: f.description }) : null, h('p', { class: 'err', role: 'alert' }));
      }
      case 'select': {
        const s = h('select', { id, class: 'input' }) as HTMLSelectElement;
        if (!f.required) s.append(h('option', { value: '', text: '(ללא)' }));
        for (const o of f.options?.values ?? []) s.append(h('option', { value: o.value, text: o.label }));
        s.value = v == null ? (f.required ? f.options?.values[0]?.value ?? '' : '') : String(v);
        if (f.required && v == null) set(p, s.value);
        s.addEventListener('change', () => set(p, s.value));
        return wrap(f, p, s, id, bare);
      }
      case 'image': return imageField(f, p, id, bare);
      default: {
        const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
        const i = h('input', { id, type, class: 'input', dir: f.name === 'slug' ? 'ltr' : 'auto', required: f.required, step: type === 'number' ? 'any' : undefined, inputmode: type === 'number' ? 'decimal' : undefined }) as HTMLInputElement;
        i.value = v == null ? '' : String(v);
        i.addEventListener('input', () => set(p, type === 'number' ? (i.value === '' ? '' : Number(i.value)) : i.value));
        return wrap(f, p, i, id, bare);
      }
    }
  }

  function imageField(f: Field, p: Path, id: string, bare: boolean) {
    const box = h('div', { class: 'image-field' });
    const draw = () => {
      const v = get(p) as string | undefined;
      const m = v ? findMedia(v) : undefined;
      box.replaceChildren(
        h('div', { class: 'image-preview' }, v ? (m ? h('img', { src: thumb(m), alt: '' }) : h('span', { class: 'muted', text: relOf(v) })) : h('span', { class: 'muted', text: 'אין תמונה' })),
        h('div', { class: 'image-actions' },
          h('button', { type: 'button', id, class: 'btn btn-small', text: v ? 'החלפת תמונה' : 'בחירת תמונה', onclick: async () => { const m2 = await pick(); if (m2) { set(p, `/media/${m2.rel}`); draw(); } } }),
          v && !f.required ? h('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'הסרה', onclick: () => { set(p, ''); draw(); } }) : null));
    };
    library().then(draw);
    draw();
    return wrap(f, p, box, id, bare);
  }

  function object(f: Field, p: Path, top: boolean): HTMLElement {
    const inner = h('div', { class: 'fields' }, ...(f.fields ?? []).map((s) => field(s, [...p, s.name])));
    if (top) {
      return h('details', { class: 'section', 'data-path': pathKey(p) },
        h('summary', {}, h('span', { text: f.label || f.name })),
        h('div', { class: 'section-body' }, f.description ? h('p', { class: 'help', text: f.description }) : null, inner, h('p', { class: 'err', role: 'alert' })));
    }
    return h('fieldset', { class: 'group', 'data-path': pathKey(p) }, h('legend', { text: f.label || f.name }),
      f.description ? h('p', { class: 'help', text: f.description }) : null, inner, h('p', { class: 'err', role: 'alert' }));
  }

  function summaryOf(f: Field, item: Obj, i: number) {
    const tpl = listOpts(f).summary;
    let s = tpl ? tpl.replace(/\{fields\.(\w+)\}/g, (_, k) => String(item?.[k] ?? '')).trim() : '';
    if (!s && f.blocks) s = f.blocks.find((b) => b.name === item?.[f.blockKey || 'type'])?.label ?? '';
    if (f.blocks && item?.text) s = `${s}: ${String(item.text)}`;
    if (!s) s = String(Object.values(item ?? {}).find((x) => typeof x === 'string' && x && !x.startsWith('/media/')) ?? '');
    s = s.replace(/\s+/g, ' ');
    return s.length > 70 ? s.slice(0, 68) + '…' : s || `פריט ${i + 1}`;
  }

  function list(f: Field, p: Path, top: boolean): HTMLElement {
    const { min = 0, max = Infinity } = listOpts(f);
    const items = h('div', { class: 'list-items' });
    const objects = isObjType(f);
    const arr = () => { let a = get(p); if (!Array.isArray(a)) { a = []; set(p, a); } return a as unknown[]; };
    const addRow = h('div', { class: 'list-add' });
    const move = (from: number, to: number) => { const a = arr(); if (to < 0 || to >= a.length) return; a.splice(to, 0, a.splice(from, 1)[0]); onChange(); render(); };
    const open = new Set<number>();
    function render() {
      const a = arr();
      items.replaceChildren(...a.map((item, i) => {
        const tools = h('span', { class: 'item-tools' },
          h('button', { type: 'button', class: 'icon-btn', title: 'למעלה', 'aria-label': 'להזיז למעלה', text: '▲', disabled: i === 0, onclick: () => move(i, i - 1) }),
          h('button', { type: 'button', class: 'icon-btn', title: 'למטה', 'aria-label': 'להזיז למטה', text: '▼', disabled: i === a.length - 1, onclick: () => move(i, i + 1) }),
          a.length > min ? h('button', { type: 'button', class: 'icon-btn icon-del', title: 'מחיקה', 'aria-label': 'מחיקה', text: '✕', onclick: async () => {
            if (objects && !(await confirmDlg('מחיקה', `למחוק את "${summaryOf(f, item as Obj, i)}"?`, 'מחיקה', true))) return;
            a.splice(i, 1); open.clear(); onChange(); render();
          } }) : null);
        const drag = h('span', { class: 'drag', title: 'גוררים כדי לשנות את הסדר', 'aria-hidden': 'true', text: '⋮⋮' });
        if (!objects) {
          const row = scalar({ ...f, list: undefined, label: undefined, description: undefined }, [...p, i], true);
          return h('div', { class: 'list-row' }, drag, row, tools);
        }
        let sub: Field[] = f.fields ?? [];
        if (f.blocks) sub = f.blocks.find((b) => b.name === (item as Obj)?.[f.blockKey || 'type'])?.fields ?? [];
        const body = h('div', { class: 'fields' }, ...sub.map((s) => field(s, [...p, i, s.name])));
        const det = h('details', { class: 'item', open: open.has(i) },
          h('summary', {}, drag, h('span', { class: 'item-title', text: summaryOf(f, item as Obj, i) }), tools), body) as HTMLDetailsElement;
        det.addEventListener('toggle', () => { if (det.open) open.add(i); else open.delete(i); });
        body.addEventListener('input', () => { det.querySelector('.item-title')!.textContent = summaryOf(f, arr()[i] as Obj, i); });
        return det;
      }));
      const full = a.length >= max;
      addRow.replaceChildren(...(full ? [] : f.blocks
        ? f.blocks.map((b) => h('button', { type: 'button', class: 'btn btn-small btn-ghost', text: `+ ${b.label}`, onclick: () => { arr().push({ [f.blockKey || 'type']: b.name, ...(emptyValue({ name: '', type: 'object', fields: b.fields }) as Obj) }); open.add(arr().length - 1); onChange(); render(); } }))
        : [h('button', { type: 'button', class: 'btn btn-small btn-ghost', text: '+ הוספה', onclick: () => { arr().push(itemValue(f)); open.add(arr().length - 1); onChange(); render(); (items.lastElementChild?.querySelector('input,textarea') as HTMLElement | null)?.focus(); } })]));
    }
    Sortable.create(items, { handle: '.drag', animation: 150, onEnd: (ev) => { if (ev.oldIndex != null && ev.newIndex != null && ev.oldIndex !== ev.newIndex) { open.clear(); move(ev.oldIndex, ev.newIndex); } } });
    render();
    const head = [labelEl(f), f.description ? h('p', { class: 'help', text: f.description }) : null];
    const body = h('div', { class: `list ${objects ? 'list-objects' : 'list-scalars'}`, 'data-path': pathKey(p) }, ...(top && objects ? [] : head), items, addRow, h('p', { class: 'err', role: 'alert' }));
    if (top && objects) return h('details', { class: 'section', 'data-path': pathKey(p) }, h('summary', {}, h('span', { text: f.label || f.name })),
      h('div', { class: 'section-body' }, f.description ? h('p', { class: 'help', text: f.description }) : null, body));
    return body;
  }

  function field(f: Field, p: Path, top = false): HTMLElement {
    if (f.list) return list(f, p, top);
    if (f.type === 'object') return object(f, p, top);
    return scalar(f, p);
  }

  const el = h('div', { class: 'form' });
  let plain: HTMLElement | null = null;
  for (const f of fields) {
    const node = field(f, [f.name], true);
    if (node.tagName === 'DETAILS') { plain = null; el.append(node); continue; }
    if (!plain) { plain = h('div', { class: 'card fields' }); el.append(plain); }
    plain.append(node);
  }

  function clearIssues() {
    el.querySelectorAll('.has-error').forEach((x) => x.classList.remove('has-error'));
    el.querySelectorAll('.err').forEach((x) => (x.textContent = ''));
  }
  function showIssues(list: { path: string; message: string }[]) {
    clearIssues();
    let first: HTMLElement | null = null;
    for (const is of list) {
      let parts = is.path.split('.');
      let target: HTMLElement | null = null;
      while (parts.length && !(target = el.querySelector<HTMLElement>(`[data-path="${CSS.escape(parts.join('.'))}"]`))) parts = parts.slice(0, -1);
      target ??= el.querySelector<HTMLElement>('.field');
      if (!target) continue;
      target.classList.add('has-error');
      const err = target.querySelector(':scope > .err, :scope > .section-body > .err');
      if (err) err.textContent = is.message;
      for (let d = target.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
      first ??= target;
    }
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return { el, data: () => prune(doc) as Obj, raw: doc, showIssues, clearIssues };
}
