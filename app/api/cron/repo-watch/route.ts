import { recordHeartbeat } from '../../_lib/ceo-finance';
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Monthly watch over vetted open-source candidates (see docs/REPO_STRATEGY.md). Only refreshes metadata and alerts;
// it never clones or runs third-party code.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const { data: repos } = await supabase.from('repo_candidates').select('*').neq('status', 'rejected');
  const alerts: string[] = [];
  for (const repo of repos || []) {
    const slug = repo.url.replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '');
    try {
      const response = await fetch(`https://api.github.com/repos/${slug}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mjic-repo-watch' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) { alerts.push(`${slug}: GitHub returned ${response.status}`); continue; }
      const info = (await response.json()) as { stargazers_count: number; pushed_at: string; archived: boolean; license?: { spdx_id?: string } | null };
      const license = info.license?.spdx_id || 'UNKNOWN';
      if (repo.license && repo.license !== license) alerts.push(`${slug}: license changed ${repo.license} -> ${license}`);
      if (info.archived) alerts.push(`${slug}: repository is archived`);
      await supabase.from('repo_candidates').update({ stars: info.stargazers_count, last_push: info.pushed_at, license: repo.license || license, reviewed_at: new Date().toISOString() }).eq('id', repo.id);
    } catch (error) {
      alerts.push(`${slug}: ${error instanceof Error ? error.message : 'check failed'}`);
    }
  }
  if (alerts.length) await sendTelegramMessage(`<b>REPO WATCH</b>\n${alerts.map((line) => `• ${escapeTelegramHtml(line)}`).join('\n')}`);
  await recordHeartbeat('repo-watch', 'ok'); return NextResponse.json({ success: true, checked: repos?.length || 0, alerts });
}
