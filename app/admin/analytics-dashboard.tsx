"use client";

import { useCallback, useEffect, useState } from "react";
import { Donut, GroupedBars, HBar, Legend, type Series } from "./charts";

type Severity = "info" | "warning" | "error" | "critical";
type Analytics = {
  generatedAt: string;
  days: string[];
  enquiries: number[];
  orders: number[];
  samples: { pending: number; overdue: number; returned: number; lost: number; damaged: number };
  severity: Record<Severity, number[]>;
  heartbeats: Array<{ job: string; lastRunAt: string; ageHours: number; status: string; stale: boolean }>;
  alerts: { critical24h: number; warning24h: number; error24h: number; alertsSent24h: number; staleJobs: number; queuePending: number; queueFailed: number };
};

const COLORS = { enquiries: "#0B1E3D", orders: "#B8912F", pending: "#f59e0b", returned: "#10b981", lost: "#ef4444", damaged: "#a1a1aa", overdue: "#dc2626", info: "#60a5fa", warning: "#f59e0b", error: "#f97316", critical: "#dc2626" };

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-zinc-200 bg-white p-4 shadow-sm ${className}`}>
      <h3 className="mb-3 text-sm font-semibold text-zinc-700">{title}</h3>
      {children}
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-zinc-900"}`}>{value.toLocaleString("en-PH")}</p>
    </div>
  );
}

const shortDay = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

type FetchResult = { ok: boolean; body: Analytics & { error?: string } };

async function fetchAnalytics(token: string): Promise<FetchResult> {
  const response = await fetch("/api/admin/analytics", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, body };
}

export default function AnalyticsDashboard({ token }: { token: string }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const apply = useCallback(({ ok, body }: FetchResult) => {
    if (ok) {
      setData(body);
      setError("");
    } else {
      setError(body.error || "Could not load analytics.");
    }
  }, []);

  async function refresh() {
    setLoading(true);
    apply(await fetchAnalytics(token));
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetchAnalytics(token).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [token, apply]);

  if (!data) {
    return <p className="text-sm text-zinc-500">{error || "Loading analytics…"}</p>;
  }

  const labels = data.days.map(shortDay);
  const volumeSeries: Series[] = [
    { label: "Client enquiries", color: COLORS.enquiries, values: data.enquiries },
    { label: "Orders", color: COLORS.orders, values: data.orders },
  ];
  const severitySeries: Series[] = (["info", "warning", "error", "critical"] as const).map((s) => ({ label: s, color: COLORS[s], values: data.severity[s] }));
  const sampleSegments = [
    { label: "Out (pending)", value: data.samples.pending, color: COLORS.pending },
    { label: "Returned", value: data.samples.returned, color: COLORS.returned },
    { label: "Lost", value: data.samples.lost, color: COLORS.lost },
    { label: "Damaged", value: data.samples.damaged, color: COLORS.damaged },
  ];
  const a = data.alerts;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">Updated {new Date(data.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} · last 14 days · Manila time</p>
        <button className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-50" disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Enquiries (14d)" value={data.enquiries.reduce((s, n) => s + n, 0)} />
        <Kpi label="Orders (14d)" value={data.orders.reduce((s, n) => s + n, 0)} />
        <Kpi label="Samples out" value={data.samples.pending} tone={data.samples.overdue ? "text-red-600" : undefined} />
        <Kpi label="Critical alerts (24h)" value={a.critical24h} tone={a.critical24h ? "text-red-600" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Daily client enquiries & order volume">
          <GroupedBars labels={labels} series={volumeSeries} />
        </Card>
        <Card title="Sample jacket retrieval status">
          <Donut segments={sampleSegments} centerLabel="samples" />
          <p className="mt-3 text-xs text-zinc-600">{data.samples.overdue} overdue past expected return date.</p>
        </Card>
        <Card title="System log severity (14 days)">
          <GroupedBars labels={labels} series={severitySeries} />
        </Card>
        <Card title="Telegram alert metrics (24h)">
          <HBar rows={[
            { label: "Critical logs", value: a.critical24h, color: COLORS.critical },
            { label: "Warning logs", value: a.warning24h, color: COLORS.warning },
            { label: "Error logs", value: a.error24h, color: COLORS.error },
            { label: "Alerts sent (jobs)", value: a.alertsSent24h, color: COLORS.info },
            { label: "Outbound queue pending", value: a.queuePending, color: COLORS.pending },
            { label: "Outbound failed (24h)", value: a.queueFailed, color: COLORS.lost },
          ]} />
        </Card>
      </div>

      <Card title="System health & cron job execution">
        {data.heartbeats.length === 0 ? (
          <p className="text-sm text-zinc-500">No job heartbeats recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr><th className="py-1">Job</th><th>Last run (Manila)</th><th>Age (h)</th><th>Status</th><th>Health</th></tr>
              </thead>
              <tbody>
                {data.heartbeats.map((h) => (
                  <tr key={h.job} className="border-t border-zinc-100">
                    <td className="py-1.5 font-mono text-xs">{h.job}</td>
                    <td>{new Date(h.lastRunAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td>
                    <td>{h.ageHours}</td>
                    <td>{h.status}</td>
                    <td><span className={`rounded px-2 py-0.5 text-xs font-medium ${h.stale ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{h.stale ? "Check" : "Healthy"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3"><Legend series={[{ label: "Stale or non-ok job", color: COLORS.overdue }, { label: "Healthy", color: COLORS.returned }]} /></div>
      </Card>
    </div>
  );
}
