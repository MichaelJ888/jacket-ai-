import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { readSetting, writeSetting } from '../../_lib/system-settings';
import { parseDoneSteps, setStepDone } from '../../../admin/main-goals-logic';

export const dynamic = 'force-dynamic';

const SETTING_KEY = 'main_goals';
type GoalsSetting = { doneSteps?: unknown; updatedAt?: string | null };

// Completed step IDs for the CEO's "Main Goal Reminder" widget on /admin.
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const setting = (await readSetting<GoalsSetting>(supabase, SETTING_KEY)) ?? {};
  return NextResponse.json(
    { ok: true, doneSteps: parseDoneSteps(setting.doneSteps), updatedAt: setting.updatedAt ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// Body { stepId: string, done: boolean }. Unknown step IDs are rejected.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  let body: { stepId?: unknown; done?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.stepId !== 'string' || typeof body.done !== 'boolean') {
    return NextResponse.json({ error: 'stepId (string) and done (boolean) are required' }, { status: 400 });
  }

  const current = parseDoneSteps((await readSetting<GoalsSetting>(supabase, SETTING_KEY))?.doneSteps);
  const doneSteps = setStepDone(current, body.stepId, body.done);
  if (!doneSteps) return NextResponse.json({ error: 'Unknown goal step' }, { status: 400 });

  const updatedAt = new Date().toISOString();
  const writeError = await writeSetting(supabase, SETTING_KEY, { doneSteps, updatedAt });
  if (writeError) return NextResponse.json({ error: writeError }, { status: 503 });
  return NextResponse.json({ ok: true, doneSteps, updatedAt }, { headers: { 'Cache-Control': 'no-store' } });
}
