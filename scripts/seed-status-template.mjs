// Seed the MJIC Client Project Status template into mjic_knowledge_items (category 'template').
// Idempotent: inserts when missing; if the stored copy differs it is NOT overwritten unless --update is passed.
// Usage: node scripts/seed-status-template.mjs [path/to/client_project_status_template.md] [--update]
import { readFileSync } from 'node:fs';

const envPath = new URL('../.env.local', import.meta.url);
try {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // .env.local optional if vars are already exported in the shell
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  process.exit(1);
}

const args = process.argv.slice(2);
const allowUpdate = args.includes('--update');
const templatePath = args.find((arg) => !arg.startsWith('--')) || 'C:/Users/pc2/Desktop/client_project_status_template.md';
const title = 'Client Project Status Template (11-milestone production tracker)';

// Strict UTF-8 (throws on invalid bytes instead of writing U+FFFD garbage), strips BOM, normalizes CRLF.
const content = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(templatePath)).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
if (content.length > 20000) {
  console.error(`Template is ${content.length} chars (limit 20000). Refusing to truncate silently.`);
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

const existing = await fetch(
  `${supabaseUrl}/rest/v1/mjic_knowledge_items?category=eq.template&title=eq.${encodeURIComponent(title)}&select=id,content`,
  { headers, signal: AbortSignal.timeout(20000) },
);
if (!existing.ok) {
  console.error(`Lookup failed: ${existing.status} ${await existing.text()}`);
  process.exit(1);
}
const found = await existing.json();
if (found.length) {
  const [row] = found;
  if (row.content === content) {
    console.log(`Already seeded and up to date (id ${row.id}). Nothing to do.`);
    process.exit(0);
  }
  if (!allowUpdate) {
    console.log(`Seeded template (id ${row.id}) differs from ${templatePath}. Not overwritten; re-run with --update to replace it.`);
    process.exit(0);
  }
  const patch = await fetch(`${supabaseUrl}/rest/v1/mjic_knowledge_items?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(20000),
  });
  if (!patch.ok) {
    console.error(`Update failed: ${patch.status} ${await patch.text()}`);
    process.exit(1);
  }
  console.log(`✅ Updated template knowledge item ${row.id} from ${templatePath}.`);
  process.exit(0);
}

const insert = await fetch(`${supabaseUrl}/rest/v1/mjic_knowledge_items`, {
  method: 'POST',
  headers: { ...headers, Prefer: 'return=representation' },
  body: JSON.stringify({ category: 'template', title, content, file_name: 'client_project_status_template.md', mime_type: 'text/plain' }),
  signal: AbortSignal.timeout(20000),
});
if (!insert.ok) {
  console.error(`Insert failed: ${insert.status} ${await insert.text()}`);
  process.exit(1);
}
const [row] = await insert.json();
console.log(`✅ Seeded template as knowledge item ${row.id} (category 'template').`);
