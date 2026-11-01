'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Job = {
  id: string;
  source_url: string;
  output_url: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  swapping: 'Anonymizing face',
  enhancing: 'Enhancing 4K',
  pending_approval: 'Waiting for CEO approval',
  approved: 'Approved',
  rejected: 'Rejected',
  failed: 'Failed',
};

async function uploadFile(file: File, kind: 'source' | 'face' | 'logo'): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  const res = await fetch('/api/admin/studio/upload', { method: 'POST', body: form });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.url;
}

export default function CeoAiStudioPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<File[]>([]);
  const [face, setFace] = useState<File | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [anonymize, setAnonymize] = useState(true);
  const [scale, setScale] = useState<2 | 4>(4);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
    const res = await fetch('/api/admin/studio/jobs', { cache: 'no-store' });
    if (res.status === 401) {
      setSignedIn(false);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { jobs?: Job[] };
    setSignedIn(true);
    setJobs(data.jobs ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const res = await fetch('/api/admin/studio/jobs', { cache: 'no-store' }).catch(() => null);
      if (cancelled || !res) return;
      if (res.status === 401) {
        setSignedIn(false);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { jobs?: Job[] };
      setSignedIn(true);
      setJobs(data.jobs ?? []);
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function startBatch() {
    setError('');
    if (sources.length === 0) return setError('Choose at least one product photo.');
    if (anonymize && !face) return setError('Upload a synthetic face image, or turn off face anonymization.');
    setBusy(true);
    try {
      const faceUrl = anonymize && face ? await uploadFile(face, 'face') : null;
      const logoUrl = logo ? await uploadFile(logo, 'logo') : null;
      for (let i = 0; i < sources.length; i++) {
        setProgress(`Starting ${i + 1} of ${sources.length}…`);
        const sourceUrl = await uploadFile(sources[i], 'source');
        const res = await fetch('/api/admin/studio/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceUrl, faceUrl, logoUrl, enhanceScale: scale }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(`${sources[i].name}: ${data.error ?? res.status}`);
      }
      setProgress(`${sources.length} job(s) started. Results appear below as they finish.`);
      setSources([]);
      loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch failed');
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: 'approve' | 'reject') {
    const res = await fetch('/api/admin/studio/jobs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not record decision');
    loadJobs();
  }

  if (signedIn === false) {
    return (
      <main className="mx-auto max-w-xl p-6 text-zinc-900">
        <h1 className="mb-3 text-xl font-bold">CEO AI Studio</h1>
        <p className="mb-4 text-sm text-zinc-600">Sign in through the Visual Site Editor first, then come back here.</p>
        <Link href="/admin/editor" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Sign in</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6 text-zinc-900">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">CEO AI Studio &amp; Enhancer</h1>
        <Link href="/admin" className="text-sm underline">← MJIC Admin</Link>
      </div>

      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold">New batch</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm font-semibold">
            Product photos (batch)
            <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => setSources(Array.from(e.target.files ?? []))} className="mt-1 block w-full text-sm font-normal" />
            <span className="text-xs text-zinc-500">{sources.length} selected · PNG/JPEG/WebP, 8 MB max each</span>
          </label>
          <label className="text-sm font-semibold">
            Synthetic face (anonymize)
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFace(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm font-normal" />
            <span className="text-xs text-zinc-500">Use an AI-generated or owned face only.</span>
          </label>
          <label className="text-sm font-semibold">
            Left-chest logo (optional)
            <input type="file" accept="image/png,image/webp" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm font-normal" />
            <span className="text-xs text-zinc-500">Transparent PNG works best.</span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={anonymize} onChange={(e) => setAnonymize(e.target.checked)} />
            Anonymize face with synthetic face
          </label>
          <label className="flex items-center gap-2">
            Upscale
            <select value={scale} onChange={(e) => setScale(Number(e.target.value) as 2 | 4)} className="rounded border border-zinc-300 px-2 py-1">
              <option value={4}>4× (4K)</option>
              <option value={2}>2×</option>
            </select>
          </label>
          <button type="button" onClick={startBatch} disabled={busy} className="rounded-md bg-zinc-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
            {busy ? 'Working…' : 'Start batch'}
          </button>
        </div>
        {progress && <p className="mt-3 text-sm text-zinc-700">{progress}</p>}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-bold">Jobs</h2>
        {jobs.length === 0 && <p className="text-sm text-zinc-500">No jobs yet.</p>}
        <div className="grid gap-4 md:grid-cols-3">
          {jobs.map((job) => (
            <article key={job.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              {job.output_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={job.output_url} alt="Studio output" className="mb-3 aspect-[3/4] w-full rounded object-cover" />
              ) : (
                <div className="mb-3 flex aspect-[3/4] w-full items-center justify-center rounded bg-zinc-100 text-xs text-zinc-500">
                  {STATUS_LABEL[job.status] ?? job.status}
                </div>
              )}
              <p className="text-sm font-semibold">{STATUS_LABEL[job.status] ?? job.status}</p>
              {job.error && <p className="mt-1 text-xs text-red-700">{job.error}</p>}
              {job.status === 'pending_approval' && (
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => decide(job.id, 'approve')} className="flex-1 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Approve</button>
                  <button type="button" onClick={() => decide(job.id, 'reject')} className="flex-1 rounded bg-zinc-200 px-3 py-2 text-sm font-semibold">Reject</button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
