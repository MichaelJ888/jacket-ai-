import assert from 'node:assert/strict';
import test from 'node:test';

import { isAdminAuthorized, isCronAuthorized, isMemoryAuthorized } from './auth.ts';

const req = (token?: string) => new Request('http://x.test', { headers: token ? { authorization: `Bearer ${token}` } : {} });

test('scoped tokens do not cross over and fail closed', () => {
  process.env.CRON_SECRET = 'vercel-cron';
  process.env.SCHEDULER_TOKEN = 'gh-sched';
  process.env.ADMIN_PASSWORD = 'admin-pw';
  delete process.env.ADMIN_TOKEN;
  delete process.env.MEMORY_TOKEN;
  assert.equal(isCronAuthorized(req('vercel-cron')), true);
  assert.equal(isCronAuthorized(req('gh-sched')), true);
  assert.equal(isCronAuthorized(req('admin-pw')), false);
  assert.equal(isAdminAuthorized(req('admin-pw')), true);
  assert.equal(isAdminAuthorized(req('vercel-cron')), false);
  assert.equal(isAdminAuthorized(req('gh-sched')), false);
  assert.equal(isMemoryAuthorized(req('admin-pw')), true);
  assert.equal(isMemoryAuthorized(req('gh-sched')), false);
  assert.equal(isAdminAuthorized(req()), false);
});

test('unset tokens never authorize, even an empty bearer', () => {
  for (const key of ['CRON_SECRET', 'SCHEDULER_TOKEN', 'ADMIN_PASSWORD', 'ADMIN_TOKEN', 'MEMORY_TOKEN']) delete process.env[key];
  assert.equal(isCronAuthorized(req('')), false);
  assert.equal(isAdminAuthorized(req('undefined')), false);
});
