"use client";

import { useCallback, useEffect, useState } from "react";

type Progress = { kind: string; label: string; targetPcs: number | null; actualPcs: number; targetRevenue: number | null; actualRevenue: number; pcsPct: number | null; revenuePct: number | null };
type Subcon = { id: string; name: string; specialty: string | null; contact_phone: string | null; daily_capacity_pcs: number | null; rate_per_pc: number | null; active: boolean };
type Sample = { id: string; item: string; quantity: number; client_name: string; expected_return_at: string | null; status: string };
type ImportResult = {
  applied: boolean;
  dryRun: boolean;
  preview?: string;
  errors?: Array<{ row: number; column: string; message: string }>;
  links?: Array<{ name: string; quick_dispatch_url: string | null }>;
};

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("mjic_admin") || "" : "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function fetchPanel() {
  const headers = authHeaders();
  const [q, s, m] = await Promise.all([
    fetch("/api/production-quota", { headers }),
    fetch("/api/subcons", { headers }),
    fetch("/api/samples", { headers }),
  ]);
  if (q.status === 401 || s.status === 401 || m.status === 401) {
    return { unauthorized: true, progress: [] as Progress[], subcons: [] as Subcon[], samples: [] as Sample[] };
  }
  const qj = await q.json();
  const sj = await s.json();
  const mj = await m.json();
  return { unauthorized: false, progress: (qj.progress || []) as Progress[], subcons: (sj.subcons || []) as Subcon[], samples: (mj.samples || []) as Sample[] };
}

