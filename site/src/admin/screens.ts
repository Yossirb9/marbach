// The smaller admin screens: the shell (menu, sign out), login, lists with drag-to-reorder, the recommendations inbox,
// users, my account, the media page. Each screen is picked by data-screen on <body>.
import Sortable from 'sortablejs';
import { $, $$, api, h, toast, confirmDlg, boot, showSecret, url, fmtDate, ask, dialog } from './ui';
import { initMediaPage } from './media';

const screen = document.body.dataset.screen;

// ---------- shell ----------
$('[data-menu-toggle]')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('[data-logout]')?.addEventListener('click', async () => { await api('/api/admin/logout/', { method: 'POST' }); location.assign(url('/admin/login/')); });

// ---------- login ----------
if (screen === 'login') {
  const form = $<HTMLFormElement>('#login')!;
  const err = $('#login-error')!;
  const btn = $<HTMLButtonElement>('button[type=submit]', form)!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    const fd = new FormData(form);
    try {
      const r = await fetch(url('/api/admin/login/'), { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password'), csrf: fd.get('csrf') }) });
      const d = await r.json().catch(() => ({ error: 'שגיאה' }));
      if (r.ok && d.ok) {
        const next = new URLSearchParams(location.search).get('next') || '';
        location.assign(/^\/[\w\-/]*admin\/[\w\-/]*$/.test(next) ? next : url('/admin/'));
        return;
      }
      err.textContent = d.error || 'ההתחברות נכשלה';
      if (r.status === 403) setTimeout(() => location.reload(), 1500);
    } catch { err.textContent = 'אין חיבור. נסו שוב.'; }
    btn.disabled = false;
  });
}

// ---------- list (talks, videos, testimonials: drag to reorder) ----------
if (screen === 'list') {
  const b = boot<{ collection: string; sortable: boolean }>();
  const listEl = $('#entries');
  const q = $<HTMLInputElement>('#filter');
  q?.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    $$('#entries > li').forEach((li) => { li.hidden = !!v && !li.textContent!.toLowerCase().includes(v); });
  });
  if (b.sortable && listEl) {
    const saveOrder = async () => {
      const ids = $$('#entries > li', listEl).map((li) => li.dataset.id!);
      const r = await api(`/api/admin/reorder/${b.collection}/`, { json: { ids } });
      toast(r.ok ? 'הסדר נשמר. כך הוא מופיע עכשיו באתר.' : r.error || 'שמירת הסדר נכשלה', r.ok ? 'ok' : 'error');
      $$('#entries > li', listEl).forEach((li, i) => { const n = $('.order-num', li); if (n) n.textContent = String(i + 1); });
    };
    Sortable.create(listEl, { handle: '.drag', animation: 150, onEnd: (ev) => { if (ev.oldIndex !== ev.newIndex) saveOrder(); } });
    listEl.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>('[data-move]');
      if (!btn) return;
      const li = btn.closest('li')!;
      const sib = btn.dataset.move === 'up' ? li.previousElementSibling : li.nextElementSibling?.nextElementSibling ?? null;
      if (btn.dataset.move === 'up' && !sib) return;
      if (btn.dataset.move === 'down' && !li.nextElementSibling) return;
      listEl.insertBefore(li, sib);
      saveOrder();
    });
  }
}

// ---------- recommendations inbox ----------
if (screen === 'inbox') {
  $$<HTMLElement>('[data-sub]').forEach((card) => {
    const id = card.dataset.sub!;
    const val = (n: string) => $<HTMLInputElement | HTMLTextAreaElement>(`[name="${n}"]`, card)?.value ?? '';
    card.addEventListener('click', async (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act!;
      if (act === 'approve' && card.dataset.consent === '0' && !(await confirmDlg('פרסום בלי הסכמה?', 'הכותב/ת לא סימנו שמותר לפרסם את ההמלצה באתר. לפרסם בכל זאת?', 'לפרסם'))) return;
      if (act === 'reject' && !(await confirmDlg('לא לפרסם', 'להעביר את ההמלצה ל"לא פורסמו"? אפשר להחזיר אותה אחר כך.', 'כן'))) return;
      if (act === 'delete' && !(await confirmDlg('מחיקה סופית', 'למחוק את ההמלצה לגמרי? אי אפשר לבטל.', 'מחיקה', true))) return;
      btn.disabled = true;
      const r = await api(`/api/admin/submissions/${id}/`, { json: { action: act, name: val('name'), role: val('role'), quote: val('quote') } });
      if (!r.ok) { btn.disabled = false; toast(r.error || 'הפעולה נכשלה', 'error'); return; }
      toast(act === 'approve' ? 'ההמלצה פורסמה באתר' : act === 'reject' ? 'הועבר ל"לא פורסמו"' : act === 'restore' ? 'הוחזר לממתינות' : 'נמחק', 'ok',
        act === 'approve' ? { href: url('/#testimonials'), text: 'לצפייה' } : undefined);
      card.remove();
      const left = $$('[data-sub]').length;
      if (!left) $('#inbox-empty')?.removeAttribute('hidden');
    });
  });
}

