// The editing screen of one document (a page, the settings, the menu, or one article / talk / video / testimonial):
// the generated form, save, preview, earlier versions, delete.
import { $, api, h, toast, boot, confirmDlg, dialog, fmtDate, url } from './ui';
import { buildForm, emptyValue, type Field } from './form';

interface Boot { kind: 'singleton' | 'entry'; name: string; id: string; fields: Field[]; data: Record<string, unknown> | null; updated_at: number; viewUrl: string; listUrl?: string; deletable?: boolean; title?: string }
const b = boot<Boot>();
const root = $('#editor')!;
const isNew = b.kind === 'entry' && b.id === 'new';
let id = b.id;
let updatedAt = b.updated_at;
const initial = b.data ?? Object.fromEntries(b.fields.map((f) => [f.name, emptyValue(f)]).filter(([, v]) => v !== undefined));
if (isNew && b.name === 'articles') {
  const today = new Date().toISOString().slice(0, 10);
  initial.date ??= today;
  initial.slug ??= today;
  initial.draft = true;
}

const status = h('span', { class: 'save-status muted', 'aria-live': 'polite' });
const form = buildForm(b.fields, initial, () => refreshDirty());
let baseline = JSON.stringify(form.data());
const dirty = () => JSON.stringify(form.data()) !== baseline;
function refreshDirty() {
  const d = dirty();
  saveBtn.disabled = !d && !isNewUnsaved();
  status.textContent = d ? 'יש שינויים שלא נשמרו' : '';
  const draft = form.raw.draft === true;
  draftNote.hidden = !(b.name === 'articles' && draft);
}
const isNewUnsaved = () => isNew && id === 'new';

const draftNote = h('p', { class: 'note note-draft', hidden: true, text: 'טיוטה: המאמר נשמר אבל לא מופיע באתר. כדי לפרסם, מורידים את הסימון "טיוטה" ושומרים.' });
const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'שמירה', onclick: () => save() }) as HTMLButtonElement;
const previewBtn = h('button', { type: 'button', class: 'btn', text: 'תצוגה מקדימה', onclick: () => preview() });
const viewLink = h('a', { class: 'btn btn-ghost', href: b.viewUrl, target: '_blank', rel: 'noopener', text: 'צפייה באתר', hidden: isNew }) as HTMLAnchorElement;
const historyBtn = h('button', { type: 'button', class: 'btn btn-ghost', text: 'גרסאות קודמות', hidden: isNew, onclick: () => showHistory() });
const deleteBtn = b.deletable ? h('button', { type: 'button', class: 'btn btn-danger-ghost', text: 'מחיקה', hidden: isNew, onclick: () => remove() }) : null;

root.append(draftNote, form.el,
  h('div', { class: 'actionbar' }, h('div', { class: 'actionbar-in' }, saveBtn, previewBtn, viewLink, historyBtn, deleteBtn, status)));
refreshDirty();

async function save() {
  saveBtn.disabled = true;
  status.textContent = 'שומרים…';
  form.clearIssues();
  const path = b.kind === 'singleton' ? `/api/admin/singleton/${b.name}/` : `/api/admin/entry/${b.name}/${id}/`;
  const r = await api(path, { json: { data: form.data(), updated_at: updatedAt } });
  if (!r.ok) {
    status.textContent = '';
    saveBtn.disabled = false;
    if (r.issues) form.showIssues(r.issues);
    toast(r.error || 'השמירה נכשלה', 'error');
    return;
  }
  baseline = JSON.stringify(form.data());
  updatedAt = Number(r.updated_at) || Date.now();
  const draft = b.name === 'articles' && form.raw.draft === true;
  toast(draft ? 'נשמר כטיוטה (לא מופיע באתר)' : 'נשמר. השינוי כבר באתר.', 'ok', draft ? undefined : { href: String(r.url), text: 'לצפייה' });
  viewLink.href = String(r.url || b.viewUrl);
  if (isNewUnsaved() && r.id) {
    id = String(r.id);
    history.replaceState(null, '', url(`/admin/entry/${b.name}/${id}/`));
    viewLink.hidden = false; historyBtn.hidden = false; if (deleteBtn) deleteBtn.hidden = false;
  }
  refreshDirty();
}

