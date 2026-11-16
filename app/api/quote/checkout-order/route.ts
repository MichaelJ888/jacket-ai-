import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { generateOrderReference, calculateDeposit, validateCheckoutOrder, type CheckoutOrder } from '../../_lib/checkout-order';

export const dynamic = 'force-dynamic';

interface CreateOrderRequest {
  customerName: string;
  customerContact?: string;
  quantity: number;
  totalPhp: number;
  quoteNumber?: string;
  lalamoveEstimatePhp?: number;
  lalamoveVehicle?: 'motorcycle' | 'sedan' | 'mpv' | 'l300';
}

/**
 * GET /api/quote/checkout-order?quoteNumber=MJIC-2026-0001 or ?clientToken=...
 * Retrieves payment reconciliation data for a quote or by client token.
 */
export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
    }

    const url = new URL(request.url);
    const quoteNumber = url.searchParams.get('quoteNumber');
    const orderReference = url.searchParams.get('orderReference');
    const clientToken = url.searchParams.get('clientToken');

    if (!quoteNumber && !orderReference && !clientToken) {
      return NextResponse.json({ error: 'quoteNumber, orderReference, or clientToken query param required' }, { status: 400 });
    }

    // Fetch order from Supabase
    let query = supabase.from('checkout_orders').select('*');
    if (quoteNumber) {
      query = query.eq('quote_number', quoteNumber);
    } else if (orderReference) {
      query = query.eq('reference', orderReference);
    } else if (clientToken) {
      query = query.eq('client_token', clientToken);
    }

    const { data, error } = await query.single();

    if (error || !data) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      order: data,
      orderReference: data.reference,
      quoteNumber: data.quote_number,
      depositAmount: data.deposit_php,
      depositDue: data.deposit_due || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      paymentStatus: data.payment_status || 'pending',
      paymentSlipUrl: data.payment_slip_url || undefined,
      submittedAt: data.payment_submitted_at,
      verifiedAt: data.payment_verified_at,
      verificationNote: data.payment_verification_note,
      orderStatus: data.order_status,
      totalPhp: data.total_php,
      customerName: data.customer_name,
    });
  } catch (error) {
    console.error('[checkout-order GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/quote/checkout-order
 * Creates a new checkout order with reference generation and Supabase logging.
 */
export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
    }

    const body: CreateOrderRequest = await request.json();

    const depositPhp = calculateDeposit(body.totalPhp);
    const errors = validateCheckoutOrder({
      customerName: body.customerName,
      quantity: body.quantity,
      totalPhp: body.totalPhp,
      depositPhp,
      lalamoveEstimatePhp: body.lalamoveEstimatePhp,
    });

    if (errors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const now = new Date();
    const sequenceResult = await supabase
      .from('checkout_orders')
      .select('id', { count: 'exact' })
      .throwOnError();
    const sequenceNumber = (sequenceResult.count || 0) + 1;
    const reference = generateOrderReference(now, sequenceNumber);
    const clientToken = `${reference}-${Math.random().toString(36).slice(2, 10)}`.toLowerCase();

    const orderData: Partial<CheckoutOrder> = {
      reference,
      clientToken,
      quoteNumber: body.quoteNumber || null,
      customerName: body.customerName,
      customerContact: body.customerContact || null,
      quantity: body.quantity,
      totalPhp: body.totalPhp,
      depositPhp,
      depositPaid: false,
      paymentMethod: null,
      lalamoveEstimatePhp: body.lalamoveEstimatePhp || null,
      lalamoveVehicle: body.lalamoveVehicle || null,
      orderStatus: 'draft',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const { data, error } = await supabase.from('checkout_orders').insert([orderData]).select().single();

    if (error) {
      return NextResponse.json({ error: 'Failed to create order', details: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      order: {
        id: data.id,
        reference: data.reference,
        clientToken: data.clientToken,
        totalPhp: data.totalPhp,
        depositPhp: data.depositPhp,
        orderStatus: data.orderStatus,
      },
    });
  } catch (error) {
    console.error('[checkout-order POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
