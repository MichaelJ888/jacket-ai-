"use client";

import { useEffect, useState } from "react";

type SourceFile = { name: string; size: number };
type Preview = { name: string; content: string; redactions: number; size: number };

// Mounted only while open. Shows the redacted files the ZIP would contain, before the owner downloads it.
export default function SourcePreviewDrawer({ token, onClose, onDownload }: { token: string; onClose: () => void; onDownload: () => void }) {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/export/source?list=1", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { files: SourceFile[] };
      })
      .then((data) => {
        if (cancelled) return;
        setFiles(data.files);
        if (data.files[0]) setSelected(data.files[0].name);
      })
      .catch((e: Error) => { if (!cancelled) setError(`Could not load file list (${e.message}).`); });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/admin/export/source?file=${encodeURIComponent(selected)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Preview;
      })
      .then((data) => { if (!cancelled) { setPreview(data); setError(""); } })
      .catch((e: Error) => { if (!cancelled) { setPreview(null); setError(`Could not load ${selected} (${e.message}).`); } });
    return () => { cancelled = true; };
  }, [selected, token]);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Source export preview">
      <div className="flex h-full w-full max-w-5xl flex-col bg-white text-zinc-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Source ZIP preview</h2>
            <p className="text-xs text-zinc-500">{files.length} files · {(totalBytes / 1024).toFixed(0)} KB before compression · secrets redacted · API routes, env files, media, and tests excluded</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded bg-zinc-900 px-3 py-1 text-sm font-medium text-white" onClick={onDownload}>Download ZIP</button>
            <button type="button" className="rounded border border-zinc-300 px-3 py-1 text-sm" onClick={onClose}>Close</button>
          </div>
        </div>
        {error && <p className="px-4 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex min-h-0 flex-1">
          <ul className="w-72 shrink-0 overflow-y-auto border-r border-zinc-200 text-xs">
            {files.map((f) => (
              <li key={f.name}>
                <button
                  type="button"
                  onClick={() => setSelected(f.name)}
                  className={`block w-full truncate px-3 py-1.5 text-left font-mono ${selected === f.name ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"}`}
                  title={f.name}
                >
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500">
              {preview && preview.name === selected ? `${preview.name} · ${preview.size} bytes · ${preview.redactions} redaction(s)` : selected ? "Loading…" : "Select a file"}
            </div>
            <pre className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100">{preview && preview.name === selected ? preview.content : ""}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
