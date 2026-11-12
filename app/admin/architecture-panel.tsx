"use client";

import { useEffect, useId, useState } from "react";

type HealthSnapshot = {
  status: string;
  time?: string;
  checks?: Record<string, { ok?: boolean }>;
};

type AutoPilotSnapshot = { on: boolean; checkedAt?: string };

function nodeClass(ok: boolean | undefined) {
  return ok === true ? "healthy" : ok === false ? "degraded" : "unknown";
}

function buildDiagram(health: HealthSnapshot | null, autoPilot: AutoPilotSnapshot | null) {
  const check = (name: string) => health?.checks?.[name]?.ok;
  const database = nodeClass(check("database"));
  const storage = nodeClass(check("storage"));
  const scheduledJobs = nodeClass(check("scheduledJobs"));
  const auto = nodeClass(autoPilot ? autoPilot.on : undefined);
  const flowColor = health?.status === "ok" ? "#22c55e" : health ? "#ef4444" : "#a1a1aa";
  return `flowchart LR
  subgraph INGEST["1. Lead Ingestion"]
    direction TB
    META["Meta Webhook<br/>app/api/webhooks/meta"] --> CRM["CRM Auto-Sync<br/>crm.ts upsert"]
    CRM --> LEADDB[("Supabase<br/>crm_contacts, leads, orders")]
  end
  subgraph CONTENT["2. Content Engine"]
    direction TB
    BUCKET[("Supabase Storage<br/>media-ad-renders")] --> RESUME["Resumable upload"]
    RESUME --> PUBLISH["Meta Graph API<br/>Page / Instagram"]
    PUBLISH --> CAL[("content_calendar<br/>PUBLISHED")]
  end
  subgraph CRON["3. Cron Automation"]
    direction TB
    VCRON["Scheduled jobs<br/>PHT daily / weekly / monthly"] --> BRIEF["Executive briefing"]
    BRIEF --> TGB["Telegram briefing"]
    AUTO["AI COO Auto-Pilot<br/>stale-job recovery"] -.-> VCRON
  end
  subgraph STOCK["4. Order and Stock System"]
    direction TB
    ORDER["Order / PO stock deduction"] --> THRESH["Threshold rules"]
    THRESH --> TGA["Telegram stock alert"]
    ORDER --> SYNC["Direct CRM sync"]
  end
  SYNC --> LEADDB
  CAL -. "daily briefing reads" .-> BRIEF
  classDef healthy fill:#052e16,stroke:#22c55e,color:#dcfce7,stroke-width:2px
  classDef degraded fill:#450a0a,stroke:#ef4444,color:#fee2e2,stroke-width:3px
  classDef unknown fill:#27272a,stroke:#a1a1aa,color:#f4f4f5,stroke-width:1px
  class META,CRM,LEADDB ${database}
  class BUCKET,RESUME ${storage}
  class VCRON,BRIEF,TGB ${scheduledJobs}
  class AUTO ${auto}
  class PUBLISH,CAL,ORDER,THRESH,TGA,SYNC ${database}
  linkStyle default stroke:${flowColor},stroke-width:2px`;
}

const CADENCE = [
  {
    period: "Daily · PHT (UTC+8)",
    entries: [
      "6:00 AM — Executive briefing",
      "9:00 AM — Boost advisor and video slot",
      "1:30 PM — Picture slot",
      "6:00 PM — Payroll checks when due",
      "9:00 PM — Picture slot",
    ],
  },
  {
    period: "Weekly · Monday · PHT",
    entries: [
      "9:00 AM — Forecast and pricing advice",
      "9:30 AM — AI consultant report",
      "10:00 AM — Studio catalog photo rotation",
    ],
  },
  {
    period: "Monthly · PHT",
    entries: ["10:00 AM on the 1st — Repository metadata watch"],
  },
];

type Props = { token: string };

export default function ArchitecturePanel({ token }: Props) {
  const reactId = useId();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [healthError, setHealthError] = useState("");
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [autoPilot, setAutoPilot] = useState<AutoPilotSnapshot | null>(null);
  const [checkedAt, setCheckedAt] = useState("");

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [healthResponse, pilotResponse] = await Promise.all([
          fetch("/api/health", { cache: "no-store" }),
          fetch("/api/admin/auto-pilot", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        ]);
        const healthData = await healthResponse.json().catch(() => ({})) as HealthSnapshot;
        if (!healthResponse.ok && !healthData.status) throw new Error(`Health request failed (HTTP ${healthResponse.status}).`);
        if (!cancelled) {
          setHealth(healthData);
          setCheckedAt(healthData.time || new Date().toISOString());
          setHealthError("");
        }
        const pilotData = await pilotResponse.json().catch(() => ({})) as AutoPilotSnapshot;
        if (!cancelled) setAutoPilot(pilotResponse.ok && typeof pilotData.on === "boolean" ? pilotData : null);
      } catch (cause) {
        if (!cancelled) setHealthError(cause instanceof Error ? cause.message : "Could not load live health.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
        const id = `arch-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
        const { svg: rendered } = await mermaid.render(id, buildDiagram(health, autoPilot));
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Diagram failed to render.");
      }
    })();
    return () => { cancelled = true; };
  }, [reactId, health, autoPilot]);

  const degraded = health !== null && health.status !== "ok";
  return (
    <section aria-label="System architecture" className="space-y-4 rounded-2xl border border-cyan-400/20 bg-zinc-950 p-4 text-zinc-100 shadow-[0_0_24px_-6px_rgba(34,211,238,0.35)]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mb-1 text-lg font-bold text-cyan-200">System architecture</h2>
          <p className="text-sm text-zinc-400">Live topology and 60-second health refresh; only green nodes have a passing health check.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${degraded ? "bg-red-950 text-red-200" : "bg-emerald-950 text-emerald-200"}`} role="status">
          {health ? health.status.toUpperCase() : "CHECKING"}
        </span>
      </header>
      {degraded && (
        <p className={`w-fit rounded px-3 py-1 text-sm font-bold ${autoPilot?.on ? "bg-emerald-950 text-emerald-200" : "bg-red-950 text-red-200"}`}>
          AI COO Auto-Healing {autoPilot ? (autoPilot.on ? "ON" : "OFF") : "status unavailable"}
        </p>
      )}
      {healthError && <p role="alert" className="text-sm text-red-300">Live health unavailable: {healthError}</p>}
      {checkedAt && <p className="text-xs text-zinc-500">Health checked {new Date(checkedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} PHT</p>}
      {error && <p role="alert" className="text-sm text-red-300">Live status/diagram error: {error}</p>}
      {!svg && !error && <p className="text-sm text-zinc-400">Rendering diagram…</p>}
      {svg && <div className="architecture-flow overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />}

      <section aria-labelledby="ceo-cadence-title" className="border-t border-zinc-700 pt-4">
        <h3 id="ceo-cadence-title" className="mb-3 text-base font-semibold text-cyan-100">CEO operating cadence · Manila time (UTC+8)</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {CADENCE.map((group) => (
            <article key={group.period} className="rounded-lg border border-zinc-700 bg-zinc-900/80 p-3">
              <h4 className="text-sm font-bold text-zinc-100">{group.period}</h4>
              <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                {group.entries.map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
