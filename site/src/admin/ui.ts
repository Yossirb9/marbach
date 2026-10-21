// Shared bits of the admin's browser code: calls to /api/admin (with the CSRF token), messages, dialogs.
export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T | null;
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as T[];
export const BASE = (document.documentElement.dataset.base || '/').replace(/\/?$/, '/');
export const url = (p: string) => BASE + p.replace(/^\//, '');
const csrf = () => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || '';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: (Node | string | null | undefined | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export interface ApiResult { ok: boolean; error?: string; issues?: { path: string; message: string }[]; [k: string]: unknown }

/** a call to the admin API; never throws: a network problem becomes { ok: false, error } */
export async function api(path: string, opts: { method?: string; json?: unknown; body?: BodyInit } = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { 'x-csrf-token': csrf() };
  let body = opts.body;
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
  try {
    const r = await fetch(url(path), { method: opts.method || (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
    if (r.status === 401) { toast('פג תוקף ההתחברות. מתחברים מחדש…', 'error'); setTimeout(() => location.assign(url(`/admin/login/?next=${encodeURIComponent(location.pathname)}`)), 1500); }
    const data = (await r.json().catch(() => ({ ok: false, error: `שגיאה (${r.status})` }))) as ApiResult;
    if (!r.ok && data.ok === undefined) data.ok = false;
    return data;
  } catch {
    return { ok: false, error: 'אין חיבור לאינטרנט, או שהשרת לא עונה. השינויים לא נשמרו; נסו שוב.' };
  }
}

let toastBox: HTMLElement | null = null;
export function toast(msg: string, kind: 'ok' | 'error' | 'info' = 'ok', link?: { href: string; text: string }) {
  toastBox ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast toast-${kind}` }, h('span', { text: msg }), link ? h('a', { href: link.href, target: '_blank', rel: 'noopener', text: link.text }) : null);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 9000 : 5000);
  setTimeout(() => t.remove(), kind === 'error' ? 9600 : 5600);
}

/** a modal built on <dialog>; resolves with the button value ('' when closed) */
export function dialog(title: string, body: Node | string, buttons: { text: string; value: string; kind?: string }[]): Promise<string> {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'dlg' },
      h('form', { method: 'dialog' },
        h('h2', { text: title }),
        typeof body === 'string' ? h('p', { text: body }) : body,
        h('div', { class: 'dlg-btns' }, ...buttons.map((b) => h('button', { class: `btn ${b.kind || ''}`, value: b.value, text: b.text }))),
      ));
    document.body.append(d);
    d.addEventListener('close', () => { resolve(d.returnValue || ''); d.remove(); });
    (d as HTMLDialogElement).showModal();
  });
}
export const confirmDlg = async (title: string, text: string, yes = 'כן', danger = false) =>
  (await dialog(title, text, [{ text: 'ביטול', value: '' }, { text: yes, value: 'yes', kind: danger ? 'btn-danger' : 'btn-primary' }])) === 'yes';

/** asks for one line of text (link address, user name …); null when cancelled */
export async function ask(title: string, label: string, value = '', type = 'text'): Promise<string | null> {
  const input = h('input', { type, value, dir: 'auto', class: 'input' }) as HTMLInputElement;
  const body = h('label', { class: 'field' }, h('span', { class: 'label', text: label }), input);
  setTimeout(() => input.focus(), 50);
  const r = await dialog(title, body, [{ text: 'ביטול', value: '' }, { text: 'אישור', value: 'ok', kind: 'btn-primary' }]);
  return r === 'ok' ? input.value.trim() : null;
}

/** reads the JSON the server put in <script type="application/json" id="…"> */
export const boot = <T>(id = 'boot'): T => JSON.parse(document.getElementById(id)?.textContent || 'null') as T;

export const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** copies a password into a dialog that shows it once */
export async function showSecret(title: string, user: string, password: string) {
  const code = h('code', { class: 'secret', dir: 'ltr', text: password });
  const copy = h('button', { type: 'button', class: 'btn btn-small', text: 'העתקה', onclick: async () => { try { await navigator.clipboard.writeText(password); copy.textContent = 'הועתק'; } catch { /* clipboard blocked */ } } });
  await dialog(title, h('div', {},
    h('p', {}, 'שם משתמש: ', h('strong', { dir: 'ltr', text: user })),
    h('p', {}, 'סיסמה: ', code, ' ', copy),
    h('p', { class: 'muted', text: 'הסיסמה מוצגת עכשיו בלבד ולא נשמרת בשום מקום. מעבירים אותה ביד (בטלפון או בהודעה), ומומלץ להחליף אותה אחרי הכניסה הראשונה ב"החשבון שלי".' })),
  [{ text: 'סגירה', value: 'ok', kind: 'btn-primary' }]);
}
