'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  computeGiveawayQuote,
  seedGiveawayCatalog,
  type GiveawayCatalogCategory,
  type GiveawayQuote,
} from '../../api/_lib/giveaway-quote';

const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-US')}`;

type ServerResult = { quote: GiveawayQuote; paymentTerms: string; paymentDetails: readonly string[]; leadCaptured: boolean };

const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900';
const label = 'mb-1 block text-sm font-semibold text-slate-700';

// Corporate Giveaways instant quotation: official per-item tier pricing, itemized breakdown, 50% deposit math.
export default function GiveawayQuotePage() {
  const [catalog, setCatalog] = useState<GiveawayCatalogCategory[]>(() => seedGiveawayCatalog());
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ServerResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/quote/giveaways', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.ok && Array.isArray(data.categories) && data.categories.length > 0) setCatalog(data.categories);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(
    () =>
      catalog
        .filter((cat) => picked[cat.key])
        .map((cat) => ({ key: cat.key, quantity: Math.floor(Number(quantities[cat.key] ?? cat.moq)) })),
    [catalog, picked, quantities],
  );

  const preview = useMemo(() => {
    if (items.length === 0) return null;
    try {
      return computeGiveawayQuote(items, catalog);
    } catch {
      return null;
    }
  }, [items, catalog]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (items.length === 0) {
      setError('Pick at least one giveaway item below.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/quote/giveaways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName, customerContact, items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not create the estimate.');
        return;
      }
      setResult(data as ServerResult);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-700">CG Venezuela Enterprises · Michael Jeffrey International</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Corporate Giveaways Price Quotation</h1>
        <p className="mt-2 text-slate-600">
          Instant official pricing for branded giveaways — tote bags &amp; backpacks, mugs, lanyards, and enamel pins. Itemized breakdown with a 50%
          deposit, exactly as on our formal quotations.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href="viber://chat?number=%2B639292271761" className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800">Chat on Viber</a>
          <a href="https://t.me/VERCELAI_MJIC_BOT" target="_blank" rel="noopener noreferrer" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">Chat on Telegram</a>
          <a href="/quote" className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">Jackets &amp; uniforms quote →</a>
        </div>
      </header>

      <div className="grid gap-8 md:grid-cols-[1fr_340px]">
        <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <fieldset>
            <legend className={label}>1 · Pick your giveaway items</legend>
            <ul className="divide-y divide-slate-100">
              {catalog.map((cat) => {
                const active = Boolean(picked[cat.key]);
                const qty = Math.floor(Number(quantities[cat.key] ?? cat.moq));
                const unit = active && qty >= cat.moq ? (cat.tiers.find((t) => qty >= t.min && qty <= t.max)?.price ?? null) : null;
                return (
                  <li key={cat.key} className="flex flex-wrap items-center gap-3 py-3">
                    <label className="flex min-w-56 flex-1 items-center gap-2 text-sm font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => setPicked((p) => ({ ...p, [cat.key]: e.target.checked }))}
                      />
                      {cat.label}
                      <span className="text-xs font-normal text-slate-500">MOQ {cat.moq} pcs</span>
                    </label>
                    <input
                      type="number"
                      min={cat.moq}
                      disabled={!active}
                      className={`${field} w-28`}
                      value={quantities[cat.key] ?? cat.moq}
                      onChange={(e) => setQuantities((q) => ({ ...q, [cat.key]: Number(e.target.value) }))}
                      aria-label={`${cat.label} quantity`}
                    />
                    <span className="w-32 text-right text-sm text-slate-600">
                      {active && unit !== null ? `${peso(unit)} /pc` : active ? 'Sales confirms' : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Tote bags and mugs carry the official flat rate at every quantity; volume tiers for very large giveaway runs are confirmed by sales.
            </p>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className={label}>2 · Your details</legend>
            <div>
              <label className="mb-1 block text-sm text-slate-700" htmlFor="name">Name / company</label>
              <input id="name" className={field} value={customerName} onChange={(e) => setCustomerName(e.target.value)} required minLength={2} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-700" htmlFor="contact">Phone or email</label>
              <input id="contact" className={field} value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} />
            </div>
          </fieldset>

          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button type="submit" disabled={submitting || items.length === 0} className="w-full rounded-lg bg-indigo-700 px-5 py-3 font-bold text-white disabled:opacity-60">
            {submitting ? 'Creating estimate…' : 'Create my giveaways quotation'}
          </button>
        </form>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Itemized breakdown</h2>
            {!preview && <p className="mt-2 text-sm text-slate-600">Pick an item on the left to see live official pricing.</p>}
            {preview && (
              <>
                <ul className="mt-3 space-y-2 text-sm">
                  {preview.lines.map((line) => (
                    <li key={line.key} className="flex justify-between gap-2">
                      <span>
                        {line.label} × {line.quantity}
                        {line.flatRate && <span className="block text-xs text-slate-400">flat official rate</span>}
                      </span>
                      <span className="font-semibold">{peso(line.subtotal)}</span>
                    </li>
                  ))}
                </ul>
                <hr className="my-3" />
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between"><dt>Subtotal</dt><dd className="font-bold">{peso(preview.subtotal)}</dd></div>
                  <div className="flex justify-between text-indigo-700"><dt>50% deposit</dt><dd className="font-bold">{peso(preview.deposit)}</dd></div>
                  <div className="flex justify-between text-slate-500"><dt>Balance on delivery</dt><dd>{peso(preview.balance)}</dd></div>
                </dl>
              </>
            )}
          </div>

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5" data-testid="giveaway-result">
              <h2 className="font-bold text-emerald-900">Your official estimate</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Priced from the official 2026 pricelist. Sales confirms artwork, stock, and lead time, then issues your numbered formal quotation.
              </p>
              <ul className="mt-3 space-y-1 text-sm text-slate-800">
                {result.quote.lines.map((line) => (
                  <li key={line.key} className="flex justify-between gap-2">
                    <span>{line.label} × {line.quantity} @ {peso(line.unitPrice)}</span>
                    <span className="font-semibold">{peso(line.subtotal)}</span>
                  </li>
                ))}
              </ul>
              <hr className="my-3 border-emerald-200" />
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt>Subtotal</dt><dd className="font-bold">{peso(result.quote.subtotal)}</dd></div>
                <div className="flex justify-between text-indigo-700"><dt>50% deposit ({result.paymentTerms})</dt><dd className="font-bold">{peso(result.quote.deposit)}</dd></div>
                <div className="flex justify-between text-slate-600"><dt>Balance</dt><dd>{peso(result.quote.balance)}</dd></div>
              </dl>
              <div className="mt-3 rounded-lg bg-white/70 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Deposit payment</p>
                <ul className="mt-1 list-disc pl-4">
                  {result.paymentDetails.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              {result.leadCaptured && <p className="mt-2 text-xs text-emerald-700">Sent to our sales team — we will reach out to confirm stock and artwork.</p>}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
