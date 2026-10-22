import { NextResponse } from 'next/server';
import { checkPageHealth, resubscribePage } from '../../../_lib/meta-health';
import { listConnections } from '../../../_lib/meta-oauth';
import { resolveCaller, tenantScope } from '../../../_lib/tenants';

export const dynamic = 'force-dynamic';

const PAGE_ID = /^\d+$/;

// GET ?pageId=: per-check pass/fail with fix hints for one connected Page (buyers: own Pages only).
export async function GET(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const pageId = new URL(request.url).searchParams.get('pageId');
  if (!pageId || !PAGE_ID.test(pageId)) return NextResponse.json({ error: 'pageId required' }, { status: 400 });
  try {
    const page = (await listConnections(tenantScope(caller))).find((item) => item.page_id === pageId);
    if (!page) return NextResponse.json({ error: 'Page is not connected' }, { status: 404 });
    return NextResponse.json({ pageId, ...(await checkPageHealth(pageId, page.ig_user_id)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

// POST { pageId }: re-subscribe the webhook, then return fresh health.
export async function POST(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { pageId?: string };
  if (!body.pageId || !PAGE_ID.test(body.pageId)) return NextResponse.json({ error: 'pageId required' }, { status: 400 });
  try {
    const page = (await listConnections(tenantScope(caller))).find((item) => item.page_id === body.pageId);
    if (!page) return NextResponse.json({ error: 'Page is not connected' }, { status: 404 });
    const result = await resubscribePage(body.pageId);
    return NextResponse.json({ resubscribed: result.ok, error: result.error, pageId: body.pageId, ...(await checkPageHealth(body.pageId, page.ig_user_id)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
