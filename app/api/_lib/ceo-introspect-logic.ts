// Pure helpers for system self-inspection. No imports so they are unit-testable.

export const TRACKED_ENV = [
  'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_GATEWAY_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_CEO_USER_ID',
  'TELEGRAM_WEBHOOK_SECRET', 'CRON_SECRET', 'SCHEDULER_TOKEN', 'GITHUB_TOKEN', 'GITHUB_PAT', 'HINDSIGHT_URL', 'RETELL_API_KEY', 'RETELL_AGENT_ID',
] as const;

// Reports only whether a variable is set, never its value.
export function envReadiness(env: Record<string, string | undefined>) {
  return Object.fromEntries(TRACKED_ENV.map((name) => [name, Boolean(env[name])])) as Record<(typeof TRACKED_ENV)[number], boolean>;
}

export function configHints(ready: Record<string, boolean>) {
  const hints: string[] = [];
  if (!ready.TELEGRAM_CEO_USER_ID) hints.push('TELEGRAM_CEO_USER_ID is not set: anyone inside the ops chat can command the CEO bot. Set it to the CEO\'s numeric Telegram id.');
  if (!ready.TELEGRAM_WEBHOOK_SECRET) hints.push('TELEGRAM_WEBHOOK_SECRET is not set: the Telegram webhook accepts unsigned requests.');
  if (!ready.GITHUB_TOKEN && !ready.GITHUB_PAT) hints.push('No GitHub token: approved improvement ideas cannot open GitHub issues.');
  if (!ready.GEMINI_API_KEY && !ready.ANTHROPIC_API_KEY && !ready.AI_GATEWAY_API_KEY) hints.push('No LLM provider key is set.');
  if (!ready.RETELL_API_KEY) hints.push('Voice AI is not connected (RETELL_API_KEY missing): phone calls are not answered by AI yet.');
  return hints;
}

export function groupCounts<T extends Record<string, unknown>>(rows: T[], key: keyof T, top = 10) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = String(row[key] ?? 'unknown');
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([name, count]) => ({ name, count }));
}

export function staleJobs(heartbeats: Array<{ job: string; last_run_at: string | null; last_status: string | null }>, now = Date.now(), maxAgeHours = 36) {
  return heartbeats
    .filter((row) => !row.last_run_at || now - new Date(row.last_run_at).getTime() > maxAgeHours * 3_600_000 || (row.last_status && row.last_status !== 'ok'))
    .map((row) => ({ job: row.job, last_run_at: row.last_run_at, last_status: row.last_status }));
}
