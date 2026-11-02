import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { CREDIT_ALERT_THRESHOLD_USD, parseLedgerInput, summarizeBalances } from '../../_lib/credits-logic';
import { appendLedgerEntry, loadLedgerRows } from '../../_lib/credits';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const { rows, error } = await loadLedgerRows(supabase);
  if (error) return NextResponse.json({ error: 'Could not load the credit ledger.' }, { status: 500 });
  return NextResponse.json({
    thresholdUsd: CREDIT_ALERT_THRESHOLD_USD,
    balances: summarizeBalances(rows),
    entries: rows.slice(-50).reverse(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// Body: { provider: 'replicate' | 'fal', kind: 'balance' | 'spend', amountUsd, note? }
// "balance" sets the current balance from the provider dashboard; "spend" records usage since then.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const parsed = parseLedgerInput(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await appendLedgerEntry(supabase, parsed.value);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, entry: result.entry, balances: result.balances, alerted: result.alerted });
}
