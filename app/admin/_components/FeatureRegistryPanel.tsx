"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { FeatureRecord } from "../../../lib/mjic-features";

type RegistryResponse = { features: FeatureRecord[]; detectedRoutes: string[]; error?: string };

export default function FeatureRegistryPanel() {
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(url: string, init?: RequestInit) {
    const token = sessionStorage.getItem("mjic_admin");
    const response = await fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
      cache: "no-store",
    });
    const body = await response.json() as RegistryResponse;
    if (!response.ok) throw new Error(body.error || `Feature registry request failed (${response.status}).`);
    return body;
  }

  async function refresh(clearMessage = true) {
    try {
      setRegistry(await request("/api/admin/features"));
      if (clearMessage) setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load feature registry.");
    }
  }

  useEffect(() => {
    let active = true;
    request("/api/admin/features")
      .then((data) => { if (active) setRegistry(data); })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "Could not load feature registry.");
      });
    return () => { active = false; };
  }, []);

  async function addFeature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await request("/api/admin/features", { method: "POST", body: JSON.stringify({ title }) });
      setTitle("");
      setMessage("Feature saved to the shared Supabase registry.");
      await refresh(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save feature.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-cyan-300/20 bg-zinc-900/80 p-4" aria-labelledby="feature-registry-title">
      <header>
        <h3 id="feature-registry-title" className="font-semibold text-cyan-200">MJIC Feature Registry</h3>
        <p className="mt-1 text-xs text-zinc-400">Built-in modules, detected App Router modules, and CEO-added items. Routes refresh during dev/build; custom entries persist in Supabase.</p>
      </header>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void addFeature(event)}>
        <label className="sr-only" htmlFor="custom-feature-title">New feature title</label>
        <input id="custom-feature-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={120} required placeholder="Add a custom feature" className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" />
        <button type="submit" disabled={busy} className="rounded-lg border border-cyan-300/40 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50">{busy ? "Saving…" : "Add feature"}</button>
      </form>
      <p className="text-xs text-zinc-300" aria-live="polite">{message || (registry ? `${registry.features.length} registered · ${registry.detectedRoutes.length} detected routes` : "Loading registry…")}</p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {registry?.features.map((feature) => (
          <li key={feature.id} className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
            <p className="text-sm font-medium text-zinc-100">{feature.title}</p>
            <p className="mt-1 break-all text-xs text-zinc-500">{feature.path ?? feature.source}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
