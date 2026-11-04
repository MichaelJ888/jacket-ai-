"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type HealthChecks = Record<string, { ok: boolean; detail?: string }>;
type Health = { status: string; time: string; dbLatencyMs: number | null; checks: HealthChecks };
type Telemetry = {
  time?: string;
  database?: { ok: boolean; pingMs: number | null };
  runtime?: { uptimeSec: number; rssMb: number; heapUsedMb: number };
  jobs?: Array<{ job: string; label: string; state: string; lastRunAt: string | null }>;
  failingJobs?: number;
};
type PublicStatus = {
  status: string;
  time: string;
  company: string;
  departments: Array<{ department: string; status: string; jobs: Array<{ label: string; state: string; lastRunAt: string | null }> }>;
  org: {
    departments: Array<{ id: string; name: string; roles: string[]; href: string }>;
    nodes: Array<{ id: string; title: string; department: string; reportsTo: string | null; region: string | null; status: "operational" | "attention" | "manual" }>;
  };
  features: Array<{ id: string; label: string; state: string }>;
};
type AutoPilotResult = { success: boolean; due: string[]; kicked: Array<{ job: string; status: number | "error" }>; skipped: string[] };

const POLL_ACTIVE_MS = 30_000;
const POLL_BACKGROUND_MS = 120_000;

const STATE_DOT: Record<string, string> = {
  ok: "bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.7)]",
  operational: "bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.7)]",
  degraded: "bg-amber-400 shadow-[0_0_8px_2px_rgba(251,191,36,0.7)]",
  attention: "bg-amber-400 shadow-[0_0_8px_2px_rgba(251,191,36,0.7)]",
  stale: "bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.7)]",
  never: "bg-zinc-500",
  manual: "bg-sky-400 shadow-[0_0_8px_2px_rgba(56,189,248,0.5)]",
  unknown: "bg-zinc-500",
};

const panel = "rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md shadow-[0_0_30px_rgba(0,0,0,0.4)]";

