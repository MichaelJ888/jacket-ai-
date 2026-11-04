import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { queueQuoteEmail } from '../../_lib/quote-dispatch.ts';

export const dynamic = 'force-dynamic';

// Admin-only manual dispatch of a saved quotation. The customer email is queued for CEO approval, never sent directly.
export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { quoteNumber?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const quoteNumber = typeof body.quoteNumber === 'string' ? body.quoteNumber.trim() : '';
  if (!/^MJIC-\d{4}-\d{4}$/.test(quoteNumber)) return NextResponse.json({ error: 'quoteNumber must look like MJIC-YYYY-NNNN' }, { status: 400 });

  const result = await queueQuoteEmail(quoteNumber);
  return NextResponse.json({ ok: result.queued, ...result }, { status: result.queued ? 202 : 422 });
}
