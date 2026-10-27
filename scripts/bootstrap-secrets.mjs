// Metadata audit by default; optional missing-only sync encrypts locally via gh and stdin.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
export const REQUIRED_SECRETS = [
  'COPILOT_GITHUB_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];
const REQUIRED_WORKFLOW = 'devq-cloud.yml';

async function github(path, token, fetcher) {
  const response = await fetcher(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: response.status === 200 ? await response.json() : null };
}

async function listSecretNames(repo, token, fetcher) {
  const names = [];
  for (let page = 1; ; page += 1) {
    const { status, body } = await github(`/repos/${repo}/actions/secrets?per_page=100&page=${page}`, token, fetcher);
    if (status !== 200 || !body) throw new Error(`GET secrets failed: HTTP ${status} (token needs repo secrets read access)`);
    if (!Array.isArray(body.secrets)) throw new Error('GitHub secret metadata is malformed.');
    names.push(...body.secrets.map((secret) => secret.name));
    if (body.secrets.length < 100) return names;
  }
}

export async function auditCloudRunner({ repo, env, syncMissing = false, ghPath = 'gh', fetcher = fetch, run = spawnSync }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Expected owner/repo, not a flag or URL.');
  const token = env.GITHUB_PAT || env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_PAT is not configured.');
  let present = new Set(await listSecretNames(repo, token, fetcher));
  const synced = [];
  if (syncMissing) {
    const candidates = REQUIRED_SECRETS.filter((name) => !present.has(name) && env[name]?.trim());
    if (candidates.length) {
      const version = run(ghPath, ['--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
      if (version.error || version.status !== 0 || !version.stdout?.startsWith('gh version ')) {
        throw new Error('GitHub CLI is unavailable. Install official gh or supply --gh-path=<executable>. No secrets were changed.');
      }
    }
    for (const name of candidates) {
      const result = run(ghPath, ['secret', 'set', name, '--repo', repo], {
        input: env[name], encoding: 'utf8', timeout: 30_000, windowsHide: true,
        env: { ...process.env, GH_TOKEN: token, GH_PROMPT_DISABLED: '1' },
      });
      // Do not surface arbitrary CLI output: it may contain a secret or provider response.
      if (result.error || result.status !== 0) throw new Error(`GitHub encrypted secret sync failed for ${name}; re-audit before retrying.`);
      synced.push(name);
    }
    present = new Set(await listSecretNames(repo, token, fetcher));
    if (synced.some((name) => !present.has(name))) throw new Error('GitHub secret sync could not be verified.');
  }
  const workflow = await github(`/repos/${repo}/actions/workflows/${REQUIRED_WORKFLOW}`, token, fetcher);
  const workflowOk = workflow.status === 200 && workflow.body?.state === 'active';
  return {
    repo, secrets: Object.fromEntries(REQUIRED_SECRETS.map((name) => [name, present.has(name)])),
    missing: REQUIRED_SECRETS.filter((name) => !present.has(name)), synced,
    unavailableLocally: REQUIRED_SECRETS.filter((name) => !present.has(name) && !env[name]?.trim()),
    workflow: { name: REQUIRED_WORKFLOW, status: workflow.status, active: workflowOk },
    ready: REQUIRED_SECRETS.every((name) => present.has(name)) && workflowOk,
    verification: 'Names and workflow state only; credential validity, Copilot entitlement, quotas and end-to-end execution are not verified.',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (positional.length > 1 || args.some((arg) => arg.startsWith('--') && arg !== '--sync-missing' && !arg.startsWith('--gh-path='))) {
    throw new Error('Usage: node scripts/bootstrap-secrets.mjs [owner/repo] [--sync-missing] [--gh-path=<executable>]');
  }
  let local = {};
  try {
    local = parseEnv(readFileSync(resolve(ROOT, '.env.local'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not read local environment configuration.');
  }
  const env = { ...local, ...process.env };
  const report = await auditCloudRunner({
    repo: positional[0] || env.GITHUB_REPO || 'MichaelJ888/jacket-ai-', env,
    syncMissing: args.includes('--sync-missing'),
    ghPath: args.find((arg) => arg.startsWith('--gh-path='))?.slice('--gh-path='.length) || 'gh',
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : '';
    console.error(/^(Usage:|Expected owner|GITHUB_PAT|GET secrets failed|GitHub |Could not read local)/.test(message) ? message : 'GitHub runner audit failed; verify connectivity and scoped access.');
    process.exitCode = 1;
  });
}
