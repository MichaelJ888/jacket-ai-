import { getSupabaseAdmin } from './integrations';

const CLOUD_WORKFLOW = 'devq-cloud.yml';

// Starts .github/workflows/devq-cloud.yml for one approved task. Fails soft: the task stays approved and the PC worker can still claim it.
export async function dispatchDevTask(taskId: string): Promise<{ ok: boolean; reason?: string }> {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO || 'MichaelJ888/jacket-ai-';
  if (!token) return { ok: false, reason: 'GITHUB_PAT is not set' };
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${CLOUD_WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main', inputs: { task_id: taskId } }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return { ok: true };
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    return { ok: false, reason: data.message || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'dispatch failed' };
  }
}

// Queues a coding job. An explicit /dev message is treated as a clear CEO code request and auto-approved; anything else waits for /approve.
export async function queueDevTask(task: string, explicit: boolean, updateId?: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Hindi ma-queue ang dev task: Supabase is not configured.';
  const approvedAt = explicit ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from('dev_tasks')
    .insert({ task: task.slice(0, 4000), telegram_update_id: updateId ?? null, approved_at: approvedAt })
    .select('id')
    .single();
  if (error) return `Hindi ma-queue: ${error.message}`;
  const short = String(data.id).slice(0, 8);
  if (explicit) {
    const run = await dispatchDevTask(data.id);
    const status = run.ok
      ? 'Auto-approved. Cloud runner na ang gagawa at magpapadala ng PR link dito.'
      : `Auto-approved, pero hindi ma-trigger ang cloud runner (${run.reason}). Kukunin ito ng PC worker kapag naka-on.`;
    return `Na-queue #${short}, Boss.\n${status}`;
  }
  const { count } = await supabase.from('dev_tasks').select('id', { count: 'exact', head: true }).eq('status', 'queued').is('approved_at', null);
  return `Na-queue #${short}, Boss. ${count ?? 1} ang naghihintay ng approval.\nI-/approve mo ito kung gusto mong gawin.\n(Awtomatikong nakita kong coding task ito. Kung business question ito, simulan ang message sa /biz.)`;
}

export async function devQueueCommand(name: 'ideas' | 'queue' | 'approve' | 'stop', id?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Supabase is not configured.';
  if (name === 'approve') {
    const { data: pending } = await supabase.from('dev_tasks').select('id, task').eq('status', 'queued').is('approved_at', null).order('created_at').limit(100);
    const row = id ? pending?.find((item) => String(item.id).startsWith(id)) : pending?.[0];
    if (!row) return id ? `Walang nakapilang task na may ID ${id}, Boss.` : 'Walang task na naghihintay ng approval, Boss.';
    const short = String(row.id).slice(0, 8);
    // Stays queued+approved so the cloud runner or the PC worker can claim it (queued -> claimed).
    const { error } = await supabase
      .from('dev_tasks')
      .update({ approved_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'queued')
      .is('approved_at', null);
    if (error) return `Hindi na-approve #${short}: ${error.message}`;
    const run = await dispatchDevTask(row.id);
    const status = run.ok
      ? 'Cloud runner na ang gagawa at magpapadala ng PR link dito.'
      : `Hindi ma-trigger ang cloud runner (${run.reason}). Kukunin ito ng PC worker kapag naka-on.`;
    return `Approved #${short}: ${row.task.slice(0, 120)}\n${status}`;
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
