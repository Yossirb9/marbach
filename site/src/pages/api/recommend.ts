// "כתבו המלצה": besides opening WhatsApp / mail to Ofer (as before), the form posts the recommendation here. It waits in
// the admin ("ממתינות לאישור") until Ofer approves it, which turns it into a testimonial on the site.
// Spam protection: same-origin only, a hidden honeypot field, a minimum time on the page, length limits, a limit per IP
// (5 an hour) and for the whole site (100 a day), and the same text from the same sender is stored once.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json, fail, readJson } from '../../lib/api';
import { rateHit, sameOrigin, clientIp, sha256 } from '../../lib/auth';

const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

export const POST: APIRoute = async ({ request, url }) => {
  if (!sameOrigin(request, url)) return fail(403, 'forbidden');
  const b = await readJson<Record<string, unknown>>(request, 20_000);
  if (!b) return fail(400, 'bad request');
  // bots: the honeypot is filled, or the form was sent faster than a person can type. Answer "ok" and store nothing.
  if (clean(b.website, 200) || Number(b.t) < 2500) return json({ ok: true });
  const name = clean(b.name, 80), role = clean(b.role, 120), text = clean(b.text, 3000);
  if (!name || text.length < 5) return fail(400, 'נא למלא שם והמלצה');
  const db = env.DB;
  const ip = clientIp(request);
  const ipHash = (await sha256(`recommend:${ip}`)).slice(0, 24);
  const [perIp, perDay] = await Promise.all([
    rateHit(db, `recommend-ip:${ipHash}`, 5, 3600e3),
    rateHit(db, 'recommend-all', 100, 864e5),
  ]);
  if (perIp.blocked || perDay.blocked) return fail(429, 'נשלחו יותר מדי המלצות. נסו שוב מאוחר יותר.');
  const dup = await db.prepare(`SELECT id FROM submissions WHERE ip_hash = ?1 AND name = ?2 AND text = ?3 AND created_at > ?4`)
    .bind(ipHash, name, text, Date.now() - 3600e3).first();
  if (!dup) {
    await db.prepare(`INSERT INTO submissions (name, role, text, consent, status, ip_hash, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6)`)
      .bind(name, role, text, b.consent ? 1 : 0, ipHash, Date.now()).run();
  }
  return json({ ok: true });
};
