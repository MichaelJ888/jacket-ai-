import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';
import { CREDIT_ALERT_THRESHOLD_USD, currentBalance, parseLedgerInput, shouldAlertLow, summarizeBalances, type LedgerRow } from '../../_lib/credits-logic';

export const dynamic = 'force-dynamic';

const LEDGER_LIMIT = 5000;

// Returns every ledger row in ascending order so balances can be replayed.
async function loadRows(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  const { data, error } = await supabase
    .from('provider_credit_ledger')
    .select('id, provider, kind, amount_usd, note, created_at')
    .order('id', { ascending: true })
    .limit(LEDGER_LIMIT);
  return { rows: (data ?? []) as Array<LedgerRow & { note: string; created_at: string }>, error };
}

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const { rows, error } = await loadRows(supabase);
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
  const { provider, kind, amountUsd, note } = parsed.value;

  const { rows, error: loadError } = await loadRows(supabase);
  if (loadError) return NextResponse.json({ error: 'Could not load the credit ledger.' }, { status: 500 });
  const before = currentBalance(rows, provider);

  const { data: entry, error } = await supabase
    .from('provider_credit_ledger')
    .insert({ provider, kind, amount_usd: amountUsd, note })
    .select('id, provider, kind, amount_usd, note, created_at')
    .single();
  if (error || !entry) return NextResponse.json({ error: 'Could not save the ledger entry.' }, { status: 500 });

  const updated = [...rows, entry as LedgerRow];
  const after = currentBalance(updated, provider);
  let alerted = false;
  if (shouldAlertLow(before, after)) {
    const label = provider === 'replicate' ? 'Replicate' : 'Fal.ai';
    alerted = await sendTelegramMessage(
      `⚠️ <b>Low AI credits</b>\n${escapeTelegramHtml(label)} balance is <b>$${(after as number).toFixed(2)}</b> (below $${CREDIT_ALERT_THRESHOLD_USD}).\nTop up before image and ad generation stops.`,
    );
  }
  return NextResponse.json({ ok: true, entry, balances: summarizeBalances(updated), alerted });
}
