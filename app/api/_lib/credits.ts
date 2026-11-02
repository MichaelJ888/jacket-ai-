import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from './integrations';
import { CREDIT_ALERT_THRESHOLD_USD, CREDIT_PROVIDER_LABELS, currentBalance, shouldAlertLow, summarizeBalances, type CreditProvider, type LedgerRow } from './credits-logic';

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

export const LEDGER_LIMIT = 5000;

// Returns every ledger row in ascending order so balances can be replayed.
export async function loadLedgerRows(supabase: AdminClient) {
  const { data, error } = await supabase
    .from('provider_credit_ledger')
    .select('id, provider, kind, amount_usd, note, created_at')
    .order('id', { ascending: true })
    .limit(LEDGER_LIMIT);
  return { rows: (data ?? []) as Array<LedgerRow & { note: string; created_at: string }>, error };
}

// Appends one ledger row and sends a Telegram alert only when the balance crosses below the threshold.
export async function appendLedgerEntry(
  supabase: AdminClient,
  input: { provider: CreditProvider; kind: 'balance' | 'spend'; amountUsd: number; note: string },
) {
  const { rows, error: loadError } = await loadLedgerRows(supabase);
  if (loadError) return { ok: false as const, error: 'Could not load the credit ledger.' };
  const before = currentBalance(rows, input.provider);

  const { data: entry, error } = await supabase
    .from('provider_credit_ledger')
    .insert({ provider: input.provider, kind: input.kind, amount_usd: input.amountUsd, note: input.note })
    .select('id, provider, kind, amount_usd, note, created_at')
    .single();
  if (error || !entry) return { ok: false as const, error: 'Could not save the ledger entry.' };

  const updated = [...rows, entry as LedgerRow];
  const after = currentBalance(updated, input.provider);
  let alerted = false;
  if (shouldAlertLow(before, after)) {
    const label = CREDIT_PROVIDER_LABELS[input.provider];
    alerted = await sendTelegramMessage(
      `⚠️ <b>Low AI credits</b>\n${escapeTelegramHtml(label)} balance is <b>$${(after as number).toFixed(2)}</b> (below $${CREDIT_ALERT_THRESHOLD_USD}).\nTop up before image and ad generation stops.`,
    );
  }
  return { ok: true as const, entry, balances: summarizeBalances(updated), alerted };
}

// Usage hook: records a spend row for a completed provider call. Never throws, so billing bookkeeping cannot break a job.
export async function recordProviderSpend(provider: CreditProvider, amountUsd: number, note: string) {
  if (!(amountUsd > 0)) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  try {
    await appendLedgerEntry(supabase, { provider, kind: 'spend', amountUsd: Number(amountUsd.toFixed(4)), note: note.slice(0, 200) });
  } catch (error) {
    console.error('Credit ledger spend not recorded', error);
  }
}
