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
 * POST /api/quote/checkout-order
 * Creates a new checkout order with reference generation and Supabase logging.
 * Returns order details including reference code and 50% deposit amount.
 */
export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
    }

    const body: CreateOrderRequest = await request.json();

    // Validate input
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

    // Generate reference code and client token
    const now = new Date();
    const sequenceResult = await supabase
      .from('checkout_orders')
      .select('id', { count: 'exact' })
      .throwOnError();
    const sequenceNumber = (sequenceResult.count || 0) + 1;
    const reference = generateOrderReference(now, sequenceNumber);
    const clientToken = `${reference}-${Math.random().toString(36).slice(2, 10)}`.toLowerCase();

    // Insert order into Supabase
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
        lalamoveEstimatePhp: data.lalamoveEstimatePhp,
        lalamoveVehicle: data.lalamoveVehicle,
      },
    });
  } catch (error) {
    console.error('Checkout order creation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/quote/checkout-order?clientToken=...
 * Retrieves an order by client token.
 */
export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
    }

    const url = new URL(request.url);
    const clientToken = url.searchParams.get('clientToken');

    if (!clientToken) {
      return NextResponse.json({ error: 'clientToken query parameter is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('checkout_orders')
      .select('*')
      .eq('clientToken', clientToken)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, order: data });
  } catch (error) {
    console.error('Checkout order retrieval error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
