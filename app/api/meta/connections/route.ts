import { NextResponse } from 'next/server';
import { disconnectPage, listConnections } from '../../_lib/meta-oauth';
import { describeTenant, resolveCaller, tenantScope } from '../../_lib/tenants';

export const dynamic = 'force-dynamic';

// GET: Pages visible to the caller (admin: all, buyer: own). Tokens are never returned.
export async function GET(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({
      oauthConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
      appId: caller.kind === 'admin' ? process.env.META_APP_ID || null : null,
      tenant: caller.kind === 'tenant' ? describeTenant(caller.tenant) : null,
      pages: await listConnections(tenantScope(caller)),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

// DELETE ?pageId=...: unsubscribe the webhook and forget the Page (buyers can only remove their own).
export async function DELETE(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const pageId = new URL(request.url).searchParams.get('pageId');
  if (!pageId || !/^\d+$/.test(pageId)) return NextResponse.json({ error: 'pageId required' }, { status: 400 });
  try {
    const mine = await listConnections(tenantScope(caller));
    if (!mine.some((page) => page.page_id === pageId)) return NextResponse.json({ error: 'Page is not connected' }, { status: 404 });
    await disconnectPage(pageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