// ---------- users (admins) ----------
if (screen === 'users') {
  const me = boot<{ me: number }>().me;
  const table = $('#users')!;
  const ROLE: Record<string, string> = { admin: 'מנהל/ת (כולל משתמשים)', editor: 'עורך/ת תוכן' };
  const render = async () => {
    const r = await api('/api/admin/users/');
    const items = (r.items as { id: number; username: string; display_name: string; role: string; disabled: number; last_login: number }[]) ?? [];
    table.replaceChildren(...items.map((u) => h('li', { class: 'user-row' },
      h('div', {}, h('strong', { text: u.display_name || u.username }), ' ', h('span', { class: 'muted', dir: 'ltr', text: u.username }),
        h('div', { class: 'muted small', text: `${ROLE[u.role] ?? u.role}${u.disabled ? ' · חסום' : ''}${u.last_login ? ` · כניסה אחרונה ${fmtDate(u.last_login)}` : ' · עוד לא נכנס/ה'}` })),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-small', text: 'איפוס סיסמה', onclick: async () => {
          if (!(await confirmDlg('איפוס סיסמה', `ליצור סיסמה חדשה ל-${u.display_name || u.username}? הסיסמה הקודמת תפסיק לעבוד.`, 'ליצור סיסמה'))) return;
          const x = await api('/api/admin/users/', { json: { action: 'reset', id: u.id } });
          if (x.ok) await showSecret('הסיסמה החדשה', String(x.username), String(x.password)); else toast(x.error || 'שגיאה', 'error');
        } }),
        u.id === me ? null : h('button', { type: 'button', class: 'btn btn-small btn-ghost', text: u.role === 'admin' ? 'להפוך לעורך/ת' : 'להפוך למנהל/ת', onclick: async () => {
          const x = await api('/api/admin/users/', { json: { action: 'role', id: u.id, role: u.role === 'admin' ? 'editor' : 'admin' } });
          toast(x.ok ? 'התפקיד עודכן' : x.error || 'שגיאה', x.ok ? 'ok' : 'error'); render();
        } }),
        u.id === me ? null : h('button', { type: 'button', class: 'btn btn-small btn-ghost', text: u.disabled ? 'ביטול חסימה' : 'חסימה', onclick: async () => {
          const x = await api('/api/admin/users/', { json: { action: u.disabled ? 'enable' : 'disable', id: u.id } });
          toast(x.ok ? 'עודכן' : x.error || 'שגיאה', x.ok ? 'ok' : 'error'); render();
        } }),
        u.id === me ? null : h('button', { type: 'button', class: 'btn btn-small btn-danger-ghost', text: 'מחיקה', onclick: async () => {
          if (!(await confirmDlg('מחיקת משתמש', `למחוק את ${u.display_name || u.username}?`, 'מחיקה', true))) return;
          const x = await api('/api/admin/users/', { json: { action: 'delete', id: u.id } });
          toast(x.ok ? 'המשתמש נמחק' : x.error || 'שגיאה', x.ok ? 'ok' : 'error'); render();
        } })))));
  };
  $('#add-user')?.addEventListener('click', async () => {
    const username = await ask('משתמש חדש', 'שם משתמש (באנגלית, למשל ofer)', '');
    if (!username) return;
    const display = (await ask('משתמש חדש', 'השם שיוצג (למשל עפר מרבך)', '')) ?? '';
    const role = await dialog('משתמש חדש', 'מה התפקיד?', [{ text: 'עורך/ת תוכן (כל התוכן)', value: 'editor', kind: 'btn-primary' }, { text: 'מנהל/ת (גם משתמשים)', value: 'admin' }, { text: 'ביטול', value: '' }]);
    if (!role) return;
    const x = await api('/api/admin/users/', { json: { action: 'create', username, display_name: display, role } });
    if (!x.ok) { toast(x.error || 'שגיאה', 'error'); return; }
    await showSecret('המשתמש נוצר', String(x.username), String(x.password));
    render();
  });
  render();
}

// ---------- my account ----------
if (screen === 'account') {
  const form = $<HTMLFormElement>('#pw')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    if (fd.get('next') !== fd.get('again')) { toast('שתי הסיסמאות החדשות לא זהות', 'error'); return; }
    const r = await api('/api/admin/password/', { json: { current: fd.get('current'), next: fd.get('next') } });
    if (r.ok) { form.reset(); toast('הסיסמה הוחלפה'); } else toast(r.error || 'שגיאה', 'error');
  });
}

// ---------- media ----------
if (screen === 'media') initMediaPage($('#media')!);
