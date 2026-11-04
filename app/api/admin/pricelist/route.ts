import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { loadPricelist, savePricelistCategory } from '../../_lib/pricelist.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, categories: (await loadPricelist()).categories }, { headers: { 'Cache-Control': 'no-store' } });
}

// Create or update one category (labels, active flag, and tier rows). Validation errors return 400.
export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const category = await savePricelistCategory(body, 'admin');
    return NextResponse.json({ ok: true, category });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Save failed';
    const status = message.startsWith('Could not save') ? 500 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
