import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';
import { PERMISSIVE, runScout } from '../../_lib/scout';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Weekly deep scan of GitHub for better/cheaper building blocks. Shortlists permissive-licence repos and tells the CEO.
// Adoption stays a human/agent decision per docs/REPO_STRATEGY.md; nothing is cloned or run automatically.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runScout();
  const queued = await queueLowEffortIdeas(result.ideas);
  if (result.ideas.length) {
    const lines = result.ideas.slice(0, 6).map((item) =>
      `• <b>${escapeTelegramHtml(item.idea)}</b> [${escapeTelegramHtml(item.effort || '?')} effort]\n  Repo: ${escapeTelegramHtml(item.repo)} (${escapeTelegramHtml(item.license)})\n  Para sa MJIC: ${escapeTelegramHtml(item.mjic_application)}`,
    );
    await sendTelegramMessage(`<b>IMPROVEMENT SCOUT</b> - ${result.ideas.length} bagong ideya${queued ? `, ${queued} na-queue para sa VS Code AI` : ''}\n${lines.join('\n')}\n\nI-type ang <code>/ideas</code> para sa listahan. Para ipagawa: <code>/dev i-apply ang idea na ...</code>`);
  }
  return NextResponse.json({ success: true, added: result.added, ideasSaved: result.ideasSaved, queued, failures: result.failures, error: result.error });
}

// Auto-integration path: only low-effort ideas from permissive-licence repos, max 1 per run, and only while the queue is short.
// The VS Code AI still implements, tests and deploys them (concepts only, never copied code, per docs/REPO_STRATEGY.md).
async function queueLowEffortIdeas(ideas: Array<{ idea: string; mjic_application: string; effort: string; repo: string; license: string }>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;
  const pick = ideas.find((item) => item.effort.toLowerCase() === 'low' && PERMISSIVE.has(item.license));
  if (!pick) return 0;
  const { count } = await supabase.from('dev_tasks').select('id', { count: 'exact', head: true }).in('status', ['queued', 'claimed']);
  if ((count ?? 0) >= 5) return 0;
  const task = `[SCOUT] Implement this idea (concept only, write our own code, add a test, keep it small): ${pick.idea}. How it helps MJIC: ${pick.mjic_application}. Inspired by ${pick.repo} (${pick.license}).`;
  const { error } = await supabase.from('dev_tasks').insert({ task: task.slice(0, 4000) });
  if (error) return 0;
  await supabase.from('repo_ideas').update({ status: 'queued' }).eq('repo_url', pick.repo).eq('idea', pick.idea.slice(0, 400));
  return 1;
}
