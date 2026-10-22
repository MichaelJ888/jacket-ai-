"use client";

import { useCallback, useEffect, useState } from "react";

type Job = { job: string; label: string; state: "ok" | "degraded" | "stale" | "never"; lastRunAt: string | null };
type Dept = { department: string; status: "ok" | "attention"; jobs: Job[] };
type Workspace = { id: string; name: string; contacts: number; needsHuman: number };
type Contact = { id: string; name: string | null; channel: string; stage: string; lead_score: number; ai_paused: boolean; workspace: { id: string; name: string } };
type Report = { headline: string; pendingApprovals: number; dormantLeads: number; departments: Dept[]; workspaces: Workspace[]; contacts: Contact[] };

const BADGE: Record<Job["state"], string> = { ok: "bg-green-100", degraded: "bg-amber-100", stale: "bg-red-100", never: "bg-zinc-100 text-zinc-500" };

export default function CooPanel({ token }: { token: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/coo${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return setError("Could not load the COO report.");
    setError(null);
    setReport(await r.json());
  }, [token, workspace]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!report) return <p className="text-sm text-zinc-500">Loading...</p>;

  return (
    <section className="space-y-5 text-sm">
      <div className="rounded border border-zinc-200 p-3">
        <strong>{report.headline}</strong>
        <p className="text-zinc-600">{report.pendingApprovals} approvals waiting - {report.dormantLeads} dormant leads</p>
        <button className="mt-1 text-xs underline" onClick={() => void load()}>Refresh</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {report.departments.map((d) => (
          <div key={d.department} className="rounded border border-zinc-200 p-3">
            <div className="flex justify-between"><strong>{d.department}</strong><span className={`rounded px-2 text-xs ${d.status === "ok" ? "bg-green-100" : "bg-red-100"}`}>{d.status === "ok" ? "OK" : "Attention"}</span></div>
            <ul className="mt-2 space-y-1">
              {d.jobs.map((j) => (
                <li key={j.job} className="flex justify-between gap-2"><span>{j.label}</span><span className={`rounded px-2 text-xs ${BADGE[j.state]}`} title={j.lastRunAt || "never reported"}>{j.state}</span></li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-2 font-semibold">All customers (CRM)</h3>
        <div className="mb-2 flex flex-wrap gap-2">
          <button className={`rounded px-2 py-1 text-xs ${workspace === "" ? "bg-zinc-900 text-white" : "bg-zinc-200"}`} onClick={() => setWorkspace("")}>All</button>
          {report.workspaces.map((w) => (
            <button key={w.id} className={`rounded px-2 py-1 text-xs ${workspace === w.id ? "bg-zinc-900 text-white" : "bg-zinc-200"}`} onClick={() => setWorkspace(w.id)}>{w.name} ({w.contacts}{w.needsHuman ? `, ${w.needsHuman} need human` : ""})</button>
          ))}
        </div>
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b"><th className="py-1">Customer</th><th>Workspace</th><th>Channel</th><th>Stage</th><th>Score</th><th>AI</th></tr></thead>
          <tbody>
            {report.contacts.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100"><td className="py-1">{c.name || "Customer"}</td><td>{c.workspace.name}</td><td>{c.channel}</td><td>{c.stage}</td><td>{c.lead_score}</td><td>{c.ai_paused ? "paused" : "on"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
