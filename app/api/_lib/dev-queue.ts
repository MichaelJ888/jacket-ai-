import { getSupabaseAdmin } from './integrations';
import { createCodeChangeIssue } from './ceo-exec';

// Queues a coding job for the VS Code AI chat. The CEO reads the reply on Telegram; results come back via scripts/devq.mjs.
export async function queueDevTask(task: string, explicit: boolean, updateId?: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Hindi ma-queue ang dev task: Supabase is not configured.';
  const { data, error } = await supabase.from('dev_tasks').insert({ task: task.slice(0, 4000), telegram_update_id: updateId ?? null }).select('id').single();
  if (error) return `Hindi ma-queue: ${error.message}`;
  const { count } = await supabase.from('dev_tasks').select('id', { count: 'exact', head: true }).eq('status', 'queued');
  const hint = explicit ? '' : '\n(Awtomatikong nakita kong coding task ito. Kung business question ito, simulan ang message sa /biz.)';
  return `Na-queue para sa VS Code AI, Boss. #${String(data.id).slice(0, 8)} - ${count ?? 1} sa pila.\nKukunin ito kapag bukas ang VS Code AI chat at magsasabi ako dito kapag tapos na.${hint}`;
}

export async function devQueueCommand(name: 'ideas' | 'queue' | 'approve' | 'stop', id?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Supabase is not configured.';
  if (name === 'approve') {
    const { data: pending } = await supabase.from('dev_tasks').select('id, task').eq('status', 'queued').is('approved_at', null).order('created_at').limit(100);
    const row = id ? pending?.find((item) => String(item.id).startsWith(id)) : pending?.[0];
    if (!row) return id ? `Walang nakapilang task na may ID ${id}, Boss.` : 'Walang task na naghihintay ng approval, Boss.';
    const short = String(row.id).slice(0, 8);
    const issue = await createCodeChangeIssue(
      row.task.slice(0, 120),
      `Telegram dev task #${short}, approved by the CEO.\n\n${row.task}\n\nImplement with the smallest safe change, add or update a test, and open a PR. Do not merge.`,
    );
    if (!issue.ok) return `Hindi na-approve #${short}: GitHub issue failed (${issue.reason}). Nanatili sa pila.`;
    // Stays queued so scripts/devq.mjs next / devq-worker can claim it (queued -> claimed).
    const { error } = await supabase
      .from('dev_tasks')
      .update({ approved_at: new Date().toISOString(), result: `GitHub issue: ${issue.url}` })
      .eq('id', row.id)
      .eq('status', 'queued')
      .is('approved_at', null);
    if (error) return `Na-create ang GitHub issue (${issue.url}) pero hindi na-approve: ${error.message}`;
    return `Approved #${short}: ${row.task.slice(0, 120)}\nGitHub issue: ${issue.url}\nAko na ang gagawa nito sa VS Code at magsasabi ako kapag tapos na.`;
  }
  if (name === 'stop') {
    const { data, error } = await supabase
      .from('dev_tasks')
      .update({ status: 'failed', result: 'Stopped by CEO via /stop', completed_at: new Date().toISOString() })
      .eq('status', 'queued')
      .select('id');
    if (error) return `Hindi na-stop: ${error.message}`;
    return `Na-stop ang ${data?.length ?? 0} nakapilang dev task, Boss. Ang naka-claim na ay tatakbo pa.`;
  }
  if (name === 'queue') {
    const { data } = await supabase.from('dev_tasks').select('id, task, status').in('status', ['queued', 'claimed']).order('created_at').limit(15);
    if (!data?.length) return 'Walang nakapilang dev task, Boss.';
    return data.map((row) => `${row.status === 'claimed' ? '▶' : '•'} #${String(row.id).slice(0, 8)} ${row.task.slice(0, 120)}`).join('\n');
  }
  const { data } = await supabase.from('repo_ideas').select('idea, mjic_application, effort, status, repo_url').order('created_at', { ascending: false }).limit(12);
  if (!data?.length) return 'Wala pang naka-save na ideya mula sa GitHub scan.';
  return `Mga ideya mula sa GitHub scan (${data.length} pinakabago):\n\n` + data.map((row, index) => `${index + 1}. ${row.idea} [${row.effort || '?'}, ${row.status}]\n   Gamit: ${row.mjic_application || '-'}\n   ${row.repo_url}`).join('\n\n');
}
