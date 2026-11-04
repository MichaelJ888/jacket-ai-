import { NextResponse } from 'next/server';
import { saveFormalQuote, listQuotesByClientToken, isFormalToken } from '../_lib/formal-quote-store.ts';
import { getSupabaseAdmin } from '../_lib/integrations';
import { buildPublicQuote, PublicQuoteError } from '../_lib/public-quote.ts';

export const dynamic = 'force-dynamic';

// Public unified quotation: prices from the official pricelist only, saves a numbered formal quote.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let result: ReturnType<typeof buildPublicQuote>;
  try {
    result = buildPublicQuote(body);
  } catch (error) {
    if (error instanceof PublicQuoteError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Invalid quote input' }, { status: 400 });
  }
  if (result.kind === 'sales') return NextResponse.json({ ok: false, requiresSalesQuote: true, message: result.message }, { status: 422 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const { request, quote } = result;
  try {
    const saved = await saveFormalQuote(supabase, {
      customerName: request.customerName,
      customerContact: request.customerContact,
      productName: request.productName,
      quote,
      inputs: { ...request, source: 'quote-web' },
      channel: 'quote-web',
    });
    return NextResponse.json({
      ok: true,
      quoteNumber: saved.quoteNumber,
      accessToken: saved.accessToken,
      clientToken: saved.clientToken,
      createdAt: saved.createdAt,
      quote,
    });
  } catch (error) {
    console.error('Public quote save failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not save your quote. Please try again.' }, { status: 500 });
  }
}

// Returning client: every quote issued to this client token, newest first.
export async function GET(req: Request) {
  const client = new URL(req.url).searchParams.get('client') || '';
  if (!isFormalToken(client)) return NextResponse.json({ error: 'Invalid client link' }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  try {
    const quotes = await listQuotesByClientToken(supabase, client);
    return NextResponse.json({ ok: true, quotes });
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
