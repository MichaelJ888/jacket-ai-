import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { escapeTelegramHtml, sendTelegramMessage } from '../../_lib/integrations';
import { runScout } from '../../_lib/scout';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Weekly deep scan of GitHub for better/cheaper building blocks. Shortlists permissive-licence repos and tells the CEO.
// Adoption stays a human/agent decision per docs/REPO_STRATEGY.md; nothing is cloned or run automatically.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runScout();
  if (result.ideas.length) {
    const lines = result.ideas.slice(0, 8).map((item) =>
      `• <b>${escapeTelegramHtml(item.idea)}</b> [${escapeTelegramHtml(item.effort || '?')} effort]\n  Repo: ${escapeTelegramHtml(item.repo)} (${escapeTelegramHtml(item.license)})\n  Para sa MJIC: ${escapeTelegramHtml(item.mjic_application)}`,
    );
    await sendTelegramMessage(`<b>IMPROVEMENT SCOUT</b> - ${result.ideas.length} bagong ideya\n${lines.join('\n')}\n\nI-type ang <code>/ideas</code> para sa listahan. Para ipagawa: <code>/dev i-apply ang idea na ...</code>`);
  } else if (result.added.length) {
    await sendTelegramMessage(`<b>IMPROVEMENT SCOUT</b>\nBagong repos (walang bagong idea pa):\n${result.added.slice(0, 8).map((line) => `• ${escapeTelegramHtml(line)}`).join('\n')}`);
  }
  return NextResponse.json({ success: true, added: result.added, ideasSaved: result.ideasSaved, failures: result.failures, error: result.error });
}
