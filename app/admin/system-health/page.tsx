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

export default function SystemHealthPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Admin token"
            className="rounded border px-3 py-2"
          />
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
