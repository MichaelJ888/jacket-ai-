import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorChatFromRequest } from '../../../_lib/site-content';
import { createStudioJob, failJob, startStage } from '../../../_lib/studio';
import { isAllowedStudioAssetUrl } from '../../../_lib/studio-logic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Starts a studio job. Returns immediately; Replicate reports each stage to /api/admin/studio/webhook.
export async function POST(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  if (!process.env.REPLICATE_API_KEY) return NextResponse.json({ error: 'REPLICATE_API_KEY is not configured' }, { status: 500 });

  const body = (await request.json().catch(() => null)) as { sourceUrl?: unknown; faceUrl?: unknown; logoUrl?: unknown; enhanceScale?: unknown } | null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!body || !isAllowedStudioAssetUrl(body.sourceUrl, supabaseUrl)) return NextResponse.json({ error: 'sourceUrl must be an uploaded studio image.' }, { status: 400 });
  if (body.faceUrl != null && !isAllowedStudioAssetUrl(body.faceUrl, supabaseUrl)) return NextResponse.json({ error: 'faceUrl must be an uploaded studio image.' }, { status: 400 });
  if (body.logoUrl != null && !isAllowedStudioAssetUrl(body.logoUrl, supabaseUrl)) return NextResponse.json({ error: 'logoUrl must be an uploaded studio image.' }, { status: 400 });

  const faceUrl = typeof body.faceUrl === 'string' ? body.faceUrl : null;
  const logoUrl = typeof body.logoUrl === 'string' ? body.logoUrl : null;
  const enhanceScale = body.enhanceScale === 4 ? 4 : 2;
  const origin = new URL(request.url).origin;

  try {
    const job = await createStudioJob(supabase, { sourceUrl: body.sourceUrl, faceUrl, logoUrl, enhanceScale });
    try {
      await startStage(supabase, job, faceUrl ? 'swap' : 'enhance', origin);
    } catch (error) {
      await failJob(supabase, job.id, error instanceof Error ? error.message : 'Could not start Replicate stage');
      throw error;
    }
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not start the studio job.' }, { status: 502 });
  }
}
