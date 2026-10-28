// Seed the MJIC Client Project Status template into mjic_knowledge_items (category 'template').
// Idempotent: skips if a 'template' item with the same title already exists.
// Usage: node scripts/seed-status-template.mjs [path/to/client_project_status_template.md]
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

const templatePath = process.argv[2] || 'C:/Users/pc2/Desktop/client_project_status_template.md';
const title = 'Client Project Status Template (11-milestone production tracker)';
const content = readFileSync(templatePath, 'utf8').slice(0, 20000);

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

const existing = await fetch(
  `${supabaseUrl}/rest/v1/mjic_knowledge_items?category=eq.template&title=eq.${encodeURIComponent(title)}&select=id`,
  { headers, signal: AbortSignal.timeout(20000) },
);
if (!existing.ok) {
  console.error(`Lookup failed: ${existing.status} ${await existing.text()}`);
  process.exit(1);
}
const found = await existing.json();
if (found.length) {
  console.log(`Already seeded (id ${found[0].id}). Nothing to do.`);
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
