import { publicBaseUrl } from './channels';
import { type CronJob } from './ceo-policy';

// Executors for CEO-bot actions. Kept free of ceo-control imports so approval resolution can call them without a cycle.

export async function runCronJob(job: CronJob): Promise<{ ok: boolean; status: number; body: string }> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, status: 0, body: 'CRON_SECRET is not set' };
  try {
    const response = await fetch(`${publicBaseUrl()}/api/cron/${job}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(50000),
    });
    return { ok: response.ok, status: response.status, body: (await response.text()).slice(0, 300) };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : 'request failed' };
  }
}

// Opens a labelled GitHub issue so the coding agent / a developer prepares a PR. Nothing is merged or deployed here:
// CI (lint, test, build) runs on the PR and the CEO merges it.
export async function createCodeChangeIssue(title: string, body: string): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'MichaelJ888/jacket-ai-';
  if (!token) return { ok: false, reason: 'GITHUB_TOKEN is not set (needs a fine-grained token with Issues: write on the repo)' };
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `[CEO request] ${title}`.slice(0, 200),
        body: `${body.slice(0, 6000)}\n\n---\nCreated from a CEO-approved Telegram request. Open a PR only; do not push to main. CI must pass and the CEO merges.`,
        labels: ['ceo-request'],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json().catch(() => ({}))) as { html_url?: string; message?: string };
    return response.ok ? { ok: true, url: data.html_url } : { ok: false, reason: data.message || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'request failed' };
  }
}
