// Unify orders into crm_contacts so every client appears in the Admin COO panel.
// Idempotent: safe to re-run. Usage:
//   node scripts/sync-crm-orders.mjs              # apply (default)
//   node scripts/sync-crm-orders.mjs --dry-run    # preview only
import { readFileSync } from 'node:fs';
import { groupOrders, toCrmRow } from './lib/crm-sync-logic.mjs';

try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // optional when variables are already exported
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
const timeout = () => AbortSignal.timeout(30000);

async function request(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: timeout() });
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function fetchAllOrders() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await request(`orders?select=id,order_number,client_name,contact_phone,contact_id,stage,total_amount&order=created_at.asc,id.asc&limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const orders = await fetchAllOrders();
const { groups, skipped } = groupOrders(orders);
const now = new Date().toISOString();
const rows = groups.map((group) => toCrmRow(group, now));

console.log(`Orders read: ${orders.length} · unique clients: ${groups.length} · skipped (no name/phone): ${skipped.length}`);
if (dryRun) {
  for (const row of rows) console.log(`  ${row.external_id} · ${row.name} · ${row.stage} · orders ${row.orders_count} · ₱${row.lifetime_value}`);
  console.log('DRY RUN — nothing was written.');
  process.exit(0);
}

const contactIdByExternal = new Map();
for (let i = 0; i < rows.length; i += 100) {
  const saved = await request('crm_contacts?on_conflict=channel,external_id&select=id,external_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows.slice(i, i + 100)),
  });
  for (const contact of saved) contactIdByExternal.set(contact.external_id, contact.id);
}

let linked = 0;
for (const group of groups) {
  const contactId = contactIdByExternal.get(group.externalId);
  if (!contactId) throw new Error(`No CRM contact returned for ${group.externalId}`);
  const ids = group.orders.map((order) => order.id);
  await request(`orders?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ contact_id: contactId }),
  });
  linked += ids.length;
}

const countResponse = await fetch(`${supabaseUrl}/rest/v1/crm_contacts?select=id&limit=1`, { headers: { ...headers, Prefer: 'count=exact' }, signal: timeout() });
console.log(`✅ Upserted ${rows.length} client(s) into crm_contacts; linked ${linked} order(s).`);
console.log(`crm_contacts total rows: ${countResponse.headers.get('content-range')?.split('/')[1] ?? 'unknown'}`);
