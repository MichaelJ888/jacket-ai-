// Applies supabase/schema.sql to the live project via the Supabase Management API.
// Requires SUPABASE_ACCESS_TOKEN (personal access token) in .env.local.
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

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!accessToken) {
  console.error('Missing SUPABASE_ACCESS_TOKEN. Generate one at https://supabase.com/dashboard/account/tokens and add it to .env.local.');
  process.exit(1);
}
if (!supabaseUrl) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local.');
  process.exit(1);
}

const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const body = await res.json().catch(() => null);

if (!res.ok) {
  console.error(`Schema push failed (${res.status}):`, body ?? (await res.text()));
  process.exit(1);
}

console.log('Schema applied successfully to project', projectRef);
