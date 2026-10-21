// Reading and writing the content in D1.
// - Every save goes through save*(): one D1 batch (a transaction) writes the document, keeps the previous version in
//   `revisions`, bumps the content version and empties the HTML cache, so the next visitor sees the change.
// - A render loads the whole content in one batch (it is small) and parses it through the schemas; the parsed snapshot is
//   kept in memory per content version, so an isolate parses it once per change, not once per page.
import { SINGLETONS, COLLECTIONS, type SingletonId, type CollectionId } from './schema';
import type { Snapshot, ImageInfo } from './data';

type Row = Record<string, unknown>;
let memo: { version: number; snap: Snapshot } | null = null;

export async function getVersion(db: D1Database): Promise<number> {
  const r = await db.prepare(`SELECT value FROM meta WHERE key = 'version'`).first<{ value: string }>();
  return Number(r?.value ?? 0);
}

function parseLoose<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, raw: string, what: string): T | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { console.error(`bad JSON in ${what}`); return null; }
  const r = schema.safeParse(v);
  if (!r.success) { console.error(`invalid content in ${what}`); return null; }
  return r.data as T;
}

export async function loadSnapshot(db: D1Database, version?: number): Promise<Snapshot> {
  if (version !== undefined && memo && memo.version === version) return memo.snap;
  const [v, s, e, m] = await db.batch([
    db.prepare(`SELECT value FROM meta WHERE key = 'version'`),
    db.prepare(`SELECT id, data FROM singletons`),
    db.prepare(`SELECT collection, id, data FROM entries ORDER BY collection, id`),
    db.prepare(`SELECT rel, id, w, h, variants, full FROM media`),
  ]);
  const ver = Number((v.results[0] as Row | undefined)?.value ?? 0);
  const singletons: Record<string, unknown> = {};
  for (const r of s.results as Row[]) {
    const id = String(r.id);
    if (id in SINGLETONS) singletons[id] = parseLoose(SINGLETONS[id as SingletonId], String(r.data), id);
  }
  // a page that is missing or broken still renders, from its defaults (title is required, so it falls back to "")
  for (const id of Object.keys(SINGLETONS) as SingletonId[]) {
    if (!singletons[id]) {
      const r = (SINGLETONS[id] as unknown as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse(id === 'settings'
        ? { siteName: 'ד״ר עפר מרבך', phone: '050-000-0000', email: 'a@b.co', courseUrl: 'https://example.com/' } : { title: '' });
      singletons[id] = r.data ?? {};
    }
  }
  const lists: Record<CollectionId, unknown[]> = { articles: [], talks: [], videos: [], testimonials: [] };
  for (const r of e.results as Row[]) {
    const c = String(r.collection) as CollectionId;
    if (!(c in COLLECTIONS)) continue;
    const d = parseLoose<Record<string, unknown>>(COLLECTIONS[c] as never, String(r.data), `${c}/${r.id}`);
    if (d) lists[c].push({ ...d, id: String(r.id) });
  }
  const images: Record<string, ImageInfo> = {};
  for (const r of m.results as Row[]) {
    images[String(r.rel)] = { id: String(r.id), w: Number(r.w), h: Number(r.h), variants: JSON.parse(String(r.variants)), full: String(r.full) };
  }
  const snap = { version: ver, singletons, ...lists, images } as unknown as Snapshot;
  memo = { version: ver, snap };
  return snap;
}

/** the statements that every content change appends to its batch */
export const bumpStatements = (db: D1Database) => [
  db.prepare(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'version'`),
  db.prepare(`DELETE FROM html_cache`),
  // keep the last 5000 earlier versions (plenty for "גרסאות קודמות")
  db.prepare(`DELETE FROM revisions WHERE id <= (SELECT MAX(id) - 5000 FROM revisions)`),
];

const revision = (db: D1Database, kind: string, ref: string, by: string) =>
  db.prepare(`INSERT INTO revisions (kind, ref, data, at, by)
    SELECT ?1, ?2, data, ?3, ?4 FROM ${kind === 'singleton' ? 'singletons WHERE id = ?2' : 'entries WHERE collection || \'/\' || id = ?2'}`)
    .bind(kind, ref, Date.now(), by);

export async function saveSingleton(db: D1Database, id: SingletonId, data: unknown, by: string) {
  await db.batch([
    revision(db, 'singleton', id, by),
    db.prepare(`INSERT INTO singletons (id, data, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(id, JSON.stringify(data), Date.now(), by),
    ...bumpStatements(db),
  ]);
}

export async function saveEntry(db: D1Database, c: CollectionId, id: string, data: unknown, by: string) {
  const now = Date.now();
  await db.batch([
    revision(db, 'entry', `${c}/${id}`, by),
    db.prepare(`INSERT INTO entries (collection, id, data, created_at, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?4, ?5)
      ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(c, id, JSON.stringify(data), now, by),
    ...bumpStatements(db),
  ]);
}

export async function deleteEntry(db: D1Database, c: CollectionId, id: string, by: string) {
  await db.batch([
    revision(db, 'entry', `${c}/${id}`, by),
    db.prepare(`DELETE FROM entries WHERE collection = ?1 AND id = ?2`).bind(c, id),
    ...bumpStatements(db),
  ]);
}

/** new order for a list (talks, videos, testimonials): order = 1, 2, 3 … in the given sequence */
export async function reorder(db: D1Database, c: CollectionId, ids: string[], by: string) {
  const now = Date.now();
  await db.batch([
    ...ids.map((id, i) => db.prepare(`UPDATE entries SET data = json_set(data, '$.order', ?3), updated_at = ?4, updated_by = ?5
      WHERE collection = ?1 AND id = ?2`).bind(c, id, i + 1, now, by)),
    ...bumpStatements(db),
  ]);
}

export async function getRaw(db: D1Database, kind: 'singleton' | 'entry', c: string, id: string): Promise<{ data: unknown; updated_at: number; updated_by: string } | null> {
  const r = kind === 'singleton'
    ? await db.prepare(`SELECT data, updated_at, updated_by FROM singletons WHERE id = ?1`).bind(id).first<Row>()
    : await db.prepare(`SELECT data, updated_at, updated_by FROM entries WHERE collection = ?1 AND id = ?2`).bind(c, id).first<Row>();
  return r ? { data: JSON.parse(String(r.data)), updated_at: Number(r.updated_at), updated_by: String(r.updated_by ?? '') } : null;
}

export const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
