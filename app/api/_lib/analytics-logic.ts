export const MANILA_TZ = 'Asia/Manila';
export const SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

const DAY_MS = 86_400_000;
const MANILA_OFFSET = '+08:00';

// YYYY-MM-DD in Manila time, the business's reporting calendar.
export function manilaDay(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Consecutive Manila days ending today, oldest first.
export function dayRange(now: Date, days: number): string[] {
  const todayMidnight = Date.parse(`${manilaDay(now)}T00:00:00${MANILA_OFFSET}`);
  return Array.from({ length: days }, (_, i) => manilaDay(new Date(todayMidnight - (days - 1 - i) * DAY_MS + DAY_MS / 2)));
}

export function rangeStartIso(now: Date, days: number): string {
  const first = dayRange(now, days)[0];
  return new Date(Date.parse(`${first}T00:00:00${MANILA_OFFSET}`)).toISOString();
}

export function countByDay(timestamps: string[], days: string[]): number[] {
  const index = new Map(days.map((day, i) => [day, i]));
  const counts = new Array<number>(days.length).fill(0);
  for (const ts of timestamps) {
    const i = index.get(manilaDay(ts));
    if (i !== undefined) counts[i] += 1;
  }
  return counts;
}

export type SampleRow = { status: string; expected_return_at: string | null };
export type SampleSummary = { pending: number; overdue: number; returned: number; lost: number; damaged: number };

export function summarizeSamples(rows: SampleRow[], today: string): SampleSummary {
  const summary: SampleSummary = { pending: 0, overdue: 0, returned: 0, lost: 0, damaged: 0 };
  for (const row of rows) {
    if (row.status === 'OUT') {
      summary.pending += 1;
      if (row.expected_return_at && row.expected_return_at < today) summary.overdue += 1;
    } else if (row.status === 'RETURNED') summary.returned += 1;
    else if (row.status === 'LOST') summary.lost += 1;
    else if (row.status === 'DAMAGED') summary.damaged += 1;
  }
  return summary;
}

export type LogRow = { severity: string; created_at: string };
export function severityByDay(logs: LogRow[], days: string[]): Record<Severity, number[]> {
  const out = Object.fromEntries(SEVERITIES.map((s) => [s, new Array<number>(days.length).fill(0)])) as Record<Severity, number[]>;
  const index = new Map(days.map((day, i) => [day, i]));
  for (const log of logs) {
    const i = index.get(manilaDay(log.created_at));
    const severity = SEVERITIES.find((s) => s === log.severity);
    if (i !== undefined && severity) out[severity][i] += 1;
  }
  return out;
}

export type HeartbeatRow = { job: string; last_run_at: string; last_status: string; last_alert_at: string | null };
export type HeartbeatView = { job: string; lastRunAt: string; ageHours: number; status: string; stale: boolean };

export function heartbeatViews(heartbeats: HeartbeatRow[], now: Date): HeartbeatView[] {
  return heartbeats
    .map((hb) => {
      const ageHours = Math.max(0, (now.getTime() - Date.parse(hb.last_run_at)) / 3_600_000);
      return {
        job: hb.job,
        lastRunAt: hb.last_run_at,
        ageHours: Math.round(ageHours * 10) / 10,
        status: hb.last_status,
        stale: hb.last_status !== 'ok' || ageHours > 24,
      };
    })
    .sort((a, b) => a.job.localeCompare(b.job));
}

export type AlertMetrics = {
  critical24h: number;
  warning24h: number;
  error24h: number;
  alertsSent24h: number;
  staleJobs: number;
  queuePending: number;
  queueFailed: number;
};

export function alertMetrics(logs: LogRow[], heartbeats: HeartbeatRow[], now: Date, queue: { pending: number; failed: number }): AlertMetrics {
  const since = now.getTime() - DAY_MS;
  const recent = logs.filter((log) => Date.parse(log.created_at) >= since);
  const count = (severity: Severity) => recent.filter((log) => log.severity === severity).length;
  const views = heartbeatViews(heartbeats, now);
  return {
    critical24h: count('critical'),
    warning24h: count('warning'),
    error24h: count('error'),
    alertsSent24h: heartbeats.filter((hb) => hb.last_alert_at && Date.parse(hb.last_alert_at) >= since).length,
    staleJobs: views.filter((v) => v.stale).length,
    queuePending: queue.pending,
    queueFailed: queue.failed,
  };
}
