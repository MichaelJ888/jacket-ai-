import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { readSetting, writeSetting } from '../../_lib/system-settings';
import { MAX_GOALS, defaultGoals, parseGoals } from '../../../admin/main-goals-logic';

export const dynamic = 'force-dynamic';

const SETTING_KEY = 'main_goals';
type GoalsSetting = { goals?: unknown; updatedAt?: string | null };

// Goals, steps, and checked states for the CEO's "MJIC Main Goal Directives" widget on /admin.
// Missing setting = the six baseline directives. A saved list (even empty) is returned as stored.
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const setting = (await readSetting<GoalsSetting>(supabase, SETTING_KEY)) ?? {};
  const goals = parseGoals(setting.goals) ?? defaultGoals();
  return NextResponse.json({ ok: true, goals, updatedAt: setting.updatedAt ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}

// Body { goals: MainGoal[] } replaces the whole list. Invalid or oversized lists are rejected, not truncated.
export async function PUT(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  let body: { goals?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.goals) || body.goals.length > MAX_GOALS) {
    return NextResponse.json({ error: `goals must be an array of at most ${MAX_GOALS} goals` }, { status: 400 });
  }
  const goals = parseGoals(body.goals);
  if (!goals) return NextResponse.json({ error: 'goals must be an array' }, { status: 400 });

  const updatedAt = new Date().toISOString();
  const writeError = await writeSetting(supabase, SETTING_KEY, { goals, updatedAt });
  if (writeError) return NextResponse.json({ error: writeError }, { status: 503 });
  return NextResponse.json({ ok: true, goals, updatedAt }, { headers: { 'Cache-Control': 'no-store' } });
}
