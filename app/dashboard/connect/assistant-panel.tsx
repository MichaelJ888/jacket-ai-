"use client";

import { useCallback, useEffect, useState } from "react";

type Profile = { business_name: string; about: string; offers: string; contact_info: string; tone: string; language: string; handoff_message: string; enabled: boolean };
type Contact = { id: string; name: string | null; channel: string; ai_paused: boolean; last_inbound_at: string | null };

const json = { "Content-Type": "application/json" };
const field = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm";

export default function AssistantPanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInbox = useCallback(async () => {
    const r = await fetch("/api/meta/bot/inbox");
    if (r.ok) setContacts((await r.json()).contacts || []);
  }, []);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/meta/bot");
      if (r.ok) {
        const d = await r.json();
        setProfile(d.profile);
        setProblems(d.problems || []);
      }
      await loadInbox();
    })();
  }, [loadInbox]);

  if (!profile) return null;
  const set = (patch: Partial<Profile>) => setProfile({ ...profile, ...patch });

  async function save(enabled: boolean) {
    setBusy(true);
    const r = await fetch("/api/meta/bot", { method: "PUT", headers: json, body: JSON.stringify({ ...profile, enabled }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg(d.error || "Could not save.");
    setProfile(d.profile);
    setProblems(d.problems || []);
    setMsg(d.profile.enabled ? "Saved. Your assistant is ON and replying to customers." : d.problems?.length ? d.problems.join(" ") : "Saved. Assistant is OFF.");
  }

  async function ask() {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer(null);
    const r = await fetch("/api/meta/bot/test", { method: "POST", headers: json, body: JSON.stringify({ message: question, profile }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setAnswer(r.ok ? d.reply : d.error || "No answer.");
  }

  async function resume(contactId: string) {
    await fetch("/api/meta/bot/inbox", { method: "POST", headers: json, body: JSON.stringify({ contactId }) });
    await loadInbox();
  }

  return (
    <section className="mt-10 rounded border border-zinc-200 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Your AI assistant</h2>
        <span className={`rounded px-2 py-0.5 text-xs ${profile.enabled ? "bg-green-100" : "bg-zinc-100"}`}>{profile.enabled ? "ON" : "OFF"}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-600">It answers your customers using only what you write here. Until you turn it on, it stays silent.</p>

      <div className="mt-3 space-y-2">
        <input className={field} placeholder="Business name" value={profile.business_name} onChange={(e) => set({ business_name: e.target.value })} />
        <textarea className={field} rows={3} placeholder="About your business" value={profile.about} onChange={(e) => set({ about: e.target.value })} />
        <textarea className={field} rows={6} placeholder={"Products / services and prices, e.g.\nLatte - 120\nAmericano - 90"} value={profile.offers} onChange={(e) => set({ offers: e.target.value })} />
        <textarea className={field} rows={2} placeholder="Contact, hours, location" value={profile.contact_info} onChange={(e) => set({ contact_info: e.target.value })} />
        <div className="flex gap-2">
          <select className={field} value={profile.tone} onChange={(e) => set({ tone: e.target.value })}>
            <option value="friendly">Friendly</option>
            <option value="professional">Professional</option>
            <option value="playful">Playful</option>
          </select>
          <select className={field} value={profile.language} onChange={(e) => set({ language: e.target.value })}>
            <option value="taglish">Taglish</option>
            <option value="english">English</option>
            <option value="tagalog">Tagalog</option>
          </select>
        </div>
        <input className={field} placeholder="Message when it hands over to you (optional)" value={profile.handoff_message} onChange={(e) => set({ handoff_message: e.target.value })} />
      </div>

      {problems.length > 0 && <p className="mt-2 text-xs text-amber-700">{problems.join(" ")}</p>}
      {msg && <p className="mt-2 rounded bg-zinc-100 p-2 text-sm">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void save(true)}>Save & turn ON</button>
        <button className="rounded border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => void save(false)}>Save as OFF</button>
      </div>

      <div className="mt-5 border-t pt-3">
        <h3 className="text-sm font-semibold">Try it (nothing is sent to customers)</h3>
        <div className="mt-2 flex gap-2">
          <input className={field} placeholder="Type a customer question" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void ask()} />
          <button className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50" disabled={busy} onClick={() => void ask()}>Ask</button>
        </div>
        {answer && <p className="mt-2 whitespace-pre-wrap rounded bg-zinc-50 p-2 text-sm">{answer}</p>}
      </div>

      <div className="mt-5 border-t pt-3">
        <h3 className="text-sm font-semibold">Recent customers</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between">
              <span>{c.name || "Customer"} <span className="text-xs text-zinc-500">({c.channel})</span></span>
              {c.ai_paused ? <button className="rounded bg-amber-100 px-2 py-0.5 text-xs" onClick={() => void resume(c.id)}>Needs you - give back to assistant</button> : <span className="text-xs text-zinc-400">assistant handling</span>}
            </li>
          ))}
          {!contacts.length && <li className="text-zinc-500">No conversations yet.</li>}
        </ul>
      </div>
    </section>
  );
}
