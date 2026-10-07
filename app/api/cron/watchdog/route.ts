import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { expireOldApprovals } from '../../_lib/ceo-control';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALERT_COOLDOWN_MS = 6 * 3600 * 1000;

// Uptime + bottleneck watchdog. Alerts the CEO on Telegram, at most once per cooldown per problem set.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const problems: string[] = [];

  try {
    const response = await fetch(`${new URL(request.url).origin}/api/health`, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
    const health = (await response.json()) as { status?: string; checks?: Record<string, { ok: boolean; detail?: string }> };
    for (const [name, check] of Object.entries(health.checks || {})) {
      if (!check.ok) problems.push(`health: ${name}${check.detail ? ` (${check.detail})` : ''}`);
    }
    if (!response.ok) problems.push(`health endpoint returned HTTP ${response.status}`);
  } catch (error) {
    problems.push(`health endpoint unreachable: ${error instanceof Error ? error.message : 'unknown'}`);
  }

  if (supabase) {
    const hours = (value: number) => new Date(Date.now() - value * 3600 * 1000).toISOString();
    const [overdue, stuckDispatch, oldApprovals, silent] = await Promise.all([
      supabase.from('staff_tasks').select('id', { count: 'exact', head: true }).eq('status', 'pending').lt('due_at', hours(24)),
      supabase.from('dispatch_requests').select('id', { count: 'exact', head: true }).in('status', ['PENDING_APPROVAL', 'BOOKING_FAILED']).lt('created_at', hours(12)),
      supabase.from('approvals').select('id', { count: 'exact', head: true }).eq('status', 'PENDING').lt('created_at', hours(6)),
      supabase.from('crm_contacts').select('id', { count: 'exact', head: true }).eq('ai_paused', true).lt('last_inbound_at', hours(4)).gt('last_inbound_at', hours(48)),
    ]);
    if (overdue.count) problems.push(`bottleneck: ${overdue.count} staff task(s) overdue by more than 24h`);
    if (stuckDispatch.count) problems.push(`bottleneck: ${stuckDispatch.count} delivery request(s) stuck over 12h`);
    if (oldApprovals.count) problems.push(`${oldApprovals.count} approval(s) waiting for you over 6h`);
    if (silent.count) problems.push(`${silent.count} customer(s) waiting for your personal reply over 4h`);
  }

  const expired = await expireOldApprovals(48);

  let alerted = false;
  if (supabase && problems.length) {
    const key = problems.join('|').slice(0, 900);
    const { data: previous } = await supabase.from('job_heartbeats').select('last_alert_at, details').eq('job', 'watchdog').maybeSingle();
    const sameSet = (previous?.details as { key?: string } | null)?.key === key;
    const recent = previous?.last_alert_at && Date.now() - new Date(previous.last_alert_at).getTime() < ALERT_COOLDOWN_MS;
    if (!(sameSet && recent)) {
      await sendTelegramMessage(`<b>WATCHDOG</b>\n- ${problems.map(escapeTelegramHtml).join('\n- ')}`);
      await supabase.from('job_heartbeats').upsert({ job: 'watchdog', last_run_at: new Date().toISOString(), last_status: 'alert', last_alert_at: new Date().toISOString(), details: { key, problems } });
      alerted = true;
    }
  }
  if (!problems.length) await recordHeartbeat('watchdog', 'ok', { problems: 0, expired });
  return NextResponse.json({ success: true, problems, alerted, expired });
}
