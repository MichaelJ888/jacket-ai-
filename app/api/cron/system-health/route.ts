import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin, escapeTelegramHtml, sendTelegramMessage } from '../../_lib/integrations';
import { manilaToday } from '../../_lib/production-quota-logic';
import { recordSystemHealth, runSelfHeal, runSystemHealthAudit } from '../../_lib/system-health';

// Nightly AI COO audit. Self-heals safe alerts and reports to the owner group only when something is red or warn.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const today = manilaToday();
  const checks = await runSystemHealthAudit(supabase, today);
  const actions = await runSelfHeal(supabase, today, checks);
  await recordSystemHealth(supabase, checks, actions);

  const issues = checks.filter((row) => row.level !== 'ok');
  if (issues.length) {
    const lines = issues.map((row) => `${row.level === 'red' ? '🔴' : '🟡'} ${escapeTelegramHtml(row.feature)}: ${escapeTelegramHtml(row.detail)}`);
    await sendTelegramMessage([`🩺 <b>AI COO HEALTH AUDIT</b> (${today})`, ...lines, ...actions.map((text) => `🔧 ${escapeTelegramHtml(text)}`)].join('\n'));
  }
  return NextResponse.json({ success: true, today, checks, actions });
}
