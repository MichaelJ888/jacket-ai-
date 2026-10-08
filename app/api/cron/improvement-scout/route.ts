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
  if (result.added.length) await sendTelegramMessage(`<b>IMPROVEMENT SCOUT</b>\nNew vetted-licence candidates:\n${result.added.slice(0, 12).map((line) => `• ${escapeTelegramHtml(line)}`).join('\n')}\nReview in repo_candidates before adopting.`);
  return NextResponse.json({ success: true, ...result });
}
