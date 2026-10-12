import { NextResponse } from 'next/server';
import { isMemoryAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';

const SCOPES = ['note', 'decision', 'issue', 'attempt', 'fix'] as const;

// Read-only view into public.agent_memory_events, gated by MEMORY_TOKEN (or an admin token).
export async function GET(req: Request) {
  if (!isMemoryAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const url = new URL(req.url);
  const scope = url.searchParams.get('scope');
  const project = url.searchParams.get('project') || 'jacket-ai';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);

  if (scope && !SCOPES.includes(scope as (typeof SCOPES)[number])) {
    return NextResponse.json({ error: `scope must be one of ${SCOPES.join(', ')}` }, { status: 400 });
  }

  let query = supabase
    .from('agent_memory_events')
    .select('id, scope, summary, location, status, supersedes, created_at, project')
    .eq('project', project)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (scope) query = query.eq('scope', scope);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ events: data });
}