export default function OperationsPage() {
  const [progress, setProgress] = useState<Progress[]>([]);
  const [subcons, setSubcons] = useState<Subcon[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState("");
  const [sample, setSample] = useState({ item: "", client_name: "", quantity: "1", expected_return_at: "" });
  const [subcon, setSubcon] = useState({ name: "", daily_capacity_pcs: "", rate_per_pc: "", contact_phone: "" });
  const [importFile, setImportFile] = useState<{ name: string; format: "csv" | "json"; content: string } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const applyPanel = useCallback((data: { unauthorized: boolean; progress: Progress[]; subcons: Subcon[]; samples: Sample[] }) => {
    if (data.unauthorized) {
      setError("Kailangan mag-login sa admin muna.");
      return;
    }
    setProgress(data.progress);
    setSubcons(data.subcons);
    setSamples(data.samples);
  }, []);

  const load = useCallback(async () => {
    applyPanel(await fetchPanel());
  }, [applyPanel]);

  useEffect(() => {
    fetchPanel().then(applyPanel);
  }, [applyPanel]);

  async function submitSample(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/samples", { method: "POST", headers: authHeaders(), body: JSON.stringify({ ...sample, quantity: Number(sample.quantity) }) });
    if (!res.ok) setError((await res.json()).error || "Hindi na-save ang sample.");
    setSample({ item: "", client_name: "", quantity: "1", expected_return_at: "" });
    load();
  }

  async function setSampleStatus(id: string, status: string) {
    await fetch("/api/samples", { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ id, status }) });
    load();
  }

  async function readImportFile(file: File) {
    setError("");
    setImportResult(null);
    const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
    setImportFile({ name: file.name, format, content: await file.text() });
  }

  // Always previews first (dryRun); only a second, explicit run writes to subcon_directory.
  async function runImport(dryRun: boolean) {
    if (!importFile) return;
    setError("");
    let body: Record<string, unknown>;
    if (importFile.format === "json") {
      try {
        body = { format: "json", rows: JSON.parse(importFile.content), dryRun };
      } catch {
        setError("Hindi valid na JSON ang file.");
        return;
      }
    } else {
      body = { format: "csv", content: importFile.content, dryRun };
    }
    const res = await fetch("/api/subcons/import", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Hindi na-import ang file.");
      return;
    }
    setImportResult(data as ImportResult);
    if (data.applied) {
      setImportFile(null);
      load();
    }
  }

  async function submitSubcon(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/subcons", { method: "POST", headers: authHeaders(), body: JSON.stringify(subcon) });
    if (!res.ok) setError((await res.json()).error || "Hindi na-save ang subcon.");
    setSubcon({ name: "", daily_capacity_pcs: "", rate_per_pc: "", contact_phone: "" });
    load();
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">Production, Subcons &amp; Samples</h1>
      {error && <p className="rounded bg-red-100 p-3 text-red-800">{error}</p>}

      <section>
        <h2 className="mb-2 text-xl font-semibold">Production Quota</h2>
        <table className="w-full text-left text-sm">
          <thead><tr><th>Period</th><th>Output (pcs)</th><th>Target</th><th>%</th><th>Revenue</th><th>Target</th><th>%</th></tr></thead>
          <tbody>
            {progress.map((row) => (
              <tr key={row.kind} className="border-t">
                <td className="py-1">{row.label}</td>
                <td>{row.actualPcs}</td>
                <td>{row.targetPcs ?? "—"}</td>
                <td>{row.pcsPct ?? "—"}</td>
                <td>₱{row.actualRevenue.toLocaleString()}</td>
                <td>{row.targetRevenue ? `₱${row.targetRevenue.toLocaleString()}` : "—"}</td>
                <td>{row.revenuePct ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-gray-500">Walang target hangga&apos;t hindi nilalagay sa <code>production_quotas</code>.</p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold">Subcon Directory</h2>
        <ul className="mb-3 space-y-1 text-sm">
          {subcons.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong>{s.active ? "" : " (inactive)"} · kapasidad {s.daily_capacity_pcs ?? "—"} pcs/araw · ₱{s.rate_per_pc ?? "—"}/pc · {s.contact_phone ?? "—"}
            </li>
          ))}
        </ul>
        <form onSubmit={submitSubcon} className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
          <input required placeholder="Pangalan" className="border p-1" value={subcon.name} onChange={(e) => setSubcon({ ...subcon, name: e.target.value })} />
          <input placeholder="Kapasidad/araw" type="number" min="0" className="border p-1" value={subcon.daily_capacity_pcs} onChange={(e) => setSubcon({ ...subcon, daily_capacity_pcs: e.target.value })} />
          <input placeholder="Rate/pc" type="number" min="0" className="border p-1" value={subcon.rate_per_pc} onChange={(e) => setSubcon({ ...subcon, rate_per_pc: e.target.value })} />
          <input placeholder="Phone" className="border p-1" value={subcon.contact_phone} onChange={(e) => setSubcon({ ...subcon, contact_phone: e.target.value })} />
          <button className="rounded bg-black px-3 py-1 text-white">I-save</button>
        </form>

        <div className="mt-4 space-y-2 text-sm">
          <p className="font-medium">I-import ang directory (CSV o JSON)</p>
          <p className="text-xs text-gray-500">
            Kumuha ng template:{" "}
            <a className="underline" href="/templates/subcon-directory-template.csv" download>CSV</a>
            {" · "}
            <a className="underline" href="/templates/subcon-directory-template.json" download>JSON</a>
            . Burahin ang halimbawang row bago i-import. Hanggang 500 rows bawat file.
          </p>
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readImportFile(file);
              e.target.value = "";
            }}
          />
          {importFile && (
            <div className="flex gap-2">
              <span className="self-center">{importFile.name}</span>
              <button type="button" onClick={() => runImport(true)} className="rounded border px-3 py-1">I-preview</button>
              <button type="button" onClick={() => runImport(false)} className="rounded bg-black px-3 py-1 text-white">I-import</button>
            </div>
          )}
          {importResult && (
            <div className="rounded border p-2">
              {importResult.errors && importResult.errors.length > 0 && (
                <ul className="mb-2 list-disc pl-5 text-red-700">
                  {importResult.errors.map((err, i) => (
                    <li key={i}>Row {err.row} ({err.column}): {err.message}</li>
                  ))}
                </ul>
              )}
              {importResult.preview && <pre className="whitespace-pre-wrap text-xs">{importResult.preview}</pre>}
              {importResult.applied && (
                <p className="text-green-700">Na-import na ang directory.</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold">Sample Tracker</h2>
        <table className="w-full text-left text-sm">
          <thead><tr><th>Item</th><th>Client</th><th>Qty</th><th>Ibalik</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {samples.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="py-1">{s.item}</td>
                <td>{s.client_name}</td>
                <td>{s.quantity}</td>
                <td>{s.expected_return_at ?? "—"}</td>
                <td>{s.status}</td>
                <td className="space-x-1">
                  {s.status === "OUT" && (
                    <>
                      <button onClick={() => setSampleStatus(s.id, "RETURNED")} className="rounded border px-2">Naibalik</button>
                      <button onClick={() => setSampleStatus(s.id, "LOST")} className="rounded border px-2">Nawala</button>
                      <button onClick={() => setSampleStatus(s.id, "DAMAGED")} className="rounded border px-2">Sira</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={submitSample} className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
          <input required placeholder="Item" className="border p-1" value={sample.item} onChange={(e) => setSample({ ...sample, item: e.target.value })} />
          <input required placeholder="Client" className="border p-1" value={sample.client_name} onChange={(e) => setSample({ ...sample, client_name: e.target.value })} />
          <input type="number" min="1" className="border p-1" value={sample.quantity} onChange={(e) => setSample({ ...sample, quantity: e.target.value })} />
          <input type="date" className="border p-1" value={sample.expected_return_at} onChange={(e) => setSample({ ...sample, expected_return_at: e.target.value })} />
          <button className="rounded bg-black px-3 py-1 text-white">I-log</button>
        </form>
      </section>
    </main>
  );
}
