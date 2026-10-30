import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildQuotaProgress, planSubconOverflow, quotaWindow } from './production-quota-logic.ts';
import { evaluateOperationalPayment } from './fund-guard.ts';
import { isSampleOverdue, summarizeSamples } from './sample-logic.ts';

test('quota windows cover daily, week, half-month, and trailing months', () => {
  assert.deepEqual(quotaWindow('daily', '2026-03-18'), { start: '2026-03-18', end: '2026-03-18' });
  // 2026-03-18 is a Wednesday, so the week runs Mon 16 to Sun 22.
  assert.deepEqual(quotaWindow('week', '2026-03-18'), { start: '2026-03-16', end: '2026-03-22' });
  assert.deepEqual(quotaWindow('half_month', '2026-03-07'), { start: '2026-03-01', end: '2026-03-15' });
  assert.deepEqual(quotaWindow('half_month', '2026-03-20'), { start: '2026-03-16', end: '2026-03-31' });
  assert.deepEqual(quotaWindow('month', '2026-03-18'), { start: '2026-03-01', end: '2026-03-18' });
  assert.deepEqual(quotaWindow('quarter', '2026-03-18'), { start: '2026-01-01', end: '2026-03-18' });
  assert.deepEqual(quotaWindow('semester', '2026-03-18'), { start: '2025-10-01', end: '2026-03-18' });
  assert.deepEqual(quotaWindow('nine_month', '2026-03-18'), { start: '2025-07-01', end: '2026-03-18' });
  assert.deepEqual(quotaWindow('year', '2026-03-18'), { start: '2025-04-01', end: '2026-03-18' });
});

test('quota progress sums output and revenue inside each window', () => {
  const progress = buildQuotaProgress(
    '2026-03-18',
    [{ period_kind: 'daily', target_pcs: 50, target_revenue: null }],
    [
      { work_date: '2026-03-18', quantity: 30 },
      { work_date: '2026-03-17', quantity: 99 },
    ],
    [{ entry_date: '2026-03-18', amount: 45000 }],
  );
  const daily = progress.find((row) => row.kind === 'daily');
  assert.equal(daily?.actualPcs, 30);
  assert.equal(daily?.pctPcs, 60);
  assert.equal(daily?.targetRevenue, null);
  assert.equal(daily?.actualRevenue, 45000);
  const month = progress.find((row) => row.kind === 'month');
  assert.equal(month?.actualPcs, 129);
});

test('subcon overflow is output above the daily target, with cheapest capacity first', () => {
  const plan = planSubconOverflow(120, 100, [
    { name: 'B Tahian', daily_capacity_pcs: 30, rate_per_pc: 60, active: true },
    { name: 'A Tahian', daily_capacity_pcs: 50, rate_per_pc: 45, active: true },
    { name: 'Inactive', daily_capacity_pcs: 500, rate_per_pc: 1, active: false },
  ]);
  assert.equal(plan.overflowPcs, 20);
  assert.equal(plan.needsSubcon, true);
  assert.deepEqual(plan.suggestions.map((row) => row.name), ['A Tahian', 'B Tahian']);
  assert.equal(planSubconOverflow(80, 100, []).needsSubcon, false);
});

test('materials payments ignore the lock; operational payments cannot use locked D.P.', () => {
  assert.equal(evaluateOperationalPayment({ amount: 5000, category: 'raw_materials', cashBalance: 1000, lockedTotal: 20000 }).allowed, true);
  assert.equal(evaluateOperationalPayment({ amount: 1000, category: 'payroll', cashBalance: 50000, lockedTotal: 0 }).allowed, true);
  const blocked = evaluateOperationalPayment({ amount: 10000, category: 'Payroll', cashBalance: 25000, lockedTotal: 20000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.availableCash, 5000);
  assert.equal(evaluateOperationalPayment({ amount: 4000, category: 'operations', cashBalance: 25000, lockedTotal: 20000 }).allowed, true);
  assert.equal(evaluateOperationalPayment({ amount: 1, category: 'operations', cashBalance: null, lockedTotal: 100 }).allowed, false);
});

test('samples are overdue only while OUT and past the expected return date', () => {
  assert.equal(isSampleOverdue({ status: 'OUT', expected_return_at: '2026-03-10' }, '2026-03-18'), true);
  assert.equal(isSampleOverdue({ status: 'OUT', expected_return_at: '2026-03-20' }, '2026-03-18'), false);
  assert.equal(isSampleOverdue({ status: 'RETURNED', expected_return_at: '2026-03-10' }, '2026-03-18'), false);
  const summary = summarizeSamples(
    [
      { id: '1', item: 'Jacket', client_name: 'A', status: 'OUT', expected_return_at: '2026-03-10', returned_at: null },
      { id: '2', item: 'Vest', client_name: 'B', status: 'RETURNED', expected_return_at: null, returned_at: '2026-03-01' },
      { id: '3', item: 'Shirt', client_name: 'C', status: 'LOST', expected_return_at: null, returned_at: null },
    ],
    '2026-03-18',
  );
  assert.deepEqual(summary, { outCount: 1, overdueCount: 1, returnedCount: 1, lostOrDamagedCount: 1 });
});
