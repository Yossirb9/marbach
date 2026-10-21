// Imports the current site into Cloudflare: all content from src/content/* into D1, all images into R2
// (originals from media/ → media/<path>, the responsive WebP variants from media-cache/m → m/<file>) and the media map
// (media-cache/images.json) into D1's media table.
//
//   node scripts/seed.mjs --local            the local D1 + R2 of `npm run dev` / `npm run preview` (.wrangler/state)
//   node scripts/seed.mjs --remote           the real database and bucket (after `wrangler login`, d1 create, migrations)
//   options: --content-only | --media-only, --force (replace content that is already there)
//
// Run the migrations first (npx wrangler d1 migrations apply marbach --local|--remote).
// Safety: when the database already has content, the content step stops unless --force is given, so a second run never
// overwrites what was edited in the admin. Media files are only added (existing keys are overwritten with the same bytes).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const target = args.has('--remote') ? '--remote' : args.has('--local') ? '--local' : null;
if (!target) { console.error('usage: node scripts/seed.mjs --local | --remote [--content-only | --media-only] [--force]'); process.exit(1); }
const DB = 'marbach';
const BUCKET = 'marbach-media';
const doContent = !args.has('--media-only');
const doMedia = !args.has('--content-only');
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const wrangler = (argv, opts = {}) => {
  const r = spawnSync(process.execPath, [WRANGLER, ...argv], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error(`wrangler ${argv.slice(0, 3).join(' ')} failed`); }
  return r.stdout;
};
const query = (sql) => JSON.parse(wrangler(['d1', 'execute', DB, target, '--json', '--command', sql]))[0].results;
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// ---------- content ----------
const { SINGLETONS, COLLECTIONS } = await import('../src/lib/schema.ts');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const CONTENT = path.join(ROOT, 'src/content');
const now = Date.now();
const sql = [];

if (doContent) {
  const have = query('SELECT (SELECT COUNT(*) FROM singletons) + (SELECT COUNT(*) FROM entries) AS n')[0].n;
  if (have > 0 && !args.has('--force')) {
    console.error(`The ${target.slice(2)} database already has ${have} content rows (maybe edited in the admin). Nothing changed. Use --force to replace them.`);
    process.exit(2);
  }
  const problems = [];
  const check = (schema, data, what) => { const r = schema.safeParse(data); if (!r.success) problems.push(`${what}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`); };
  const singles = { settings: path.join(CONTENT, 'settings.json'), layout: path.join(CONTENT, 'layout.json') };
  for (const f of fs.readdirSync(path.join(CONTENT, 'pages'))) singles[path.basename(f, '.json')] = path.join(CONTENT, 'pages', f);
  for (const [id, file] of Object.entries(singles)) {
    if (!SINGLETONS[id]) { problems.push(`unknown page ${id}`); continue; }
    const data = readJson(file);
    check(SINGLETONS[id], data, id);
    // stored as written in the file; every render parses it through the schema (defaults applied there)
    sql.push(`INSERT OR REPLACE INTO singletons (id, data, updated_at, updated_by) VALUES (${q(id)}, ${q(JSON.stringify(data))}, ${now}, 'seed');`);
  }
  for (const c of Object.keys(COLLECTIONS)) {
    const dir = path.join(CONTENT, c);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const id = path.basename(f, '.json');
      const data = readJson(path.join(dir, f));
      check(COLLECTIONS[c], data, `${c}/${id}`);
      sql.push(`INSERT OR REPLACE INTO entries (collection, id, data, created_at, updated_at, updated_by) VALUES (${q(c)}, ${q(id)}, ${q(JSON.stringify(data))}, ${now}, ${now}, 'seed');`);
    }
  }
  if (problems.length) { console.error('content does not match src/lib/schema.ts:\n' + problems.join('\n')); process.exit(1); }
  if (args.has('--force')) sql.unshift('DELETE FROM singletons;', 'DELETE FROM entries;');
}

// ---------- media map ----------
const manifest = readJson(path.join(ROOT, 'media-cache/images.json'));
if (doMedia) {
  for (const [rel, m] of Object.entries(manifest)) {
    const orig = path.join(ROOT, 'media', rel);
    const bytes = fs.existsSync(orig) ? fs.statSync(orig).size : null;
    sql.push(`INSERT OR REPLACE INTO media (rel, id, w, h, variants, full, name, bytes, created_at, created_by) VALUES (${q(rel)}, ${q(m.id)}, ${m.w}, ${m.h}, ${q(JSON.stringify(m.variants))}, ${q(m.full)}, ${q(path.basename(rel))}, ${q(bytes)}, ${now}, 'seed');`);
  }
}
if (sql.length) {
  sql.push(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'version';`, 'DELETE FROM html_cache;');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'marbach-seed-'));
  const file = path.join(tmp, 'seed.sql');
  fs.writeFileSync(file, sql.join('\n') + '\n');
  wrangler(['d1', 'execute', DB, target, '--yes', '--file', file]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`D1 (${target.slice(2)}): ${sql.length - 2} rows written`);
}

// ---------- files → R2 ----------
if (doMedia) {
  const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' };
  const files = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'media-cache/m'))) files.push({ key: `m/${f}`, file: path.join(ROOT, 'media-cache/m', f) });
  for (const rel of Object.keys(manifest)) {
    const f = path.join(ROOT, 'media', rel);
    if (fs.existsSync(f)) files.push({ key: `media/${rel}`, file: f });
  }
  const type = (f) => TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';
  if (target === '--local') {
    // straight into the local bucket (the same .wrangler/state the dev server and `wrangler dev` use)
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy({ configPath: path.join(ROOT, 'wrangler.jsonc'), persist: true });
    for (const { key, file } of files) await proxy.env.MEDIA.put(key, fs.readFileSync(file), { httpMetadata: { contentType: type(file) } });
    await proxy.dispose();
  } else {
    let i = 0, done = 0, failed = [];
    const one = () => new Promise((resolve) => {
      const job = files[i++];
      if (!job) return resolve();
      const p = spawn(process.execPath, [WRANGLER, 'r2', 'object', 'put', `${BUCKET}/${job.key}`, '--remote', '--file', job.file, '--content-type', type(job.file)], { cwd: ROOT, stdio: 'ignore' });
      p.on('exit', (code) => { if (code !== 0) failed.push(job.key); if (++done % 20 === 0) console.log(`  ${done}/${files.length}`); one().then(resolve); });
    });
    await Promise.all(Array.from({ length: 6 }, one));
    if (failed.length) { console.error(`failed (${failed.length}), run again with --media-only:`, failed.join(' ')); process.exitCode = 1; }
  }
  console.log(`R2 (${target.slice(2)}): ${files.length} files`);
}
