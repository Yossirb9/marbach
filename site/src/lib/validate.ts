// Server-side check of everything the admin sends, before it is stored: the zod schema of the document (schema.ts),
// rich text cleaned (sanitize.ts), and the rules that span documents (a unique article address, one featured video).
import { SINGLETONS, COLLECTIONS, issues, type SingletonId, type CollectionId } from './schema';
import { sanitizeHtml } from './sanitize';

export type Checked = { ok: true; data: Record<string, unknown> } | { ok: false; issues: { path: string; message: string }[] };

/** HTML fields, per document (the only places raw markup is accepted) */
const HTML_FIELDS: Record<string, string[]> = { accessibility: ['body'], articles: ['body'] };

/** JSON.stringify of the stored document must stay well below D1's row limit */
const MAX_JSON = 400_000;

export function checkDoc(kind: 'singleton' | 'entry', name: string, input: unknown): Checked {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, issues: [{ path: '', message: 'נתונים לא תקינים' }] };
  const schema = kind === 'singleton' ? SINGLETONS[name as SingletonId] : COLLECTIONS[name as CollectionId];
  if (!schema) return { ok: false, issues: [{ path: '', message: 'סוג תוכן לא מוכר' }] };
  const raw = { ...(input as Record<string, unknown>) };
  for (const f of HTML_FIELDS[name] ?? []) if (typeof raw[f] === 'string') raw[f] = sanitizeHtml(raw[f] as string);
  const r = (schema as unknown as { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown>; error?: never } }).safeParse(raw);
  if (!r.success) return { ok: false, issues: issues((r as unknown as { error: Parameters<typeof issues>[0] }).error) };
  const data = r.data!;
  if (JSON.stringify(data).length > MAX_JSON) return { ok: false, issues: [{ path: '', message: 'התוכן ארוך מדי לשמירה אחת' }] };
  return { ok: true, data };
}
