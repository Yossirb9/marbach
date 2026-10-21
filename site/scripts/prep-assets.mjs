// One-off asset preparation (npm run assets). Not part of the build: its output lands in site/media/, which the CMS
// owns from then on, and build-images.mjs turns media/ into responsive WebP.
//  1. generated illustrations (../assets-src/generated/*.png, ivory paper background) → the paper is "knocked out" into
//     transparency, so each drawing can float as its own parallax layer over any section → media/art/<name>.png
//  2. real photos of Dr. Marbach from ofer-m.com (../media_originals) → cropped copies in media/photos/
//  3. the English book cover (Amazon) and YouTube thumbnails → media/book/, media/video/
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SITE = path.resolve(import.meta.dirname, '..');
const GEN = path.resolve(SITE, '../assets-src/generated');
const ORIG = path.resolve(SITE, '../media_originals');
const MEDIA = path.join(SITE, 'media');
for (const d of ['art', 'photos', 'book', 'video']) fs.mkdirSync(path.join(MEDIA, d), { recursive: true });

// soft thresholds per drawing: [distance from paper where ink starts, where it is fully opaque]
const KNOCK = { hero_bell: [5, 40], ripples: [3, 26], bells_cluster: [6, 44], orchid: [6, 44], iceberg: [6, 44], classroom: [6, 40], book: [6, 42], lectern: [6, 40], og: [5, 40], letter: [6, 42] };
const MAXW = 2000;

async function knockout(file, name) {
  const [lo, hi] = KNOCK[name] ?? [6, 42];
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  // paper colour = median of the four 24px corner patches
  const samples = [];
  for (const [cx, cy] of [[0, 0], [W - 24, 0], [0, H - 24], [W - 24, H - 24]])
    for (let y = cy; y < cy + 24; y++) for (let x = cx; x < cx + 24; x++) { const i = (y * W + x) * 3; samples.push([data[i], data[i + 1], data[i + 2]]); }
  const med = [0, 1, 2].map((c) => samples.map((s) => s[c]).sort((a, b) => a - b)[samples.length >> 1]);
  const out = Buffer.alloc(W * H * 4);
  for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const d = Math.max(Math.abs(r - med[0]), Math.abs(g - med[1]), Math.abs(b - med[2]));
    let a = (d - lo) / (hi - lo); a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
    // un-mix the paper out of semi-transparent pixels so edges do not carry an ivory fringe onto dark sections
    const k = a > 0.02 ? 1 / a : 1;
    out[q] = Math.max(0, Math.min(255, med[0] + (r - med[0]) * k));
    out[q + 1] = Math.max(0, Math.min(255, med[1] + (g - med[1]) * k));
    out[q + 2] = Math.max(0, Math.min(255, med[2] + (b - med[2]) * k));
    out[q + 3] = Math.round(a * 255);
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 1 }).resize({ width: Math.min(W, MAXW), withoutEnlargement: true })
    .png({ compressionLevel: 9 }).toFile(path.join(MEDIA, 'art', `${name}.png`));
  // an opaque copy too (paper kept) for places that want the full plate
  await sharp(file).resize({ width: Math.min(W, MAXW), withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(MEDIA, 'art', `${name}-plate.jpg`));
  console.log('art', name, 'paper', med.join(','));
}

if (fs.existsSync(GEN)) for (const f of fs.readdirSync(GEN).filter((f) => f.endsWith('.png'))) await knockout(path.join(GEN, f), f.replace(/\.png$/, ''));

// the bell alone (no beam, none of the faint drawn rings) for the pinned scene, where the rings are live SVG
{
  const f = path.join(GEN, 'hero_bell.png');
  if (fs.existsSync(f)) {
    const tmp = path.join(GEN, '..', 'bell_only_src.png');
    const meta = await sharp(f).metadata();
    const k = meta.width / 1672;
    await sharp(f).extract({ left: Math.round(112 * k), top: Math.round(150 * k), width: Math.round(366 * k), height: Math.round(568 * k) }).toFile(tmp);
    KNOCK.bell_only = [16, 52];
    await knockout(tmp, 'bell_only');
  }
}

const photo = async (src, dest, crop) => {
  const p = path.join(ORIG, src);
  if (!fs.existsSync(p)) return console.log('missing', src);
  let s = sharp(p).flatten({ background: '#1c2b2d' });
  if (crop) s = s.extract(crop);
  await s.jpeg({ quality: 90 }).toFile(path.join(MEDIA, dest));
  console.log('photo', dest);
};
// the leaning-on-the-TED-letters portrait sits inside a rounded card with a squiggle: keep only the photo
await photo('Group-185340@2x.webp', 'photos/ofer-tedx-letters.jpg', { left: 140, top: 112, width: 1270, height: 1390 });
await photo('ribui-4.webp', 'photos/ofer-tedx-stage.jpg');
await photo('ribui-3.webp', 'photos/ofer-with-children.jpg');
await photo('amazon-cover.jpg', 'book/growing-the-orchids.jpg');
const yt = path.join(ORIG, 'yt');
if (fs.existsSync(yt)) for (const f of fs.readdirSync(yt).filter((f) => f.endsWith('.jpg'))) fs.copyFileSync(path.join(yt, f), path.join(MEDIA, 'video', f));
console.log('done');
