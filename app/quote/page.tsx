'use client';

import { useEffect, useMemo, useState } from 'react';
import { computeFormalQuote, PAYMENT_TERMS, TERMS } from '../api/_lib/formal-quote';
import { FABRIC_OPTIONS, QUOTE_CATEGORIES, officialUnitPrice, type QuoteCategoryKey } from '../api/_lib/mjic-pricelist';
import { MOQ_PIECES } from '../api/_lib/pricing-logic';

const OTHER = '__other__';
const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-US')}`;
const CATEGORY_KEYS = Object.keys(QUOTE_CATEGORIES) as QuoteCategoryKey[];

type Saved = {
  quoteNumber: string;
  clientToken: string;
  quote: ReturnType<typeof computeFormalQuote>;
};

type HistoryRow = { quote_number: string | null; product_name: string | null; quantity: number; total: number; created_at: string };

export default function QuotePage() {
  const [category, setCategory] = useState<QuoteCategoryKey>('jacket');
  const [quantity, setQuantity] = useState(MOQ_PIECES);
  const [fabricChoice, setFabricChoice] = useState(FABRIC_OPTIONS[0].name);
  const [customFabric, setCustomFabric] = useState('');
  const [fabricClass, setFabricClass] = useState<'A' | 'B' | ''>('');
  const [frontLogos, setFrontLogos] = useState(1);
  const [backLogos, setBackLogos] = useState(0);
  const [reversible, setReversible] = useState(false);
  const [hood, setHood] = useState(false);
  const [threeTone, setThreeTone] = useState(false);
  const [fullSublimation, setFullSublimation] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [productName, setProductName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  const fabricName = fabricChoice === OTHER ? customFabric.trim() : fabricChoice;
  const catalogFabric = FABRIC_OPTIONS.find((f) => f.name === fabricChoice);
  const needsClass = fabricChoice === OTHER || !catalogFabric?.productClass;
  const productClass = needsClass ? fabricClass : catalogFabric?.productClass ?? '';

  const unitPrice = useMemo(() => {
    const qty = Math.floor(Number(quantity));
    return qty >= MOQ_PIECES ? officialUnitPrice(category, qty) : null;
  }, [category, quantity]);

  const preview = useMemo(() => {
    if (unitPrice === null || (productClass !== 'A' && productClass !== 'B')) return null;
    return computeFormalQuote({
      quantity: Math.floor(Number(quantity)),
      marketUnitPrice: unitPrice,
      officialTierPrice: true,
      productClass,
      frontLogos,
      backLogos,
      reversible,
      hood,
      threeTone,
      isTshirt: category === 't-shirt',
      isFullSublimation: fullSublimation,
    });
  }, [unitPrice, productClass, quantity, frontLogos, backLogos, reversible, hood, threeTone, category, fullSublimation]);

  // Returning client: ?client=<token> shows every quote previously issued to them.
  useEffect(() => {
    const client = new URLSearchParams(window.location.search).get('client');
    if (!client || !/^[a-f0-9]{32}$/.test(client)) return;
    fetch(`/api/quote?client=${client}`)
      .then((r) => r.json())
      .then((d) => setHistory(Array.isArray(d.quotes) ? d.quotes : []))
      .catch(() => setHistory([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerContact,
          productName,
          category,
          quantity: Math.floor(Number(quantity)),
          fabric: fabricName,
          productClass: needsClass ? fabricClass : undefined,
          frontLogos,
          backLogos,
          reversible,
          hood,
          threeTone,
          isFullSublimation: fullSublimation,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || 'Could not create the quote.');
        return;
      }
      setSaved({ quoteNumber: data.quoteNumber, clientToken: data.clientToken, quote: data.quote });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900';
  const label = 'mb-1 block text-sm font-semibold text-slate-700';

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-700">CG Venezuela Enterprises · Michael Jeffrey International</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Price Quotation &amp; Formal Quote</h1>
        <p className="mt-2 text-slate-600">Get official MJIC pricing as you type. Your formal quote gets a reference number and a link to your quote history.</p>
      </header>

      {history && (
        <section className="mb-8 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
          <h2 className="text-lg font-bold text-slate-900">Your quotation history</h2>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No quotes found for this link.</p>
          ) : (
            <ul className="mt-3 divide-y divide-indigo-100 text-sm">
              {history.map((h, i) => (
                <li key={`${h.quote_number}-${i}`} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-mono font-semibold">{h.quote_number || 'Quote'}</span>
                  <span>{h.product_name || '—'} · {h.quantity} pcs</span>
                  <span className="font-semibold">{peso(h.total)}</span>
                  <span className="text-slate-500">{new Date(h.created_at).toLocaleDateString('en-PH')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid gap-8 md:grid-cols-[1fr_340px]">
        <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="category">Product category</label>
              <select id="category" className={field} value={category} onChange={(e) => setCategory(e.target.value as QuoteCategoryKey)}>
                {CATEGORY_KEYS.map((k) => (
                  <option key={k} value={k}>{QUOTE_CATEGORIES[k].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="quantity">Quantity (min. {MOQ_PIECES} pcs)</label>
              <input id="quantity" type="number" min={MOQ_PIECES} className={field} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="fabric">Garment class / fabric</label>
              <select id="fabric" className={field} value={fabricChoice} onChange={(e) => setFabricChoice(e.target.value)}>
                {FABRIC_OPTIONS.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
                <option value={OTHER}>Other — type custom fabric</option>
              </select>
            </div>
            {fabricChoice === OTHER && (
              <div>
                <label className={label} htmlFor="custom-fabric">Custom fabric</label>
                <input id="custom-fabric" className={field} value={customFabric} onChange={(e) => setCustomFabric(e.target.value)} placeholder="Type your fabric" required />
              </div>
            )}
            {needsClass && (
              <div>
                <label className={label} htmlFor="fabric-class">Fabric class</label>
                <select id="fabric-class" className={field} value={fabricClass} onChange={(e) => setFabricClass(e.target.value as 'A' | 'B' | '')} required>
                  <option value="">Select class</option>
                  <option value="A">Class A (premium)</option>
                  <option value="B">Class B (standard)</option>
                </select>
              </div>
            )}
          </div>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className={label}>Logo placement &amp; options</legend>
            <div>
              <label className="mb-1 block text-sm text-slate-700" htmlFor="front">Front logos (0–4)</label>
              <input id="front" type="number" min={0} max={4} className={field} value={frontLogos} onChange={(e) => setFrontLogos(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-700" htmlFor="back">Back logos (0–2)</label>
              <input id="back" type="number" min={0} max={2} className={field} value={backLogos} onChange={(e) => setBackLogos(Number(e.target.value))} />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reversible} onChange={(e) => setReversible(e.target.checked)} /> Reversible</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hood} onChange={(e) => setHood(e.target.checked)} /> Hood</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={threeTone} onChange={(e) => setThreeTone(e.target.checked)} /> Three-tone</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fullSublimation} onChange={(e) => setFullSublimation(e.target.checked)} /> Full sublimation</label>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="name">Your name / company</label>
              <input id="name" className={field} value={customerName} onChange={(e) => setCustomerName(e.target.value)} required minLength={2} />
            </div>
            <div>
              <label className={label} htmlFor="contact">Phone or email</label>
              <input id="contact" className={field} value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="product">Product name (optional)</label>
              <input id="product" className={field} value={productName} onChange={(e) => setProductName(e.target.value)} />
            </div>
          </div>

          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button type="submit" disabled={submitting || !fabricName} className="w-full rounded-lg bg-indigo-700 px-5 py-3 font-bold text-white disabled:opacity-60">
            {submitting ? 'Creating quote…' : 'Create formal quote'}
          </button>
        </form>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Live estimate</h2>
            {unitPrice === null && (
              <p className="mt-2 text-sm text-slate-600">
                {quantity < MOQ_PIECES ? `Enter at least ${MOQ_PIECES} pieces.` : `${QUOTE_CATEGORIES[category].label} pricing is confirmed by our sales team. Submit to request a quote.`}
              </p>
            )}
            {unitPrice !== null && (
              <>
                <p className="mt-2 text-sm text-slate-600">Official unit price</p>
                <p className="text-2xl font-bold text-slate-900">{peso(unitPrice)} <span className="text-sm font-normal">/ pc</span></p>
              </>
            )}
            {preview && (
              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between"><dt>Subtotal</dt><dd>{peso(preview.subtotal)}</dd></div>
                <div className="flex justify-between"><dt>Estimated total</dt><dd className="font-bold">{peso(preview.total)}</dd></div>
                <div className="flex justify-between"><dt>50% deposit</dt><dd>{peso(preview.deposit)}</dd></div>
              </dl>
            )}
            {preview === null && unitPrice !== null && (
              <p className="mt-3 text-xs text-slate-500">Select the fabric class to see the full estimate.</p>
            )}
          </div>

          {saved && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
              <h2 className="font-bold text-emerald-900">Quote issued</h2>
              <p className="mt-1 font-mono text-lg font-bold">{saved.quoteNumber}</p>
              <p className="mt-2 text-sm">Total {peso(saved.quote.total)} · Deposit {peso(saved.quote.deposit)}</p>
              <p className="mt-2 text-xs text-slate-600">{PAYMENT_TERMS}. Valid {saved.quote.validDays} days.</p>
              <p className="mt-3 break-all text-xs">
                Your quote history link:{' '}
                <a className="font-semibold text-indigo-700 underline" href={`/quote?client=${saved.clientToken}`}>
                  {`${typeof window !== 'undefined' ? window.location.origin : ''}/quote?client=${saved.clientToken}`}
                </a>
              </p>
              <div className="mt-4 flex items-end gap-6">
                <div className="text-center">
                  <img src={saved.quote.signatory.image} alt={`${saved.quote.signatory.name} signature`} className="h-12" />
                  <p className="text-xs font-semibold">{saved.quote.signatory.name}</p>
                  <p className="text-xs text-slate-600">{saved.quote.signatory.title}</p>
                </div>
              </div>
              <ol className="mt-4 list-decimal space-y-1 pl-4 text-xs text-slate-600">
                {TERMS.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
