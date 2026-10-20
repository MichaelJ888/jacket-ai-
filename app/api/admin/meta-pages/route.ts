import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { discoverPages } from '../../_lib/meta-pages';

export const dynamic = 'force-dynamic';

const GRAPH = 'https://graph.facebook.com/v21.0';
const FIELDS = 'messages,messaging_postbacks,feed';

// GET: list every Page the System User token can reach (tokens are never returned).
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const pages = await discoverPages(true);
  return NextResponse.json({ configured: Boolean(process.env.META_SYSTEM_USER_TOKEN), pages: pages.map(({ id, name }) => ({ id, name })) });
}

// POST: subscribe the app to every discovered Page (messages, postbacks, comments) so one webhook serves all of them.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const pages = await discoverPages(true);
  if (!pages.length) return NextResponse.json({ error: 'No Pages found. Set META_SYSTEM_USER_TOKEN and assign Pages to the System User.' }, { status: 400 });

  const results = await Promise.all(pages.map(async (page) => {
    try {
      const response = await fetch(`${GRAPH}/${page.id}/subscribed_apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${page.token}` },
        body: JSON.stringify({ subscribed_fields: FIELDS }),
        signal: AbortSignal.timeout(10000),
      });
      const data = (await response.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
      return { id: page.id, name: page.name, subscribed: Boolean(data.success), error: data.error?.message };
    } catch (error) {
      return { id: page.id, name: page.name, subscribed: false, error: error instanceof Error ? error.message : 'request failed' };
    }
  }));
  return NextResponse.json({ results });
}
