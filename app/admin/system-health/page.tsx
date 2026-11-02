"use client";

import { useCallback, useEffect, useState } from "react";

type HealthCheck = { feature: string; level: "ok" | "warn" | "red"; detail: string; selfHeal?: string };
type HealthResponse = { success?: boolean; today?: string; checks?: HealthCheck[]; overall?: string; actions?: string[]; error?: string };

const LEVEL_STYLE: Record<HealthCheck["level"], string> = {
  ok: "border-green-500 bg-green-50 text-green-800",
  warn: "border-yellow-500 bg-yellow-50 text-yellow-800",
  red: "border-red-600 bg-red-50 text-red-800",
};
const LEVEL_LABEL: Record<HealthCheck["level"], string> = { ok: "OK", warn: "WARNING", red: "RED ALERT" };

type Telemetry = {
  time?: string;
  database?: { ok: boolean; pingMs: number | null };
  runtime?: { uptimeSec: number; rssMb: number; heapUsedMb: number };
  jobs?: Array<{ job: string; label: string; state: string }>;
  failingJobs?: number;
};

const POLL_ACTIVE_MS = 30_000;
const POLL_BACKGROUND_MS = 120_000;

export default function SystemHealthPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const auth = sessionStorage.getItem("mjic_admin") || "";
        const response = await fetch("/api/telemetry", { headers: { Authorization: `Bearer ${auth}` }, cache: "no-store" });
        if (response.ok && !cancelled) setTelemetry((await response.json()) as Telemetry);
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
  }, [authed]);

  const request = useCallback(async (auth: string, method: "GET" | "POST") => {
    const response = await fetch("/api/admin/system-health", { method, headers: { Authorization: `Bearer ${auth}` }, cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as HealthResponse;
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body;
  }, []);

  const load = useCallback(async (auth: string) => {
    setBusy(true);
    try {
      const body = await request(auth, "GET");
      setData(body);
      setAuthed(true);
      setMessage("");
      sessionStorage.setItem("mjic_admin", auth);
    } catch (error) {
      setAuthed(false);
      setMessage(error instanceof Error ? error.message : "Hindi ma-load ang health audit.");
    } finally {
      setBusy(false);
    }
  }, [request]);

  useEffect(() => {
    const saved = sessionStorage.getItem("mjic_admin");
    if (saved) queueMicrotask(() => void load(saved));
  }, [load]);

  async function selfHeal() {
    const auth = sessionStorage.getItem("mjic_admin") || token;
    setBusy(true);
    try {
      const body = await request(auth, "POST");
      setData(body);
      setMessage(body.actions?.length ? `Self-heal: ${body.actions.join("; ")}` : "Walang kailangang i-self-heal.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Self-heal failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-4 text-xl font-semibold">AI COO System Health</h1>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void load(token);
          }}
        >
          <div className="flex gap-2">
            <input
              type={showPassword ? "text" : "password"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Admin token"
              autoComplete="current-password"
              className="w-full rounded border px-3 py-2"
            />
            <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="shrink-0 rounded border px-3 py-2 text-sm">
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <button type="submit" disabled={busy || !token} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
            {busy ? "Naglo-load..." : "Pumasok"}
          </button>
          {message && <p className="text-sm text-red-700">{message}</p>}
        </form>
      </main>
    );
  }

  const checks = data?.checks || [];
  const overall = data?.overall || "ok";

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">AI COO System Health</h1>
          <p className="text-sm text-gray-600">Petsa: {data?.today || "—"} · Kabuuan: {LEVEL_LABEL[overall as HealthCheck["level"]] || overall}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load(sessionStorage.getItem("mjic_admin") || "")} disabled={busy} className="rounded border px-3 py-2 text-sm">
            I-refresh
          </button>
          <button onClick={() => void selfHeal()} disabled={busy} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
            Self-heal ngayon
          </button>
        </div>
      </div>
      {message && <p className="mb-4 text-sm text-gray-700">{message}</p>}
      {telemetry && (
        <section aria-label="Live telemetry" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded border p-3">
            <p className="text-xs text-gray-500">Database</p>
            <p className={`font-semibold ${telemetry.database?.ok ? "text-green-700" : "text-red-700"}`}>
              {telemetry.database?.ok ? "Online" : "Down"} · {telemetry.database?.pingMs ?? "—"} ms
            </p>
          </div>
          <div className="rounded border p-3">
            <p className="text-xs text-gray-500">Memory (RSS / heap)</p>
            <p className="font-semibold">{telemetry.runtime?.rssMb ?? "—"} / {telemetry.runtime?.heapUsedMb ?? "—"} MB</p>
          </div>
          <div className="rounded border p-3">
            <p className="text-xs text-gray-500">Uptime</p>
            <p className="font-semibold">{telemetry.runtime ? `${Math.floor(telemetry.runtime.uptimeSec / 60)} min` : "—"}</p>
          </div>
          <div className="rounded border p-3">
            <p className="text-xs text-gray-500">Failing cron jobs</p>
            <p className={`font-semibold ${telemetry.failingJobs ? "text-red-700" : "text-green-700"}`}>{telemetry.failingJobs ?? 0}</p>
          </div>
          <p className="col-span-2 text-xs text-gray-500 sm:col-span-4">
            Huling update: {telemetry.time ? new Date(telemetry.time).toLocaleTimeString() : "—"} · auto-refresh 30s (aktibong tab) / 120s (background)
          </p>
        </section>
      )}
      <ul className="flex flex-col gap-3">
        {checks.map((check) => (
          <li key={check.feature} className={`rounded border-l-4 p-4 ${LEVEL_STYLE[check.level]}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{check.feature}</span>
              <span className="text-xs font-semibold">{LEVEL_LABEL[check.level]}</span>
            </div>
            <p className="mt-1 text-sm">{check.detail}</p>
            {check.selfHeal && <p className="mt-1 text-xs opacity-80">Self-heal: {check.selfHeal}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
