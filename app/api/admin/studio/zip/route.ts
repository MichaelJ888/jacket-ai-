import { NextResponse } from 'next/server';
import { zipSync } from 'fflate';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorChatFromRequest } from '../../../_lib/site-content';
import { isAllowedStudioAssetUrl } from '../../../_lib/studio-logic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ZIPPABLE_STATUSES = ['pending_approval', 'approved', 'posted'];
const MAX_FILES = 50;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

// Downloads the batch's studio outputs as one ZIP. GET ?ids=<uuid,uuid> limits it to specific jobs.
export async function GET(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const ids = (new URL(request.url).searchParams.get('ids') ?? '').split(',').filter(Boolean);
  if (ids.some((id) => !UUID.test(id))) return NextResponse.json({ error: 'Invalid job id.' }, { status: 400 });

  let query = supabase.from('studio_jobs').select('id, output_url').not('output_url', 'is', null).in('status', ZIPPABLE_STATUSES).order('created_at', { ascending: false }).limit(MAX_FILES);
  if (ids.length) query = query.in('id', ids);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Could not load jobs.' }, { status: 500 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const files: Record<string, Uint8Array> = {};
  for (const job of data ?? []) {
    if (!job.output_url || !isAllowedStudioAssetUrl(job.output_url, supabaseUrl)) continue;
    const res = await fetch(job.output_url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) continue;
    files[`mjic-studio-${job.id.slice(0, 8)}.jpg`] = new Uint8Array(await res.arrayBuffer());
  }
  if (Object.keys(files).length === 0) return NextResponse.json({ error: 'No finished studio images to download yet.' }, { status: 404 });

  const zip = zipSync(files, { level: 0 });
  return new Response(Buffer.from(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="mjic-studio-batch-${new Date().toISOString().slice(0, 10)}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
