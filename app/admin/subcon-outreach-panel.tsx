"use client";

import { useCallback, useEffect, useState } from "react";

type Subcon = {
  id: string;
  name: string;
  specialty: string | null;
  email: string | null;
  email_opt_in: boolean;
  email_opt_in_at: string | null;
  email_opt_in_evidence: string | null;
  email_opted_out_at: string | null;
  vetted: boolean;
  vetted_at: string | null;
  vetting_evidence: string | null;
  active: boolean;
};

type Props = { token: string };

export default function SubconOutreachPanel({ token }: Props) {
  const [subcons, setSubcons] = useState<Subcon[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { email: string; evidence: string; vettingEvidence: string }>>({});
  const [resendConfigured, setResendConfigured] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/subcons/outreach", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({})) as { subcons?: Subcon[]; resendConfigured?: boolean; error?: string };
    if (!response.ok) throw new Error(data.error || `Could not load subcontractors (HTTP ${response.status}).`);
    const rows = data.subcons ?? [];
    setSubcons(rows);
    setResendConfigured(Boolean(data.resendConfigured));
    setDrafts(Object.fromEntries(rows.map((subcon) => [subcon.id, {
      email: subcon.email ?? "",
      evidence: subcon.email_opt_in_evidence ?? "",
      vettingEvidence: subcon.vetting_evidence ?? "",
    }])));
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load subcontractors.");
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  async function saveConsent(subcon: Subcon, optedIn: boolean) {
    setBusy(subcon.id);
    setMessage("");
    try {
      const draft = drafts[subcon.id] ?? { email: "", evidence: "" };
      const response = await fetch("/api/admin/subcons/outreach", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "consent",
          subconId: subcon.id,
          email: draft.email,
          optedIn,
          evidence: draft.evidence,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || `Could not save consent (HTTP ${response.status}).`);
      setMessage(optedIn ? `Opt-in recorded for ${subcon.name}.` : `Email outreach disabled for ${subcon.name}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save consent.");
    } finally {
      setBusy("");
    }
  }

  async function saveVetting(subcon: Subcon, vetted: boolean) {
    setBusy(subcon.id);
    setMessage("");
    try {
      const evidence = drafts[subcon.id]?.vettingEvidence ?? "";
      const response = await fetch("/api/admin/subcons/outreach", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "vetting", subconId: subcon.id, vetted, evidence }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || `Could not save vetting status (HTTP ${response.status}).`);
      setMessage(vetted ? `Vetting evidence recorded for ${subcon.name}.` : `Vetting approval removed for ${subcon.name}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save vetting status.");
    } finally {
      setBusy("");
    }
  }

  async function sendOne(subcon: Subcon) {
    if (!window.confirm(`Send one MJIC subcontractor inquiry to ${subcon.email}?`)) return;
    setBusy(subcon.id);
    setMessage("");
    try {
      const response = await fetch("/api/admin/subcons/outreach", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", subconId: subcon.id, confirmSend: true, requestId: crypto.randomUUID() }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error || `Outreach failed (HTTP ${response.status}).`);
      setMessage(`Outreach sent and logged to CRM (${result.status}).`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Outreach failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-cyan-200 bg-white p-4">
      <header>
        <h2 className="text-lg font-bold">Garment subcontractor outreach</h2>
        <p className="text-sm text-zinc-600">Single-recipient, admin-confirmed email only. Explicit consent and its evidence are required; inactive records are never contacted.</p>
        <p className={`mt-2 text-sm font-semibold ${resendConfigured ? "text-emerald-700" : "text-amber-800"}`}>
          Resend: {resendConfigured ? "Ready" : "Not configured / ready for credentials"}
        </p>
      </header>
      {message && <p role="status" className="rounded bg-zinc-100 p-2 text-sm">{message}</p>}
      {!subcons.length && <p className="text-sm text-zinc-600">No subcontractor directory records found.</p>}
      <ul className="space-y-3">
        {subcons.map((subcon) => {
          const draft = drafts[subcon.id] ?? { email: "", evidence: "", vettingEvidence: "" };
          return (
            <li key={subcon.id} className="rounded-lg border border-zinc-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>{subcon.name}</strong>
                  <p className="text-xs text-zinc-600">{subcon.specialty || "Garment subcontractor"} · {subcon.active ? "Active directory record" : "Inactive"}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${subcon.email_opt_in ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                  {subcon.email_opted_out_at ? "Opted out" : subcon.email_opt_in ? "Email opt-in recorded" : "No email opt-in"}
                </span>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${subcon.vetted ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                  {subcon.vetted ? "Vetting evidence recorded" : "Not vetted"}
                </span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <label className="text-xs font-semibold">
                  Email address
                  <input value={draft.email} onChange={(event) => setDrafts((current) => ({ ...current, [subcon.id]: { ...draft, email: event.target.value } }))} type="email" maxLength={254} className="mt-1 block w-full rounded border px-2 py-1 text-sm font-normal" />
                </label>
                <label className="text-xs font-semibold">
                  Consent evidence (source/date/reference)
                  <input value={draft.evidence} onChange={(event) => setDrafts((current) => ({ ...current, [subcon.id]: { ...draft, evidence: event.target.value } }))} maxLength={500} placeholder="e.g. inbound email dated 2026-11-12" className="mt-1 block w-full rounded border px-2 py-1 text-sm font-normal" />
                </label>
                <label className="text-xs font-semibold md:col-span-2">
                  Vetting evidence (reference check/source/date)
                  <input value={draft.vettingEvidence} onChange={(event) => setDrafts((current) => ({ ...current, [subcon.id]: { ...draft, vettingEvidence: event.target.value } }))} maxLength={500} placeholder="Record the completed vetting check" className="mt-1 block w-full rounded border px-2 py-1 text-sm font-normal" />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy !== ""} onClick={() => void saveVetting(subcon, true)} className="rounded bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Approve vetting</button>
                {subcon.vetted && <button type="button" disabled={busy !== ""} onClick={() => void saveVetting(subcon, false)} className="rounded border border-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-900 disabled:opacity-50">Revoke vetting</button>}
                <button type="button" disabled={busy !== ""} onClick={() => void saveConsent(subcon, true)} className="rounded bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save explicit opt-in</button>
                {!subcon.email_opted_out_at && subcon.email_opt_in && <button type="button" disabled={busy !== ""} onClick={() => void saveConsent(subcon, false)} className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-800 disabled:opacity-50">Opt out</button>}
                <button type="button" disabled={busy !== "" || !resendConfigured || !subcon.active || !subcon.vetted || !subcon.vetting_evidence || !subcon.email_opt_in || !subcon.email_opt_in_evidence || Boolean(subcon.email_opted_out_at)} onClick={() => void sendOne(subcon)} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  {busy === subcon.id ? "Processing…" : "Send one inquiry"}
                </button>
                {subcon.email_opt_in_at && <span className="text-xs text-zinc-500">Consent recorded {new Date(subcon.email_opt_in_at).toLocaleDateString()}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
