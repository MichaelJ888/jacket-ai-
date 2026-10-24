// Sync the Pages that MJIC's System User owns into Supabase meta_connections, so auto-post can resolve their tokens.
//   node scripts/auto-assign-pages.mjs              dry run: lists what would be written, changes nothing
//   node scripts/auto-assign-pages.mjs --write      writes MJIC-owned Pages to meta_connections
// Uses META_SYSTEM_USER_TOKEN from .env.local. Only Pages assigned to that System User are read.
// Pages already linked to a buyer tenant (tenant_id set) are never touched, so buyer connections stay intact.
// Page tokens are never printed.
import { readFileSync } from 'node:fs';

const envPath = new URL('../.env.local', import.meta.url);
try {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // .env.local optional if variables are already exported in the shell
}

const GRAPH = 'https://graph.facebook.com/v21.0';
const write = process.argv.includes('--write');
const systemToken = process.env.META_SYSTEM_USER_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!systemToken || !supabaseUrl || !serviceKey) {
  console.error('Missing META_SYSTEM_USER_TOKEN, NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  process.exit(1);
}

const table = `${supabaseUrl}/rest/v1/meta_connections`;
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

async function listSystemUserPages() {
  const pages = [];
  let url = `${GRAPH}/me/accounts?fields=id,name,access_token&limit=100`;
  for (let guard = 0; url && guard < 20; guard += 1) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${systemToken}` }, signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Graph /me/accounts failed (${res.status}): ${JSON.stringify(body.error || body)}`);
    for (const page of body.data || []) if (page.id && page.access_token) pages.push(page);
    url = body.paging?.next || null;
  }
  return pages;
}

async function tenantOwnedPageIds() {
  const res = await fetch(`${table}?select=page_id&tenant_id=not.is.null`, { headers, signal: AbortSignal.timeout(15000) });
  const rows = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${JSON.stringify(rows)}`);
  return new Set((rows || []).map((row) => row.page_id));
}

async function upsertPage(page) {
  const res = await fetch(`${table}?on_conflict=page_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      page_id: page.id,
      page_name: page.name,
      page_access_token: page.access_token,
      connected_by: 'system-user:auto-assign',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Supabase upsert failed for ${page.id} (${res.status}): ${await res.text()}`);
}

try {
  const pages = await listSystemUserPages();
  const tenantOwned = await tenantOwnedPageIds();
  const targets = pages.filter((page) => !tenantOwned.has(page.id));

  console.log(`System User sees ${pages.length} Page(s); ${pages.length - targets.length} linked to buyer tenants (skipped).`);
  for (const page of targets) console.log(`  ${page.name} (${page.id})`);

  if (!write) {
    console.log(targets.length ? 'Dry run. Re-run with --write to save these Pages.' : 'Nothing to write.');
    process.exit(0);
  }

  for (const page of targets) await upsertPage(page);
  console.log(`Saved ${targets.length} Page(s) to meta_connections.`);
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
}
