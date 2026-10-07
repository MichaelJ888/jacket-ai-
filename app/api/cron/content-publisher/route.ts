import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { runContentPipeline, requeueCredentialBlocked } from '../../_lib/content';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const requeued = await requeueCredentialBlocked();
  const summary = await runContentPipeline(new URL(request.url).origin);
  await recordHeartbeat('content-publisher', 'error' in summary ? 'error' : 'ok', { ...summary, requeued });
  return NextResponse.json({ success: true, requeued, ...summary });
}
