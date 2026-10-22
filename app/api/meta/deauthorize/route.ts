import { NextResponse } from 'next/server';
import { publicBaseUrl } from '../../_lib/channels';
import { deleteTenantByFacebookUser } from '../../_lib/tenants';
import { parseSignedRequest } from '../../_lib/tenant-logic';

export const dynamic = 'force-dynamic';

// Meta's Deauthorize callback: a buyer removed the app in Facebook settings, so forget them and their Page tokens.
// The signed_request HMAC is the only auth - unsigned or forged calls are rejected.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const payload = parseSignedRequest(String(form?.get('signed_request') || ''), process.env.META_APP_SECRET);
  if (!payload?.user_id) return NextResponse.json({ error: 'Invalid signed_request' }, { status: 400 });
  try {
    await deleteTenantByFacebookUser(payload.user_id);
    return NextResponse.json({ ok: true, url: `${publicBaseUrl()}/data-deletion` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
