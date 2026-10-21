// Small helpers for the JSON endpoints under src/pages/api.
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ ok: false, error, ...extra }, status);

/** the JSON body of a request, at most `max` bytes */
export async function readJson<T = Record<string, unknown>>(request: Request, max = 1_000_000): Promise<T | null> {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > max) return null;
  const text = await request.text();
  if (text.length > max) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

export const who = (u: { username: string; display_name: string } | null | undefined) => (u ? u.display_name || u.username : '');
