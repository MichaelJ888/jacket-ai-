'use client';

import { useState, useSyncExternalStore } from 'react';

const TOKEN_KEY = 'mjic_admin_token';
const tokenListeners = new Set<() => void>();
const subscribeToken = (listener: () => void) => {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
};
const readToken = () => sessionStorage.getItem(TOKEN_KEY) || '';
const writeToken = (value: string) => {
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
  tokenListeners.forEach((listener) => listener());
};

const STYLES = [
  { key: 'modern-minimal', label: 'Modern minimal' },
  { key: 'corporate-premium', label: 'Corporate premium' },
  { key: 'bold-badge', label: 'Bold badge / emblem' },
  { key: 'lettermark', label: 'Lettermark / monogram' },
] as const;

const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900';
const labelClass = 'mb-1 block text-sm font-semibold text-slate-700';

const MAX_DIMENSION = 1024;

// Downscale to <=1024px PNG so the image-to-image call stays fast and under the 4 MB cap.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas unavailable'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Could not read that image file.'));
    img.src = URL.createObjectURL(file);
  });
}

// AI Logo Redesign Creator: old logo upload + description + brand prefs -> modern PNG concept drafts.
export default function LogoCreatorPage() {
  const token = useSyncExternalStore(subscribeToken, readToken, () => '');
  const [tokenInput, setTokenInput] = useState('');
  const [image, setImage] = useState<string>('');
  const [previewName, setPreviewName] = useState('');
  const [description, setDescription] = useState('');
  const [style, setStyle] = useState<string>('modern-minimal');
  const [colors, setColors] = useState('');
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);

  if (!token) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">AI Logo Redesign Creator</h1>
        <p className="mt-2 text-sm text-gray-600">Enter the admin token. It is kept only for this browser tab.</p>
        <input type="password" className="mt-4 w-full rounded border px-3 py-2" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="Admin token" />
        <button
          type="button"
          className="mt-3 rounded bg-black px-4 py-2 text-white"
          onClick={() => {
            const value = tokenInput.trim();
            if (value) writeToken(value);
          }}
        >
          Continue
        </button>
      </main>
    );
  }

  async function onFile(file: File | null) {
    setError(null);
    if (!file) return;
    try {
      setImage(await fileToDataUrl(file));
      setPreviewName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    }
  }

  async function generate() {
    setError(null);
    setImages([]);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/logo-creator', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, description, style, colors, count }),
      });
      const data = await res.json();
      if (res.status === 401) {
        writeToken('');
        return;
      }
      if (!res.ok) {
        setError(data.error || 'Generation failed.');
        if (Array.isArray(data.images)) setImages(data.images);
        return;
      }
      setImages(data.images || []);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6 text-slate-900">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-700">MJIC Admin</p>
        <h1 className="mt-1 text-2xl font-bold">AI Logo Redesign Creator</h1>
        <p className="mt-2 text-sm text-slate-600">
          Upload a client&apos;s old logo, describe the business and the modernization direction, and generate high-resolution PNG concept drafts.
          Concepts are raster drafts for client review — final vectorization (AI/EPS/SVG) is done by the design team.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <label className={labelClass} htmlFor="logo-file">Old logo image</label>
            <input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} className="text-sm" />
            {image && (
              <div className="mt-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="Old logo preview" className="h-20 w-20 rounded border border-slate-200 object-contain bg-white" />
                <span className="text-xs text-slate-500">{previewName} (resized to ≤1024px)</span>
              </div>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="desc">Business &amp; redesign brief</label>
            <textarea id="desc" rows={4} className={field} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Construction supply company in Cavite. Old logo feels dated — keep the crane silhouette, make it cleaner and more corporate, navy and orange." />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="style">Style direction</label>
              <select id="style" className={field} value={style} onChange={(e) => setStyle(e.target.value)}>
                {STYLES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="colors">Brand colors (optional)</label>
              <input id="colors" className={field} value={colors} onChange={(e) => setColors(e.target.value)} placeholder="navy, gold" />
            </div>
            <div>
              <label className={labelClass} htmlFor="count">Concepts</label>
              <select id="count" className={field} value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button type="button" disabled={busy || !image || description.trim().length < 10} onClick={() => void generate()} className="w-full rounded-lg bg-indigo-700 px-5 py-3 font-bold text-white disabled:opacity-60">
            {busy ? 'Generating concepts…' : 'Generate modern concepts'}
          </button>
        </section>

        <aside>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold">Concept drafts</h2>
            {images.length === 0 && <p className="mt-2 text-sm text-slate-600">Generated concepts appear here. Download the ones the client likes.</p>}
            <ul className="mt-3 space-y-3">
              {images.map((src, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Logo concept ${i + 1}`} className="w-full rounded bg-white object-contain" />
                  <a href={src} download={`logo-concept-${i + 1}.png`} className="mt-2 block rounded bg-slate-900 px-3 py-1.5 text-center text-sm font-semibold text-white">
                    Download PNG
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
