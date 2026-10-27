import assert from 'node:assert/strict';
import test from 'node:test';
import { auditEnvironment, planProductionSync, PRODUCTION_SYNC_KEYS, REQUIRED_ENV } from './lib/env-policy.mjs';
import { accessSeverity } from './lib/diagnostic-policy.mjs';
import { runEnvCheck } from './sync-env-check.mjs';

const local = Object.fromEntries(PRODUCTION_SYNC_KEYS.map((key) => [key, `private-${key}`]));
const envs = PRODUCTION_SYNC_KEYS.map((key) => ({ key, target: ['production'] }));

test('environment metadata covers targets and ignores branch-scoped overrides', () => {
  const result = auditEnvironment(local, [...envs, { key: 'ADMIN_TOKEN', target: 'preview', gitBranch: 'feature' }]);
  assert.deepEqual(result.targets.production.missing, []);
  assert.ok(result.targets.preview.missing.includes('ADMIN_TOKEN'));
  assert.deepEqual(result.local.missing, []);
  assert.ok(!JSON.stringify(result).includes('private-'));
});

test('shared production Supabase metadata is reported, not mislabeled isolated', () => {
  const shared = auditEnvironment(local, [{ key: 'NEXT_PUBLIC_SUPABASE_URL', target: ['production', 'preview', 'development'] }]);
  assert.equal(shared.databaseIsolation.status, 'shared');
  assert.deepEqual(shared.databaseIsolation.targets, ['production', 'preview', 'development']);
  const separate = auditEnvironment(local, [
    { key: 'NEXT_PUBLIC_SUPABASE_URL', target: ['production'] },
    { key: 'NEXT_PUBLIC_SUPABASE_URL', target: ['preview'] },
  ]);
  assert.equal(separate.databaseIsolation.status, 'unverified');
  assert.ok(!JSON.stringify(shared).includes('private-'));
});

test('production sync is missing-only, allowlisted and production-only', () => {
  const plan = planProductionSync({ ...local, VERCEL_TOKEN: 'never-copy', SUPABASE_ACCESS_TOKEN: 'never-copy' }, envs.filter((entry) => entry.key !== 'ADMIN_TOKEN'));
  assert.deepEqual(plan, [{ key: 'ADMIN_TOKEN', value: local.ADMIN_TOKEN, type: 'encrypted', target: ['production'] }]);
  assert.deepEqual(planProductionSync({}, []), []);
  assert.deepEqual(planProductionSync(local, envs), []);
});

test('optional access warnings are tightly scoped and never hide runtime/project failures', () => {
  assert.equal(accessSeverity('vercel', '/v2/user', 404), 'warning');
  assert.equal(accessSeverity('vercel', '/v2/teams', 403), 'warning');
  assert.equal(accessSeverity('github', '/repos/a/b/actions/jobs/123/logs', 401), 'warning');
  for (const [service, path, status] of [
    ['vercel', '/v9/projects/jacket-ai/env', 403],
    ['vercel', '/v2/user', 401],
    ['github', '/repos/a/b/issues', 401],
    ['github', '/repos/a/b/actions/jobs/123/logs', 500],
  ]) assert.equal(accessSeverity(service, path, status), 'error');
});

function fakeApi({ coreOk = true, projectStatus = 200, sync = false } = {}) {
  let current = sync ? envs.filter((entry) => entry.key !== 'ADMIN_TOKEN') : envs;
  const writes = [];
  return {
    writes,
    fetcher: async (url, init) => {
      const path = new URL(url).pathname;
      if (init?.method === 'POST') {
        writes.push(JSON.parse(init.body));
        current = envs;
        return Response.json({ created: true });
      }
      if (path.endsWith('/env')) return Response.json({ envs: current }, { status: projectStatus });
      if (path.endsWith('/api/health')) return Response.json({ status: coreOk ? 'ok' : 'down', checks: { database: { ok: coreOk }, env: { ok: coreOk } } }, { status: coreOk ? 200 : 503 });
      return new Response(null, { status: path.endsWith('/user') ? 404 : path.endsWith('/teams') ? 403 : 401 });
    },
  };
}

test('read-only audit outputs names only and optional access warnings do not fail core', async () => {
  const api = fakeApi();
  const report = await runEnvCheck({ local, env: { VERCEL_TOKEN: 'private-token', GITHUB_PAT: 'private-pat' }, fetcher: api.fetcher, githubJobId: '123' });
  assert.equal(report.coreHealthy, true);
  assert.equal(report.status, 'warning');
  assert.deepEqual(report.errors, []);
  assert.equal(report.diagnostics.length, 3);
  assert.equal(api.writes.length, 0);
  assert.ok(!JSON.stringify(report).includes('private-'));
});

test('core failure stays a failure even when optional access is denied', async () => {
  const report = await runEnvCheck({ local, env: { VERCEL_TOKEN: 'private-token' }, fetcher: fakeApi({ coreOk: false }).fetcher });
  assert.equal(report.status, 'error');
  assert.equal(report.coreHealthy, false);
});

test('project access errors cannot be downgraded as account warnings', async () => {
  await assert.rejects(runEnvCheck({ local, env: { VERCEL_TOKEN: 'private-token' }, fetcher: fakeApi({ projectStatus: 403 }).fetcher }), /HTTP 403/);
});

test('sync writes and verifies only missing production values without including them in report', async () => {
  const api = fakeApi({ sync: true });
  const report = await runEnvCheck({ local, env: { VERCEL_TOKEN: 'private-token' }, fetcher: api.fetcher, syncMissingProduction: true });
  assert.equal(api.writes.length, 1);
  assert.deepEqual(api.writes[0].map((entry) => entry.key), ['ADMIN_TOKEN']);
  assert.deepEqual(report.synced, ['ADMIN_TOKEN']);
  assert.ok(!JSON.stringify(report).includes('private-'));
  assert.ok(REQUIRED_ENV.includes('META_APP_SECRET'));
});
