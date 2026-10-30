'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteDoc } from '../../api/_lib/site-content-logic';

type Stage = 'checking' | 'login' | 'code' | 'editing';

type FrameMessage = {
  source?: string;
  type?: string;
  key?: string;
  value?: string;
  url?: string;
  catalogOrder?: string[];
};

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

export default function EditorPage() {
  const [stage, setStage] = useState<Stage>('checking');
  const [password, setPassword] = useState('');
  const [chatId, setChatId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<SiteDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const draftRef = useRef<SiteDoc | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const pushToFrame = useCallback((doc: SiteDoc) => {
    frameRef.current?.contentWindow?.postMessage({ source: 'mjic-cms-editor', type: 'render', doc }, location.origin);
  }, []);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/admin/editor', { cache: 'no-store' });
    if (!res.ok) return false;
    const body = await readJson<{ doc: SiteDoc }>(res);
    setDraft(body.doc);
    setDirty(false);
    setStage('editing');
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/editor', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setStage('login');
          return;
        }
        const body = await readJson<{ doc: SiteDoc }>(res);
        if (cancelled) return;
        setDraft(body.doc);
        setDirty(false);
        setStage('editing');
      } catch {
        if (!cancelled) setStage('login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as FrameMessage | null;
      if (!message || message.source !== 'mjic-cms-frame') return;
      if (message.type === 'ready') {
        if (draftRef.current) pushToFrame(draftRef.current);
        return;
      }
      setDirty(true);
      setDraft((prev) => {
        if (!prev) return prev;
        if (message.type === 'text' && message.key !== undefined && message.value !== undefined) {
          return { ...prev, texts: { ...prev.texts, [message.key]: message.value } };
        }
        if (message.type === 'image' && message.key !== undefined && message.url !== undefined) {
          return { ...prev, images: { ...prev.images, [message.key]: message.url } };
        }
        if (message.type === 'order' && Array.isArray(message.catalogOrder)) {
          return { ...prev, catalogOrder: message.catalogOrder };
        }
        return prev;
      });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pushToFrame]);

  function updateTheme(field: keyof SiteDoc['theme'], value: string) {
    setDirty(true);
    setDraft((prev) => (prev ? { ...prev, theme: { ...prev.theme, [field]: value.toUpperCase() } } : prev));
  }

  useEffect(() => {
    if (stage === 'editing' && draftRef.current) pushToFrame(draftRef.current);
  }, [draft?.theme.primary, draft?.theme.secondary, draft?.theme.background, stage, pushToFrame]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/editor/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, chatId }),
    });
    const body = await readJson<object>(res);
    setBusy(false);
    if (!res.ok) return setError(body.error || 'Login failed.');
    setNotice('A 6-digit code was sent to your Telegram.');
    setStage('code');
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/editor/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, chatId, code }),
    });
    const body = await readJson<object>(res);
    if (!res.ok) {
      setBusy(false);
      return setError(body.error || 'Verification failed.');
    }
    setPassword('');
    setCode('');
    const opened = await loadSession();
    setBusy(false);
    if (!opened) setError('Session could not be opened. Try again.');
  }

  async function publish() {
    if (!draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    const res = await fetch('/api/admin/editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const body = await readJson<{ updatedAt?: string }>(res);
    setBusy(false);
    if (!res.ok) return setError(body.error || 'Publish failed.');
    setDirty(false);
    setNotice('Published. Live visitors see the update within about 20 seconds.');
  }

  async function discard() {
    if (!window.confirm('Discard unpublished changes and reload the editor?')) return;
    setBusy(true);
    await loadSession();
    setFrameKey((k) => k + 1);
    setBusy(false);
    setNotice('Unpublished changes discarded.');
  }

  async function signOut() {
    await fetch('/api/admin/editor', { method: 'DELETE' });
    setDraft(null);
    setDirty(false);
    setStage('login');
  }

  if (stage === 'checking') {
    return <main className="min-h-screen grid place-items-center text-sm text-zinc-500">Checking access…</main>;
  }

  if (stage !== 'editing') {
    return (
      <main className="min-h-screen grid place-items-center bg-zinc-100 p-6">
        <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
          <h1 className="text-xl font-bold text-zinc-900">MJIC Visual Editor</h1>
          <p className="mt-1 text-sm text-zinc-500">Restricted to the CEO and Ms. Anne Manalo.</p>
          {stage === 'login' ? (
            <form onSubmit={requestCode} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-zinc-700">
                Editor password
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" autoComplete="current-password" />
              </label>
              <label className="block text-sm font-medium text-zinc-700">
                Telegram chat ID
                <input inputMode="numeric" required value={chatId} onChange={(e) => setChatId(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
              </label>
              <button disabled={busy} className="w-full rounded-md bg-zinc-900 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? 'Sending…' : 'Send login code to Telegram'}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-zinc-700">
                6-digit code
                <input inputMode="numeric" pattern="[0-9]{6}" required value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 tracking-[0.4em]" />
              </label>
              <button disabled={busy} className="w-full rounded-md bg-zinc-900 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? 'Verifying…' : 'Open editor'}
              </button>
              <button type="button" onClick={() => setStage('login')} className="w-full text-sm text-zinc-500 underline">Back</button>
            </form>
          )}
          {notice && <p className="mt-4 text-sm text-emerald-700">{notice}</p>}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-zinc-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3">
        <h1 className="mr-2 text-base font-bold text-zinc-900">Visual Editor</h1>
        <span className="text-xs text-zinc-500 hidden md:inline">Click text to edit · Click an image to replace it · Drag catalogue cards to reorder</span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {draft && (
            <>
              <ColorField label="Primary" value={draft.theme.primary} onChange={(v) => updateTheme('primary', v)} />
              <ColorField label="Secondary" value={draft.theme.secondary} onChange={(v) => updateTheme('secondary', v)} />
              <ColorField label="Background" value={draft.theme.background} onChange={(v) => updateTheme('background', v)} />
            </>
          )}
          <span className="text-xs text-zinc-500">{dirty ? 'Unpublished changes' : 'All published'}</span>
          <button onClick={discard} disabled={busy || !dirty} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40">Discard</button>
          <button onClick={publish} disabled={busy || !dirty} className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? 'Publishing…' : 'Publish Changes'}
          </button>
          <a href="/admin" className="text-sm text-zinc-600 underline">Admin</a>
          <button onClick={signOut} className="text-sm text-zinc-600 underline">Sign out</button>
        </div>
      </header>
      {(notice || error) && (
        <div className={`px-4 py-2 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{error || notice}</div>
      )}
      <iframe key={frameKey} ref={frameRef} src="/index.html?cms=editor" title="Live page editor" className="w-full flex-1 border-0 bg-white" />
    </main>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
      {label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-zinc-300 bg-white p-0.5" />
    </label>
  );
}
