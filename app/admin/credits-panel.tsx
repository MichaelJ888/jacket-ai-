"use client";

import { useCallback, useEffect, useState } from "react";

type Balance = { provider: "replicate" | "fal"; label: string; balanceUsd: number | null; low: boolean };
type Entry = { id: number; provider: "replicate" | "fal"; kind: "balance" | "spend"; amount_usd: number; note: string; created_at: string };

const input = "rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900";
const button = "rounded bg-zinc-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50";

export default function CreditsPanel({ token }: { token: string }) {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [thresholdUsd, setThresholdUsd] = useState(10);
  const [provider, setProvider] = useState<"replicate" | "fal">("replicate");
  const [kind, setKind] = useState<"balance" | "spend">("balance");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/credits", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return setMessage(data.error || "Hindi ma-load ang credits.");
    setBalances(data.balances);
    setEntries(data.entries);
    setThresholdUsd(data.thresholdUsd);
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function submit() {
    setMessage(null);
    const r = await fetch("/api/admin/credits", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ provider, kind, amountUsd: amount, note }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return setMessage(data.error || "Hindi na-save.");
    setAmount("");
    setNote("");
    setMessage(data.alerted ? "Na-save. Nagpadala ng Telegram alert (mababa ang balance)." : "Na-save.");
    void load();
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold">AI API credits</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Replicate and Fal don&apos;t expose a balance API, so enter the balance from each provider&apos;s dashboard, then log spend as you go. A Telegram alert fires when the balance drops below ${thresholdUsd}.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {balances.map((b) => (
            <div key={b.provider} className={`rounded-lg border p-3 ${b.low ? "border-red-400 bg-red-50" : "border-zinc-200"}`}>
              <div className="text-sm font-semibold">{b.label}</div>
              <div className="text-2xl font-bold">{b.balanceUsd === null ? "Not set" : `$${b.balanceUsd.toFixed(2)}`}</div>
              {b.low && <div className="text-xs font-medium text-red-700">Below ${thresholdUsd} threshold</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold">Record balance or spend</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <select className={input} value={provider} onChange={(e) => setProvider(e.target.value as "replicate" | "fal")}>
            <option value="replicate">Replicate</option>
            <option value="fal">Fal.ai</option>
          </select>
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as "balance" | "spend")}>
            <option value="balance">Set current balance (USD)</option>
            <option value="spend">Spent since last entry (USD)</option>
          </select>
          <input className={input} type="number" min="0" step="0.01" placeholder="Amount USD" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className={input} placeholder="Note (optional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className={button} disabled={!amount} onClick={submit}>Save entry</button>
        </div>
        {message && <p className="mt-2 text-sm">{message}</p>}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold">Recent entries</h3>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="text-zinc-500"><th>When</th><th>Provider</th><th>Kind</th><th>USD</th><th>Note</th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-zinc-100">
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>{e.provider}</td>
                <td>{e.kind}</td>
                <td>{Number(e.amount_usd).toFixed(2)}</td>
                <td>{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </section>
  );
}
