import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorChatFromRequest } from '../../../_lib/site-content';

export const dynamic = 'force-dynamic';

const COLUMNS = 'id, source_url, face_url, logo_url, output_url, status, error, enhance_scale, created_at, updated_at, decided_at';

export async function GET(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const { data, error } = await supabase.from('studio_jobs').select(COLUMNS).order('created_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: 'Could not load jobs.' }, { status: 500 });
  return NextResponse.json({ jobs: data ?? [] });
}

// Approval gate: nothing is posted to social media from here. Approving only marks the output as ready for a later publisher.
export async function PATCH(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const body = (await request.json().catch(() => null)) as { id?: unknown; decision?: unknown } | null;
  if (typeof body?.id !== 'string' || (body.decision !== 'approve' && body.decision !== 'reject')) {
    return NextResponse.json({ error: 'Send an id and decision (approve or reject).' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('studio_jobs')
    .update({ status: body.decision === 'approve' ? 'approved' : 'rejected', decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .eq('status', 'pending_approval')
    .select(COLUMNS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not record the decision.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Job is not waiting for approval.' }, { status: 409 });
  return NextResponse.json({ job: data });
}
