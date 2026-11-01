import { NextResponse, after } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorChatFromRequest } from '../../../_lib/site-content';
import { STUDIO_JOB_COLUMNS, decideStudioJob, postApprovedStudioJob } from '../../../_lib/studio';

export const dynamic = 'force-dynamic';

const COLUMNS = STUDIO_JOB_COLUMNS;

export async function GET(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const { data, error } = await supabase.from('studio_jobs').select(COLUMNS).order('created_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: 'Could not load jobs.' }, { status: 500 });
  return NextResponse.json({ jobs: data ?? [] });
}

// Approval = auto-post: approving queues the image for Facebook + Instagram immediately (same path as the Telegram button).
export async function PATCH(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const body = (await request.json().catch(() => null)) as { id?: unknown; decision?: unknown } | null;
  if (typeof body?.id !== 'string' || (body.decision !== 'approve' && body.decision !== 'reject')) {
    return NextResponse.json({ error: 'Send an id and decision (approve or reject).' }, { status: 400 });
  }
  const { data, error } = await decideStudioJob(supabase, body.id, body.decision);
  if (error) return NextResponse.json({ error: 'Could not record the decision.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Job is not waiting for approval.' }, { status: 409 });
  if (body.decision === 'approve') {
    const jobId = body.id;
    after(() => postApprovedStudioJob(supabase, jobId));
  }
  return NextResponse.json({ job: data });
}
