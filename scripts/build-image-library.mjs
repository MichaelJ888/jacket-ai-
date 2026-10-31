// Writes public/image-library.json: every local image under public/images that fits the 200 KB budget.
// The visual editor reads this list to pair a local asset with a slot without uploading anything.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const IMAGES = join(ROOT, 'public', 'images');
const OUT = join(ROOT, 'public', 'image-library.json');
const BUDGET = 200 * 1024;
const EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png', '.svg', '.gif']);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const items = walk(IMAGES)
  .filter((file) => EXTENSIONS.has(extname(file).toLowerCase()))
  .map((file) => ({ file, bytes: statSync(file).size }))
  .filter((item) => item.bytes <= BUDGET)
  .map(({ file, bytes }) => {
    const rel = relative(join(ROOT, 'public'), file).split(sep).map(encodeURIComponent).join('/');
    return { src: `/${rel}`, label: relative(IMAGES, file).split(sep).join(' / '), bytes };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

writeFileSync(OUT, `${JSON.stringify({ budgetBytes: BUDGET, items }, null, 0)}\n`);
console.log(`image-library.json: ${items.length} assets`);
