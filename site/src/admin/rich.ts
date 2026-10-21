// The rich-text editor (articles, the accessibility statement): TipTap, bundled with the admin (no CDN). It writes the
// same simple HTML the site already uses (p, h2/h3, lists, quotes, links, images from the library). The server cleans it
// again on save (src/lib/sanitize.ts).
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { h, ask } from './ui';
import { pick } from './media';

type Btn = { label: string; title: string; run: (e: Editor) => void; active?: (e: Editor) => boolean };

export function richEditor(value: string, onChange: (html: string) => void) {
  const host = h('div', { class: 'rich' });
  const bar = h('div', { class: 'rich-bar', role: 'toolbar', 'aria-label': 'עיצוב טקסט' });
  const area = h('div', { class: 'rich-area' });
  host.append(bar, area);
  const buttons: [HTMLButtonElement, Btn][] = [];
  let ready = false;
  const editor: Editor = new Editor({
    element: area,
    content: value || '<p></p>',
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false, codeBlock: false,
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto', 'tel'], defaultProtocol: 'https',
          HTMLAttributes: { rel: 'noopener', target: null } },
      }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    editorProps: { attributes: { dir: 'rtl', class: 'prose rich-prose', 'aria-label': 'הטקסט' } },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML()),
    onSelectionUpdate: () => refresh(),
    onTransaction: () => refresh(),
  });
  const link = async (e: Editor) => {
    const prev = (e.getAttributes('link').href as string) || '';
    const href = await ask('קישור', 'כתובת הקישור (https://…, או מספר טלפון / מייל)', prev, 'url');
    if (href === null) return;
    if (!href) { e.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    const full = /^(https?:|mailto:|tel:|\/)/i.test(href) ? href : /@/.test(href) ? `mailto:${href}` : /^[\d+\-\s]{7,}$/.test(href) ? `tel:${href.replace(/\s/g, '')}` : `https://${href}`;
    if (e.state.selection.empty && !e.isActive('link')) e.chain().focus().insertContent(`<a href="${full.replace(/"/g, '&quot;')}">${href.replace(/</g, '&lt;')}</a>`).run();
    else e.chain().focus().extendMarkRange('link').setLink({ href: full }).run();
  };
  const image = async (e: Editor) => {
    const m = await pick();
    if (!m) return;
    const alt = (await ask('תיאור התמונה', 'משפט קצר שמתאר מה רואים (לקוראי מסך). אפשר להשאיר ריק.', '')) ?? '';
    e.chain().focus().setImage({ src: `/media/${m.rel}`, alt }).run();
  };
  const BTNS: (Btn | '|')[] = [
    { label: 'B', title: 'הדגשה', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
    { label: 'I', title: 'נטוי', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
    { label: 'U', title: 'קו תחתון', run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
    '|',
    { label: 'כותרת', title: 'כותרת ביניים', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
    { label: 'כותרת גדולה', title: 'כותרת גדולה', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
    { label: '• רשימה', title: 'רשימה', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
    { label: '1. רשימה', title: 'רשימה ממוספרת', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
    { label: '״ציטוט״', title: 'ציטוט', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
    '|',
    { label: 'קישור', title: 'הוספת קישור', run: link, active: (e) => e.isActive('link') },
    { label: 'תמונה', title: 'הוספת תמונה מהספרייה', run: image },
    '|',
    { label: '↶', title: 'ביטול הפעולה האחרונה', run: (e) => e.chain().focus().undo().run() },
    { label: '↷', title: 'חזרה על הפעולה', run: (e) => e.chain().focus().redo().run() },
    { label: 'ניקוי עיצוב', title: 'ניקוי עיצוב', run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run() },
  ];
  for (const b of BTNS) {
    if (b === '|') { bar.append(h('span', { class: 'rich-sep', 'aria-hidden': 'true' })); continue; }
    const el = h('button', { type: 'button', class: 'rich-btn', title: b.title, 'aria-label': b.title, text: b.label, onmousedown: (ev: Event) => ev.preventDefault(), onclick: () => b.run(editor) }) as HTMLButtonElement;
    buttons.push([el, b]);
    bar.append(el);
  }
  ready = true;
  function refresh() { if (!ready) return; for (const [el, b] of buttons) if (b.active) el.classList.toggle('on', b.active(editor)); }
  return { el: host, set: (html: string) => editor.commands.setContent(html || '<p></p>', { emitUpdate: false }), destroy: () => editor.destroy() };
}