function Dot({ state }: { state: string }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATE_DOT[state] || STATE_DOT.unknown}`} aria-label={state} title={state} />;
}

export default function CommandCenterPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [autoPilot, setAutoPilot] = useState<AutoPilotResult | null>(null);

  const load = useCallback(async (auth: string) => {
    const headers = { Authorization: `Bearer ${auth}` };
    const [h, t, s] = await Promise.all([
      fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/telemetry", { headers, cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/status/public", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (!t) throw new Error("Access denied or telemetry unavailable.");
    setHealth(h);
    setTelemetry(t);
    setStatus(s);
  }, []);

  const login = useCallback(async (auth: string) => {
    setBusy(true);
    try {
      await load(auth);
      setAuthed(true);
      setMessage("");
      sessionStorage.setItem("mjic_admin", auth);
    } catch (error) {
      setAuthed(false);
      setMessage(error instanceof Error ? error.message : "Access denied.");
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    const saved = sessionStorage.getItem("mjic_admin");
    if (saved) queueMicrotask(() => void login(saved));
  }, [login]);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const auth = sessionStorage.getItem("mjic_admin") || "";
      try {
        await load(auth);
      } catch {
        // Keep the last good snapshot when a poll fails.
      }
      if (!cancelled) timer = setTimeout(poll, document.visibilityState === "visible" ? POLL_ACTIVE_MS : POLL_BACKGROUND_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authed, load]);

  async function stabilize() {
    const auth = sessionStorage.getItem("mjic_admin") || token;
    setBusy(true);
    setAutoPilot(null);
    try {
      const response = await fetch("/api/admin/coo", { method: "POST", headers: { Authorization: `Bearer ${auth}` } });
      const body = (await response.json()) as AutoPilotResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "Auto-pilot failed");
      setAutoPilot(body);
      setMessage(body.due.length ? `Auto-pilot kicked: ${body.kicked.map((k) => `${k.job} (${k.status})`).join(", ")}` : "All systems already stable — nothing was due.");
      await load(auth);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Auto-pilot failed.");
    } finally {
      setBusy(false);
    }
  }

  async function setAutoPilotOverride(override: "on" | "off" | null) {
    const auth = sessionStorage.getItem("mjic_admin") || token;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/auto-pilot", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ override }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save Auto-Pilot setting");
      setMessage(override === null ? "Auto-Pilot set to automatic (heartbeat-driven)." : `Auto-Pilot override saved: ${override.toUpperCase()}. Persists across refresh and logout.`);
      await load(auth);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save Auto-Pilot setting.");
    } finally {
      setBusy(false);
    }
  }

  const orgLevels = useMemo(() => {
    if (!status) return [];
    const byId = new Map(status.org.nodes.map((node) => [node.id, node]));
    const depth = (id: string): number => {
      let d = 0;
      let cursor = byId.get(id);
      while (cursor?.reportsTo) {
        cursor = byId.get(cursor.reportsTo);
        d += 1;
        if (d > 10) break;
      }
      return d;
    };
    const levels: Array<typeof status.org.nodes> = [];
    for (const node of status.org.nodes) {
      const d = depth(node.id);
      (levels[d] ||= []).push(node);
    }
    return levels;
  }, [status]);

  if (!authed) {
    return (
      <main className="neon-admin flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
        <form
          className={`${panel} flex w-full max-w-sm flex-col gap-3`}
          onSubmit={(event) => {
            event.preventDefault();
            void login(token);
          }}
        >
          <h1 className="text-lg font-bold tracking-wide text-fuchsia-300">🚀 MJIC Command Center</h1>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Admin token"
            autoComplete="current-password"
            className="w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-zinc-100"
          />
          <button type="submit" disabled={busy || !token} className="rounded bg-fuchsia-500 px-3 py-2 font-semibold text-zinc-950 disabled:opacity-50">
            {busy ? "Authenticating..." : "Enter Command Center"}
          </button>
          {message && <p className="text-sm text-red-400">{message}</p>}
        </form>
      </main>
    );
  }

  const overall = health?.status || status?.status || "unknown";
  const jobs = telemetry?.jobs || [];

  return (
    <main className="neon-admin min-h-screen bg-zinc-950 p-4 text-zinc-100 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className={`${panel} flex flex-wrap items-center justify-between gap-3`}>
          <div>
            <h1 className="text-xl font-black tracking-widest text-fuchsia-300">🚀 MJIC SPACESHIP COMMAND CENTER</h1>
            <p className="text-xs text-zinc-400">
              {status?.company || "MJIC"} · {new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })} MNL · Overall:{" "}
              <span className={overall === "ok" ? "text-emerald-400" : overall === "degraded" ? "text-amber-400" : "text-red-400"}>{overall.toUpperCase()}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/admin" className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10">← Admin</a>
            <a href="/admin/editor" className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10">🎨 Site Editor</a>
            <a href="/admin/studio" className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10">📸 AI Studio</a>
            <button
              onClick={() => void stabilize()}
              disabled={busy}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-black tracking-wide text-zinc-950 shadow-[0_0_20px_rgba(52,211,153,0.6)] hover:bg-emerald-300 disabled:opacity-50"
            >
              {busy ? "WORKING..." : "🛰️ 1-PUSH AUTO-PILOT / STABILIZE"}
            </button>
            <div className="flex items-center gap-1 rounded-lg border border-white/20 p-1 text-xs" role="group" aria-label="Auto-Pilot override">
              <button onClick={() => void setAutoPilotOverride("on")} disabled={busy} className="rounded px-2 py-1 hover:bg-emerald-500/20 disabled:opacity-50">Force ON</button>
              <button onClick={() => void setAutoPilotOverride("off")} disabled={busy} className="rounded px-2 py-1 hover:bg-amber-500/20 disabled:opacity-50">Force OFF</button>
              <button onClick={() => void setAutoPilotOverride(null)} disabled={busy} className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-50">Auto</button>
            </div>
          </div>
        </header>

        {message && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-300">{message}</p>}
        {autoPilot && autoPilot.skipped.length > 0 && <p className="text-xs text-zinc-400">Queued for next pass: {autoPilot.skipped.join(", ")}</p>}

        <section className="grid gap-4 md:grid-cols-3">
          <div className={panel}>
            <h2 className="mb-2 text-sm font-bold tracking-wider text-cyan-300">SYSTEM DIAGNOSTICS</h2>
            <ul className="space-y-1 text-sm">
              {health && Object.entries(health.checks).map(([name, check]) => (
                <li key={name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><Dot state={check.ok ? "ok" : "stale"} />{name}</span>
                  <span className="text-xs text-zinc-400">{check.ok ? "OK" : check.detail || "FAIL"}</span>
                </li>
              ))}
              {!health && <li className="text-zinc-500">Loading...</li>}
            </ul>
          </div>
          <div className={panel}>
            <h2 className="mb-2 text-sm font-bold tracking-wider text-cyan-300">RUNTIME TELEMETRY</h2>
            {telemetry ? (
              <ul className="space-y-1 text-sm">
                <li className="flex justify-between"><span>Database</span><span className="flex items-center gap-2"><Dot state={telemetry.database?.ok ? "ok" : "stale"} />{telemetry.database?.pingMs ?? "—"} ms</span></li>
                <li className="flex justify-between"><span>Uptime</span><span>{Math.floor((telemetry.runtime?.uptimeSec || 0) / 60)} min</span></li>
                <li className="flex justify-between"><span>Memory (RSS)</span><span>{telemetry.runtime?.rssMb ?? "—"} MB</span></li>
                <li className="flex justify-between"><span>Failing jobs</span><span className={telemetry.failingJobs ? "text-amber-400" : "text-emerald-400"}>{telemetry.failingJobs ?? 0}</span></li>
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Loading...</p>
            )}
          </div>
          <div className={panel}>
            <h2 className="mb-2 text-sm font-bold tracking-wider text-cyan-300">MASTER AI FEATURE CHECKLIST</h2>
            <ul className="space-y-1 text-sm">
              {status?.features.map((feature) => (
                <li key={feature.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><Dot state={feature.state} />{feature.label}</span>
                  <span className="text-xs uppercase text-zinc-400">{feature.state}</span>
                </li>
              )) || <li className="text-zinc-500">Loading...</li>}
            </ul>
          </div>
        </section>

        <section className={panel}>
          <h2 className="mb-3 text-sm font-bold tracking-wider text-cyan-300">LIVE AI ACTIVITY STREAM — SWARM EMPLOYEES</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <div key={job.job} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm">
                <span className="flex items-center gap-2"><Dot state={job.state} />{job.label}</span>
                <span className="text-xs text-zinc-500">{job.lastRunAt ? new Date(job.lastRunAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" }) : "never"}</span>
              </div>
            ))}
            {!jobs.length && <p className="text-sm text-zinc-500">Loading...</p>}
          </div>
        </section>

        <section className={panel}>
          <h2 className="mb-3 text-sm font-bold tracking-wider text-cyan-300">CORPORATE DEPARTMENT MATRIX</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {status?.org.departments.map((dept) => {
              const seats = status.org.nodes.filter((node) => node.department === dept.id);
              const attention = seats.some((seat) => seat.status === "attention");
              const rollup = status.departments.find((d) => d.department.toLowerCase().includes(dept.id === "gtm" ? "sales" : dept.id === "people" ? "operations" : dept.id === "technology" ? "platform" : dept.id === "executive" ? "strategy" : dept.name.split(" ")[0].toLowerCase()));
              return (
                <a key={dept.id} href={dept.href} className="rounded-xl border border-white/10 bg-black/30 p-3 hover:border-fuchsia-400/50 hover:bg-white/5">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{dept.name}</strong>
                    <Dot state={attention ? "attention" : rollup?.status === "attention" ? "attention" : "operational"} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">{dept.roles.join(" · ")}</p>
                  <p className="mt-1 text-xs text-zinc-500">{seats.length} seats · {seats.filter((seat) => seat.status === "operational").length} AI-operational</p>
                </a>
              );
            }) || <p className="text-sm text-zinc-500">Loading...</p>}
          </div>
        </section>

        <section className={panel}>
          <h2 className="mb-3 text-sm font-bold tracking-wider text-cyan-300">ORGANIZATIONAL HIERARCHY — BOARD TO REGIONAL VPs</h2>
          <div className="space-y-3">
            {orgLevels.map((level, index) => (
              <div key={index} className="flex flex-wrap items-stretch justify-center gap-2">
                {level.map((node) => (
                  <div key={node.id} className="flex min-w-44 items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs">
                    <Dot state={node.status} />
                    <span>
                      <span className="block font-semibold text-zinc-200">{node.title}</span>
                      <span className="text-zinc-500">{node.status === "manual" ? "human seat" : node.status}{node.region ? ` · ${node.region}` : ""}</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {!orgLevels.length && <p className="text-sm text-zinc-500">Loading...</p>}
          </div>
          <p className="mt-3 text-xs text-zinc-500">Green = AI-operational · Amber = needs attention · Blue = human seat. Status rolls up live from job heartbeats.</p>
        </section>
      </div>
    </main>
  );
}
