import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

// Usage: node scripts/ingest-knowledge.mjs --file=<path> --category=<faq|tone|product|size_chart|internal_cost|supplier> --title="..." [--apply]
// Dry-run by default. --apply uploads to /api/admin/knowledge using ADMIN_TOKEN from the environment.
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = arg.match(/^--([\w-]+)(?:=(.*))?$/);
  return match ? [match[1], match[2] ?? true] : [arg, true];
}));

const CATEGORIES = ['faq', 'tone', 'product', 'size_chart', 'internal_cost', 'supplier'];
const MIME_BY_EXTENSION = {
  '.txt': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function main() {
  if (typeof args.file !== 'string' || typeof args.title !== 'string') {
    throw new Error('--file and --title are required.');
  }
  if (!CATEGORIES.includes(args.category)) {
    throw new Error(`--category must be one of: ${CATEGORIES.join(', ')}`);
  }
  const path = resolve(args.file);
  const extension = extname(path).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) throw new Error('Unsupported file type.');
  const { size } = await stat(path);
  const plan = { file: basename(path), bytes: size, category: args.category, title: args.title.slice(0, 120), mimeType };

  if (!args.apply) {
    console.log(JSON.stringify({ mode: 'dry-run', ...plan, next: 'Re-run with --apply to upload.' }, null, 2));
    return;
  }

  const base = typeof args.base === 'string' ? args.base : 'https://jacket-ai.vercel.app';
  const token = process.env.ADMIN_TOKEN;
  if (!token) throw new Error('ADMIN_TOKEN is not set.');
  const form = new FormData();
  form.append('category', args.category);
  form.append('title', args.title);
  form.append('file', new Blob([await readFile(path)], { type: mimeType }), basename(path));
  const response = await fetch(`${base}/api/admin/knowledge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.text();
  console.log(JSON.stringify({ mode: 'apply', status: response.status, body: body.slice(0, 500) }, null, 2));
  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
