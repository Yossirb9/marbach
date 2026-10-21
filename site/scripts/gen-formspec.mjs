// One-off generator: the Hebrew labels, descriptions and field structure of the admin forms, taken from the old
// Pages CMS config (/.pages.yml), written to src/admin/formspec.json (committed). The admin builds every form from
// that file; the server validates every save with the zod schemas in src/lib/schema.ts.
// usage (from site/): node scripts/gen-formspec.mjs
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const cfg = YAML.parse(fs.readFileSync(path.join(ROOT, '../.pages.yml'), 'utf8'));
const components = cfg.components || {};

const TOKENS = 'אפשר לכתוב {phone} או {email}: האתר מציג במקומם את הטלפון והמייל מ"פרטי קשר והגדרות".';
const KEEP = ['name', 'label', 'description', 'type', 'required', 'default', 'list', 'fields', 'blocks', 'blockKey', 'options', 'pattern'];
function field(f) {
  let out = { ...f };
  if (f.component) {
    const c = components[f.component];
    if (!c) throw new Error(`unknown component ${f.component}`);
    out = { ...c, ...f };
    delete out.component;
  }
  const r = {};
  for (const k of KEEP) if (out[k] !== undefined) r[k] = out[k];
  // the admin's own field kinds
  if (r.type === 'rich-text') r.type = 'html';
  if (r.type === 'image' || r.type === 'file') r.type = r.type === 'image' ? 'image' : r.type;
  if (r.options) {
    const o = r.options;
    r.options = o.values ? { values: o.values.map((v) => (typeof v === 'string' ? { value: v, label: v } : v)) } : undefined;
    if (!r.options) delete r.options;
  }
  if (r.list && typeof r.list === 'object') {
    const l = r.list;
    r.list = { min: l.min, max: l.max, summary: l.collapsible?.summary };
  }
  // texts that may carry the phone / e-mail from the settings
  if (r.name === 'seoDescription' || r.type === 'html') r.description = `${r.description ? `${r.description} ` : ''}${TOKENS}`;
  if (r.fields) r.fields = r.fields.map(field);
  if (r.blocks) r.blocks = r.blocks.map((b) => ({ name: b.name, label: b.label, fields: (b.fields || []).map(field) }));
  return r;
}

const spec = { collections: {}, singletons: {}, groups: [] };
// the Pages CMS names → the ids of the pages in the database (= src/content/pages/<id>.json)
const ID = { video_page: 'video', writing_page: 'writing' };
for (const item of cfg.content) {
  if (item.type === 'collection') {
    spec.collections[item.name] = { label: item.label, description: item.description, view: item.view, fields: item.fields.map(field) };
  } else if (item.type === 'group') {
    const g = { name: item.name, label: item.label, items: [] };
    for (const it of item.items) {
      const id = ID[it.name] || it.name;
      spec.singletons[id] = { label: it.label, description: it.description, fields: it.fields.map(field) };
      g.items.push(id);
    }
    spec.groups.push(g);
  } else if (item.type === 'file') {
    spec.singletons[item.name] = { label: item.label, description: item.description, fields: item.fields.map(field) };
  }
}
const out = path.join(ROOT, 'src/admin/formspec.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(spec, null, 1) + '\n');
console.log('collections:', Object.keys(spec.collections).join(', '));
console.log('singletons:', Object.keys(spec.singletons).join(', '));