async function preview() {
  const r = await api('/api/admin/preview/', { json: { kind: b.kind, name: b.name, id, data: form.data() } });
  if (!r.ok) { if (r.issues) form.showIssues(r.issues); toast(r.error || 'התצוגה המקדימה נכשלה', 'error'); return; }
  const frame = h('iframe', { src: String(r.url), class: 'preview-frame', title: 'תצוגה מקדימה' });
  const wrapEl = h('div', { class: 'preview-wrap' },
    h('div', { class: 'preview-sizes' },
      h('button', { type: 'button', class: 'btn btn-small', text: 'טלפון', onclick: () => wrapEl.classList.add('phone') }),
      h('button', { type: 'button', class: 'btn btn-small', text: 'מחשב', onclick: () => wrapEl.classList.remove('phone') }),
      h('a', { class: 'btn btn-small btn-ghost', href: String(r.url), target: '_blank', rel: 'noopener', text: 'בחלון חדש' }),
      h('span', { class: 'muted', text: 'כך ייראה העמוד אחרי השמירה. עוד לא נשמר.' })),
    frame);
  if (innerWidth < 700) wrapEl.classList.add('phone');
  const p = dialog('תצוגה מקדימה', wrapEl, [{ text: 'סגירה', value: '' }]);
  document.querySelector('dialog.dlg:last-of-type')?.classList.add('dlg-full');
  await p;
}

async function showHistory() {
  const ref = b.kind === 'singleton' ? b.name : `${b.name}/${id}`;
  const r = await api(`/api/admin/revisions/?ref=${encodeURIComponent(ref)}`);
  const items = (r.items as { id: number; at: number; by: string }[] | undefined) ?? [];
  if (!items.length) { toast('אין עדיין גרסאות קודמות', 'info'); return; }
  const list = h('ul', { class: 'rev-list' }, ...items.map((it) => h('li', {}, h('button', { type: 'button', class: 'btn btn-small', value: String(it.id), text: 'לטעון', onclick: async (e: Event) => {
    (e.target as HTMLElement).closest('dialog')?.close();
    const v = await api(`/api/admin/revisions/?id=${it.id}`);
    if (!v.ok) { toast(v.error || 'שגיאה', 'error'); return; }
    if (dirty() && !(await confirmDlg('טעינת גרסה קודמת', 'השינויים שלא נשמרו יימחקו. להמשיך?', 'כן, לטעון'))) return;
    sessionStorage.setItem(`restore:${ref}`, JSON.stringify(v.data));
    location.reload();
  } }), ` ${fmtDate(it.at)}`, it.by ? ` · ${it.by}` : '')));
  await dialog('גרסאות קודמות', h('div', {}, h('p', { class: 'muted', text: 'כל שמירה שומרת את הגרסה שהייתה לפניה. טוענים גרסה לטופס, בודקים, ושומרים כדי להחזיר אותה לאתר.' }), list), [{ text: 'סגירה', value: '' }]);
}

async function remove() {
  if (!(await confirmDlg('מחיקה', `למחוק את "${b.title || 'הפריט'}"? אי אפשר לבטל את המחיקה.${b.name === 'articles' ? ' כדי רק להוריד מהאתר, מסמנים "טיוטה".' : b.name === 'testimonials' ? ' כדי רק להוריד מהאתר, מסמנים "להסתיר".' : ''}`, 'מחיקה', true))) return;
  const r = await api(`/api/admin/entry/${b.name}/${id}/`, { method: 'DELETE' });
  if (!r.ok) { toast(r.error || 'המחיקה נכשלה', 'error'); return; }
  baseline = JSON.stringify(form.data());
  location.assign(b.listUrl || url('/admin/'));
}

// a version chosen in "גרסאות קודמות" is loaded into the form after the reload (not saved until "שמירה")
{
  const ref = b.kind === 'singleton' ? b.name : `${b.name}/${id}`;
  const restored = sessionStorage.getItem(`restore:${ref}`);
  if (restored) {
    sessionStorage.removeItem(`restore:${ref}`);
    const f2 = buildForm(b.fields, JSON.parse(restored), () => refreshDirty());
    form.el.replaceWith(f2.el);
    Object.assign(form, { el: f2.el, data: f2.data, raw: f2.raw, showIssues: f2.showIssues, clearIssues: f2.clearIssues });
    refreshDirty();
    toast('נטענה גרסה קודמת. בודקים ולוחצים "שמירה" כדי להחזיר אותה לאתר.', 'info');
  }
}

addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!saveBtn.disabled) save(); } });
