import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyQuotaFromTarget, fullPeriodWindow, operatingDaysBetween, resolveDailyQuota } from './quota-engine-logic.ts';

test('operating days exclude Sundays', () => {
  // 2026-01-05 is a Monday; 2026-01-11 is the following Sunday.
  assert.equal(operatingDaysBetween('2026-01-05', '2026-01-11'), 6);
  assert.equal(operatingDaysBetween('2026-01-05', '2026-01-05'), 1);
  assert.equal(operatingDaysBetween('2026-01-11', '2026-01-11'), 0);
});

test('daily quota = total target / operating days', () => {
  assert.equal(dailyQuotaFromTarget(600, 20), 30);
  assert.equal(dailyQuotaFromTarget(100, 3), 33.3);
  assert.equal(dailyQuotaFromTarget(100, 0), null);
  assert.equal(dailyQuotaFromTarget(null, 20), null);
});

test('month window spans the whole calendar month', () => {
  assert.deepEqual(fullPeriodWindow('month', '2026-02-10'), { start: '2026-02-01', end: '2026-02-28' });
});

test('resolveDailyQuota prefers the most specific configured target', () => {
  const targets = [
    { period_kind: 'month', target_pcs: 520 },
    { period_kind: 'week', target_pcs: 120 },
  ];
  // 2026-02-11 is a Wednesday; the week window Mon 2026-02-09 to Sun 2026-02-15 has 6 operating days.
  const resolved = resolveDailyQuota('2026-02-11', targets);
  assert.equal(resolved.source?.kind, 'week');
  assert.equal(resolved.dailyPcs, 20);
  assert.equal(resolved.isOperatingDay, true);
});

test('resolveDailyQuota reports no quota when nothing is configured', () => {
  const resolved = resolveDailyQuota('2026-02-08', []);
  assert.equal(resolved.dailyPcs, null);
  assert.equal(resolved.isOperatingDay, false);
});
