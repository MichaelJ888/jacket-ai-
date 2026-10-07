import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateProfit, buildPeriodReport, checkQuoteMargin, classifyPaymentRisk, findDuplicateReferences, forecastRunwayDays, periodRange } from './finance-logic.ts';

const rules = [
  { bucket: 'salaries', percent: 25, priority: 10 },
  { bucket: 'rent', percent: 10, priority: 20, monthly_target: 5000 },
  { bucket: 'ceo_reward', percent: 5, priority: 80, is_ceo_reward: true },
  { bucket: 'emergency_fund', percent: 10, priority: 50 },
  { bucket: 'rolling_capital', percent: 50, priority: 90, is_overflow: true },
];

test('allocateProfit splits by percent and sums exactly to profit', () => {
  const result = allocateProfit(10000.01, rules);
  const sum = result.lines.reduce((total, line) => total + Math.round(line.amount * 100), 0);
  assert.equal(sum, 1000001);
  assert.equal(result.warning, null);
  assert.equal(result.lines.find((line) => line.bucket === 'salaries')?.amount, 2500);
});

test('allocateProfit caps funded buckets and overflows to rolling capital', () => {
  const result = allocateProfit(100000, rules, { rent: 4500 });
  const rent = result.lines.find((line) => line.bucket === 'rent');
  assert.equal(rent?.amount, 500);
  assert.equal(rent?.capped, true);
  assert.equal(result.lines.find((line) => line.bucket === 'rolling_capital')?.amount, 50000 + 9500);
});

test('allocateProfit returns nothing for a loss', () => {
  assert.equal(allocateProfit(-50, rules).lines.length, 0);
});

test('classifyPaymentRisk applies thresholds and the daily cap', () => {
  assert.equal(classifyPaymentRisk(500), 'standard');
  assert.equal(classifyPaymentRisk(25000), 'high');
  assert.equal(classifyPaymentRisk(60000, { paidTodayTotal: 50000 }), 'blocked');
  assert.equal(classifyPaymentRisk(-5), 'blocked');
});

test('buildPeriodReport totals per project and category', () => {
  const report = buildPeriodReport([
    { entry_type: 'income', category: 'sales', project_name: 'A', amount: 1000 },
    { entry_type: 'expense', category: 'materials', project_name: 'A', amount: 400 },
    { entry_type: 'expense', category: 'rent', project_name: null, amount: 100 },
  ]);
  assert.equal(report.net, 500);
  assert.equal(report.marginPercent, 50);
  assert.equal(report.expensesByCategory.materials, 400);
  assert.equal(report.byProject[0].project, 'A');
});

test('checkQuoteMargin, runway, duplicates and period ranges', () => {
  assert.equal(checkQuoteMargin(1000, 800, 30).ok, false);
  assert.equal(checkQuoteMargin(1000, 600, 30).ok, true);
  assert.equal(forecastRunwayDays(30000, 30000), 30);
  assert.equal(forecastRunwayDays(100, 0), null);
  assert.deepEqual(findDuplicateReferences([{ id: '1', reference: 'X' }, { id: '2', reference: 'X' }, { id: '3', reference: null }]), [{ reference: 'X', ids: ['1', '2'] }]);
  assert.deepEqual(periodRange('2026-12'), { start: '2026-12-01', end: '2027-01-01' });
  assert.equal(periodRange('bad'), null);
});
