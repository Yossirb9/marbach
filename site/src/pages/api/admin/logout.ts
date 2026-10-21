import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json } from '../../../lib/api';
import { destroySession } from '../../../lib/auth';

export const POST: APIRoute = async ({ cookies }) => {
  await destroySession(env.DB, cookies);
  return json({ ok: true });
};
