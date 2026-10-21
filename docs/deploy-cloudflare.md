# Deploying the site to Cloudflare (for Sol)

Everything runs in one Cloudflare account on the free plan: one Worker (the site + /admin), one D1 database (content,
users, sessions, HTML cache), one R2 bucket (images). Nothing else: no GitHub, no mail service, no outside login.
Run every command from `site/`. Nothing here has been run against a real account yet. Locally, the whole flow was tested
with `wrangler dev` and the local D1 + R2 (see "Local" at the end).

## One-time setup

```bash
cd "P_Projects/ANTON BUILDS/marbach_site/site"
npm ci                                   # (needs ~450 MB in node_modules)

# 1. Yossi signs in to Cloudflare once (a browser window opens; approve it)
npx wrangler login
npx wrangler whoami                      # shows the account

# 2. The database (Western Europe is the closest primary location to Israel)
npx wrangler d1 create marbach --location weur
#    → copy the printed database_id into wrangler.jsonc  (d1_databases[0].database_id)

# 3. The image bucket
npx wrangler r2 bucket create marbach-media

# 4. Tables
npm run db:migrate:remote                # = wrangler d1 migrations apply marbach --remote

# 5. Content + images: src/content/* → D1, media/ + media-cache/m → R2 (~225 files, a few minutes)
node scripts/seed.mjs --remote
#    It refuses to run again on a database that already has content (so Ofer's edits are never overwritten);
#    --force replaces everything, --media-only re-uploads only the files.

# 6. Optional, before the first deploy: the public address for canonical/OG links.
#    wrangler.jsonc → vars.SITE_URL = "https://marbach-site.<account>.workers.dev" (or the real domain later).
#    Empty = the address each request came in on (fine for a start).

# 7. Build + deploy (prints the address: https://marbach-site.<account-subdomain>.workers.dev)
npm run deploy                           # = astro build && wrangler deploy

# 8. Users. The password is printed ONCE in the terminal and not saved anywhere: pass it on by hand.
node scripts/create-user.mjs --remote --username yossi --name "יוסי" --role admin
#    Ofer: from /admin → משתמשים → "+ משתמש חדש" (role "עורך/ת תוכן"), or:
node scripts/create-user.mjs --remote --username ofer --name "עפר מרבך" --role editor
#    Forgotten password later: /admin → משתמשים → "איפוס סיסמה" (or the script with --reset).
```

## Check after the first deploy

1. Open the workers.dev address. The site should look the same as https://yossirb9.github.io/marbach/.
2. Open `/admin`, log in, change a text, save, and check that the change is on the site.
3. Keep `npx wrangler tail` running while logging in. On the free plan, a request gets 10 ms CPU. A login hashes the
   password (PBKDF2, 100,000 iterations, about 13 ms on a laptop). If the logs show `exceededCpu` / error 1102 on
   login:
   - set `vars.PBKDF2_ITERATIONS` in wrangler.jsonc to `50000`;
   - run `npm run deploy`;
   - reset the passwords with `create-user.mjs --reset`. Every hash keeps its own iteration count.

   The Workers Paid plan ($5 a month) removes this concern entirely. Public pages are served from the HTML cache, which
   costs one D1 query and no rendering. A page is rendered only once after each save.
4. The site keeps `noindex` until Ofer approves going live: /admin → פרטי קשר והגדרות → uncheck "noindex", then save.

## Later

- **Deploying code changes:** `npm run deploy`. The HTML cache is keyed by content version and by build id, so pages
  rendered by the previous deploy are never served.
- **New tables or columns:** add `migrations/000N_*.sql`, then run `npm run db:migrate:remote` before `npm run deploy`.
- **Backup:** `npx wrangler d1 export marbach --remote --output backup-$(date +%F).sql`. D1 Time Travel can also restore
  the database to a minute in the past: `npx wrangler d1 time-travel restore marbach --timestamp <ISO time>`.
  Images: the bucket keeps every upload (`media/<path>` = the original).
- **Rolling back the code:** `npx wrangler rollback`.
- **Custom domain:** Cloudflare dashboard → Workers → marbach-site → Settings → Domains & Routes. Then set SITE_URL. On a
  custom domain, the images (/m/…) are also kept in Cloudflare's edge cache. On workers.dev, only browsers cache them
  (for a year; the file names never change).
- **Switching off the old site:** the GitHub Actions workflow was removed on this branch. When Cloudflare is live:
  - GitHub repo → Settings → Pages → disable.
  - Delete `.pages.yml`. The admin's labels live in `site/src/admin/formspec.json`, which is edited directly
    from then on (`scripts/gen-formspec.mjs` reads `.pages.yml` and is no longer needed).
  - Disconnect Pages CMS.

## Free-plan limits (more than enough for this site)

| Service | Free limit |
|---|---|
| Workers | 100,000 requests a day, 10 ms CPU per request |
| D1 | 5 GB, 5 million row reads a day, 100,000 row writes a day |
| R2 | 10 GB, 1 million writes and 10 million reads a month, no egress fees |

## Local (no account needed)

```bash
npm run db:migrate:local
node scripts/seed.mjs --local
node scripts/create-user.mjs --local --username yossi --role admin
npm run preview                          # astro build + wrangler dev → http://localhost:8787 (admin: /admin)
# or `npm run dev` (Astro dev server in workerd, same local D1/R2)
```
