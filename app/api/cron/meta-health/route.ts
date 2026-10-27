import { recordHeartbeat } from '../../_lib/ceo-finance';
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { escapeTelegramHtml, sendTelegramMessage } from '../../_lib/integrations';
import { checkPageHealth } from '../../_lib/meta-health';
import { listConnections } from '../../_lib/meta-oauth';
import { getPageToken } from '../../_lib/meta-pages';
import { checkMetaPublishing } from '../../_lib/meta-publishing';
import { recordMetaPublishingHealth } from '../../_lib/meta-publishing-alerts';

export const dynamic = 'force-dynamic';

// Daily cron: re-checks every connected Page and alerts the CEO on Telegram when one is broken.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const pages = await listConnections();
    const broken: string[] = [];
    for (const page of pages) {
      try {
        const { healthy, checks } = await checkPageHealth(page.page_id, page.ig_user_id);
        if (!healthy) {
          const failing = checks.filter((check) => !check.ok && check.id !== 'instagram').map((check) => check.label).join('; ');
          broken.push(`• ${escapeTelegramHtml(page.page_name || page.page_id)}: ${escapeTelegramHtml(failing)}`);
        }
      } catch {
        console.error('Meta Page health inspection failed:', page.page_id);
        broken.push(`• ${escapeTelegramHtml(page.page_name || page.page_id)}: health inspection unavailable`);
      }
    }
    const publishing = await checkMetaPublishing(process.env.META_PAGE_ID, await getPageToken(process.env.META_PAGE_ID), 'facebook');
    await recordMetaPublishingHealth('facebook', publishing);
    if (broken.length) await sendTelegramMessage(`⚠️ <b>Meta connection needs attention</b>\n${broken.join('\n')}\nOpen /dashboard/connect and press Re-subscribe or reconnect.`);
    await recordHeartbeat('meta-health', broken.length || !publishing.ok ? 'degraded' : 'ok', { checked: pages.length, broken: broken.length, publishing: publishing.code });
    return NextResponse.json({ checked: pages.length, broken: broken.length, publishing });
  } catch {
    console.error('Meta health inspection failed; check connections and provider access.');
    await recordHeartbeat('meta-health', 'error', { error: 'inspection unavailable' });
    return NextResponse.json({ error: 'Meta health inspection unavailable' }, { status: 503 });
  }
}
