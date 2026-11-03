import { NextResponse } from 'next/server';

import { evaluateJobs, groupByDepartment, type Heartbeat, type JobState } from '../../_lib/coo-logic';
import { evaluateOperationalHealth } from '../../_lib/health-logic';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { orgWithStatus } from '../../_lib/org-structure';

export const dynamic = 'force-dynamic';

// Public by design (same exposure level as /api/health): booleans, state labels
// and timings only — never counts of customers, financials, or row data.
export async function GET() {
  const supabase = getSupabaseAdmin();
  const checks: Record<string, { ok: boolean }> = {};
  let departments: ReturnType<typeof groupByDepartment> = [];
  let jobStates = new Map<string, JobState>();

  if (!supabase) {
    checks.database = { ok: false };
  } else {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [critical, queue, heartbeats] = await Promise.all([
      supabase.from('system_logs').select('id', { count: 'exact', head: true }).eq('severity', 'critical').is('resolved_at', null).gte('created_at', since),
      supabase.from('outbound_request_queue').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      supabase.from('job_heartbeats').select('job, last_run_at, last_status'),
    ]);
    Object.assign(checks, evaluateOperationalHealth(critical, queue, heartbeats));
    checks.database = { ok: !heartbeats.error };

    const beats = (heartbeats.data || []) as Heartbeat[];
    const reports = evaluateJobs(beats);
    departments = groupByDepartment(reports);
    jobStates = new Map(reports.map((report) => [report.job, report.state]));
  }

  const org = orgWithStatus(jobStates);
  const jobState = (job: string): JobState | 'unknown' => jobStates.get(job) ?? 'unknown';
  const stateOf = (...jobs: string[]) => {
    const states = jobs.map(jobState);
    return states.includes('stale') || states.includes('degraded') ? 'attention' : states.includes('unknown') ? 'unknown' : 'operational';
  };

  const features = [
    { id: 'ai-chat', label: 'AI customer chat & quoting', state: checks.database?.ok ? 'operational' : 'attention' },
    { id: 'costing', label: 'Costing / BOM engine', state: checks.database?.ok ? 'operational' : 'attention' },
    { id: 'digitizer', label: 'Embroidery auto-digitizer (DST/PES/VP3)', state: 'operational' },
    { id: 'crm', label: 'CRM & lead pipeline', state: checks.database?.ok ? 'operational' : 'attention' },
    { id: 'payments', label: 'Payment verification & fraud check', state: checks.database?.ok ? 'operational' : 'attention' },
    { id: 'telegram', label: 'Telegram staff bot & CEO approvals', state: stateOf('retry-queue') },
    { id: 'ads', label: 'Ads pipeline & content publisher', state: stateOf('content-publisher', 'content-plan') },
    { id: 'studio', label: 'CEO AI Studio & catalog rotation', state: 'operational' },
    { id: 'editor', label: 'Live visual site editor', state: 'operational' },
    { id: 'watchdog', label: 'Uptime watchdog & auto-pilot self-healing', state: stateOf('watchdog', 'auto-pilot') },
  ];

  const allOk = Object.values(checks).every((check) => check.ok);
  return NextResponse.json(
    {
      status: checks.database?.ok === false ? 'down' : allOk ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      company: org.company,
      departments: departments.map((dept) => ({
        department: dept.department,
        status: dept.status,
        jobs: dept.jobs.map((job) => ({ label: job.label, state: job.state, lastRunAt: job.lastRunAt })),
      })),
      org: {
        departments: org.departments,
        nodes: org.nodes.map((node) => ({ id: node.id, title: node.title, department: node.department, reportsTo: node.reportsTo, region: node.region ?? null, status: node.status })),
      },
      features,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
