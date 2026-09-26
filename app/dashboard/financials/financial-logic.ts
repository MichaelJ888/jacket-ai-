export interface FinancialProjectInput {
  projectName: string;
  salesRevenue: number;
  materialCosts: number;
  laborPayrollExpenses: number;
  deliveryFees: number;
}

export interface FinancialProjectResult extends FinancialProjectInput {
  grossProfitMargin: number;
  netProfit: number;
}

export interface FinancialDashboardSummary {
  totalSalesRevenue: number;
  totalMaterialCosts: number;
  totalLaborPayrollExpenses: number;
  totalDeliveryFees: number;
  totalNetProfit: number;
  grossProfitMargin: number;
  projects: FinancialProjectResult[];
}

export function calculateGrossProfit(input: Pick<FinancialProjectInput, 'salesRevenue' | 'materialCosts' | 'laborPayrollExpenses' | 'deliveryFees'>) {
  const salesRevenue = Number(input.salesRevenue || 0);
  const materialCosts = Number(input.materialCosts || 0);
  const laborPayrollExpenses = Number(input.laborPayrollExpenses || 0);
  const deliveryFees = Number(input.deliveryFees || 0);

  return Number((salesRevenue - materialCosts - laborPayrollExpenses - deliveryFees).toFixed(2));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function buildFinancialDashboard(projects: FinancialProjectInput[]): FinancialDashboardSummary {
  const enriched = projects.map((project) => {
    const netProfit = calculateGrossProfit(project);
    const grossProfitMargin = project.salesRevenue > 0 ? Number(((netProfit / project.salesRevenue) * 100).toFixed(2)) : 0;

    return {
      ...project,
      grossProfitMargin,
      netProfit,
    };
  });

  const totalSalesRevenue = enriched.reduce((sum, project) => sum + project.salesRevenue, 0);
  const totalMaterialCosts = enriched.reduce((sum, project) => sum + project.materialCosts, 0);
  const totalLaborPayrollExpenses = enriched.reduce((sum, project) => sum + project.laborPayrollExpenses, 0);
  const totalDeliveryFees = enriched.reduce((sum, project) => sum + project.deliveryFees, 0);
  const totalNetProfit = enriched.reduce((sum, project) => sum + project.netProfit, 0);
  const grossProfitMargin = totalSalesRevenue > 0 ? Number(((totalNetProfit / totalSalesRevenue) * 100).toFixed(2)) : 0;

  return {
    totalSalesRevenue: Number(totalSalesRevenue.toFixed(2)),
    totalMaterialCosts: Number(totalMaterialCosts.toFixed(2)),
    totalLaborPayrollExpenses: Number(totalLaborPayrollExpenses.toFixed(2)),
    totalDeliveryFees: Number(totalDeliveryFees.toFixed(2)),
    totalNetProfit: Number(totalNetProfit.toFixed(2)),
    grossProfitMargin,
    projects: enriched,
  };
}
