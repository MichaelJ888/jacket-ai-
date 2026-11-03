import assert from 'node:assert/strict';
import test from 'node:test';

import { CATCH_UP_JOBS, dueCatchUpJobs, runAutoPilot, type HeartbeatRow } from './auto-pilot.ts';

const now = Date.parse('2026-11-03T12:00:00Z');
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

test('dueCatchUpJobs: fresh jobs are not due, stale and never-ran jobs are due', () => {
  const beats: HeartbeatRow[] = [
    { job: 'retry-queue', last_run_at: ago(10), last_status: 'ok' },
    { job: 'sales-followups', last_run_at: ago(400), last_status: 'ok' },
    { job: 'embroidery-pickup-alerts', last_run_at: ago(20), last_status: 'ok' },
  ];
  const due = dueCatchUpJobs(beats, now).map((job) => job.job);
  assert.ok(!due.includes('retry-queue'), 'fresh retry-queue must not be due');
  assert.ok(due.includes('sales-followups'), '400-min-old sales-followups must be due');
  assert.ok(due.includes('embroidery-pickup-alerts'), '20-min-old 5-min job must be due');
  assert.ok(due.includes('watchdog'), 'never-ran job must be due');
});

test('dueCatchUpJobs: most-stale job comes first so kick caps cannot starve it', () => {
  const beats: HeartbeatRow[] = CATCH_UP_JOBS.map((job) => ({ job: job.job, last_run_at: ago(5), last_status: 'ok' }));
  beats.find((row) => row.job === 'sales-followups')!.last_run_at = ago(9_000);
  beats.find((row) => row.job === 'retry-queue')!.last_run_at = ago(300);
  const due = dueCatchUpJobs(beats, now).map((job) => job.job);
  assert.equal(due[0], 'sales-followups');
  assert.equal(due[1], 'retry-queue');
});

test('dueCatchUpJobs: invalid timestamps count as due', () => {
  const due = dueCatchUpJobs([{ job: 'retry-queue', last_run_at: 'not-a-date', last_status: 'ok' }], now);
  assert.ok(due.some((job) => job.job === 'retry-queue'));
});

test('runAutoPilot kicks only due jobs, capped by maxKicks, and tolerates fetch failures', async () => {
  const beats: HeartbeatRow[] = CATCH_UP_JOBS.map((job) => ({ job: job.job, last_run_at: ago(5), last_status: 'ok' }));
  beats.find((row) => row.job === 'retry-queue')!.last_run_at = ago(120);
  beats.find((row) => row.job === 'sales-followups')!.last_run_at = ago(120);
  beats.find((row) => row.job === 'watchdog')!.last_run_at = ago(120);

  const calls: string[] = [];
  const summary = await runAutoPilot({
    origin: 'https://example.test',
    token: 'secret',
    supabase: { from: () => ({ select: async () => ({ data: beats, error: null }) }) },
    fetchFn: (async (url: string) => {
      calls.push(url);
      if (url.includes('sales-followups')) throw new Error('boom');
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
    now,
    maxKicks: 3,
  });

  assert.equal(summary.checked, CATCH_UP_JOBS.length);
  assert.deepEqual([...summary.due].sort(), ['retry-queue', 'sales-followups', 'watchdog']);
  assert.equal(summary.kicked.length, 3);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((url) => url.startsWith('https://example.test/api/cron/')));
  assert.equal(summary.kicked.find((kick) => kick.job === 'sales-followups')?.status, 'error');
  assert.equal(summary.skipped.length, 0);
});

test('runAutoPilot reports heartbeat query failure without kicking anything', async () => {
  const summary = await runAutoPilot({
    origin: 'https://example.test',
    token: 'secret',
    supabase: { from: () => ({ select: async () => ({ data: null, error: { message: 'db down' } }) }) },
    fetchFn: (async () => { throw new Error('must not be called'); }) as typeof fetch,
    now,
  });
  assert.equal(summary.heartbeatError, 'db down');
  assert.equal(summary.kicked.length, 0);
});
