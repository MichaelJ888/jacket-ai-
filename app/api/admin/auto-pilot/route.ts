import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { AUTO_PILOT_SETTING_KEY, autoPilotState, effectiveAutoPilotOn, type AutoPilotOverride } from '../../_lib/auto-pilot';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { readSetting, writeSetting } from '../../_lib/system-settings';

export const dynamic = 'force-dynamic';

type AutoPilotSetting = { override?: AutoPilotOverride; lastStabilizeAt?: string | null; lastStabilizeStatus?: string | null; updatedBy?: string };

function parseOverride(value: unknown): AutoPilotOverride | undefined {
  if (value === 'on' || value === 'off' || value === null) return value;
  return undefined;
}

// Live state for the "1-push Auto-Pilot / Stabilize" badge on /admin.
// Effective ON = persisted manual override when set, otherwise the computed heartbeat state
// (fresh auto-pilot heartbeat, healthy, no stale sub-daily cron job).
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const { data, error } = await supabase.from('job_heartbeats').select('job,last_run_at,last_status');
  if (error || !data) return NextResponse.json({ error: error?.message || 'Heartbeat query failed' }, { status: 503 });

  const computed = autoPilotState(data);
  const setting = (await readSetting<AutoPilotSetting>(supabase, AUTO_PILOT_SETTING_KEY)) ?? {};
  const override = parseOverride(setting.override) ?? null;
  return NextResponse.json(
    {
      ok: true,
      ...computed,
      on: effectiveAutoPilotOn(computed.on, override),
      computedOn: computed.on,
      override,
      lastStabilizeAt: setting.lastStabilizeAt ?? null,
      lastStabilizeStatus: setting.lastStabilizeStatus ?? null,
      checkedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// Manual toggle only. Body { override: 'on' | 'off' | null }; null clears the override and returns to the computed state.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  let body: { override?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const override = parseOverride(body.override);
  if (override === undefined) return NextResponse.json({ error: "override must be 'on', 'off', or null" }, { status: 400 });

  const current = (await readSetting<AutoPilotSetting>(supabase, AUTO_PILOT_SETTING_KEY)) ?? {};
  const writeError = await writeSetting(supabase, AUTO_PILOT_SETTING_KEY, { ...current, override, updatedBy: 'admin' });
  if (writeError) return NextResponse.json({ error: writeError }, { status: 503 });
  return NextResponse.json({ ok: true, override }, { headers: { 'Cache-Control': 'no-store' } });
}
