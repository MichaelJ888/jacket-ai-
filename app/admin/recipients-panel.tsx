"use client";

import { useCallback, useEffect, useState } from "react";

type Recipient = { chatId: string | null; source: "env" | "saved" | "none"; envOverride: boolean };

export default function RecipientsPanel({ token }: { token: string }) {
  const [anne, setAnne] = useState<Recipient | null>(null);
  const [fallback, setFallback] = useState<"owner-group" | "none">("owner-group");
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/recipients", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!r.ok) return setError("Hindi ma-load ang recipients.");
    const data = await r.json();
    setError(null);
    setAnne(data.anne);
    setFallback(data.fallback);
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save(anneChatId: string) {
    setMessage(null);
    const r = await fetch("/api/admin/recipients", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ anneChatId }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return setMessage(data.error || "Hindi na-save.");
    setAnne(data.anne);
    setInput("");
    setMessage(anneChatId ? "Na-save ang chat ID ni Ms. Anne." : "Na-clear ang chat ID ni Ms. Anne. Owner group lang ang tatanggap.");
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!anne) return <p className="text-sm text-zinc-500">Loading...</p>;

  const sourceLabel = anne.source === "env" ? "Env variable (ANNE_MANALO_TELEGRAM_CHAT_ID)" : anne.source === "saved" ? "Naka-save (auto-detect o manual)" : "Wala pang chat ID";

  return (
    <section className="space-y-4 text-sm">
      <div className="rounded border border-zinc-200 p-3">
        <h2 className="font-semibold">Ms. Anne Manalo — Telegram chat ID</h2>
        <p className="text-zinc-600">Pinagmulan: {sourceLabel}</p>
        <p className="text-zinc-600">Kasalukuyang chat ID: <code>{anne.chatId || "—"}</code></p>
        <p className="mt-1 text-zinc-600">
          {anne.chatId
            ? "Tumatanggap na si Ms. Anne ng mga alerto."
            : fallback === "owner-group"
              ? "Walang chat ID pa — ang owner group muna ang tumatanggap ng alerto (safety fallback)."
              : "Walang chat ID at walang fallback — i-set ang chat ID."}
        </p>
        {anne.envOverride && <p className="mt-1 text-amber-700">Ang env variable ang nangingibabaw; hindi mababago dito habang naka-set ito sa Vercel.</p>}
      </div>

      <div className="rounded border border-zinc-200 p-3">
        <p className="mb-2 text-zinc-600">
          Awtomatiko: kapag nag-message si Ms. Anne sa bot (private chat, pangalan na may &quot;Manalo&quot;), ise-save ang chat ID niya. Gamitin ang field na ito kung manual ang gusto.
        </p>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-zinc-300 px-2 py-1"
            placeholder="Numeric chat ID, hal. 123456789"
            inputMode="numeric"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button className="rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-40" disabled={!input.trim() || anne.envOverride} onClick={() => void save(input.trim())}>
            I-save
          </button>
          <button className="rounded bg-zinc-200 px-3 py-1 disabled:opacity-40" disabled={!anne.chatId || anne.envOverride} onClick={() => void save("")}>
            I-clear
          </button>
        </div>
        {message && <p className="mt-2 text-zinc-700">{message}</p>}
      </div>
    </section>
  );
}
