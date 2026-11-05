import { NextResponse } from 'next/server';
import { rateLimitResponse } from '../../_lib/rate-limit';
import { recordLead } from '../../_lib/integrations';
import { PAYMENT_DETAILS, PAYMENT_TERMS } from '../../_lib/formal-quote.ts';
import { computeGiveawayQuote, GiveawayQuoteError, marketQuoteLine, quoteFromLines, type GiveawayQuote, type GiveawayQuoteLine } from '../../_lib/giveaway-quote.ts';
import { loadGiveawayCatalog } from '../../_lib/giveaway-catalog.ts';
import { isValidGiveawayPhoto } from '../../_lib/giveaway-vision.ts';
import { marketQuoteSecret, verifyMarketQuote } from '../../_lib/giveaway-market.ts';

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

  let quote: GiveawayQuote;
  try {
    const catalog = await loadGiveawayCatalog();
    let lines: GiveawayQuoteLine[] = [];
    const hasItems = Array.isArray(body.items) && body.items.length > 0;

    // A photo-priced token is optional. Its price is server-signed, so the client cannot set it.
    const hasMarket = body.marketQuote !== undefined && body.marketQuote !== null && body.marketQuote !== '';
    const marketSecret = marketQuoteSecret();
    const market = hasMarket && marketSecret ? verifyMarketQuote(body.marketQuote, marketSecret) : null;
    if (hasMarket && !market) return NextResponse.json({ error: 'Photo price expired. Re-run the photo analysis.' }, { status: 400 });

    if (hasItems || !market) lines = computeGiveawayQuote(body.items, catalog).lines;
    if (market) lines = [...lines, marketQuoteLine(market.label, market.unitPrice, market.quantity)];
    quote = quoteFromLines(lines);
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
