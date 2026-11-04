import { NextResponse } from 'next/server';

import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { parseQaBatch } from '../../_lib/qa-logic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Batch ingestion of website Q&A pairs. New rows default to 'approved' so the Sales Closer uses them immediately; pass status 'pending' to hold a row.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON.' }, { status: 400 });
  }
  const { pairs, errors } = parseQaBatch(body);
  if (errors.length) return NextResponse.json({ success: false, errors }, { status: 400 });

  const { data, error } = await supabase
    .from('mjic_qa_pairs')
    .insert(pairs.map((pair) => ({ ...pair, updated_at: new Date().toISOString() })))
    .select('id, status');
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, inserted: data?.length ?? 0 });
}

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const { data, error } = await supabase
    .from('mjic_qa_pairs')
    .select('id, question, answer, status, source, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, items: data || [] });
}
