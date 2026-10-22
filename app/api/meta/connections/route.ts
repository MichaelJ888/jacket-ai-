import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { disconnectPage, listConnections } from '../../_lib/meta-oauth';

export const dynamic = 'force-dynamic';

// GET: connected Pages (tokens are never returned).
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ oauthConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET), appId: process.env.META_APP_ID || null, pages: await listConnections() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

// DELETE ?pageId=...: unsubscribe the webhook and forget the Page.
export async function DELETE(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const pageId = new URL(request.url).searchParams.get('pageId');
  if (!pageId || !/^\d+$/.test(pageId)) return NextResponse.json({ error: 'pageId required' }, { status: 400 });
  try {
    await disconnectPage(pageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
