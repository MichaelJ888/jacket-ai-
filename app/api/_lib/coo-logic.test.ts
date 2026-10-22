import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateJobs, groupByDepartment, JOBS } from './coo-logic.ts';

const now = Date.parse('2026-01-10T12:00:00Z');
const ago = (hours: number) => new Date(now - hours * 3600000).toISOString();

test('job states: ok, degraded, stale, never', () => {
  const reports = evaluateJobs([
    { job: 'sales-followups', last_run_at: ago(0.5), last_status: 'ok' },
    { job: 'retry-queue', last_run_at: ago(0.5), last_status: 'degraded' },
    { job: 'embroidery-pickup-alerts', last_run_at: ago(10), last_status: 'ok' },
  ], now);
  const state = (job: string) => reports.find((report) => report.job === job)?.state;
  assert.equal(state('sales-followups'), 'ok');
  assert.equal(state('retry-queue'), 'degraded');
  assert.equal(state('embroidery-pickup-alerts'), 'stale');
  assert.equal(state('backup'), 'never');
  assert.equal(reports.length, JOBS.length);
});

test('department needs attention only on stale or degraded jobs', () => {
  const groups = groupByDepartment(evaluateJobs([{ job: 'retry-queue', last_run_at: ago(9), last_status: 'ok' }], now));
  assert.equal(groups.find((g) => g.department === 'Platform')?.status, 'attention');
  assert.equal(groups.find((g) => g.department === 'Finance')?.status, 'ok');
});
