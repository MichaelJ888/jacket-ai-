import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { createApproval, expireOldApprovals } from '../../_lib/ceo-control';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { composeBossStyleMessage, escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';
import { ensureProductionPublic } from '../../_lib/vercel-protection';
import { hindsightRecall } from '../../_lib/hindsight.ts';
import type { Channel } from '../../_lib/crm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALERT_COOLDOWN_MS = 6 * 3600 * 1000;

// Uptime + bottleneck watchdog. Alerts the CEO on Telegram, at most once per cooldown per problem set.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const problems: string[] = [];

  const protection = await ensureProductionPublic();
  if (protection.status === 'healed') problems.push(`self-healed: Vercel Deployment Protection had drifted (${protection.detail}); production is public again`);
  else if (protection.status === 'error') problems.push(`vercel protection check failed (${protection.detail})`);

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

    // Auto Self-Healing & Solution Proposing:
    // 1. If customers are waiting with AI paused, draft a solution for the CEO with 1-tap Approve/Reject
    if (silent.count && silent.count > 0) {
      const { data: pausedContacts } = await supabase
        .from('crm_contacts')
        .select('id, channel, external_id, name, phone')
        .eq('ai_paused', true)
        .lt('last_inbound_at', hours(4))
        .gt('last_inbound_at', hours(48))
        .limit(2);

      const { data: pendingApprovals } = await supabase
        .from('approvals')
        .select('payload')
        .eq('status', 'PENDING')
        .eq('kind', 'customer_reply');

      const existingContactIds = new Set(
        (pendingApprovals || []).map((a) => (a.payload as { contactId?: string })?.contactId).filter(Boolean),
      );

      for (const contact of pausedContacts || []) {
        if (!existingContactIds.has(contact.id)) {
          const { data: lastMsg } = await supabase
            .from('inbox_messages')
            .select('content')
            .eq('contact_id', contact.id)
            .eq('direction', 'in')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const clientName = contact.name || 'po';
          const draft = await composeBossStyleMessage(
            `Hi ${clientName}, pasensya na sa delay po! Checking this with our production team right now, update kita agad today.`,
          );

          await createApproval({
            kind: 'customer_reply',
            summary: `Customer ${contact.name || contact.phone || 'Client'} (${contact.channel}) has been waiting >4h.\nMessage: "${lastMsg?.content?.slice(0, 120) || 'Follow up'}"\nProposed reply: "${draft}"`,
            action: {
              type: 'send_reply',
              contactId: contact.id,
              channel: contact.channel as Channel,
              externalId: contact.external_id,
              text: draft,
            },
          });
        }
      }
    }

    // 2. If dispatches failed, offer 1-tap re-booking approval
    if (stuckDispatch.count && stuckDispatch.count > 0) {
      const { data: failedDispatches } = await supabase
        .from('dispatch_requests')
        .select('id, project_name, delivery_address')
        .eq('status', 'BOOKING_FAILED')
        .limit(2);

      const { data: pendingDispatchApprovals } = await supabase
        .from('approvals')
        .select('payload')
        .eq('status', 'PENDING')
        .eq('kind', 'retry_dispatch');

      const existingDispIds = new Set(
        (pendingDispatchApprovals || []).map((a) => (a.payload as { dispatchId?: string })?.dispatchId).filter(Boolean),
      );

      for (const disp of failedDispatches || []) {
        if (!existingDispIds.has(disp.id)) {
          await createApproval({
            kind: 'retry_dispatch',
            summary: `Delivery to ${disp.delivery_address || 'client'} for project ${disp.project_name || 'MJIC'} failed booking. Tap Approve to re-book.`,
            action: {
              type: 'retry_dispatch',
              dispatchId: disp.id,
            },
          });
        }
      }
    }
  }

  const expired = await expireOldApprovals(48);

  let alerted = false;
  if (supabase && problems.length) {
    const key = problems.join('|').slice(0, 900);
    const { data: previous } = await supabase.from('job_heartbeats').select('last_alert_at, details').eq('job', 'watchdog').maybeSingle();
    const sameSet = (previous?.details as { key?: string } | null)?.key === key;
    const recent = previous?.last_alert_at && Date.now() - new Date(previous.last_alert_at).getTime() < ALERT_COOLDOWN_MS;
    if (!(sameSet && recent)) {
      // Check memory for known fixes
      let memoryNote = '';
      try {
        const recalled = await hindsightRecall(problems[0], { limit: 1, scope: 'fix' });
        if (recalled.length) memoryNote = `\n<i>💡 Memory Fix: ${escapeTelegramHtml(recalled[0])}</i>`;
      } catch {
        // Non-blocking
      }

      await sendTelegramMessage(`<b>WATCHDOG</b>\n- ${problems.map(escapeTelegramHtml).join('\n- ')}${memoryNote}`);
      await supabase.from('job_heartbeats').upsert({ job: 'watchdog', last_run_at: new Date().toISOString(), last_status: 'alert', last_alert_at: new Date().toISOString(), details: { key, problems } });
      alerted = true;
    }
  }
  if (!problems.length) await recordHeartbeat('watchdog', 'ok', { problems: 0, expired });
  return NextResponse.json({ success: true, problems, alerted, expired });
}
