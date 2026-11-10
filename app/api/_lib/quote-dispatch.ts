import { getSupabaseAdmin, sendTelegramDocument } from './integrations.ts';
import { loadQuoteLogo, renderQuotePdf, quoteTotals } from './quote-pdf.ts';
import { createApproval } from './ceo-control.ts';
import { quoteInputFromRow, type QuoteRow } from './quote-dispatch-logic.ts';

type Supabase = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

export const QUOTE_EMAIL_TIMEOUT_MS = 15_000;

const num = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export async function loadQuoteRow(supabase: Supabase, quoteNumber: string): Promise<QuoteRow | null> {
  const { data } = await supabase
    .from('formal_quotes')
    .select('quote_number, customer_name, customer_contact, product_name, breakdown, created_at')
    .eq('quote_number', quoteNumber)
    .maybeSingle();
  return (data as QuoteRow | null) ?? null;
}

export async function renderStoredQuotePdf(row: QuoteRow): Promise<Uint8Array> {
  return renderQuotePdf(quoteInputFromRow(row), await loadQuoteLogo());
}

// Sends the quotation PDF through Resend. Only called after the CEO approves the matching approval.
export async function sendQuoteEmail(to: string, quoteNumber: string, customerName: string, pdf: Uint8Array): Promise<{ ok: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return { ok: false, reason: 'RESEND_API_KEY / RESEND_FROM are not set' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `MJIC quotation ${quoteNumber}`,
        text: `Hello ${customerName},\n\nPlease find your quotation ${quoteNumber} attached.\nA 50% deposit is due to confirm the order. Payment details are on the quotation.\n\nMJIC`,
        attachments: [{ filename: `${quoteNumber}.pdf`, content: Buffer.from(pdf).toString('base64') }],
      }),
      signal: AbortSignal.timeout(QUOTE_EMAIL_TIMEOUT_MS),
    });
    return response.ok ? { ok: true } : { ok: false, reason: `Resend HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'request failed' };
  }
}

// Queues a customer-bound quote email behind CEO approval. Nothing is sent to the customer here.
export async function queueQuoteEmail(quoteNumber: string): Promise<{ queued: boolean; reason?: string }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { queued: false, reason: 'Database unavailable' };
  const row = await loadQuoteRow(supabase, quoteNumber);
  if (!row) return { queued: false, reason: 'Quote not found' };
  const to = row.customer_contact?.trim() || '';
  if (!to.includes('@')) return { queued: false, reason: 'No email address on the quote' };

  const pdf = await renderStoredQuotePdf(row);
  const totals = quoteTotals(quoteInputFromRow(row).items, num(row.breakdown.depositPct, 50));
  const result = await createApproval({
    kind: 'quote_email',
    summary: `Email quotation ${quoteNumber} to ${row.customer_name} <${to}>. Total PHP ${totals.subtotal.toLocaleString('en-PH')}, deposit PHP ${totals.deposit.toLocaleString('en-PH')}.`,
    action: { type: 'send_quote_email', quoteNumber, to },
    amount: totals.subtotal,
  });
  if (result.error || !result.id) return { queued: false, reason: result.error || 'approval not created' };
  await sendTelegramDocument(pdf, `${quoteNumber}.pdf`, `<b>Preview: ${quoteNumber}</b> (not sent yet, awaiting your approval)`);
  return { queued: true };
}
