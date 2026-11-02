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
  settings?: { fabric: string; precision: string; autoTune: boolean; angle: number; rowSpacingMm: number; fillStitchMm: number; pullCompMm: number; notes: string[] };
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
  ['logo.vp3', 'Pfaff/Husqvarna VP3'],
  ['preview.png', 'Preview (PNG)'],
];

const input = 'w-full rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm shadow-inner focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600';
const card = 'rounded-2xl border border-white/70 bg-white/70 p-6 shadow-xl shadow-indigo-900/5 backdrop-blur-xl';

const FABRIC_OPTIONS: Array<[string, string]> = [
  ['cotton-uniform', 'Cotton Uniform'],
  ['heavy-jacket-twill', 'Heavy Jacket Twill'],
  ['polo-knit', 'Polo Knit'],
  ['cap-structured', 'Cap Structured'],
];

const TRUST_BADGES = ['Auto-tuned stitches', 'Tajima · Brother · Melco · Janome', 'Signed 7-day downloads', 'Human QA on flagged files'];

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
  const [widthIn, setWidthIn] = useState('3.5');
  const [heightIn, setHeightIn] = useState('');
  const [maxColors, setMaxColors] = useState('0');
  const [projectName, setProjectName] = useState('');
  const [clientName, setClientName] = useState('');
  const [placement, setPlacement] = useState('');
  const [orderId, setOrderId] = useState('');
  const [fabric, setFabric] = useState('cotton-uniform');
  const [autoTune, setAutoTune] = useState(true);
  const [angle, setAngle] = useState('45');
  const [rowSpacingMm, setRowSpacingMm] = useState('');
  const [fillStitchMm, setFillStitchMm] = useState('');
  const [pullCompMm, setPullCompMm] = useState('');
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

  async function generate(precision: 'standard' | 'high' = 'standard') {
    setError('');
    setResult(null);
    if (!file) return setError('Choose a logo file (PNG, JPG or SVG).');
    if (file.size > MAX_FILE_BYTES) return setError('Logo is over 3 MB. Export a smaller PNG or SVG.');
    const width = Number(widthIn);
    if (!Number.isFinite(width) || width < 0.5 || width > 12) return setError('Width must be between 0.5 and 12 inches.');
    const height = Number(heightIn);
    if (heightIn && (!Number.isFinite(height) || height < 0.5 || height > 12)) return setError('Height must be between 0.5 and 12 inches.');

    setBusy(true);
    try {
      const image = await readAsDataUrl(file);
      const res = await fetch('/api/embroidery/auto-digitize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          widthInches: width,
          heightInches: heightIn && height > 0 ? height : undefined,
          maxColors: Number(maxColors) || undefined,
          projectName,
          clientName,
          placement,
          orderId: orderId.trim() || undefined,
          fabric,
          autoTune,
          precision,
          angle: Number(angle) || 0,
          rowSpacingMm: rowSpacingMm ? Number(rowSpacingMm) : undefined,
          fillStitchMm: fillStitchMm ? Number(fillStitchMm) : undefined,
          pullCompMm: pullCompMm ? Number(pullCompMm) : undefined,
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

  if (signedIn === null) return <main className="p-6 text-sm text-slate-500">Checking access…</main>;

  if (!signedIn) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-6 text-slate-900">
        <div className={`mx-auto mt-16 max-w-xl ${card}`}>
          <h1 className="mb-3 text-2xl font-extrabold tracking-tight">Embroidery Auto-Digitizer</h1>
          <p className="mb-6 text-sm text-slate-600">Sign in through the Visual Site Editor first, then come back here.</p>
          <Link href="/admin/editor" className="inline-block rounded-lg bg-gradient-to-r from-indigo-600 to-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30">Sign in</Link>
        </div>
      </main>
    );
  }

  const qa = result?.qa;

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-sky-50 text-slate-900">
      <header className="bg-gradient-to-r from-slate-900 via-indigo-900 to-sky-800 px-6 py-10 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-200">MJIC · Production</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">Embroidery Auto-Digitizer</h1>
            <p className="mt-2 max-w-2xl text-sm text-indigo-100">Turn any logo into production-ready stitch files for Tajima, Brother, Melco and Janome machines in under a minute.</p>
          </div>
          <Link href="/admin" className="rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur hover:bg-white/20">← Admin Hub</Link>
        </div>
        <ul className="mx-auto mt-6 flex max-w-6xl flex-wrap gap-2">
          {TRUST_BADGES.map((badge) => (
            <li key={badge} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-sky-50">✓ {badge}</li>
          ))}
        </ul>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-2">
        <section className={`space-y-4 ${card}`}>
          <div>
            <span className={label}>Logo file (PNG / JPG / SVG, max 3 MB)</span>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml" className={input} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label><span className={label}>Width (inches)</span><input type="number" step="0.25" min={0.5} max={12} className={input} value={widthIn} onChange={(e) => setWidthIn(e.target.value)} /></label>
            <label><span className={label}>Height (inches, optional)</span><input type="number" step="0.25" min={0.5} max={12} className={input} value={heightIn} onChange={(e) => setHeightIn(e.target.value)} /></label>
            <label><span className={label}>Max colors (0 = auto)</span><input type="number" min={0} max={12} className={input} value={maxColors} onChange={(e) => setMaxColors(e.target.value)} /></label>
            <label><span className={label}>Placement</span><input className={input} list="placements" placeholder="Left chest" value={placement} onChange={(e) => setPlacement(e.target.value)} />
              <datalist id="placements"><option value="Left chest" /><option value="Right chest" /><option value="Back" /><option value="Sleeve" /><option value="Cap front" /></datalist>
            </label>
            <label><span className={label}>Project name</span><input className={input} value={projectName} onChange={(e) => setProjectName(e.target.value)} /></label>
            <label><span className={label}>Client name</span><input className={input} value={clientName} onChange={(e) => setClientName(e.target.value)} /></label>
          </div>
          <label className="block"><span className={label}>Order ID (UUID, optional — links files to the order)</span><input className={input} value={orderId} onChange={(e) => setOrderId(e.target.value)} /></label>

          <details className="rounded-xl border border-indigo-100 bg-white/60 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-indigo-900">Advanced settings</summary>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2"><span className={label}>Fabric</span>
                <select className={input} value={fabric} onChange={(e) => setFabric(e.target.value)}>
                  {FABRIC_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </label>
              <label><span className={label}>Fill angle (°)</span><input type="number" min={0} max={180} className={input} value={angle} onChange={(e) => setAngle(e.target.value)} /></label>
              <label><span className={label}>Stitch density — row spacing (mm)</span><input type="number" step="0.05" min={0.25} max={1.2} placeholder="AI / preset" className={input} value={rowSpacingMm} onChange={(e) => setRowSpacingMm(e.target.value)} /></label>
              <label><span className={label}>Fill stitch length (mm)</span><input type="number" step="0.1" min={1.2} max={6} placeholder="AI / preset" className={input} value={fillStitchMm} onChange={(e) => setFillStitchMm(e.target.value)} /></label>
              <label><span className={label}>Pull compensation (mm)</span><input type="number" step="0.05" min={0} max={0.6} placeholder="AI / preset" className={input} value={pullCompMm} onChange={(e) => setPullCompMm(e.target.value)} /></label>
              <label className="col-span-2 flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={autoTune} onChange={(e) => setAutoTune(e.target.checked)} />AI auto-tune from logo complexity (fills any blank field above)</label>
            </div>
          </details>

          <button type="button" disabled={busy} onClick={() => void generate('standard')} className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:brightness-110 disabled:opacity-50">
            {busy ? 'Digitizing…' : 'Generate stitch files'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>

        <section className={`space-y-4 ${card}`}>
          <h2 className="text-lg font-bold">Result</h2>
          {!result && !busy && <p className="text-sm text-slate-500">Upload a logo and generate to see stitch count, thread colors, QA warnings and downloads.</p>}
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
              {result?.settings && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                  <li>Fabric: {result.settings.fabric} · AI auto-tune {result.settings.autoTune ? 'on' : 'off'} · precision {result.settings.precision}</li>
                  {result.settings.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
              <button type="button" disabled={busy} onClick={() => void generate('high')} className="w-full rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/40 transition hover:brightness-110 disabled:opacity-50">
                ✨ AI Smart Improve — re-analyze and sharpen paths
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
