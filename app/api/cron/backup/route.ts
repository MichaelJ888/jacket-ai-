import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { getSupabaseAdmin, reportCriticalError, sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TABLES = [
  'crm_contacts', 'inbox_messages', 'leads', 'ledger_entries', 'payment_requests', 'profit_allocations', 'staff_profiles',
  'staff_tasks', 'style_examples', 'material_inventory', 'content_calendar', 'approvals', 'ceo_settings',
  'project_costings', 'purchase_orders', 'suppliers_directory', 'dispatch_requests', 'embroidery_jobs',
];
const KEEP = 8;

// Weekly JSON snapshot of the business tables into the private db-backups bucket.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const snapshot: Record<string, unknown[]> = {};
  const failed: string[] = [];
  for (const table of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
      if (error) { failed.push(`${table}: ${error.message}`); break; }
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    snapshot[table] = rows;
  }

  const name = `backup-${new Date().toISOString().slice(0, 10)}.json`;
  const body = new TextEncoder().encode(JSON.stringify({ takenAt: new Date().toISOString(), snapshot }));
  const upload = await supabase.storage.from('db-backups').upload(name, body, { contentType: 'application/json', upsert: true });
  if (upload.error) {
    await reportCriticalError('backup:upload', upload.error);
    return NextResponse.json({ success: false, error: upload.error.message }, { status: 500 });
  }

  const listing = await supabase.storage.from('db-backups').list('', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  const stale = (listing.data || []).slice(KEEP).map((file) => file.name);
  if (stale.length) await supabase.storage.from('db-backups').remove(stale);

  await recordHeartbeat('backup', failed.length ? 'partial' : 'ok', { name, bytes: body.byteLength, failed });
  if (failed.length) void sendTelegramMessage(`<b>Backup partial</b>: ${failed.length} table(s) failed. Check system_logs.`);
  return NextResponse.json({ success: true, name, bytes: body.byteLength, failed });
}
