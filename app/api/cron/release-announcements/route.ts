import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { dispatchReleaseAnnouncements } from '../../_lib/release-announcements';

export const dynamic = 'force-dynamic';

// Release workflow endpoint: ?expect=<release id>. Returns 409 until this deployment's registry head matches.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const expect = new URL(req.url).searchParams.get('expect');
  if (!expect) return NextResponse.json({ error: 'expect=<release id> is required' }, { status: 400 });
  const result = await dispatchReleaseAnnouncements(expect);
  if (result.status === 'not-live') return NextResponse.json({ success: false, ...result }, { status: 409 });
  if (result.status === 'error') return NextResponse.json({ success: false, ...result }, { status: 503 });
  return NextResponse.json({ success: true, ...result });
}
