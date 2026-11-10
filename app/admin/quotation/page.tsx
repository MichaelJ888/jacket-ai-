'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, type DragEvent, type FormEvent } from 'react';
import { SIGNATORIES, TERMS, VALID_DAYS, PAYMENT_DETAILS, type SignatoryKey } from '../../api/_lib/formal-quote';
import { resolveFabricClass } from '../../api/_lib/fabric-class';
import { FABRIC_OPTIONS } from '../../api/_lib/mjic-pricelist';
import { EMPTY_FORM, applyDesignScan, formatPeso, toRequestBody, type DesignScan, type QuoteForm } from './quotation-logic';

type Quote = {
  total: number;
  deposit: number;
  balance: number;
  subtotal: number;
  discount: number;
  garmentUnit: number;
  unitPrice: number;
  programFee: number;
  volumeDiscountPct: number;
  quantity: number;
  addOns: { classASurcharge: number; extraFrontLogos: number; backLogos: number; reversible: number; hood: number; threeTone: number; perPiece: number };
  paymentTerms: string;
  signatory: { key: SignatoryKey; name: string; title: string; image: string };
};
type SaveResult = { quoteId: string; createdAt: string; quote: Quote };

const FIELD = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none';
const LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-600';

export default function QuotationPage() {
  const [form, setForm] = useState<QuoteForm>(EMPTY_FORM);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SaveResult | null>(null);

  const set = <K extends keyof QuoteForm>(key: K, value: QuoteForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function scanFile(file: File | undefined) {
    if (!file) return;
    setScanning(true);
    setScanNote('');
    setError('');
    const body = new FormData();
    body.append('image', file);
    const res = await fetch('/api/costing/scan-design', { method: 'POST', body, cache: 'no-store' }).catch(() => null);
    setScanning(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !data?.detected) {
      setScanNote(data?.error || 'Design scan failed. Enter the counts manually.');
      return;
    }
    setForm((f) => applyDesignScan(f, data.detected as DesignScan));
    setScanNote(`AI counted ${data.detected.frontLogos} front / ${data.detected.backLogos} back. ${data.detected.notes}`.trim());
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    void scanFile(event.dataTransfer.files?.[0]);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setResult(null);
    const res = await fetch('/api/costing/formal-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toRequestBody(form)),
      cache: 'no-store',
    }).catch(() => null);
    setSaving(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !data?.ok) {
      setError(data?.error || 'Could not save the quote.');
      return;
    }
    setResult({ quoteId: data.quoteId, createdAt: data.createdAt, quote: data.quote });
  }

  const q = result?.quote;
  const sig = q?.signatory ?? SIGNATORIES[form.signatory];

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold text-zinc-900">Formal Quotation</h1>
        <Link href="/admin" className="text-sm text-zinc-600 underline">Back to Admin</Link>
      </div>

      <form onSubmit={save} className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-2 print:hidden">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-600 md:col-span-2"
        >
          <span className="font-semibold text-zinc-900">{scanning ? 'Scanning design…' : 'Drop a design mockup here, or click to choose'}</span>
          <span className="text-xs">PNG, JPEG or WEBP, up to 5 MB. AI counts the logos; you confirm the values below.</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => scanFile(e.target.files?.[0])} />
        </label>
        {scanNote && <p className="text-xs text-zinc-600 md:col-span-2">{scanNote}</p>}

        <div><label className={LABEL}>Customer name *</label><input className={FIELD} required value={form.customerName} onChange={(e) => set('customerName', e.target.value)} /></div>
        <div><label className={LABEL}>Contact (phone or email)</label><input className={FIELD} value={form.customerContact} onChange={(e) => set('customerContact', e.target.value)} /></div>
        <div><label className={LABEL}>Product</label><input className={FIELD} value={form.productName} onChange={(e) => set('productName', e.target.value)} /></div>
        <div><label className={LABEL}>Quantity (min 20) *</label><input className={FIELD} type="number" min={20} required value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></div>
        <div><label className={LABEL}>Market unit price (PHP) *</label><input className={FIELD} type="number" min={1} step="0.01" required value={form.marketUnitPrice} onChange={(e) => set('marketUnitPrice', e.target.value)} /></div>
        <div><label className={LABEL}>Cost per piece (optional)</label><input className={FIELD} type="number" min={0} step="0.01" value={form.costPerPiece} onChange={(e) => set('costPerPiece', e.target.value)} /></div>
        <div>
          <label className={LABEL}>Fabric (class is set automatically)</label>
          <input className={FIELD} list="fabric-options" required value={form.fabric} onChange={(e) => set('fabric', e.target.value)} />
          <datalist id="fabric-options">
            {FABRIC_OPTIONS.map((f) => <option key={f.name} value={f.name} />)}
          </datalist>
          <p className="mt-1 text-xs text-zinc-500">
            {resolveFabricClass(form.fabric) === 'B' ? 'Class B: no surcharge' : 'Class A: +₱300/pc'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LABEL}>Front logos</label><input className={FIELD} type="number" min={0} value={form.frontLogos} onChange={(e) => set('frontLogos', e.target.value)} /></div>
          <div><label className={LABEL}>Back logos</label><input className={FIELD} type="number" min={0} value={form.backLogos} onChange={(e) => set('backLogos', e.target.value)} /></div>
        </div>
        <div><label className={LABEL}>Discount (fixed ₱ off the total)</label><input className={FIELD} type="number" min={0} step="1" value={form.discountPesos} onChange={(e) => set('discountPesos', e.target.value)} /></div>
        <div>
          <label className={LABEL}>Signatory</label>
          <select className={FIELD} value={form.signatory} onChange={(e) => set('signatory', e.target.value as SignatoryKey)}>
            {(Object.keys(SIGNATORIES) as SignatoryKey[]).map((key) => (
              <option key={key} value={key}>{SIGNATORIES[key].name} — {SIGNATORIES[key].title}</option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-wrap gap-4 text-sm text-zinc-800 md:col-span-2">
          {([
            ['reversible', 'Reversible'],
            ['hood', 'Hood'],
            ['threeTone', 'Three-tone'],
            ['isTshirt', 'T-shirt'],
            ['isFullSublimation', 'Full sublimation'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
              {label}
            </label>
          ))}
        </fieldset>

        {error && <p className="text-sm text-red-700 md:col-span-2">{error}</p>}
        <button type="submit" disabled={saving} className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 md:col-span-2">
          {saving ? 'Calculating and saving…' : 'Calculate, save to CRM, and generate quote'}
        </button>
      </form>

      {q && result && (
        <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900 shadow-sm print:border-0 print:shadow-none">
          <div className="flex items-start justify-between gap-4 print:hidden">
            <p className="text-xs text-zinc-500">Saved as quote {result.quoteId} · CRM contact updated</p>
            <button type="button" onClick={() => window.print()} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">Print / Save PDF</button>
          </div>
          <header>
            <div className="flex flex-wrap items-center gap-4 border-b-2 border-[#B8912F] pb-3">
              <Image
                src="/branding/mjic-official-logo.webp"
                alt="Michael Jeffrey International Corporation official logo"
                width={1408}
                height={768}
                priority
                className="h-auto w-36 sm:w-44"
              />
              <div>
                <h2 className="text-lg font-bold text-[#0B1E3D]">MICHAEL JEFFREY INTERNATIONAL CORPORATION</h2>
                <p className="text-sm font-semibold text-[#9C7521]">Custom Jackets and more</p>
                <p className="mt-1 text-xs text-zinc-600">CG Venezuela Enterprises · Create. Enhance. and Sustain.</p>
                <p className="text-xs text-zinc-600">22 Bayabas St., Elmar&apos;s Subdivision, Cupang, Antipolo City</p>
              </div>
            </div>
            <p className="mt-2 text-sm">Prepared for: <strong>{form.customerName}</strong> · {new Date(result.createdAt).toLocaleDateString('en-PH')} · Valid for {VALID_DAYS} days</p>
          </header>
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-zinc-600">
              <tr><th className="py-1">Description</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Unit</th><th className="py-1 text-right">Total</th></tr>
            </thead>
            <tbody>
              <tr className="border-b"><td className="py-1">{form.productName || 'Customized garment'} ({resolveFabricClass(form.fabric) === 'A' ? 'Class A' : 'Class B'})</td><td className="text-right">{q.quantity}</td><td className="text-right">{formatPeso(q.unitPrice)}</td><td className="text-right">{formatPeso(q.unitPrice * q.quantity)}</td></tr>
              {q.programFee > 0 && <tr className="border-b"><td className="py-1">1-Time Embroidery Digitizing / Program Fee</td><td className="text-right">1 lot</td><td /><td className="text-right">{formatPeso(q.programFee)}</td></tr>}
            </tbody>
          </table>
          <dl className="ml-auto grid w-full max-w-sm grid-cols-2 gap-1 text-sm">
            <dt>Subtotal</dt><dd className="text-right">{formatPeso(q.subtotal)}</dd>
            {q.discount > 0 && <><dt>Discount</dt><dd className="text-right">-{formatPeso(q.discount)}</dd></>}
            <dt className="font-bold">Total</dt><dd className="text-right font-bold">{formatPeso(q.total)}</dd>
            <dt>Deposit (50%)</dt><dd className="text-right">{formatPeso(q.deposit)}</dd>
            <dt>Balance</dt><dd className="text-right">{formatPeso(q.balance)}</dd>
          </dl>
          <p className="text-sm">Payment Terms: {q.paymentTerms}</p>
          <div className="text-xs text-zinc-700">
            <p className="font-semibold">General Terms and Conditions</p>
            <ol className="list-decimal space-y-1 pl-5">{TERMS.map((t) => <li key={t}>{t}</li>)}</ol>
          </div>
          <div className="text-xs text-zinc-700">
            <p className="font-semibold">For Payment</p>
            {PAYMENT_DETAILS.map((line) => <p key={line}>{line}</p>)}
          </div>
          <div className="flex flex-col items-start gap-1 pt-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sig.image} alt={`${sig.name} signature`} className="h-16 w-auto" />
            <p className="border-t border-zinc-400 pt-1 text-sm font-semibold">{sig.name}</p>
            <p className="text-xs text-zinc-600">{sig.title}</p>
          </div>
        </section>
      )}
    </main>
  );
}
