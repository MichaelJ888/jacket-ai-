// Pure policy for what the CEO bot may do on its own vs. what needs a Telegram tap. No imports so it is unit-testable.

export type Risk = 'auto' | 'approval';

// Every cron the CEO bot may trigger. Anything not listed is refused.
export const CRON_JOBS = {
  'ceo-digest': 'auto',
  watchdog: 'auto',
  'staff-reminders': 'auto',
  'sales-followups': 'auto',
  'embroidery-pickup-alerts': 'auto',
  'content-plan': 'auto',
  insights: 'auto',
  'improvement-scout': 'auto',
  'repo-watch': 'auto',
  'swarm-worker': 'auto',
  // Touch money, publish publicly, book external services, or delete data: always one-tap approval.
  payroll: 'approval',
  'content-publisher': 'approval',
  'retry-queue': 'approval',
  backup: 'approval',
  'memory-archive': 'approval',
} as const satisfies Record<string, Risk>;

export type CronJob = keyof typeof CRON_JOBS;

export function cronRisk(job: string): Risk | null {
  return Object.prototype.hasOwnProperty.call(CRON_JOBS, job) ? CRON_JOBS[job as CronJob] : null;
}

const INJECTION = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |any )?(the )?(previous|prior|above|system) (instructions|prompts?|rules)/i,
  /(reveal|show|print|repeat|leak|send) (me )?(your |the )?(system|hidden|initial) (prompt|instructions)|\.env\b|service[_ -]?role|api[_ -]?key/i,
  /<\/?(system|assistant|tool)>/i,
];

export type GuardInput = { killSwitch: boolean; actionsToday: number; dailyCap: number; payload: unknown };
export type GuardVerdict = { ok: true } | { ok: false; reason: string };

// Deterministic checks run before every action tool: kill switch, daily action budget, injection/secret-exfil patterns.
export function evaluateGuard({ killSwitch, actionsToday, dailyCap, payload }: GuardInput): GuardVerdict {
  if (killSwitch) return { ok: false, reason: 'Kill switch is ON. Actions are frozen until the CEO turns it off.' };
  if (actionsToday >= dailyCap) return { ok: false, reason: `Daily action cap (${dailyCap}) reached. Raise CEO_DAILY_ACTION_CAP or wait until tomorrow.` };
  const text = JSON.stringify(payload ?? '');
  if (INJECTION.some((pattern) => pattern.test(text))) return { ok: false, reason: 'Blocked: input looks like a prompt-injection or secret-exfiltration attempt.' };
  return { ok: true };
}

export function sanitizePageKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}
