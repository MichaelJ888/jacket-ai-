import { recordHeartbeat } from '../../_lib/ceo-finance';
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { escapeTelegramHtml, sendTelegramMessage } from '../../_lib/integrations';
import { checkPageHealth } from '../../_lib/meta-health';
import { listConnections } from '../../_lib/meta-oauth';

export const dynamic = 'force-dynamic';

// Daily cron: re-checks every connected Page and alerts the CEO on Telegram when one is broken.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const pages = await listConnections();
    const broken: string[] = [];
    for (const page of pages) {
      const { healthy, checks } = await checkPageHealth(page.page_id, page.ig_user_id);
      if (!healthy) {
        const failing = checks.filter((check) => !check.ok && check.id !== 'instagram').map((check) => check.label).join('; ');
        broken.push(`• ${escapeTelegramHtml(page.page_name || page.page_id)}: ${escapeTelegramHtml(failing)}`);
      }
    }
    if (broken.length) await sendTelegramMessage(`⚠️ <b>Meta connection needs attention</b>\n${broken.join('\n')}\nOpen /dashboard/connect and press Re-subscribe or reconnect.`);
    await recordHeartbeat('meta-health', broken.length ? 'degraded' : 'ok', { checked: pages.length, broken: broken.length }); return NextResponse.json({ checked: pages.length, broken: broken.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
