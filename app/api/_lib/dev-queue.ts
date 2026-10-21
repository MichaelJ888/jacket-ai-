import { getSupabaseAdmin } from './integrations';

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

export async function devQueueCommand(name: 'ideas' | 'queue') {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Supabase is not configured.';
  if (name === 'queue') {
    const { data } = await supabase.from('dev_tasks').select('id, task, status').in('status', ['queued', 'claimed']).order('created_at').limit(15);
    if (!data?.length) return 'Walang nakapilang dev task, Boss.';
    return data.map((row) => `${row.status === 'claimed' ? '▶' : '•'} #${String(row.id).slice(0, 8)} ${row.task.slice(0, 120)}`).join('\n');
  }
  const { data } = await supabase.from('repo_ideas').select('idea, mjic_application, effort, status, repo_url').order('created_at', { ascending: false }).limit(12);
  if (!data?.length) return 'Wala pang naka-save na ideya mula sa GitHub scan.';
  return `Mga ideya mula sa GitHub scan (${data.length} pinakabago):\n\n` + data.map((row, index) => `${index + 1}. ${row.idea} [${row.effort || '?'}, ${row.status}]\n   Gamit: ${row.mjic_application || '-'}\n   ${row.repo_url}`).join('\n\n');
}
