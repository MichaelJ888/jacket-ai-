import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '../../_lib/integrations';
import { buildFinancialDashboard, type FinancialProjectInput } from '../../../dashboard/financials/financial-logic';

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  try {
    const [costingsResult, payrollResult, dispatchResult] = await Promise.all([
      supabase.from('project_costings').select('project_name, total_cost, costing'),
      supabase.from('staff_attendance').select('total_earned'),
      supabase.from('dispatch_requests').select('project_name, status, approved_at'),
    ]);

    const costings = costingsResult.data || [];
    const payroll = payrollResult.data || [];
    const dispatches = dispatchResult.data || [];

    const materialByProject = new Map<string, number>();
    for (const row of costings) {
      const projectName = String(row.project_name || 'Unassigned project');
      const materialCost = Number((row.costing as { totalCost?: number } | null)?.totalCost || row.total_cost || 0);
      materialByProject.set(projectName, toNumber(materialCost));
    }

    const payrollByProject = new Map<string, number>();
    for (const row of payroll) {
      const totalEarned = toNumber(row.total_earned, 0);
      const projectName = 'Labor payroll';
      payrollByProject.set(projectName, (payrollByProject.get(projectName) || 0) + totalEarned);
    }

    const projects: FinancialProjectInput[] = Array.from(new Set([...costings.map((row) => String(row.project_name || 'Unassigned project')), ...dispatches.map((row) => String(row.project_name || 'Unassigned project'))])).map((projectName) => {
      const materialCosts = materialByProject.get(projectName) || 0;
      const laborPayrollExpenses = payrollByProject.get(projectName) || 0;
      const deliveryFees = dispatches.filter((row) => String(row.project_name || 'Unassigned project') === projectName && row.status !== 'PENDING_APPROVAL').length * 2500;
      const salesRevenue = Math.max(0, (costings.find((row) => String(row.project_name || 'Unassigned project') === projectName)?.total_cost || 0) * 2.4);

      return {
        projectName,
        salesRevenue,
        materialCosts,
        laborPayrollExpenses,
        deliveryFees,
      };
    });

    const dashboard = buildFinancialDashboard(projects.length ? projects : [
      { projectName: 'No active projects', salesRevenue: 0, materialCosts: 0, laborPayrollExpenses: 0, deliveryFees: 0 },
    ]);

    return NextResponse.json({ success: true, dashboard });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Financial dashboard failed' }, { status: 500 });
  }
}
