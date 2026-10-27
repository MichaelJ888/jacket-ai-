import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { createMetaPublishingPreflight, runContentPipeline, requeueCredentialBlocked } from '../../_lib/content';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const validateMeta = createMetaPublishingPreflight();
    const requeued = await requeueCredentialBlocked(validateMeta);
    const summary = await runContentPipeline(new URL(request.url).origin, validateMeta);
    const failed = 'error' in summary;
    await recordHeartbeat('content-publisher', failed ? 'error' : summary.failed || summary.videoErrors.length || summary.needsCredentials.length ? 'degraded' : 'ok', { ...summary, requeued });
    return NextResponse.json({ success: !failed, requeued, ...summary }, { status: failed ? 503 : 200 });
  } catch {
    console.error('Content publisher failed; inspect database connectivity and provider diagnostics.');
    await recordHeartbeat('content-publisher', 'error', { error: 'pipeline unavailable' });
    return NextResponse.json({ success: false, error: 'Content pipeline unavailable' }, { status: 503 });
  }
}
