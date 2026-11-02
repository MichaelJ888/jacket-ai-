'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SeoAudit, SeoStatus } from '../../api/_lib/seo-audit';

type Response = { url: string; fetchedAt: string; audit: SeoAudit };

const STATUS_STYLE: Record<SeoStatus, string> = {
  pass: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  fail: 'bg-red-100 text-red-800',
};

const RANK_CHANNELS = [
  'Google Search',
  'Chrome Search',
  'Gemini',
  'ChatGPT',
  'Claude',
  'Perplexity',
  'Facebook',
  'Instagram',
  'TikTok',
];

export default function SeoRankTrackerPage() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);

  const [injecting, setInjecting] = useState(false);
  const [injectMsg, setInjectMsg] = useState('');

  async function autoInject() {
    setInjecting(true);
    setInjectMsg('');
    const res = await fetch('/api/admin/seo', { method: 'POST', cache: 'no-store' });
    setInjecting(false);
    if (res.status === 401) {
      setUnauthorized(true);
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
    setInjectMsg(res.ok && body.ok ? 'Keywords and JSON-LD schema published. They load on the live homepage.' : body.error ?? `Inject failed (${res.status}).`);
  }

  async function runAudit() {
    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/seo', { cache: 'no-store' });
    setLoading(false);
    if (res.status === 401) {
      setUnauthorized(true);
      return;
    }
    const body = (await res.json().catch(() => ({}))) as Partial<Response> & { error?: string };
    if (!res.ok || !body.audit) {
      setError(body.error ?? `Audit failed (${res.status}).`);
      return;
    }
    setUnauthorized(false);
    setData(body as Response);
  }

  return (
    <main className="mx-auto max-w-5xl p-6 text-zinc-900">
      <nav aria-label="Admin" className="mb-6 flex items-center justify-between">
        <Link href="/admin" className="text-sm underline">← Back to admin</Link>
        <h1 className="text-xl font-bold">SEO Rank Tracker</h1>
      </nav>

      <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">On-site SEO audit</h2>
            <p className="text-sm text-zinc-600">Reads the live homepage and checks titles, meta, canonical, JSON-LD and Philippine B2B keyword coverage.</p>
          </div>
          <button
            onClick={() => void runAudit()}
            disabled={loading}
            className="rounded-lg bg-zinc-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Auditing…' : 'Run audit'}
          </button>
        </div>

        {unauthorized && (
          <p className="mt-4 text-sm text-red-700">
            Sign in first at <Link href="/admin/editor" className="underline">/admin/editor</Link>, then run the audit again.
          </p>
        )}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
          <button
            onClick={() => void autoInject()}
            disabled={injecting}
            className="rounded-lg bg-emerald-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            {injecting ? 'Injecting…' : '⚡ Auto-Inject Best B2B Keywords & JSON-LD Schema'}
          </button>
          {injectMsg && <p className="text-sm text-zinc-700">{injectMsg}</p>}
        </div>

        {data && (
          <div className="mt-5 space-y-5">
            <p className="text-sm text-zinc-600">
              Score <span className="text-2xl font-bold text-zinc-900">{data.audit.score}</span>/100 · {data.url} · {data.audit.wordCount} words · checked {new Date(data.fetchedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.audit.checks.map((check) => (
                <li key={check.id} className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{check.label}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${STATUS_STYLE[check.status]}`}>{check.status}</span>
                  </div>
                  <p className="mt-1 break-words text-sm text-zinc-600">{check.detail}</p>
                </li>
              ))}
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-zinc-600">
                  <tr>
                    <th className="py-2">Target keyword (PH B2B)</th>
                    <th className="py-2">Mentions</th>
                    <th className="py-2">Per 1,000 words</th>
                    <th className="py-2">In title</th>
                    <th className="py-2">In meta description</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.keywords.map((row) => (
                    <tr key={row.keyword} className="border-b">
                      <td className="py-2 font-medium">{row.keyword}</td>
                      <td className="py-2">{row.occurrences}</td>
                      <td className="py-2">{row.per1000Words}</td>
                      <td className="py-2">{row.inTitle ? 'Yes' : 'No'}</td>
                      <td className="py-2">{row.inDescription ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Live search & social rank tracking</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Not connected yet. Rankings need a SERP data provider key (for search engines) and platform analytics access (for social). No rank values are shown until a source is connected.
        </p>
        <ul className="grid gap-2 sm:grid-cols-3">
          {RANK_CHANNELS.map((channel) => (
            <li key={channel} className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm">
              <span className="font-medium">{channel}</span>
              <span className="block text-xs text-zinc-500">Not connected</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
