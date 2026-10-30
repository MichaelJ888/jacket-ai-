import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { formatPlanPreview, planImport, type RowPlan } from '../../_lib/csv-import-logic';
import { getSupabaseAdmin, sendTelegramMessage, escapeTelegramHtml } from '../../_lib/integrations';
import { buildMessengerLink, csvToTable, fillOptionalColumns, jsonRowsToTable, SUBCON_IMPORT_COLUMNS, SUBCON_IMPORT_KEY } from '../../_lib/subcon-import-logic';

// POST: bulk import of the subcon directory from a user-supplied CSV or JSON file.
// Body: { format: 'csv' | 'json', content?: string (CSV text), rows?: object[] (JSON array), dryRun?: boolean }
// dryRun defaults to true. Nothing is written unless dryRun is false and the file has no validation errors.
export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { format?: unknown; content?: unknown; rows?: unknown; dryRun?: unknown } | null;
  const dryRun = body?.dryRun !== false;

  let table: { header: string[]; rows: string[][] } | null = null;
  if (body?.format === 'csv' && typeof body.content === 'string') table = csvToTable(body.content);
  else if (body?.format === 'json') table = jsonRowsToTable(body.rows ?? (typeof body.content === 'string' ? JSON.parse(body.content) : null));
  if (!table) return NextResponse.json({ error: 'Send format "csv" with content, or format "json" with a rows array' }, { status: 400 });
  if (table.rows.length > 500) return NextResponse.json({ error: 'Import is limited to 500 rows per file' }, { status: 400 });

  const filled = fillOptionalColumns(table);
  const { data: existingRows, error: existingError } = await supabase.from('subcon_directory').select('*');
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  const existing = Object.fromEntries(
    (existingRows || []).map((row) => [
      String(row.name),
      Object.fromEntries(SUBCON_IMPORT_COLUMNS.map((spec) => [spec.name, row[spec.name] === null || row[spec.name] === undefined ? '' : String(row[spec.name])])),
    ]),
  );

  const result = planImport(filled.header, filled.rows, SUBCON_IMPORT_COLUMNS, SUBCON_IMPORT_KEY, existing);
  const withValues = result.plan.filter((item): item is Extract<RowPlan, { values: Record<string, string> }> => 'values' in item);
  for (const item of withValues) {
    if (item.values.messenger_handle && !buildMessengerLink(item.values.messenger_handle)) {
      result.errors.push({ row: item.row, column: 'messenger_handle', message: `"${item.values.messenger_handle}" is not a valid Page username or m.me link` });
    }
  }
  result.ok = result.errors.length === 0;

  const preview = formatPlanPreview(result);
  if (dryRun || !result.ok) {
    return NextResponse.json({ success: true, applied: false, dryRun, counts: result.counts, errors: result.errors, preview });
  }

  const toWrite = withValues;
  const nowIso = new Date().toISOString();
  const payload = toWrite.map((item) => {
    const v = item.values;
    return {
      name: v.name,
      specialty: v.specialty || null,
      contact_phone: v.contact_phone || null,
      location: v.location || null,
      daily_capacity_pcs: v.daily_capacity_pcs === '' ? null : Math.floor(Number(v.daily_capacity_pcs)),
      rate_per_pc: v.rate_per_pc === '' ? null : Number(v.rate_per_pc),
      messenger_handle: v.messenger_handle || null,
      notes: v.notes || null,
      updated_at: nowIso,
    };
  });
  if (payload.length) {
    const { error } = await supabase.from('subcon_directory').upsert(payload, { onConflict: 'name' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void sendTelegramMessage(`🧵 <b>SUBCON IMPORT</b>: ${result.counts.insert} bago, ${result.counts.update} na-update, ${result.counts.unchanged} walang pagbabago.${payload.length ? `\n${payload.slice(0, 10).map((row) => escapeTelegramHtml(row.name)).join(', ')}` : ''}`);
  const links = payload.map((row) => ({ name: row.name, quick_dispatch_url: buildMessengerLink(row.messenger_handle) }));
  return NextResponse.json({ success: true, applied: true, dryRun: false, counts: result.counts, errors: [], preview, links });
}
