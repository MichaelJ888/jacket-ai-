export type Department = 'Sales & CRM' | 'Operations' | 'Finance' | 'Marketing' | 'Platform' | 'Strategy';

export type JobSpec = { job: string; department: Department; label: string; everyHours: number };

// everyHours = how often the job should report in. A job is "stale" after 2x that (cron jitter, GitHub Actions delays).
export const JOBS: JobSpec[] = [
  { job: 'sales-followups', department: 'Sales & CRM', label: 'Sales follow-up agent', everyHours: 1 },
  { job: 'meta-health', department: 'Sales & CRM', label: 'Facebook/Instagram connection monitor', everyHours: 24 },
  { job: 'embroidery-pickup-alerts', department: 'Operations', label: 'Embroidery pickup alerts', everyHours: 1 },
  { job: 'staff-reminders', department: 'Operations', label: 'Staff task reminders', everyHours: 1 },
  { job: 'retry-queue', department: 'Platform', label: 'Outbound message retry queue', everyHours: 1 },
  { job: 'payroll', department: 'Finance', label: 'Payroll run', everyHours: 24 * 7 },
  { job: 'backup', department: 'Platform', label: 'Database backup', everyHours: 24 * 8 },
  { job: 'watchdog', department: 'Platform', label: 'Uptime watchdog', everyHours: 24 },
  { job: 'memory-archive', department: 'Platform', label: 'Memory archiver', everyHours: 24 },
  { job: 'content-plan', department: 'Marketing', label: 'Content planner', everyHours: 24 },
  { job: 'content-publisher', department: 'Marketing', label: 'Content publisher', everyHours: 1 },
  { job: 'swarm-worker', department: 'Strategy', label: 'Swarm worker', everyHours: 24 },
  { job: 'improvement-scout', department: 'Strategy', label: 'Improvement scout', everyHours: 1 },
  { job: 'insights', department: 'Strategy', label: 'Forecast & pricing insights', everyHours: 24 * 7 },
  { job: 'consultant', department: 'Strategy', label: 'AI consultant report', everyHours: 24 * 7 },
  { job: 'ceo-digest', department: 'Strategy', label: 'CEO digest', everyHours: 24 },
  { job: 'repo-watch', department: 'Strategy', label: 'Repo watch', everyHours: 24 * 31 },
];

export type Heartbeat = { job: string; last_run_at: string; last_status: string };
export type JobState = 'ok' | 'degraded' | 'stale' | 'never';
export type JobReport = JobSpec & { state: JobState; lastRunAt: string | null; lastStatus: string | null };

export function evaluateJobs(beats: Heartbeat[], now = Date.now(), specs: JobSpec[] = JOBS): JobReport[] {
  const byJob = new Map(beats.map((beat) => [beat.job, beat]));
  return specs.map((spec) => {
    const beat = byJob.get(spec.job);
    if (!beat) return { ...spec, state: 'never', lastRunAt: null, lastStatus: null };
    const ageHours = (now - new Date(beat.last_run_at).getTime()) / 3600000;
    const state: JobState = ageHours > spec.everyHours * 2 + 1 ? 'stale' : beat.last_status === 'ok' ? 'ok' : 'degraded';
    return { ...spec, state, lastRunAt: beat.last_run_at, lastStatus: beat.last_status };
  });
}

export type DepartmentReport = { department: Department; status: 'ok' | 'attention'; jobs: JobReport[] };

export function groupByDepartment(reports: JobReport[]): DepartmentReport[] {
  const order: Department[] = ['Sales & CRM', 'Operations', 'Finance', 'Marketing', 'Platform', 'Strategy'];
  return order.map((department) => {
    const jobs = reports.filter((report) => report.department === department);
    // "never" is not a failure by itself: some jobs only run weekly or monthly.
    return { department, jobs, status: jobs.some((job) => job.state === 'stale' || job.state === 'degraded') ? 'attention' : 'ok' };
  });
}
