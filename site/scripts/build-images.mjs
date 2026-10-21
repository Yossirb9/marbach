// The original media library: every image under site/media/ becomes responsive WebP variants in media-cache/m/, and
// media-cache/images.json maps it:
//   { "<path under media/>": { id, w, h, variants: [{w, src}], full } }
// Only the seed uses this (scripts/seed.mjs uploads media/ + media-cache/m to R2 and the map to D1). On the live site,
// images are uploaded in the admin, which makes the same variants in the browser. media-cache is committed, so a run
// only converts images that are new; variants of images no longer in media/ are removed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const MEDIA = path.join(ROOT, 'media');
const OUT = path.join(ROOT, 'media-cache/m');
const MANIFEST = path.join(ROOT, 'media-cache/images.json');
const WIDTHS = [360, 720, 1200, 1800];

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

const files = walk(MEDIA).filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f));
const old = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const manifest = {};
let made = 0, skipped = 0, failed = [];

for (const file of files) {
  const rel = path.relative(MEDIA, file).split(path.sep).join('/');
  const id = crypto.createHash('sha1').update(rel).digest('hex').slice(0, 10);
  const prev = old[rel];
  // same name but a different file (replaced in place) → convert again
  const sig = crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 12);
  if (prev && prev.sig === sig && prev.variants.every((v) => fs.existsSync(path.join(ROOT, 'media-cache', v.src)))) {
    manifest[rel] = prev; skipped++; continue;
  }
  try {
    const img = sharp(file, { animated: false }).rotate();
    const meta = await img.metadata();
    const w = meta.autoOrient?.width ?? meta.width, h = meta.autoOrient?.height ?? meta.height;
    const widths = WIDTHS.filter((x) => x < w);
    if (!widths.length || w <= WIDTHS.at(-1)) widths.push(Math.min(w, WIDTHS.at(-1)));
    const variants = [];
    for (const vw of [...new Set(widths)]) {
      const name = `${id}-${vw}.webp`;
      await sharp(file).rotate().resize({ width: vw, withoutEnlargement: true })
        .webp({ quality: 78, effort: 5 }).toFile(path.join(OUT, name));
      variants.push({ w: vw, src: `/m/${name}` });
    }
    manifest[rel] = { id, w, h, sig, variants, full: variants.at(-1).src };
    made++;
  } catch (e) {
    failed.push([rel, e.message]);
  }
}

// variants that belong to no image any more (deleted from the media library)
const keep = new Set(Object.values(manifest).flatMap((m) => m.variants.map((v) => path.basename(v.src))));
let removed = 0;
for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) { fs.unlinkSync(path.join(OUT, f)); removed++; }

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`images: ${files.length} files, ${made} converted, ${skipped} cached, ${removed} old variants removed, ${failed.length} failed`);
for (const f of failed) console.log('FAIL', ...f);
if (failed.length) process.exitCode = 1;
