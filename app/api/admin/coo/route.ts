import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { AUTO_PILOT_SETTING_KEY, runAutoPilot } from '../../_lib/auto-pilot';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { evaluateJobs, groupByDepartment, type Heartbeat } from '../../_lib/coo-logic';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { readSetting, writeSetting } from '../../_lib/system-settings';

export const dynamic = 'force-dynamic';

type Contact = { id: string; name: string | null; channel: string; stage: string; lead_score: number; ai_paused: boolean; last_inbound_at: string | null; page_id: string | null };

// Admin-only COO view: every department's agents, and every customer of every workspace (MJIC + each buyer).
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const workspaceFilter = new URL(request.url).searchParams.get('workspace');
  const [beats, tenants, pages, contacts, approvals, dormant] = await Promise.all([
    supabase.from('job_heartbeats').select('job,last_run_at,last_status'),
    supabase.from('tenants').select('id,name,plan'),
    supabase.from('meta_connections').select('page_id,page_name,tenant_id'),
    supabase.from('crm_contacts').select('id,name,channel,stage,lead_score,ai_paused,last_inbound_at,page_id').order('last_inbound_at', { ascending: false, nullsFirst: false }).limit(500),
    supabase.from('approvals').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
    supabase.from('crm_contacts').select('id', { count: 'exact', head: true }).eq('stage', 'dormant'),
  ]);

  const tenantName = new Map(((tenants.data || []) as Array<{ id: string; name: string | null }>).map((t) => [t.id, t.name || 'Buyer']));
  const pageOwner = new Map(((pages.data || []) as Array<{ page_id: string; tenant_id: string | null }>).map((p) => [p.page_id, p.tenant_id]));
  const workspaceOf = (pageId: string | null) => {
    const tenantId = pageId ? pageOwner.get(pageId) : null;
    return tenantId ? { id: tenantId, name: tenantName.get(tenantId) || 'Buyer' } : { id: 'mjic', name: 'MJIC (own)' };
  };

  const rows = ((contacts.data || []) as Contact[]).map((c) => ({ ...c, workspace: workspaceOf(c.page_id) }));
  const summary = new Map<string, { id: string; name: string; contacts: number; needsHuman: number }>();
  for (const row of rows) {
    const entry = summary.get(row.workspace.id) || { id: row.workspace.id, name: row.workspace.name, contacts: 0, needsHuman: 0 };
    entry.contacts += 1;
    if (row.ai_paused) entry.needsHuman += 1;
    summary.set(row.workspace.id, entry);
  }

  const departments = groupByDepartment(evaluateJobs((beats.data || []) as Heartbeat[]));
  const attention = departments.filter((d) => d.status === 'attention').map((d) => d.department);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    headline: attention.length ? `Needs attention: ${attention.join(', ')}` : 'All departments running normally',
    pendingApprovals: approvals.count || 0,
    dormantLeads: dormant.count || 0,
    departments,
    workspaces: [...summary.values()],
    contacts: workspaceFilter ? rows.filter((row) => row.workspace.id === workspaceFilter) : rows,
  });
}

// 1-push "Auto-Pilot / Stabilize System": admin-triggered catch-up pass, same
// engine as /api/cron/auto-pilot (re-invokes stale sub-daily cron routes).
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const token = process.env.CRON_SECRET || process.env.SCHEDULER_TOKEN || '';
  const summary = await runAutoPilot({ origin: new URL(request.url).origin, token, supabase });
  const failed = summary.kicked.filter((kick) => kick.status !== 200);
  await recordHeartbeat('auto-pilot', summary.heartbeatError ? 'error' : failed.length ? 'degraded' : 'ok', { ...summary, trigger: 'admin' });
  const stabilizeStatus = summary.heartbeatError ? 'error' : failed.length ? 'degraded' : 'ok';
  const current = (await readSetting<{ override?: unknown }>(supabase, AUTO_PILOT_SETTING_KEY)) ?? {};
  await writeSetting(supabase, AUTO_PILOT_SETTING_KEY, { ...current, lastStabilizeAt: new Date().toISOString(), lastStabilizeStatus: stabilizeStatus, updatedBy: 'admin' });
  return NextResponse.json({ success: !summary.heartbeatError, ...summary });
}
