import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFinancialDashboard, calculateGrossProfit, formatCurrency } from './financial-logic';

test('calculateGrossProfit subtracts material, payroll, and delivery costs from revenue', () => {
  const grossProfit = calculateGrossProfit({
    salesRevenue: 200000,
    materialCosts: 80000,
    laborPayrollExpenses: 35000,
    deliveryFees: 5000,
  });

  assert.equal(grossProfit, 80000);
  assert.equal(formatCurrency(grossProfit), '₱80,000.00');
});

test('buildFinancialDashboard aggregates project-level profitability and totals', () => {
  const dashboard = buildFinancialDashboard([
    { projectName: 'Project A', salesRevenue: 150000, materialCosts: 60000, laborPayrollExpenses: 25000, deliveryFees: 4000 },
    { projectName: 'Project B', salesRevenue: 120000, materialCosts: 50000, laborPayrollExpenses: 22000, deliveryFees: 3000 },
  ]);

  assert.equal(dashboard.totalSalesRevenue, 270000);
  assert.equal(dashboard.totalMaterialCosts, 110000);
  assert.equal(dashboard.totalLaborPayrollExpenses, 47000);
  assert.equal(dashboard.totalDeliveryFees, 7000);
  assert.equal(dashboard.totalNetProfit, 106000);
  assert.equal(dashboard.projects[0].netProfit, 59000);
  assert.equal(dashboard.projects[1].netProfit, 43000);
});
