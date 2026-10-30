import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { manilaToday } from '../../_lib/production-quota-logic';
import { recordSystemHealth, runSelfHeal, runSystemHealthAudit } from '../../_lib/system-health';

// GET: AI COO health audit for every MJIC feature (admin only, read-only).
// POST: audit + safe self-heal (re-sends alerts only; no money, stock, or order data changes).
export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const today = manilaToday();
  const checks = await runSystemHealthAudit(supabase, today);
  return NextResponse.json({ success: true, today, checks, overall: checks.some((row) => row.level === 'red') ? 'red' : checks.some((row) => row.level === 'warn') ? 'warn' : 'ok' });
}

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const today = manilaToday();
  const checks = await runSystemHealthAudit(supabase, today);
  const actions = await runSelfHeal(supabase, today, checks);
  await recordSystemHealth(supabase, checks, actions);
  return NextResponse.json({ success: true, today, checks, actions });
}
