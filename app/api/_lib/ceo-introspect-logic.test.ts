import assert from 'node:assert/strict';
import test from 'node:test';
import { configHints, envReadiness, groupCounts, staleJobs } from './ceo-introspect-logic.ts';

test('env readiness reports booleans only, never values', () => {
  const ready = envReadiness({ GEMINI_API_KEY: 'super-secret', CRON_SECRET: '' });
  assert.equal(ready.GEMINI_API_KEY, true);
  assert.equal(ready.CRON_SECRET, false);
  assert.ok(!JSON.stringify(ready).includes('super-secret'));
});

test('config hints flag missing security and integration settings', () => {
  const hints = configHints(envReadiness({}));
  assert.ok(hints.some((hint) => hint.includes('TELEGRAM_CEO_USER_ID')));
  assert.ok(hints.some((hint) => hint.includes('RETELL_API_KEY')));
  const ok = configHints(envReadiness({ TELEGRAM_CEO_USER_ID: '1', TELEGRAM_WEBHOOK_SECRET: 'x', GITHUB_PAT: 'x', GEMINI_API_KEY: 'x', RETELL_API_KEY: 'x' }));
  assert.deepEqual(ok, []);
});

test('groupCounts ranks by frequency', () => {
  const rows = [{ c: 'a' }, { c: 'b' }, { c: 'a' }, { c: 'a' }, { c: 'b' }, { c: 'z' }];
  assert.deepEqual(groupCounts(rows, 'c', 2), [{ name: 'a', count: 3 }, { name: 'b', count: 2 }]);
});

test('stale or failing jobs are flagged', () => {
  const now = Date.parse('2026-01-10T00:00:00Z');
  const jobs = staleJobs([
    { job: 'fresh', last_run_at: '2026-01-09T20:00:00Z', last_status: 'ok' },
    { job: 'old', last_run_at: '2026-01-01T00:00:00Z', last_status: 'ok' },
    { job: 'failing', last_run_at: '2026-01-09T23:00:00Z', last_status: 'error' },
    { job: 'never', last_run_at: null, last_status: null },
  ], now);
  assert.deepEqual(jobs.map((job) => job.job), ['old', 'failing', 'never']);
});
