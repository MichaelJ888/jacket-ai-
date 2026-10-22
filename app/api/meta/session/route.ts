import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../_lib/tenant-logic';
import { describeTenant, tenantFromRequest } from '../../_lib/tenants';

export const dynamic = 'force-dynamic';

// GET: who is signed in (null when nobody) plus whether Facebook login is available at all.
export async function GET(request: Request) {
  const tenant = await tenantFromRequest(request).catch(() => null);
  return NextResponse.json({ tenant: tenant ? describeTenant(tenant) : null, oauthConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET) });
}

// DELETE: sign out.
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
