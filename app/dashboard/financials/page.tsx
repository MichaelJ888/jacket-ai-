"use client";

import { useEffect, useMemo, useState } from "react";

import { buildFinancialDashboard, formatCurrency, type FinancialProjectInput } from "./financial-logic";

const fallbackProjects: FinancialProjectInput[] = [
  { projectName: "Jacket 2024 Batch A", salesRevenue: 180000, materialCosts: 72000, laborPayrollExpenses: 35000, deliveryFees: 5000 },
  { projectName: "Corporate Uniform Q1", salesRevenue: 245000, materialCosts: 96000, laborPayrollExpenses: 42000, deliveryFees: 7000 },
  { projectName: "Schoolwear Pilot", salesRevenue: 98000, materialCosts: 40000, laborPayrollExpenses: 17000, deliveryFees: 2600 },
];

export default function FinancialDashboardPage() {
  const [projects, setProjects] = useState<FinancialProjectInput[]>(fallbackProjects);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        const response = await fetch("/api/dashboard/financials", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load financial data.");
        if (active) {
          setProjects(payload.dashboard?.projects || fallbackProjects);
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setProjects(fallbackProjects);
          setError(loadError instanceof Error ? loadError.message : "Unable to load financial data.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDashboard();
    const intervalId = window.setInterval(() => void loadDashboard(), 30000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const dashboard = useMemo(() => buildFinancialDashboard(projects), [projects]);

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", color: "#18181b", padding: "40px 20px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, color: "#4f46e5", fontSize: 12 }}>MJIC Finance</div>
          <h1 style={{ margin: "8px 0 0", fontSize: 36 }}>Gross profit dashboard</h1>
        </div>

        {error ? (
          <div style={{ marginBottom: 20, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 12, padding: 12 }}>{error}</div>
        ) : null}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 18,
            marginBottom: 28,
          }}
        >
          {[
            { label: "Total sales revenue", value: formatCurrency(dashboard.totalSalesRevenue) },
            { label: "Material costs", value: formatCurrency(dashboard.totalMaterialCosts) },
            { label: "Labor payroll", value: formatCurrency(dashboard.totalLaborPayrollExpenses) },
            { label: "Delivery fees", value: formatCurrency(dashboard.totalDeliveryFees) },
            { label: "Net profit", value: formatCurrency(dashboard.totalNetProfit), highlight: true },
            { label: "Gross profit margin", value: `${dashboard.grossProfitMargin}%` },
          ].map((item) => (
            <div key={item.label} style={{ background: "#fff", borderRadius: 18, border: "1px solid #e4e4e7", padding: 18 }}>
              <div style={{ color: "#71717a", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.1 }}>{item.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 10, color: item.highlight ? "#166534" : "#111827" }}>{item.value}</div>
            </div>
          ))}
        </section>

        <section style={{ background: "#fff", borderRadius: 20, border: "1px solid #e4e4e7", padding: 24, boxShadow: "0 16px 40px rgba(15, 23, 42, 0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Project profitability</h2>
            <div style={{ color: "#52525b", fontSize: 14 }}>Formula: Sales revenue - material costs - labor payroll - delivery fees = net profit</div>
          </div>

          {loading ? (
            <div style={{ color: "#52525b", padding: "18px 0" }}>Loading live financial data…</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 840 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                    <th style={{ padding: "12px 10px" }}>Project</th>
                    <th style={{ padding: "12px 10px" }}>Sales revenue</th>
                    <th style={{ padding: "12px 10px" }}>Material costs</th>
                    <th style={{ padding: "12px 10px" }}>Labor payroll</th>
                    <th style={{ padding: "12px 10px" }}>Delivery fees</th>
                    <th style={{ padding: "12px 10px" }}>Net profit</th>
                    <th style={{ padding: "12px 10px" }}>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.projects.map((project) => {
                    const netProfit = project.netProfit;
                    const margin = `${project.grossProfitMargin}%`;

                    return (
                      <tr key={project.projectName} style={{ borderTop: "1px solid #e4e4e7" }}>
                        <td style={{ padding: "12px 10px", fontWeight: 600 }}>{project.projectName}</td>
                        <td style={{ padding: "12px 10px" }}>{formatCurrency(project.salesRevenue)}</td>
                        <td style={{ padding: "12px 10px" }}>{formatCurrency(project.materialCosts)}</td>
                        <td style={{ padding: "12px 10px" }}>{formatCurrency(project.laborPayrollExpenses)}</td>
                        <td style={{ padding: "12px 10px" }}>{formatCurrency(project.deliveryFees)}</td>
                        <td style={{ padding: "12px 10px", fontWeight: 700, color: netProfit >= 0 ? "#166534" : "#b91c1c" }}>{formatCurrency(netProfit)}</td>
                        <td style={{ padding: "12px 10px", fontWeight: 700 }}>{margin}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
