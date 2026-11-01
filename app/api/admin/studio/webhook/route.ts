import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { handleStageCompleted, type StudioJob, type StudioStage } from '../../../_lib/studio';
import type { ReplicatePrediction } from '../../../_lib/replicate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Replicate calls this when a prediction completes. Access is gated by the per-job random token, not by the editor cookie.
export async function POST(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('job') ?? '';
  const token = url.searchParams.get('token') ?? '';
  const stage = url.searchParams.get('stage');
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || (stage !== 'swap' && stage !== 'enhance')) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const { data: job } = await supabase.from('studio_jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job || (job as StudioJob).webhook_token !== token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const prediction = (await request.json().catch(() => null)) as ReplicatePrediction | null;
  if (!prediction?.id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const result = await handleStageCompleted(supabase, job as StudioJob, stage as StudioStage, prediction, url.origin);
  return NextResponse.json({ ok: true, ...result });
}
