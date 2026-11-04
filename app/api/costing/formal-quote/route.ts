import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { computeFormalQuote, SIGNATORIES, type FormalQuoteInput, type SignatoryKey } from '../../_lib/formal-quote.ts';
import { getQuoteByAccessToken, isFormalToken, saveFormalQuote, type SavedFormalQuote } from '../../_lib/formal-quote-store.ts';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

// Formal quotation: admin computes + saves a quote; the customer reads it later with the access token.
export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const customerName = String(body.customerName || '').trim();
  if (customerName.length < 2) return NextResponse.json({ error: 'customerName is required' }, { status: 400 });
  const customerContact = body.customerContact ? String(body.customerContact).trim().slice(0, 120) : null;

  let quote: ReturnType<typeof computeFormalQuote>;
  try {
    quote = computeFormalQuote({
      quantity: Number(body.quantity),
      marketUnitPrice: Number(body.marketUnitPrice),
      productClass: body.productClass === 'A' ? 'A' : 'B',
      costPerPiece: Number(body.costPerPiece) || 0,
      frontLogos: Number(body.frontLogos) || 0,
      backLogos: Number(body.backLogos) || 0,
      reversible: body.reversible === true,
      hood: body.hood === true,
      threeTone: body.threeTone === true,
      isTshirt: body.isTshirt === true,
      isFullSublimation: body.isFullSublimation === true,
      discountPesos: Number(body.discountPesos) || 0,
      signatory: typeof body.signatory === 'string' && body.signatory in SIGNATORIES ? (body.signatory as SignatoryKey) : undefined,
    } satisfies FormalQuoteInput);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid quote input' }, { status: 400 });
  }

  const productName = body.productName ? String(body.productName).trim().slice(0, 200) : null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  let saved: SavedFormalQuote;
  try {
    saved = await saveFormalQuote(supabase, { customerName, customerContact, productName, quote, inputs: body, channel: 'formal-quote' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Save failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    quoteId: saved.id,
    quoteNumber: saved.quoteNumber,
    accessToken: saved.accessToken,
    clientToken: saved.clientToken,
    createdAt: saved.createdAt,
    quote,
  });
}

// Customer history: returns one saved quote by its unguessable access token.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!isFormalToken(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  let data: Awaited<ReturnType<typeof getQuoteByAccessToken>>;
  try {
    data = await getQuoteByAccessToken(supabase, token);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Lookup failed' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, quote: data });
}
