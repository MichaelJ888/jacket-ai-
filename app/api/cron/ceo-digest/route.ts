import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { isShadowMode, isVacationMode } from '../../_lib/ceo-control';
import { getCashBalance, getPeriodReport, currentPeriod, recordHeartbeat, safely } from '../../_lib/ceo-finance';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const peso = (value: number | null | undefined) => (value == null ? 'n/a' : `₱${Math.round(value).toLocaleString('en-PH')}`);

type CountQuery = ReturnType<ReturnType<NonNullable<ReturnType<typeof getSupabaseAdmin>>['from']>['select']>;
async function count(table: string, build: (query: CountQuery) => PromiseLike<{ count: number | null }>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;
  const { count: total } = await build(supabase.from(table).select('id', { count: 'exact', head: true }));
  return total || 0;
}

// Daily briefing; on Mondays (or ?weekly=1) it adds the weekly staff scorecard and a cash-flow outlook.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const since = new Date(Date.now() - 86400000).toISOString();
  const nowIso = new Date().toISOString();
  const manilaDay = new Date(Date.now() + 8 * 3600 * 1000).getUTCDay();
  const weekly = new URL(request.url).searchParams.get('weekly') === '1' || manilaDay === 1;

  const [newLeads, inbound, aiReplies, drafts, quotedNow, wonWeek, pendingApprovals, paused, cash, mtd, errors, published, calendarIssues, overdue, stock, vacation, shadow] = await Promise.all([
    safely('digest:newLeads', () => count('crm_contacts', (q) => q.gte('created_at', since)), 0),
    safely('digest:inbound', () => count('inbox_messages', (q) => q.eq('direction', 'in').gte('created_at', since)), 0),
    safely('digest:ai', () => count('inbox_messages', (q) => q.eq('direction', 'out').eq('sender', 'ai').eq('status', 'sent').gte('created_at', since)), 0),
    safely('digest:drafts', () => count('inbox_messages', (q) => q.eq('status', 'draft').gte('created_at', since)), 0),
    safely('digest:quoted', () => count('crm_contacts', (q) => q.in('stage', ['quoted', 'negotiating'])), 0),
    safely('digest:won', () => count('crm_contacts', (q) => q.eq('stage', 'won').gte('updated_at', new Date(Date.now() - 7 * 86400000).toISOString())), 0),
    safely('digest:approvals', () => count('approvals', (q) => q.eq('status', 'PENDING')), 0),
    safely('digest:paused', () => count('crm_contacts', (q) => q.eq('ai_paused', true)), 0),
    safely('digest:cash', () => getCashBalance(), null as number | null),
    safely('digest:mtd', async () => (await getPeriodReport(currentPeriod())).report, null),
    safely('digest:errors', () => count('system_logs', (q) => q.eq('severity', 'critical').gte('created_at', since)), 0),
    safely('digest:posts', () => count('content_calendar', (q) => q.eq('status', 'PUBLISHED').gte('published_at', since)), 0),
    safely('digest:calendar', () => count('content_calendar', (q) => q.in('status', ['NEEDS_CREDENTIALS', 'FAILED'])), 0),
    safely('digest:overdue', () => count('staff_tasks', (q) => q.eq('status', 'pending').lt('due_at', nowIso)), 0),
    safely('digest:stock', async () => {
      const { data } = await supabase.from('material_inventory').select('material_name, quantity_available, reorder_level').gt('reorder_level', 0);
      return (data || []).filter((row) => Number(row.quantity_available) <= Number(row.reorder_level)).map((row) => row.material_name as string);
    }, [] as string[]),
    isVacationMode(),
    isShadowMode(),
  ]);

  const report = mtd as { income?: number; expenses?: number; profit?: number } | null;
  const lines = [
    `<b>${weekly ? 'WEEKLY' : 'DAILY'} CEO BRIEFING</b>${vacation ? ' (vacation mode)' : ''}${shadow ? ' (SHADOW MODE: customers are not receiving AI replies)' : ''}`,
    `Leads (24h): ${newLeads} new, ${inbound} messages in, ${aiReplies} AI replies sent${drafts ? `, ${drafts} drafts held` : ''}`,
    `Pipeline: ${quotedNow} quoted/negotiating, ${wonWeek} won this week`,
    `Cash: ${peso(cash)} | Month-to-date income ${peso(report?.income)}, expenses ${peso(report?.expenses)}, profit ${peso(report?.profit)}`,
    `Social: ${published} posts published; ${calendarIssues} need attention`,
  ];
  const attention: string[] = [];
  if (pendingApprovals) attention.push(`${pendingApprovals} approval(s) waiting for you`);
  if (paused) attention.push(`${paused} customer(s) waiting for a personal reply (AI paused)`);
  if (overdue) attention.push(`${overdue} overdue staff task(s)`);
  if (stock.length) attention.push(`Low stock: ${stock.slice(0, 6).join(', ')}`);
  if (errors) attention.push(`${errors} critical system error(s) in 24h`);
  lines.push(attention.length ? `\n<b>Needs attention</b>\n- ${attention.map(escapeTelegramHtml).join('\n- ')}` : '\nNothing needs your attention.');

  if (weekly) {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: tasks } = await supabase.from('staff_tasks').select('staff_name, status, due_at, completed_at').gte('created_at', weekAgo);
    const board = new Map<string, { total: number; done: number; late: number }>();
    for (const task of tasks || []) {
      const row = board.get(task.staff_name) || { total: 0, done: 0, late: 0 };
      row.total += 1;
      if (task.status === 'done') row.done += 1;
      if (task.due_at && ((task.completed_at && task.completed_at > task.due_at) || (!task.completed_at && task.due_at < nowIso))) row.late += 1;
      board.set(task.staff_name, row);
    }
    if (board.size) lines.push(`\n<b>Staff scorecard (7 days)</b>\n${[...board].map(([name, row]) => `- ${escapeTelegramHtml(name)}: ${row.done}/${row.total} done, ${row.late} late`).join('\n')}`);
    const day = new Date(Date.now() + 8 * 3600 * 1000).getUTCDate();
    if (report?.expenses && day > 0) {
      const projectedExpense = (Number(report.expenses) / Math.max(day, 1)) * 30;
      const projectedIncome = (Number(report.income || 0) / Math.max(day, 1)) * 30;
      lines.push(`\n<b>Cash outlook</b> (run-rate): projected month income ${peso(projectedIncome)}, expenses ${peso(projectedExpense)}. Tax/BIR reserve suggestion: ${peso(projectedIncome * 0.03)} (3% percentage-tax estimate; confirm with your accountant).`);
    }
  }

  await sendTelegramMessage(lines.join('\n'));
  await recordHeartbeat('ceo-digest', 'ok', { weekly });
  return NextResponse.json({ success: true, weekly });
}
