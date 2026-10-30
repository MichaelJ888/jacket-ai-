// Import existing clients/orders into the orders table from a CSV file.
// Usage:
//   node scripts/import-orders.mjs path/to/clients.csv            # dry-run (default, nothing is written)
//   node scripts/import-orders.mjs path/to/clients.csv --apply    # actually insert
//
// CSV header (order of columns does not matter; only client_name is required):
//   client_name,project_name,quantity,total_amount,stage,contact_phone,delivery_address
// stage must be one of the 11 pipeline keys (S01_INQUIRY ... S11_DISPATCH), COMPLETED, ON_HOLD or CANCELLED.
//   Shortcuts also work: inquiry, sourcing, design, quote, deposit, paid, sizing, sample, production, qc,
//   balance, dispatch, done, hold, cancel. Legacy words (sewing, cutting, po, packing, ready, delivered) are mapped too.
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

const STAGES = ['S01_INQUIRY', 'S02_SOURCING', 'S03_DESIGN_APPROVAL', 'S04_QUOTATION', 'S05_DEPOSIT', 'S06_SIZING', 'S07_SAMPLE', 'S08_PRODUCTION', 'S09_QC', 'S10_BALANCE', 'S11_DISPATCH', 'COMPLETED', 'ON_HOLD', 'CANCELLED'];
const ALIASES = {
  inquiry: 'S01_INQUIRY', brief: 'S01_INQUIRY',
  sourcing: 'S02_SOURCING', materials: 'S02_SOURCING', po: 'S02_SOURCING',
  design: 'S03_DESIGN_APPROVAL', mockup: 'S03_DESIGN_APPROVAL', artwork: 'S03_DESIGN_APPROVAL',
  quote: 'S04_QUOTATION', quotation: 'S04_QUOTATION',
  deposit: 'S05_DEPOSIT', dp: 'S05_DEPOSIT', downpayment: 'S05_DEPOSIT', awaiting_deposit: 'S05_DEPOSIT',
  sizing: 'S06_SIZING', size: 'S06_SIZING', names: 'S06_SIZING', deposit_verified: 'S06_SIZING', verified: 'S06_SIZING',
  paid: 'S10_BALANCE', fullpaid: 'S10_BALANCE', 'full paid': 'S10_BALANCE', binayaran: 'S10_BALANCE',
  dp: 'S05_DEPOSIT', downpayment: 'S05_DEPOSIT', 'down payment': 'S05_DEPOSIT',
  sample: 'S07_SAMPLE', prototype: 'S07_SAMPLE',
  production: 'S08_PRODUCTION', cutting: 'S08_PRODUCTION', cut: 'S08_PRODUCTION', embroidery: 'S08_PRODUCTION', burda: 'S08_PRODUCTION', sewing: 'S08_PRODUCTION', tahi: 'S08_PRODUCTION', po_drafted: 'S08_PRODUCTION',
  qc: 'S09_QC', checking: 'S09_QC',
  balance: 'S10_BALANCE', packing: 'S10_BALANCE', pack: 'S10_BALANCE',
  dispatch: 'S11_DISPATCH', ready: 'S11_DISPATCH', ready_for_delivery: 'S11_DISPATCH', shipped: 'S11_DISPATCH', dispatched: 'S11_DISPATCH', delivery: 'S11_DISPATCH', delivered: 'S11_DISPATCH',
  done: 'COMPLETED', completed: 'COMPLETED',
  hold: 'ON_HOLD', on_hold: 'ON_HOLD',
  cancel: 'CANCELLED',
};

function resolveStage(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return 'S05_DEPOSIT';
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
await fetch(`${supabaseUrl}/rest/v1/crm_contacts?on_conflict=channel,external_id`, {
  method: 'POST',
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(orders.map((order) => ({
    channel: 'csv_import',
    external_id: order.contact_phone || order.client_name,
    name: order.client_name,
    phone: order.contact_phone,
    stage: 'won',
    orders_count: 1,
    lifetime_value: order.total_amount,
    notes: `Imported from CSV: ${order.project_name || order.order_number}`,
  }))),
  signal: AbortSignal.timeout(30000),
});
console.log(`✅ Imported ${inserted.length} order(s). They will appear in the next 6AM/1PM client pulse.`);
