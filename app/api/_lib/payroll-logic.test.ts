import assert from 'node:assert/strict';
import test from 'node:test';

import { latestClosedSemiMonthly, latestSaturdayWeek, parseAttendanceText, periodInstants, isSaturday } from './payroll-logic.ts';

test('semi-monthly periods close on the 15th and month end', () => {
  assert.equal(latestClosedSemiMonthly({ year: 2026, month: 10, day: 16 }).label, '2026-10-01 to 2026-10-15');
  assert.equal(latestClosedSemiMonthly({ year: 2026, month: 11, day: 1 }).label, '2026-10-16 to 2026-10-31');
  assert.equal(latestClosedSemiMonthly({ year: 2027, month: 1, day: 1 }).label, '2026-12-16 to 2026-12-31');
  assert.equal(latestClosedSemiMonthly({ year: 2026, month: 3, day: 1 }).label, '2026-02-16 to 2026-02-28');
});

test('sewer week is Sunday-Saturday ending on the latest Saturday', () => {
  assert.ok(isSaturday({ year: 2026, month: 10, day: 10 }));
  assert.equal(latestSaturdayWeek({ year: 2026, month: 10, day: 10 }).label, 'Week 2026-10-04 to 2026-10-10');
  assert.equal(latestSaturdayWeek({ year: 2026, month: 10, day: 12 }).label, 'Week 2026-10-04 to 2026-10-10');
  assert.deepEqual(periodInstants({ start: '2026-10-04', end: '2026-10-10', label: '' }), { from: '2026-10-04T00:00:00+08:00', to: '2026-10-11T00:00:00+08:00' });
});

test('attendance text parsing', () => {
  assert.equal(parseAttendanceText('Time in'), 'IN');
  assert.equal(parseAttendanceText('TIME-OUT 5pm'), 'OUT');
  assert.equal(parseAttendanceText('out'), 'OUT');
  assert.equal(parseAttendanceText('inventory check'), null);
  assert.equal(parseAttendanceText('hello'), null);
});
