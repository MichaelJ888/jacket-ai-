import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { accessSeverity } from './lib/diagnostic-policy.mjs';
import { auditEnvironment, planProductionSync, REQUIRED_ENV } from './lib/env-policy.mjs';

export async function runEnvCheck({ local, env, fetcher = fetch, syncMissingProduction = false, githubJobId }) {
  const token = env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN is required for project environment metadata.');
  const project = encodeURIComponent(env.VERCEL_PROJECT_ID || 'jacket-ai');
  const api = async (path, method = 'GET', body) => {
    const url = new URL(`https://api.vercel.com${path}`);
    if (env.VERCEL_TEAM_ID) url.searchParams.set('teamId', env.VERCEL_TEAM_ID);
    const response = await fetcher(url, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Vercel project metadata ${method} failed (HTTP ${response.status}).`);
    const result = await response.json();
    if (!Array.isArray(result.envs)) throw new Error('Vercel environment metadata was malformed.');
    return result.envs;
  };
  let envs = await api(`/v9/projects/${project}/env`);
  const synced = [];
  if (syncMissingProduction) {
    const plan = planProductionSync(local, envs);
    if (plan.length) {
      const url = new URL(`https://api.vercel.com/v10/projects/${project}/env`);
      if (env.VERCEL_TEAM_ID) url.searchParams.set('teamId', env.VERCEL_TEAM_ID);
      const response = await fetcher(url, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(plan), signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Missing-production sync failed (HTTP ${response.status}); re-audit before retrying.`);
      await response.body?.cancel();
      envs = await api(`/v9/projects/${project}/env`);
      const missing = new Set(auditEnvironment(local, envs).targets.production.missing);
      if (plan.some((entry) => missing.has(entry.key) || !envs.some((item) => item.key === entry.key && [].concat(item.target || []).includes('production')))) {
        throw new Error('Missing-production sync could not be verified.');
      }
      synced.push(...plan.map((entry) => entry.key));
    }
  }
  const audit = auditEnvironment(local, envs);
  const errors = [];
  const warnings = [];
  if (audit.targets.production.missing.length) errors.push('Required production/Meta environment names are missing.');
  if (audit.local.missing.length) warnings.push('Local configuration has missing variables; see names in local.missing.');
  for (const target of ['preview', 'development']) {
    if (audit.targets[target].missing.length) warnings.push(`${target}: incomplete configuration; use isolated test credentials, not copied production secrets.`);
  }
  let coreHealthy = false;
  try {
    const base = (env.APP_BASE_URL || 'https://jacket-ai.vercel.app').replace(/\/+$/, '');
    const response = await fetcher(`${base}/api/health`, { signal: AbortSignal.timeout(20_000), redirect: 'manual' });
    const data = await response.json();
    coreHealthy = response.ok && data.checks?.database?.ok === true && data.checks?.env?.ok === true;
    if (!coreHealthy) errors.push(`Core deployment health failed (HTTP ${response.status}).`);
    else if (data.status !== 'ok') warnings.push('Deployment core is up but operational health is degraded; inspect /api/health.');
  } catch {
    errors.push('Core deployment health could not be verified.');
  }
  const diagnostics = [];
  const inspect = async (service, path, tokenValue) => {
    try {
      const url = new URL(`https://${service === 'vercel' ? 'api.vercel.com' : 'api.github.com'}${path}`);
      if (service === 'vercel' && env.VERCEL_TEAM_ID) url.searchParams.set('teamId', env.VERCEL_TEAM_ID);
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${tokenValue}` },
        signal: AbortSignal.timeout(15_000), redirect: 'manual',
      });
      await response.body?.cancel();
      // GitHub log downloads respond with a redirect; no log content is needed.
      const severity = service === 'github' && response.status === 302 ? 'ok' : accessSeverity(service, path, response.status);
      diagnostics.push({ service, path, status: response.status, severity });
      if (severity !== 'ok') (severity === 'warning' ? warnings : errors).push(`${service} ${path}: HTTP ${response.status} (${severity === 'warning' ? 'optional inspection unavailable; not a deployment failure' : 'access check failed'}).`);
    } catch {
      diagnostics.push({ service, path, severity: 'warning' });
      warnings.push(`${service}: optional inspection request unavailable.`);
    }
  };
  await Promise.all(['/v2/user', '/v2/teams'].map((path) => inspect('vercel', path, token)));
  if (githubJobId) {
    if (!/^\d+$/.test(githubJobId)) throw new Error('GitHub job ID must contain digits only.');
    const githubToken = env.GITHUB_PAT || env.GITHUB_TOKEN;
    if (!githubToken) warnings.push('GitHub log access was not checked: token is missing.');
    else await inspect('github', `/repos/${env.GITHUB_REPO || 'MichaelJ888/jacket-ai-'}/actions/jobs/${githubJobId}/logs`, githubToken);
  }
  return { status: errors.length ? 'error' : warnings.length ? 'warning' : 'ok', coreHealthy, ...audit, synced, diagnostics, warnings, errors };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--sync-missing-production' && !/^--github-job=\d+$/.test(arg))) {
    throw new Error('Usage: node scripts/sync-env-check.mjs [--sync-missing-production] [--github-job=<id>]');
  }
  let local = {};
  try {
    local = parseEnv(readFileSync(new URL('../.env.local', import.meta.url), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not parse .env.local.');
  }
  const env = { ...local, ...process.env };
  const report = await runEnvCheck({
    local, env, syncMissingProduction: args.includes('--sync-missing-production'),
    githubJobId: args.find((arg) => arg.startsWith('--github-job='))?.split('=')[1],
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Error messages here are controlled; never emit provider bodies, headers or secret values.
    console.error(error instanceof Error && /^(VERCEL_TOKEN|Vercel |Missing-production |Usage:|GitHub job|Could not parse)/.test(error.message) ? error.message : 'Environment audit failed; check connectivity and scoped project access.');
    process.exitCode = 1;
  });
}

export { REQUIRED_ENV };
