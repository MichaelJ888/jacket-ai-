// Pure helpers for the AI provider credit ledger. Rows must be passed in ascending id order.

export const CREDIT_PROVIDERS = ['replicate', 'fal'] as const;
export type CreditProvider = (typeof CREDIT_PROVIDERS)[number];
export const CREDIT_PROVIDER_LABELS: Record<CreditProvider, string> = { replicate: 'Replicate', fal: 'Fal.ai' };
export const CREDIT_ALERT_THRESHOLD_USD = 10;

export type LedgerRow = { id: number; provider: CreditProvider; kind: 'balance' | 'spend'; amount_usd: number };

export function currentBalance(rows: LedgerRow[], provider: CreditProvider): number | null {
  let balance: number | null = null;
  for (const row of rows) {
    if (row.provider !== provider) continue;
    if (row.kind === 'balance') balance = row.amount_usd;
    else if (balance !== null) balance -= row.amount_usd;
  }
  return balance === null ? null : Number(balance.toFixed(4));
}

export function summarizeBalances(rows: LedgerRow[]) {
  return CREDIT_PROVIDERS.map((provider) => {
    const balanceUsd = currentBalance(rows, provider);
    return { provider, label: CREDIT_PROVIDER_LABELS[provider], balanceUsd, low: balanceUsd !== null && balanceUsd < CREDIT_ALERT_THRESHOLD_USD };
  });
}

// Alert once per crossing below the threshold, not on every entry while the balance stays low.
export function shouldAlertLow(before: number | null, after: number | null): boolean {
  return after !== null && after < CREDIT_ALERT_THRESHOLD_USD && (before === null || before >= CREDIT_ALERT_THRESHOLD_USD);
}

export function parseLedgerInput(body: unknown):
  | { ok: true; value: { provider: CreditProvider; kind: 'balance' | 'spend'; amountUsd: number; note: string } }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Expected an object.' };
  const source = body as Record<string, unknown>;
  const provider = CREDIT_PROVIDERS.find((item) => item === source.provider);
  if (!provider) return { ok: false, error: 'Provider must be replicate or fal.' };
  if (source.kind !== 'balance' && source.kind !== 'spend') return { ok: false, error: 'Kind must be balance or spend.' };
  const raw = source.amountUsd;
  const amount = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return { ok: false, error: 'Amount must be a number from 0 to 1,000,000 USD.' };
  const note = typeof source.note === 'string' ? source.note.trim().slice(0, 200) : '';
  return { ok: true, value: { provider, kind: source.kind, amountUsd: Number(amount.toFixed(4)), note } };
}
