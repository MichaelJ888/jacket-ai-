import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { runConsultantReport } from '../../_lib/consultant';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { escapeTelegramHtml, getSupabaseAdmin, reportCriticalError, sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Weekly AI-consultant report: real 30-day numbers -> 3 ranked recommendations on Telegram. Advice only; nothing changes automatically.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await runConsultantReport();
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 503 });
    const sent = result.report ? await sendTelegramMessage(`<b>WEEKLY AI CONSULTANT</b>\n${escapeTelegramHtml(result.report.slice(0, 3300))}\n\n<i>Reply "propose 1" (or 2, 3) and I will turn it into an Approve/Reject task for the coding agent.</i>`) : false;
    // Save to the CEO chat memory so a follow-up reply like "propose 1" has the report as context.
    if (sent && result.report) await getSupabaseAdmin()?.from('ceo_conversations').insert({ role: 'assistant', content: `[Weekly consultant report]\n${result.report.slice(0, 1800)}` });
    await recordHeartbeat('consultant', sent ? 'ok' : 'not-sent');
    return NextResponse.json({ success: true, notified: sent });
  } catch (error) {
    await reportCriticalError('cron-consultant', error);
    return NextResponse.json({ success: false, error: 'Consultant report failed' }, { status: 500 });
  }
}
