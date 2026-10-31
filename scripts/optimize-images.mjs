// Creates a WebP sibling (<= 200 KB) for every raster image in public/images that is larger than the budget.
// Originals are kept untouched. Re-run safely: files that already have a WebP sibling are skipped.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, extname, basename, dirname, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..', 'public', 'images');
const BUDGET = 200 * 1024;
const RASTER = new Set(['.jpg', '.jpeg', '.png']);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

async function encodeUnderBudget(file) {
  const base = sharp(file, { failOn: 'none' }).rotate().resize({ width: 1600, withoutEnlargement: true });
  for (const quality of [82, 72, 62, 52, 42]) {
    const buffer = await base.clone().webp({ quality, effort: 4 }).toBuffer();
    if (buffer.length <= BUDGET) return buffer;
  }
  return null;
}

let converted = 0;
let skipped = 0;
for (const file of walk(ROOT)) {
  const ext = extname(file).toLowerCase();
  if (!RASTER.has(ext) || statSync(file).size <= BUDGET) continue;
  const target = join(dirname(file), `${basename(file, extname(file))}.webp`);
  if (existsSync(target)) { skipped += 1; continue; }
  const buffer = await encodeUnderBudget(file);
  if (!buffer) { console.warn(`could not reach budget: ${file}`); continue; }
  await writeFile(target, buffer);
  converted += 1;
  console.log(`${file} -> ${(buffer.length / 1024).toFixed(0)} KB`);
}
console.log(`done: ${converted} converted, ${skipped} already had WebP`);
