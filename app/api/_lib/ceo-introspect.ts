import { tool } from 'ai';
import { z } from 'zod';

import { CRON_JOBS } from './ceo-policy';
import { configHints, envReadiness, groupCounts, staleJobs } from './ceo-introspect-logic';
import { getSupabaseAdmin } from './integrations';

// Lets the CEO bot audit its own AI system: tools, schedules, job health, errors, guard blocks, approvals, config gaps.
// Never returns secret values: environment is reported as set/unset only.

export type ToolManifest = Array<{ name: string; description: string }>;

export function describeTools(tools: Record<string, { description?: string }>): ToolManifest {
  return Object.entries(tools).map(([name, definition]) => ({ name, description: (definition.description || '').slice(0, 160) }));
}

async function openCodeRequests(): Promise<Array<{ title: string; url: string }> | string> {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO || 'MichaelJ888/jacket-ai-';
  if (!token) return 'GitHub token not set';
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues?labels=ceo-request&state=open&per_page=10`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return `GitHub HTTP ${response.status}`;
    const issues = (await response.json()) as Array<{ title: string; html_url: string; pull_request?: unknown }>;
    return issues.filter((issue) => !issue.pull_request).map((issue) => ({ title: issue.title, url: issue.html_url }));
  } catch {
    return 'GitHub unreachable';
  }
}

export async function gatherSystemHealth(manifest: ToolManifest) {
  const supabase = getSupabaseAdmin();
  const ready = envReadiness(process.env);
  const base = {
    tools: manifest,
    cron_jobs: Object.entries(CRON_JOBS).map(([job, risk]) => ({ job, risk })),
    config_ready: ready,
    config_hints: configHints(ready),
  };
  if (!supabase) return { ...base, error: 'Supabase is not configured' };

  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [heartbeats, logs, approvals, voice, issues] = await Promise.all([
    supabase.from('job_heartbeats').select('job, last_run_at, last_status'),
    supabase.from('system_logs').select('severity, context, message').in('severity', ['warning', 'error', 'critical']).gte('created_at', since7).limit(1000),
    supabase.from('approvals').select('kind, status').gte('created_at', since30).limit(1000),
    supabase.from('voice_calls').select('status, duration_seconds, cost_usd').gte('created_at', since30).limit(1000),
    openCodeRequests(),
  ]);

  const logRows = (logs.data || []) as Array<{ severity: string; context: string; message: string }>;
  const voiceRows = (voice.data || []) as Array<{ duration_seconds: number | null; cost_usd: number | null }>;
  return {
    ...base,
    stale_or_failing_jobs: staleJobs((heartbeats.data || []) as Parameters<typeof staleJobs>[0]),
    problems_last_7d: { by_context: groupCounts(logRows, 'context'), by_severity: groupCounts(logRows, 'severity'), guard_blocks: logRows.filter((row) => row.context === 'ceo-audit' && row.message.includes('BLOCKED')).length },
    approvals_last_30d: groupCounts((approvals.data || []) as Array<{ kind: string; status: string }>, 'status'),
    voice_calls_last_30d: { calls: voiceRows.length, minutes: Math.round(voiceRows.reduce((sum, row) => sum + (row.duration_seconds || 0), 0) / 60), cost_usd: Number(voiceRows.reduce((sum, row) => sum + Number(row.cost_usd || 0), 0).toFixed(2)) },
    open_ceo_requests_on_github: issues,
  };
}

export function buildIntrospectionTools(manifest: () => ToolManifest) {
  return {
    system_introspection: tool({
      description: 'Audit the MJIC AI system itself: every tool the bot has, scheduled jobs and their risk class, stale or failing jobs, errors in the last 7 days, guard blocks, approval stats, voice-call usage, open improvement requests on GitHub, and missing configuration. Use it before suggesting improvements to the AI system.',
      inputSchema: z.object({}),
      execute: async () => gatherSystemHealth(manifest()),
    }),
  };
}
