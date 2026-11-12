import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorChatFromRequest } from '../../../_lib/site-content';
import { REPLICATE_BILLING_MESSAGE } from '../../../_lib/replicate';
import { createStudioJob, failStage, startStage } from '../../../_lib/studio';
import { isAllowedStudioAssetUrl, parseStudioMetadata } from '../../../_lib/studio-logic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Starts a studio job. Returns immediately; Replicate reports each stage to /api/admin/studio/webhook.
export async function POST(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  if (!process.env.REPLICATE_API_KEY) return NextResponse.json({ error: 'REPLICATE_API_KEY is not configured' }, { status: 500 });

  const body = (await request.json().catch(() => null)) as { sourceUrl?: unknown; faceUrl?: unknown; logoUrl?: unknown; enhanceScale?: unknown; productTitle?: unknown; category?: unknown; fabric?: unknown; description?: unknown; viewPreset?: unknown; seoCaption?: unknown } | null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!body || !isAllowedStudioAssetUrl(body.sourceUrl, supabaseUrl)) return NextResponse.json({ error: 'sourceUrl must be an uploaded studio image.' }, { status: 400 });
  if (body.faceUrl != null && !isAllowedStudioAssetUrl(body.faceUrl, supabaseUrl)) return NextResponse.json({ error: 'faceUrl must be an uploaded studio image.' }, { status: 400 });
  if (body.logoUrl != null && !isAllowedStudioAssetUrl(body.logoUrl, supabaseUrl)) return NextResponse.json({ error: 'logoUrl must be an uploaded studio image.' }, { status: 400 });

  const faceUrl = typeof body.faceUrl === 'string' ? body.faceUrl : null;
  const logoUrl = typeof body.logoUrl === 'string' ? body.logoUrl : null;
  const enhanceScale = body.enhanceScale === 4 ? 4 : 2;
  const metadata = parseStudioMetadata(body);
  if (!metadata) return NextResponse.json({ error: 'A valid product title, category, and angle preset are required.' }, { status: 400 });
  const origin = new URL(request.url).origin;

  try {
    const job = await createStudioJob(supabase, { sourceUrl: body.sourceUrl, faceUrl, logoUrl, enhanceScale, metadata });
    try {
      await startStage(supabase, job, faceUrl ? 'swap' : 'enhance', origin);
    } catch (error) {
      const billing = await failStage(supabase, job.id, error, 'Could not start Replicate stage');
      if (billing) return NextResponse.json({ error: REPLICATE_BILLING_MESSAGE, code: 'replicate_billing', jobId: job.id }, { status: 402 });
      throw error;
    }
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not start the studio job.' }, { status: 502 });
  }
}
