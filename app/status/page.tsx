"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PublicStatus = {
  status: string;
  time: string;
  company: string;
  departments: Array<{ department: string; status: string; jobs: Array<{ label: string; state: string; lastRunAt: string | null }> }>;
  org: {
    departments: Array<{ id: string; name: string; roles: string[] }>;
    nodes: Array<{ id: string; title: string; department: string; reportsTo: string | null; region: string | null; status: "operational" | "attention" | "manual" }>;
  };
  features: Array<{ id: string; label: string; state: string }>;
};

const POLL_MS = 60_000;

const DOT: Record<string, string> = {
  ok: "bg-emerald-400 shadow-[0_0_10px_3px_rgba(52,211,153,0.6)]",
  operational: "bg-emerald-400 shadow-[0_0_10px_3px_rgba(52,211,153,0.6)]",
  degraded: "bg-amber-400 shadow-[0_0_10px_3px_rgba(251,191,36,0.6)]",
  attention: "bg-amber-400 shadow-[0_0_10px_3px_rgba(251,191,36,0.6)]",
  stale: "bg-red-500 shadow-[0_0_10px_3px_rgba(239,68,68,0.6)]",
  never: "bg-zinc-500",
  manual: "bg-sky-400 shadow-[0_0_10px_3px_rgba(56,189,248,0.5)]",
  unknown: "bg-zinc-500",
};

const panel = "rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md";

function Dot({ state }: { state: string }) {
  return <span className={`inline-block h-3 w-3 shrink-0 animate-pulse rounded-full ${DOT[state] || DOT.unknown}`} aria-label={state} title={state} />;
}

export default function PublicStatusPage() {
  const [data, setData] = useState<PublicStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch("/api/status/public", { cache: "no-store" });
        if (response.ok && !cancelled) {
          setData(await response.json());
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const overall = failed ? "unreachable" : data?.status || "connecting";
  const overallColor = overall === "ok" ? "text-emerald-400" : overall === "degraded" ? "text-amber-400" : "text-red-400";
  const aiSeats = data?.org.nodes.filter((node) => node.status !== "manual") || [];
  const aiOperational = aiSeats.filter((node) => node.status === "operational").length;

  return (
    <main className="min-h-screen bg-zinc-950 p-4 text-zinc-100 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className={`${panel} text-center`}>
          <p className="text-xs tracking-[0.3em] text-fuchsia-300">MICHAEL JEFFREY INTERNATIONAL CORPORATION</p>
          <h1 className="mt-2 text-3xl font-black tracking-wide">Master AI Status &amp; Feature Checklist</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Live operational status of our Super-Intelligent AI COO and AI Swarm workforce — updated every minute.{" "}
            <span className={`font-bold ${overallColor}`}>{overall.toUpperCase()}</span>
          </p>
          <div className="mx-auto mt-4 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-700"
              style={{ width: aiSeats.length ? `${Math.round((aiOperational / aiSeats.length) * 100)}%` : "0%" }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500">{aiOperational}/{aiSeats.length} AI seats operational</p>
        </header>

        <section className={panel}>
          <h2 className="mb-3 text-sm font-bold tracking-widest text-cyan-300">PLATFORM FEATURES</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {data?.features.map((feature) => (
              <div key={feature.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm">
                <span className="flex items-center gap-2"><Dot state={feature.state} />{feature.label}</span>
                <span className="text-xs uppercase text-zinc-500">{feature.state}</span>
              </div>
            )) || <p className="text-sm text-zinc-500">Connecting...</p>}
          </div>
        </section>

        <section className={panel}>
          <h2 className="mb-3 text-sm font-bold tracking-widest text-cyan-300">AI SWARM DEPARTMENTS — LIVE PERFORMANCE</h2>
          <div className="space-y-3">
            {data?.departments.map((dept) => {
              const okCount = dept.jobs.filter((job) => job.state === "ok").length;
              const pct = dept.jobs.length ? Math.round((okCount / dept.jobs.length) * 100) : 100;
              return (
                <div key={dept.department}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2"><Dot state={dept.status === "ok" ? "ok" : "attention"} />{dept.department}</span>
                    <span className="text-xs text-zinc-500">{okCount}/{dept.jobs.length} agents green</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${dept.status === "ok" ? "bg-gradient-to-r from-emerald-400 to-cyan-400" : "bg-gradient-to-r from-amber-400 to-red-400"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    {dept.jobs.map((job) => (
                      <li key={job.label} className="flex items-center gap-1"><Dot state={job.state} />{job.label}</li>
                    ))}
                  </ul>
                </div>
              );
            }) || <p className="text-sm text-zinc-500">Connecting...</p>}
          </div>
        </section>

        <section className={panel}>
          <h2 className="mb-3 text-sm font-bold tracking-widest text-cyan-300">AI EXECUTIVE SEATS</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data?.org.nodes.filter((node) => node.status !== "manual").map((node) => (
              <div key={node.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs">
                <Dot state={node.status} />
                <span className="font-semibold text-zinc-200">{node.title}{node.region ? ` (${node.region})` : ""}</span>
              </div>
            )) || <p className="text-sm text-zinc-500">Connecting...</p>}
          </div>
          <p className="mt-3 text-xs text-zinc-500">Green = fully operational · Amber = needs attention · Blue = human-led seat. Data: live job heartbeats.</p>
        </section>

        <footer className="pb-6 text-center text-xs text-zinc-600">
          <Link href="/" className="underline hover:text-zinc-400">← Back to mjic.ph</Link> · Last update: {data ? new Date(data.time).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "—"}
        </footer>
      </div>
    </main>
  );
}
