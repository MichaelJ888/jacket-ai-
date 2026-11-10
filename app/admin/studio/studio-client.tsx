'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { buildAutoStudioDescription } from '../../api/_lib/studio-logic';

type Job = {
  id: string;
  source_url: string;
  output_url: string | null;
  status: string;
  error: string | null;
  product_title: string | null;
  category: string | null;
  description: string | null;
  in_catalog: boolean;
  created_at: string;
};

const CATEGORIES = ['uniform', 'jacket', 'polo', 'corporate-wear', 'sports-jersey', 'giveaway', 'school-uniform', 'bag', 'other'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

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

export default function CeoAiStudioClient() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<File[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [face, setFace] = useState<File | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [anonymize, setAnonymize] = useState(true);
  const [scale, setScale] = useState<2 | 4>(4);
  const [productTitle, setProductTitle] = useState('');
  const [category, setCategory] = useState('');
  const [fabric, setFabric] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
    const res = await fetch('/api/admin/studio/jobs', { cache: 'no-store' });
    if (res.status === 401) {
      setSignedIn(false);
      return;
    }
    if (!res.ok) {
      setError(`Could not load studio jobs (HTTP ${res.status}).`);
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
      if (!res.ok) {
        setError(`Could not load studio jobs (HTTP ${res.status}).`);
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

  function chooseSources(files: FileList | File[]) {
    const selected = Array.from(files);
    const invalid = selected.find((file) => !IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES);
    if (invalid) {
      setError(`${invalid.name}: choose a PNG, JPEG, or WebP image up to 8 MB.`);
      return;
    }
    setError('');
    setSources(selected);
  }

  async function startBatch() {
    setError('');
    if (sources.length === 0) return setError('Choose at least one product photo.');
    if (anonymize && !face) return setError('Upload a synthetic face image, or turn off face anonymization.');
    if (!productTitle.trim() || !category) return setError('Add a product title and category so the image can go to the catalog and ads.');
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
          body: JSON.stringify({ sourceUrl, faceUrl, logoUrl, enhanceScale: scale, productTitle, category, fabric, description }),
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

  async function setCatalog(id: string, inCatalog: boolean) {
    setError('');
    const res = await fetch('/api/admin/studio/catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, inCatalog }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not update the catalog');
    loadJobs();
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
      <main className="neon-admin mx-auto max-w-xl p-6 text-zinc-900">
        <h1 className="mb-3 text-xl font-bold">CEO AI Studio</h1>
        <p className="mb-4 text-sm text-zinc-600">This staff tool is password-protected. Sign in with the authorized Visual Site Editor password, then return here.</p>
        <Link href="/admin/editor" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Sign in</Link>
      </main>
    );
  }

  if (signedIn === null) {
    return <main className="neon-admin p-6 text-sm text-zinc-700">Checking the authorized editor session…</main>;
  }

  return (
    <main className="neon-admin mx-auto max-w-5xl p-6 text-zinc-900">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">MJIC staff · secure editor session</p>
          <h1 className="mt-1 text-xl font-bold">CEO AI Studio &amp; Enhancer</h1>
        </div>
        <nav aria-label="Studio navigation" className="flex gap-2 text-sm">
          <Link href="/" className="rounded border border-cyan-400/40 px-3 py-2 font-semibold text-cyan-100 hover:bg-cyan-400/10">MJIC Website Landing Page</Link>
          <Link href="/admin" className="rounded border border-fuchsia-400/40 px-3 py-2 font-semibold text-fuchsia-100 hover:bg-fuchsia-400/10">Admin Dashboard</Link>
        </nav>
      </header>

      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold">New batch</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm font-semibold">
            <span>Product photos (batch)</span>
            <span
              onDragOver={(event) => { event.preventDefault(); setDropActive(true); }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(event) => { event.preventDefault(); setDropActive(false); chooseSources(event.dataTransfer.files); }}
              className={`mt-1 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm font-normal transition ${dropActive ? 'border-cyan-400 bg-cyan-50' : 'border-zinc-300 hover:border-cyan-500'}`}
            >
              <span className="font-semibold">Drop photos here or browse</span>
              <span className="mt-1 text-xs text-zinc-500">Jackets, bags, polos · PNG/JPEG/WebP · up to 8 MB each</span>
              <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => chooseSources(e.target.files ?? [])} className="sr-only" />
            </span>
            <span className="mt-1 block text-xs text-zinc-500">{sources.length} selected</span>
          </label>
          <label className="text-sm font-semibold">
            Synthetic face (anonymize)
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFace(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm font-normal" />
            <span className="text-xs text-zinc-500">Use an AI-generated or owned face only.</span>
          </label>
          <label className="text-sm font-semibold">
            Left-chest logo (optional)
            <input type="file" accept="image/png,image/webp" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm font-normal" />
            <span className="text-xs text-zinc-500">An opaque chest patch covers the previous mark; a transparent PNG replacement logo works best.</span>
          </label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold">
            Product title
            <input value={productTitle} onChange={(e) => setProductTitle(e.target.value)} maxLength={120} placeholder="e.g. Corporate Polo — Navy" className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1 text-sm font-normal" />
          </label>
          <label className="text-sm font-semibold">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1 text-sm font-normal">
              <option value="">Choose a category</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Fabric (optional)
            <input value={fabric} onChange={(e) => setFabric(e.target.value)} maxLength={120} placeholder="e.g. 220gsm cotton pique" className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1 text-sm font-normal" />
          </label>
        </div>
        <label className="mt-4 block text-sm font-semibold">
          Description (optional; editable)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} rows={3} className="mt-1 block w-full rounded border border-zinc-300 px-2 py-2 text-sm font-normal" />
          <span className="mt-1 flex items-center justify-between gap-3 text-xs font-normal text-zinc-500">
            <span>{description.length}/600 characters. Auto descriptions use only the product details you provide.</span>
            <button type="button" disabled={!productTitle.trim() || !category} className="shrink-0 rounded border border-zinc-300 px-2 py-1 font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-50" onClick={() => setDescription(buildAutoStudioDescription(productTitle, category, fabric).slice(0, 600))}>Auto-write description</button>
          </span>
        </label>
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Jobs</h2>
          <a href="/api/admin/studio/zip" className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white">Download batch (ZIP)</a>
        </div>
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
              {job.product_title && <p className="mt-1 text-xs text-zinc-600">{job.product_title}{job.category ? ` · ${job.category}` : ''}</p>}
              {job.description && <p className="mt-2 text-xs text-zinc-600">{job.description}</p>}
              {job.output_url && <a href={`/api/admin/studio/download?id=${encodeURIComponent(job.id)}`} className="mt-3 block w-full rounded border border-cyan-700 px-3 py-2 text-center text-sm font-semibold text-cyan-900 hover:bg-cyan-50">Download image</a>}
              {job.status === 'pending_approval' && (
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => decide(job.id, 'approve')} className="flex-1 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Approve</button>
                  <button type="button" onClick={() => decide(job.id, 'reject')} className="flex-1 rounded bg-zinc-200 px-3 py-2 text-sm font-semibold">Reject</button>
                </div>
              )}
              {['approved', 'posted'].includes(job.status) && job.output_url && (
                <button type="button" onClick={() => setCatalog(job.id, !job.in_catalog)} className={`mt-3 w-full rounded px-3 py-2 text-sm font-semibold ${job.in_catalog ? 'bg-zinc-200' : 'bg-zinc-900 text-white'}`}>
                  {job.in_catalog ? 'Remove from catalog' : 'Push to catalog'}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
