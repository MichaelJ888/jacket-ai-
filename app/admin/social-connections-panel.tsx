"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SOCIAL_PROVIDER_IDS,
  SOCIAL_PROVIDER_SETUP,
  type SocialConnection,
  type SocialProvider,
} from "../api/_lib/social-connections";

const TONE = {
  active: "bg-emerald-100 text-emerald-900",
  not_linked: "bg-amber-100 text-amber-900",
  error: "bg-red-100 text-red-900",
  unverified: "bg-amber-100 text-amber-900",
};

const LABEL = {
  active: "Active",
  not_linked: "Not Linked",
  error: "Token Expired / Error",
  unverified: "Configured · Check health",
};

type Props = { token: string; onConnectMeta: () => void };

export default function SocialConnectionsPanel({ token, onConnectMeta }: Props) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [selected, setSelected] = useState<SocialProvider | null>(null);
  const [checking, setChecking] = useState<SocialProvider | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/social/connections", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({})) as { connections?: SocialConnection[]; error?: string };
    if (!response.ok) throw new Error(data.error || `Could not load connections (HTTP ${response.status}).`);
    setConnections(data.connections ?? []);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/social/connections", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({})) as { connections?: SocialConnection[]; error?: string };
        if (!response.ok) throw new Error(data.error || `Could not load connections (HTTP ${response.status}).`);
        if (!cancelled) setConnections(data.connections ?? []);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load connections.");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function check(provider: SocialProvider) {
    setChecking(provider);
    setMessage("");
    try {
      const response = await fetch("/api/social/connections", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({})) as { connection?: SocialConnection; error?: string };
      if (!response.ok) throw new Error(data.error || `Health check failed (HTTP ${response.status}).`);
      if (data.connection) {
        setConnections((current) => current.map((item) => item.id === provider ? data.connection! : item));
        setMessage(`${data.connection.label}: ${data.connection.detail}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Health check failed.");
    } finally {
      setChecking(null);
    }
  }

  const selectedSetup = selected ? SOCIAL_PROVIDER_SETUP[selected] : null;

  return (
    <section className="mb-6 rounded-xl border border-cyan-200 bg-white p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Social platform connections</h3>
          <p className="text-xs text-zinc-600">Green means a live check passed. Configured credentials without a supported live check remain unverified.</p>
        </div>
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not refresh."))}>
          Refresh
        </button>
      </header>
      <ul className="grid gap-2 sm:grid-cols-2">
        {connections.map((connection) => (
          <li key={connection.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 p-3">
            <div>
              <strong className="text-sm">{connection.label}</strong>
              <p className="mt-1 max-w-md text-xs text-zinc-600">{connection.detail}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${TONE[connection.state]}`} role="status">{LABEL[connection.state]}</span>
              {(connection.id === "facebook" || connection.id === "instagram") && (
                <button type="button" className="rounded bg-blue-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={checking !== null} onClick={() => void check(connection.id)}>
                  {checking === connection.id ? "Checking…" : connection.state === "not_linked" ? "Connect" : "Check health"}
                </button>
              )}
              <button type="button" className="text-xs font-semibold underline" onClick={() => setSelected(connection.id)}>Setup</button>
            </div>
          </li>
        ))}
        {!connections.length && !message && <li className="text-sm text-zinc-500">Loading connection status…</li>}
      </ul>
      {message && <p role="status" className="mt-3 text-sm text-zinc-700">{message}</p>}

      {selected && selectedSetup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="social-setup-title" className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl">
            <header className="flex items-start justify-between gap-3">
              <div>
                <h2 id="social-setup-title" className="text-lg font-bold">{selectedSetup.label} setup</h2>
                <p className="mt-1 text-sm text-zinc-600">No credentials are exposed or generated by this panel.</p>
              </div>
              <button type="button" aria-label="Close setup checklist" className="rounded border px-2 py-1" onClick={() => setSelected(null)}>Close</button>
            </header>
            <ol className="my-4 list-decimal space-y-2 pl-5 text-sm">
              {selectedSetup.checklist.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <div className="flex flex-wrap gap-2">
              <a className="rounded bg-zinc-900 px-3 py-2 text-sm font-semibold text-white" href={selectedSetup.setupUrl} target="_blank" rel="noreferrer">Open official platform setup</a>
              {(selected === "facebook" || selected === "instagram") && (
                <button type="button" className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => { setSelected(null); onConnectMeta(); }}>Start Facebook OAuth</button>
              )}
            </div>
          </section>
        </div>
      )}
      {!connections.length && message && <p className="sr-only">{SOCIAL_PROVIDER_IDS.length} providers are configured in the registry.</p>}
    </section>
  );
}
