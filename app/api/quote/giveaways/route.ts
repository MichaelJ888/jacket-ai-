import { NextResponse } from 'next/server';
import { rateLimitResponse } from '../../_lib/rate-limit';
import { recordLead } from '../../_lib/integrations';
import { PAYMENT_DETAILS, PAYMENT_TERMS } from '../../_lib/formal-quote.ts';
import { computeGiveawayQuote, GiveawayQuoteError } from '../../_lib/giveaway-quote.ts';
import { loadGiveawayCatalog } from '../../_lib/giveaway-catalog.ts';
import { isValidGiveawayPhoto } from '../../_lib/giveaway-vision.ts';

export const dynamic = 'force-dynamic';

// Public catalog for the /quote/giveaways page (tiers are public price-list data).
export async function GET() {
  const catalog = await loadGiveawayCatalog();
  return NextResponse.json(
    { ok: true, categories: catalog.filter((cat) => cat.active) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// Instant corporate-giveaways estimate: itemized breakdown + 50% deposit, priced server-side only.
// Not a numbered formal quote (that schema is garment-specific); the request is captured as a lead for sales follow-up.
export async function POST(req: Request) {
  const limited = await rateLimitResponse(req, 'public-quote-giveaways', 10, 60);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const customerName = String(body.customerName ?? '').trim().slice(0, 120);
  if (customerName.length < 2) return NextResponse.json({ error: 'Please enter your name or company name.' }, { status: 400 });
  const customerContact = String(body.customerContact ?? '').trim().slice(0, 120) || null;
  const photo = isValidGiveawayPhoto(body.photo) ? body.photo : null;
  const suggestedCategory = typeof body.suggestedCategory === 'string' ? body.suggestedCategory.slice(0, 40) : null;

  let quote;
  try {
    quote = computeGiveawayQuote(body.items, await loadGiveawayCatalog());
  } catch (error) {
    if (error instanceof GiveawayQuoteError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Invalid quote input' }, { status: 400 });
  }

  const summary = [
    ...quote.lines.map((line) => `${line.label} x${line.quantity} @ PHP ${line.unitPrice}/pc = PHP ${line.subtotal.toLocaleString('en-US')}`),
    `Subtotal PHP ${quote.subtotal.toLocaleString('en-US')} | 50% deposit PHP ${quote.deposit.toLocaleString('en-US')} | balance PHP ${quote.balance.toLocaleString('en-US')}`,
  ].join('\n');
  const lead = await recordLead({
    name: customerName,
    contact: customerContact ?? undefined,
    message: `Corporate giveaways instant estimate:\n${summary}`,
    source: 'giveaways-quote',
    details: { quote, ...(photo ? { photo, suggestedCategory } : {}) },
  });

  return NextResponse.json({
    ok: true,
    kind: 'estimate',
    quote,
    paymentTerms: PAYMENT_TERMS,
    paymentDetails: PAYMENT_DETAILS,
    leadCaptured: lead.saved,
  });
}
