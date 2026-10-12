import { runSwarm, type SwarmState } from './swarm';
import { createPoolRunner } from './swarm-runner';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from './integrations';

// CEO-initiated swarms are capped well below the engine's 1,000 ceiling: each agent is a paid LLM call.
export const CEO_SWARM_MAX_AGENTS = 100;
export const CEO_SWARM_DEFAULT_AGENTS = 24;
const MAX_ACTIVE_JOBS = 2;
const MAX_SLICES = 40;
const SLICE_DEADLINE_MS = 22000; // + up to ~32s for the last in-flight call stays under the 60s function limit
const SWARM_CONCURRENCY = 5; // free-tier RPM limits, not CPU, are the real ceiling
const LOCK_MS = 55000;

export async function createSwarmJob(goal: string, context: string | undefined, maxAgents?: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: 'Supabase is not configured' };
  const { count } = await supabase.from('swarm_jobs').select('id', { count: 'exact', head: true }).eq('status', 'RUNNING');
  if ((count ?? 0) >= MAX_ACTIVE_JOBS) return { error: `Already ${count} swarm jobs running. Wait for one to finish.` };
  const agents = Math.max(3, Math.min(CEO_SWARM_MAX_AGENTS, Math.floor(maxAgents ?? CEO_SWARM_DEFAULT_AGENTS)));
  const { data, error } = await supabase
    .from('swarm_jobs')
    .insert({ goal: goal.slice(0, 4000), context: context?.slice(0, 8000) ?? null, max_agents: agents })
    .select('id, max_agents')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not create swarm job' };
  return { job_id: data.id as string, max_agents: data.max_agents as number };
}

// Self-chaining: an unfinished job pokes the worker endpoint so it keeps going without any external scheduler.
// Fire-and-forget (short client timeout); the 5-min GitHub scheduler and the daily Vercel cron are only safety nets.
function chainNextSlice() {
  const base = process.env.APP_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return;
  fetch(`${base.replace(/\/$/, '')}/api/cron/swarm-worker`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(4000) }).catch(() => undefined);
}

type Outcome = 'skipped' | 'partial' | 'retry' | 'done' | 'failed';

// Runs one time-boxed slice of one job. Safe to call concurrently: a row lock (locked_until) guards each job.
export async function advanceSwarmJob(jobId: string): Promise<Outcome> {
  const outcome = await advanceOnce(jobId);
  if (outcome === 'partial') chainNextSlice(); // only when real progress was made; 'retry' waits for the scheduler
  return outcome;
}

const progressOf = (s: SwarmState | null | undefined) => (s ? Object.keys(s.results).length + Object.keys(s.verdicts).length + (s.subtasks ? 1 : 0) + (s.report ? 1 : 0) : 0);

async function advanceOnce(jobId: string): Promise<Outcome> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'skipped';
  const nowIso = new Date().toISOString();
  const { data: job } = await supabase
    .from('swarm_jobs')
    .update({ locked_until: new Date(Date.now() + LOCK_MS).toISOString() })
    .eq('id', jobId)
    .eq('status', 'RUNNING')
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
    .select('id, goal, context, max_agents, state, slices')
    .maybeSingle();
  if (!job) return 'skipped';

  try {
    const result = await runSwarm({
      goal: job.goal,
      context: job.context ?? undefined,
      runner: createPoolRunner(),
      maxAgents: job.max_agents,
      concurrency: SWARM_CONCURRENCY,
      deadlineMs: SLICE_DEADLINE_MS,
      state: (job.state as SwarmState | null) ?? undefined,
    });
    const slices = job.slices + 1;

    if (result.status === 'complete') {
      const report = result.state.report ?? '(empty report)';
      await supabase.from('swarm_jobs').update({ status: 'DONE', state: result.state, report, slices, locked_until: null, completed_at: new Date().toISOString() }).eq('id', jobId);
      await sendTelegramMessage(`<b>Swarm done</b> (${result.state.agentsUsed} agents)\n<i>${escapeTelegramHtml(job.goal.slice(0, 120))}</i>\n\n${escapeTelegramHtml(report.slice(0, 3500))}`);
      return 'done';
    }
    if (slices >= MAX_SLICES) throw new Error(`Gave up after ${MAX_SLICES} slices`);
    const progressed = progressOf(result.state) > progressOf(job.state as SwarmState | null);
    const lastFailure = Object.values(result.state.failures)[0] ?? null;
    await supabase.from('swarm_jobs').update({
      state: result.state,
      slices,
      last_error: progressed ? null : lastFailure,
      locked_until: progressed ? null : new Date(Date.now() + 45000).toISOString(),
    }).eq('id', jobId);
    return progressed ? 'partial' : 'retry';
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'swarm failed';
    const saved = (err as { swarmState?: SwarmState }).swarmState;
    const slices = job.slices + 1;
    // Provider hiccups (rate limit / high demand) are retried later with progress kept; 45s cool-off avoids hammering.
    if (slices < MAX_SLICES) {
      await supabase.from('swarm_jobs').update({ state: saved ?? job.state, slices, last_error: message, locked_until: new Date(Date.now() + 45000).toISOString() }).eq('id', jobId);
      return 'retry';
    }
    await supabase.from('swarm_jobs').update({ status: 'FAILED', last_error: message, locked_until: null, completed_at: new Date().toISOString() }).eq('id', jobId);
    await sendTelegramMessage(`<b>Swarm failed</b>\n<i>${escapeTelegramHtml(job.goal.slice(0, 120))}</i>\n${escapeTelegramHtml(message)}`);
    return 'failed';
  }
}
