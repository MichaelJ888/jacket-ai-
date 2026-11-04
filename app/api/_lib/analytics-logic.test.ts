import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertMetrics,
  countByDay,
  countByWeek,
  dayRange,
  heartbeatViews,
  manilaDay,
  severityByDay,
  summarizeQuotes,
  summarizeSamples,
  weekRange,
  weekStart,
} from './analytics-logic.ts';

test('weekStart returns the Monday of the Manila week', () => {
  assert.equal(weekStart('2025-03-10'), '2025-03-10'); // Monday
  assert.equal(weekStart('2025-03-16'), '2025-03-10'); // Sunday
  assert.equal(weekStart('2025-03-17'), '2025-03-17');
});

test('weekRange and countByWeek bucket quotes by Monday-start week', () => {
  const weeks = weekRange(new Date('2025-03-12T04:00:00Z'), 2);
  assert.deepEqual(weeks, ['2025-03-03', '2025-03-10']);
  const counts = countByWeek(['2025-03-03T01:00:00+08:00', '2025-03-16T10:00:00+08:00', '2025-03-17T00:00:00+08:00', '2025-02-01T00:00:00Z'], weeks);
  assert.deepEqual(counts, [1, 1]);
});

test('summarizeQuotes treats unlinked and open-stage quotes as pending', () => {
  const summary = summarizeQuotes([
    { total: 1000, created_at: '2025-03-11T00:00:00Z', stage: 'quoted' },
    { total: '2500.5', created_at: '2025-03-11T00:00:00Z', stage: 'negotiating' },
    { total: 700, created_at: '2025-03-11T00:00:00Z', stage: 'won' },
    { total: 300, created_at: '2025-03-11T00:00:00Z', stage: 'lost' },
    { total: 400, created_at: '2025-03-11T00:00:00Z', stage: null },
  ]);
  assert.equal(summary.pendingCount, 3);
  assert.equal(summary.pendingRevenue, 3900.5);
  assert.equal(summary.stages.won, 1);
  assert.equal(summary.stages.unlinked, 1);
  assert.equal(summary.stages.quoted, 1);
});

test('summarizeQuotes maps unknown stages to unlinked', () => {
  const summary = summarizeQuotes([{ total: 10, created_at: '2025-03-11T00:00:00Z', stage: 'mystery' }]);
  assert.equal(summary.stages.unlinked, 1);
  assert.equal(summary.pendingRevenue, 10);
});

test('manilaDay buckets by Manila calendar day, not UTC', () => {
  // 2025-03-10T18:00Z is 2025-03-11 02:00 in Manila.
  assert.equal(manilaDay('2025-03-10T18:00:00Z'), '2025-03-11');
  assert.equal(manilaDay('2025-03-10T15:59:00Z'), '2025-03-10');
});

test('dayRange returns consecutive Manila days ending today', () => {
  const days = dayRange(new Date('2025-03-11T04:00:00Z'), 3);
  assert.deepEqual(days, ['2025-03-09', '2025-03-10', '2025-03-11']);
});

test('countByDay counts only timestamps inside the window', () => {
  const days = ['2025-03-10', '2025-03-11'];
  const counts = countByDay(['2025-03-10T01:00:00+08:00', '2025-03-11T23:59:00+08:00', '2025-03-11T10:00:00Z', '2025-03-01T00:00:00Z'], days);
  assert.deepEqual(counts, [1, 2]);
});

test('summarizeSamples splits status and flags overdue pending samples', () => {
  const summary = summarizeSamples(
    [
      { status: 'OUT', expected_return_at: '2025-03-01' },
      { status: 'OUT', expected_return_at: '2025-03-20' },
      { status: 'RETURNED', expected_return_at: null },
      { status: 'LOST', expected_return_at: null },
      { status: 'DAMAGED', expected_return_at: null },
    ],
    '2025-03-11',
  );
  assert.deepEqual(summary, { pending: 2, overdue: 1, returned: 1, lost: 1, damaged: 1 });
});

test('severityByDay ignores unknown severities and out-of-window days', () => {
  const out = severityByDay(
    [
      { severity: 'critical', created_at: '2025-03-11T01:00:00Z' },
      { severity: 'debug', created_at: '2025-03-11T01:00:00Z' },
      { severity: 'warning', created_at: '2024-01-01T00:00:00Z' },
    ],
    ['2025-03-10', '2025-03-11'],
  );
  assert.deepEqual(out.critical, [0, 1]);
  assert.deepEqual(out.warning, [0, 0]);
});

test('heartbeatViews marks non-ok or day-old jobs as stale', () => {
  const now = new Date('2025-03-11T12:00:00Z');
  const views = heartbeatViews(
    [
      { job: 'b-ok', last_run_at: '2025-03-11T11:00:00Z', last_status: 'ok', last_alert_at: null },
      { job: 'a-error', last_run_at: '2025-03-11T11:00:00Z', last_status: 'error', last_alert_at: null },
      { job: 'c-old', last_run_at: '2025-03-09T00:00:00Z', last_status: 'ok', last_alert_at: null },
    ],
    now,
  );
  assert.deepEqual(views.map((v) => [v.job, v.stale]), [['a-error', true], ['b-ok', false], ['c-old', true]]);
  assert.equal(views[1].ageHours, 1);
});

test('alertMetrics counts only the last 24 hours', () => {
  const now = new Date('2025-03-11T12:00:00Z');
  const metrics = alertMetrics(
    [
      { severity: 'critical', created_at: '2025-03-11T01:00:00Z' },
      { severity: 'critical', created_at: '2025-03-01T01:00:00Z' },
      { severity: 'warning', created_at: '2025-03-11T02:00:00Z' },
    ],
    [{ job: 'x', last_run_at: '2025-03-11T11:00:00Z', last_status: 'ok', last_alert_at: '2025-03-11T10:00:00Z' }],
    now,
    { pending: 4, failed: 1 },
  );
  assert.equal(metrics.critical24h, 1);
  assert.equal(metrics.warning24h, 1);
  assert.equal(metrics.alertsSent24h, 1);
  assert.equal(metrics.queuePending, 4);
  assert.equal(metrics.queueFailed, 1);
});
