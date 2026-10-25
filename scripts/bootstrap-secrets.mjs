// Checks that the GitHub Actions secrets and workflow needed by the Telegram dev queue exist on the repo.
// GitHub never returns secret values, so this validates names only. Set the values in
// Settings > Secrets and variables > Actions. Exit code 1 means something required is missing.
// Usage: node scripts/bootstrap-secrets.mjs [owner/repo]
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const REQUIRED_SECRETS = [
  'COPILOT_GITHUB_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];
const REQUIRED_WORKFLOW = 'devq-cloud.yml';

function loadEnvFile() {
  const file = resolve(ROOT, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

async function github(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: response.status === 200 ? await response.json() : null };
}

async function listSecretNames(repo, token) {
  const names = [];
  for (let page = 1; ; page += 1) {
    const { status, body } = await github(`/repos/${repo}/actions/secrets?per_page=100&page=${page}`, token);
    if (status !== 200 || !body) throw new Error(`GET secrets failed: HTTP ${status} (token needs repo secrets read access)`);
    names.push(...body.secrets.map((secret) => secret.name));
    if (body.secrets.length < 100) return names;
  }
}

async function main() {
  loadEnvFile();
  const repo = process.argv[2] || process.env.GITHUB_REPO || 'MichaelJ888/jacket-ai-';
  const token = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_PAT is not set in .env.local.');
    process.exit(1);
  }

  const present = new Set(await listSecretNames(repo, token));
  const missing = REQUIRED_SECRETS.filter((name) => !present.has(name));
  for (const name of REQUIRED_SECRETS) console.log(`${present.has(name) ? 'OK     ' : 'MISSING'} secret ${name}`);

  const workflow = await github(`/repos/${repo}/actions/workflows/${REQUIRED_WORKFLOW}`, token);
  const workflowOk = workflow.status === 200;
  console.log(`${workflowOk ? 'OK     ' : 'MISSING'} workflow ${REQUIRED_WORKFLOW} (HTTP ${workflow.status})`);

  if (missing.length || !workflowOk) {
    console.error(`\nNot ready. Missing: ${[...missing, ...(workflowOk ? [] : [REQUIRED_WORKFLOW])].join(', ')}`);
    process.exit(1);
  }
  console.log(`\nReady: all required secrets and the ${REQUIRED_WORKFLOW} workflow are present on ${repo}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
