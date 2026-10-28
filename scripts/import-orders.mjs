// Import existing clients/orders into the orders table from a CSV file.
// Usage:
//   node scripts/import-orders.mjs path/to/clients.csv            # dry-run (default, nothing is written)
//   node scripts/import-orders.mjs path/to/clients.csv --apply    # actually insert
//
// CSV header (order of columns does not matter; only client_name is required):
//   client_name,project_name,quantity,total_amount,stage,contact_phone,delivery_address
// stage must be one of: AWAITING_DEPOSIT, DEPOSIT_VERIFIED, PO_DRAFTED, CUTTING,
//   EMBROIDERY, SEWING, QC, PACKING, READY_FOR_DELIVERY, DISPATCHED, DELIVERED, ON_HOLD
//   (case-insensitive; common shortcuts like "sewing", "deposit", "ready" also work)
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

const STAGES = ['AWAITING_DEPOSIT', 'DEPOSIT_VERIFIED', 'PO_DRAFTED', 'CUTTING', 'EMBROIDERY', 'SEWING', 'QC', 'PACKING', 'READY_FOR_DELIVERY', 'DISPATCHED', 'DELIVERED', 'ON_HOLD'];
const ALIASES = {
  deposit: 'AWAITING_DEPOSIT', dp: 'AWAITING_DEPOSIT', downpayment: 'AWAITING_DEPOSIT',
  paid: 'DEPOSIT_VERIFIED', verified: 'DEPOSIT_VERIFIED',
  po: 'PO_DRAFTED', materials: 'PO_DRAFTED',
  cut: 'CUTTING', cutting: 'CUTTING',
  embroidery: 'EMBROIDERY', burda: 'EMBROIDERY',
  sewing: 'SEWING', tahi: 'SEWING',
  qc: 'QC', checking: 'QC',
  pack: 'PACKING', packing: 'PACKING',
  ready: 'READY_FOR_DELIVERY',
  shipped: 'DISPATCHED', dispatch: 'DISPATCHED', dispatched: 'DISPATCHED', delivery: 'DISPATCHED',
  delivered: 'DELIVERED',
  hold: 'ON_HOLD',
};

function resolveStage(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return 'AWAITING_DEPOSIT';
  if (ALIASES[key]) return ALIASES[key];
  const upper = key.toUpperCase();
  return STAGES.includes(upper) ? upper : null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (char === '"') { inQuotes = false; } else { field += char; }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

const args = process.argv.slice(2);
const csvPath = args.find((arg) => !arg.startsWith('--'));
const apply = args.includes('--apply');

if (!csvPath) {
  console.error('Usage: node scripts/import-orders.mjs <clients.csv> [--apply]');
  process.exit(1);
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
if (rows.length < 2) {
  console.error('CSV needs a header row plus at least one client row.');
  process.exit(1);
}

const header = rows[0].map((cell) => cell.trim().toLowerCase());
const column = (name) => header.indexOf(name);
if (column('client_name') === -1) {
  console.error('CSV header must include client_name. Got: ' + header.join(', '));
  process.exit(1);
}

const batch = Date.now().toString().slice(-6);
const orders = [];
const errors = [];
rows.slice(1).forEach((cells, index) => {
  const line = index + 2;
  const get = (name) => (column(name) === -1 ? '' : (cells[column(name)] || '').trim());
  const clientName = get('client_name');
  if (!clientName) { errors.push(`line ${line}: missing client_name`); return; }
  const stage = resolveStage(get('stage'));
  if (!stage) { errors.push(`line ${line}: unknown stage "${get('stage')}"`); return; }
  const total = Number(String(get('total_amount')).replace(/[₱,\s]|php/gi, '')) || 0;
  const quantity = Number(get('quantity')) || null;
  orders.push({
    order_number: `ORD-I${batch}${String(index).padStart(2, '0')}`,
    client_name: clientName,
    project_name: get('project_name') || null,
    quantity,
    total_amount: total,
    deposit_amount: Math.round(total * 50) / 100,
    stage,
    contact_phone: get('contact_phone') || null,
    delivery_address: get('delivery_address') || null,
  });
});

console.log(`Parsed ${orders.length} order(s), ${errors.length} error(s).`);
for (const error of errors) console.log('  ERROR: ' + error);
for (const order of orders) console.log(`  ${order.order_number} · ${order.client_name} · ${order.stage} · ₱${order.total_amount}`);

if (!apply) {
  console.log('\nDRY RUN — nothing was written. Re-run with --apply to insert.');
  process.exit(errors.length ? 1 : 0);
}

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  process.exit(1);
}
if (!orders.length) process.exit(1);

const response = await fetch(`${supabaseUrl}/rest/v1/orders`, {
  method: 'POST',
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify(orders),
  signal: AbortSignal.timeout(30000),
});

if (!response.ok) {
  console.error(`Insert failed: ${response.status} ${await response.text()}`);
  process.exit(1);
}
const inserted = await response.json();
await fetch(`${supabaseUrl}/rest/v1/order_events`, {
  method: 'POST',
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(inserted.map((order) => ({ order_id: order.id, to_stage: order.stage, note: 'Imported from CSV' }))),
  signal: AbortSignal.timeout(30000),
});
console.log(`✅ Imported ${inserted.length} order(s). They will appear in the next 6AM/1PM client pulse.`);
