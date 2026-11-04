import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { computeFormalQuote, type FormalQuoteInput } from '../../_lib/formal-quote.ts';
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
    } satisfies FormalQuoteInput);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid quote input' }, { status: 400 });
  }

  const productName = body.productName ? String(body.productName).trim().slice(0, 200) : null;
  const accessToken = randomBytes(16).toString('hex');
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const { data, error } = await supabase
    .from('formal_quotes')
    .insert({
      access_token: accessToken,
      customer_name: customerName,
      customer_contact: customerContact,
      product_name: productName,
      product_class: quote.productClass,
      quantity: quote.quantity,
      inputs: body,
      breakdown: quote,
      discount: quote.discount,
      total: quote.total,
      deposit: quote.deposit,
    })
    .select('id, access_token, created_at')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || 'Save failed' }, { status: 500 });

  // CRM upsert is best effort: a failure must not lose the saved quote.
  const isEmail = customerContact?.includes('@') ?? false;
  const { error: crmError } = await supabase.from('crm_contacts').upsert(
    {
      channel: 'formal-quote',
      external_id: (customerContact || customerName).toLowerCase(),
      name: customerName,
      phone: customerContact && !isEmail ? customerContact : null,
      email: isEmail ? customerContact : null,
      stage: 'quoted',
      notes: `Formal quote ${data.id}: total PHP ${quote.total}, deposit PHP ${quote.deposit}`,
    },
    { onConflict: 'channel,external_id' },
  );
  if (crmError) console.error('Formal quote CRM upsert failed:', crmError.message);

  return NextResponse.json({ ok: true, quoteId: data.id, accessToken: data.access_token, createdAt: data.created_at, quote });
}

// Customer history: returns one saved quote by its unguessable access token.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  const { data, error } = await supabase
    .from('formal_quotes')
    .select('id, customer_name, product_name, product_class, quantity, breakdown, total, deposit, created_at')
    .eq('access_token', token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, quote: data });
}
