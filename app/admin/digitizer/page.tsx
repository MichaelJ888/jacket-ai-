'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type ThreadSummary = { colorIndex: number; hex: string; name: string; stitchCount: number };

type Qa = {
  stitchCount: number;
  colorChanges: number;
  trims: number;
  jumps: number;
  designWidthMm: number;
  designHeightMm: number;
  densityPerCm2: number;
  estimatedMinutesAt700Spm: number;
  threadList: ThreadSummary[];
  warnings: string[];
  needsHumanReview: boolean;
  confidence: number;
};

type DigitizeResponse = {
  success?: boolean;
  requiresManualDigitizing?: boolean;
  qa?: Qa;
  files?: Record<string, string>;
  job?: { id: string; status: string };
  error?: string;
};

// Vercel caps request bodies at ~4.5 MB; base64 adds ~33%, so keep source files well under that.
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const FILE_LABELS: Array<[string, string]> = [
  ['logo.dst', 'Tajima DST'],
  ['logo.pes', 'Brother PES'],
  ['logo.exp', 'Melco EXP'],
  ['logo.jef', 'Janome JEF'],
  ['preview.png', 'Preview (PNG)'],
];

const input = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-600';

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the logo file.'));
    reader.readAsDataURL(file);
  });
}

export default function EmbroideryDigitizerPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [widthMm, setWidthMm] = useState('100');
  const [heightMm, setHeightMm] = useState('');
  const [maxColors, setMaxColors] = useState('0');
  const [projectName, setProjectName] = useState('');
  const [clientName, setClientName] = useState('');
  const [placement, setPlacement] = useState('');
  const [orderId, setOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DigitizeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/embroidery/auto-digitize', { cache: 'no-store' })
      .then((res) => { if (!cancelled) setSignedIn(res.ok); })
      .catch(() => { if (!cancelled) setSignedIn(false); });
    return () => { cancelled = true; };
  }, []);

  async function generate() {
    setError('');
    setResult(null);
    if (!file) return setError('Choose a logo file (PNG, JPG or SVG).');
    if (file.size > MAX_FILE_BYTES) return setError('Logo is over 3 MB. Export a smaller PNG or SVG.');
    const width = Number(widthMm);
    if (!Number.isFinite(width) || width <= 0) return setError('Enter the design width in mm.');

    setBusy(true);
    try {
      const image = await readAsDataUrl(file);
      const res = await fetch('/api/embroidery/auto-digitize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          widthMm: width,
          heightMm: Number(heightMm) > 0 ? Number(heightMm) : undefined,
          maxColors: Number(maxColors) || undefined,
          projectName,
          clientName,
          placement,
          orderId: orderId.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as DigitizeResponse;
      if (!res.ok) return setError(data.error || `Digitizing failed (${res.status}).`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Digitizing failed.');
    } finally {
      setBusy(false);
    }
  }

  if (signedIn === null) return <main className="p-6 text-sm text-zinc-500">Checking access…</main>;

  if (!signedIn) {
    return (
      <main className="mx-auto max-w-xl p-6 text-zinc-900">
        <h1 className="mb-3 text-xl font-bold">Embroidery Auto-Digitizer</h1>
        <p className="mb-4 text-sm text-zinc-600">Sign in through the Visual Site Editor first, then come back here.</p>
        <Link href="/admin/editor" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Sign in</Link>
      </main>
    );
  }

  const qa = result?.qa;

  return (
    <main className="mx-auto max-w-5xl p-6 text-zinc-900">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Embroidery Auto-Digitizer</h1>
        <Link href="/admin" className="text-sm underline">← Back to Admin Hub</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div>
            <span className={label}>Logo file (PNG / JPG / SVG, max 3 MB)</span>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml" className={input} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label><span className={label}>Width (mm)</span><input type="number" min={1} className={input} value={widthMm} onChange={(e) => setWidthMm(e.target.value)} /></label>
            <label><span className={label}>Height (mm, optional)</span><input type="number" min={1} className={input} value={heightMm} onChange={(e) => setHeightMm(e.target.value)} /></label>
            <label><span className={label}>Max colors (0 = auto)</span><input type="number" min={0} max={12} className={input} value={maxColors} onChange={(e) => setMaxColors(e.target.value)} /></label>
            <label><span className={label}>Placement</span><input className={input} list="placements" placeholder="Left chest" value={placement} onChange={(e) => setPlacement(e.target.value)} />
              <datalist id="placements"><option value="Left chest" /><option value="Right chest" /><option value="Back" /><option value="Sleeve" /><option value="Cap front" /></datalist>
            </label>
            <label><span className={label}>Project name</span><input className={input} value={projectName} onChange={(e) => setProjectName(e.target.value)} /></label>
            <label><span className={label}>Client name</span><input className={input} value={clientName} onChange={(e) => setClientName(e.target.value)} /></label>
          </div>
          <label className="block"><span className={label}>Order ID (UUID, optional — links files to the order)</span><input className={input} value={orderId} onChange={(e) => setOrderId(e.target.value)} /></label>
          <button type="button" disabled={busy} onClick={() => void generate()} className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Digitizing…' : 'Generate stitch files'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>

        <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Result</h2>
          {!result && !busy && <p className="text-sm text-zinc-500">Upload a logo and generate to see stitch count, thread colors, QA warnings and downloads.</p>}
          {qa && (
            <>
              <p className={`text-sm font-semibold ${qa.needsHumanReview ? 'text-amber-700' : 'text-emerald-700'}`}>
                {qa.needsHumanReview ? 'Needs manual digitizing review' : 'Ready for production'} · status {result?.job?.status ?? '—'}
              </p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-zinc-500">Stitches</dt><dd className="font-bold">{qa.stitchCount.toLocaleString('en-PH')}</dd></div>
                <div><dt className="text-zinc-500">Colors</dt><dd className="font-bold">{qa.threadList.length}</dd></div>
                <div><dt className="text-zinc-500">Size</dt><dd className="font-bold">{qa.designWidthMm} × {qa.designHeightMm} mm</dd></div>
                <div><dt className="text-zinc-500">Density</dt><dd className="font-bold">{qa.densityPerCm2}/cm²</dd></div>
                <div><dt className="text-zinc-500">Run time @700 spm</dt><dd className="font-bold">{qa.estimatedMinutesAt700Spm} min</dd></div>
                <div><dt className="text-zinc-500">Color changes / trims</dt><dd className="font-bold">{qa.colorChanges} / {qa.trims}</dd></div>
              </dl>
              <ul className="space-y-1 text-sm">
                {qa.threadList.map((t) => (
                  <li key={t.colorIndex} className="flex items-center gap-2">
                    <span className="inline-block h-4 w-4 rounded border border-zinc-300" style={{ background: t.hex }} />
                    <span>{t.name}</span><span className="text-zinc-500">{t.hex} · {t.stitchCount.toLocaleString('en-PH')} st</span>
                  </li>
                ))}
              </ul>
              {qa.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">{qa.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              )}
              <div className="flex flex-wrap gap-2">
                {FILE_LABELS.map(([key, text]) => result?.files?.[key] && (
                  <a key={key} href={result.files[key]} target="_blank" rel="noopener noreferrer" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-100">
                    {text}
                  </a>
                ))}
              </div>
              <p className="text-xs text-zinc-500">Download links are signed and expire after 7 days.</p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
