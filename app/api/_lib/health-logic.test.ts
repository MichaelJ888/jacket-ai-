import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateOperationalHealth } from './health-logic.ts';

const now = Date.parse('2026-10-26T15:00:00Z');
const zero = { count: 0, error: null };
const jobs = ['sales-followups', 'content-publisher', 'retry-queue', 'swarm-worker'];
const healthy = () => ({
  error: null,
  data: jobs.map((job) => ({ job, last_run_at: new Date(now).toISOString(), last_status: 'ok' })),
});

test('operational checks accept successful queries and fresh successful jobs', () => {
  assert.ok(Object.values(evaluateOperationalHealth(zero, zero, healthy(), now)).every((check) => check.ok));
});

test('count queries fail closed on database errors or unavailable counts', () => {
  for (const result of [
    { count: null, error: { message: 'private database error' } },
    { count: 0, error: { message: 'query failed' } },
    { count: null, error: null },
    { count: NaN, error: null },
    { count: -1, error: null },
  ]) {
    const checks = evaluateOperationalHealth(result, result, healthy(), now);
    assert.equal(checks.criticalErrors24h.ok, false);
    assert.equal(checks.retryQueueBacklog.ok, false);
    assert.ok(!JSON.stringify(checks).includes('private database error'));
  }
});

test('operational count thresholds include one critical error and 25 queued requests', () => {
  const below = evaluateOperationalHealth(zero, { count: 24, error: null }, healthy(), now);
  assert.equal(below.retryQueueBacklog.ok, true);
  const atLimit = evaluateOperationalHealth({ count: 1, error: null }, { count: 25, error: null }, healthy(), now);
  assert.equal(atLimit.criticalErrors24h.ok, false);
  assert.equal(atLimit.retryQueueBacklog.ok, false);
});

test('heartbeat query errors and missing results cannot report healthy', () => {
  for (const heartbeats of [
    { data: null, error: { message: 'private database error' } },
    { data: healthy().data, error: { message: 'partial query failure' } },
    { data: null, error: null },
    { data: [], error: null },
  ]) {
    assert.equal(evaluateOperationalHealth(zero, zero, heartbeats, now).scheduledJobs.ok, false);
  }
});

test('fresh failed, partial or unknown job statuses degrade health', () => {
  for (const status of ['error', 'degraded', 'partial', 'not-sent', '', null]) {
    const heartbeats = healthy();
    const data = heartbeats.data.map((row, index) => index === 0 ? { ...row, last_status: status } : row);
    const check = evaluateOperationalHealth(zero, zero, { data, error: null }, now).scheduledJobs;
    assert.equal(check.ok, false);
    assert.match(check.detail || '', /unsuccessful last run: sales-followups/);
  }
});

test('stale, missing, invalid and far-future job timestamps degrade health', () => {
  for (const lastRun of [
    new Date(now - 361 * 60_000).toISOString(),
    new Date(now + 6 * 60_000).toISOString(),
    'invalid',
    '',
    null,
  ]) {
    const data = healthy().data.map((row, index) => index === 0 ? { ...row, last_run_at: lastRun } : row);
    assert.equal(evaluateOperationalHealth(zero, zero, { data, error: null }, now).scheduledJobs.ok, false);
  }
  for (const job of jobs) {
    const data = healthy().data.filter((row) => row.job !== job);
    assert.equal(evaluateOperationalHealth(zero, zero, { data, error: null }, now).scheduledJobs.ok, false);
  }
});

test('heartbeat age boundary tolerates six hours and small clock skew', () => {
  for (const offset of [-360 * 60_000, 5 * 60_000]) {
    const data = healthy().data.map((row) => ({ ...row, last_run_at: new Date(now + offset).toISOString() }));
    assert.equal(evaluateOperationalHealth(zero, zero, { data, error: null }, now).scheduledJobs.ok, true);
  }
});
