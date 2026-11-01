import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorChatFromRequest } from '../../../_lib/site-content';
import { STUDIO_JOB_COLUMNS } from '../../../_lib/studio';

export const dynamic = 'force-dynamic';

// Puts an approved studio image into the public catalog. Only approved/posted jobs with a title and category qualify.
export async function PATCH(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const body = (await request.json().catch(() => null)) as { id?: unknown; inCatalog?: unknown } | null;
  if (typeof body?.id !== 'string' || typeof body.inCatalog !== 'boolean') {
    return NextResponse.json({ error: 'Send an id and inCatalog (true or false).' }, { status: 400 });
  }

  if (body.inCatalog) {
    const { data: job } = await supabase.from('studio_jobs').select('id, status, output_url, product_title, category').eq('id', body.id).maybeSingle();
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    if (!job.output_url || !['approved', 'posted'].includes(job.status)) {
      return NextResponse.json({ error: 'Only approved images can go to the catalog.' }, { status: 409 });
    }
    if (!job.product_title || !job.category) {
      return NextResponse.json({ error: 'Add a product title and category before catalog push.' }, { status: 422 });
    }
  }

  const update = body.inCatalog
    ? { in_catalog: true, featured_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    : { in_catalog: false, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('studio_jobs').update(update).eq('id', body.id).select(STUDIO_JOB_COLUMNS).maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not update the catalog.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  return NextResponse.json({ job: data });
}
