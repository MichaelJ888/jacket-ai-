import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../_lib/auth';
import { getSupabaseAdmin } from '../_lib/integrations';

export const dynamic = 'force-dynamic';

const AUDIENCES = ['client', 'employee', 'supplier'];

// Bulk-teach the AI how the CEO answers. Body: { audience, examples: [{ prompt?, reply }] } or { audience, text } (blank-line separated).
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as { audience?: string; text?: string; examples?: Array<{ prompt?: string; reply?: string }> };
  const audience = AUDIENCES.includes(body.audience || '') ? (body.audience as string) : 'client';
  const examples = (body.examples || []).filter((item) => item.reply?.trim());
  if (body.text?.trim()) {
    for (const chunk of body.text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) examples.push({ reply: chunk });
  }
  if (!examples.length) return NextResponse.json({ error: 'Provide examples[] or text' }, { status: 400 });

  const rows = examples.slice(0, 200).map((item) => ({
    kind: audience,
    audience,
    prompt: item.prompt?.trim().slice(0, 1000) || null,
    example: item.reply!.trim().slice(0, 1000),
  }));
  const { error } = await supabase.from('style_examples').insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, saved: rows.length, audience });
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const counts: Record<string, number> = {};
  for (const audience of AUDIENCES) {
    const { count } = await supabase.from('style_examples').select('id', { count: 'exact', head: true }).eq('audience', audience);
    counts[audience] = count || 0;
  }
  return NextResponse.json({ success: true, counts });
}

