"use client";

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PricelistCategory } from '../../api/_lib/pricelist-logic';

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
type Row = { min: string; max: string; price: string };
type Draft = { key: string; label: string; active: boolean; rows: Row[] };

const toDraft = (c: PricelistCategory): Draft => ({
  key: c.key,
  label: c.label,
  active: c.active,
  rows: c.tiers.map((t) => ({ min: String(t.min), max: String(t.max), price: String(t.price) })),
});

export default function PricelistAdminPage() {
  const token = useSyncExternalStore(subscribeToken, readToken, () => '');
  const [tokenInput, setTokenInput] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch('/api/admin/pricelist', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) {
          writeToken('');
          setStatus({ _page: 'Admin token rejected.' });
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data?.ok) setDrafts(data.categories.map(toDraft));
      })
      .catch(() => !cancelled && setStatus({ _page: 'Could not load the pricelist.' }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const update = (index: number, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const updateRow = (index: number, rowIndex: number, patch: Partial<Row>) =>
    update(index, { rows: drafts[index].rows.map((r, i) => (i === rowIndex ? { ...r, ...patch } : r)) });

  async function save(index: number) {
    const d = drafts[index];
    setStatus((s) => ({ ...s, [d.key]: 'Saving…' }));
    const body = {
      key: d.key,
      label: d.label,
      active: d.active,
      tiers: d.rows.map((r) => ({ min: Number(r.min), max: Number(r.max), price: Number(r.price) })),
    };
    const res = await fetch('/api/admin/pricelist', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (res?.ok && data?.ok) {
      setStatus((s) => ({ ...s, [d.key]: 'Saved. Live on /quote.' }));
      setDrafts((list) => list.map((x, i) => (i === index ? toDraft(data.category) : x)));
    } else {
      setStatus((s) => ({ ...s, [d.key]: data?.error || 'Save failed.' }));
    }
  }

  function addCategory() {
    const key = newKey.trim().toLowerCase();
    const label = newLabel.trim();
    if (!key || !label) {
      setStatus((s) => ({ ...s, _new: 'Enter a key and a label.' }));
      return;
    }
    if (drafts.some((d) => d.key === key)) {
      setStatus((s) => ({ ...s, _new: 'That key already exists.' }));
      return;
    }
    setDrafts((list) => [...list, { key, label, active: true, rows: [{ min: '1', max: '', price: '' }] }]);
    setNewKey('');
    setNewLabel('');
    setStatus((s) => ({ ...s, _new: '' }));
  }

  if (!token) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">Pricelist admin</h1>
        <p className="mt-2 text-sm text-gray-600">Enter the admin token. It is kept only for this browser tab.</p>
        <input
          type="password"
          className="mt-4 w-full rounded border px-3 py-2"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Admin token"
        />
        <button
          type="button"
          className="mt-3 rounded bg-black px-4 py-2 text-white"
          onClick={() => {
            const value = tokenInput.trim();
            if (!value) return;
            writeToken(value);
            setTokenInput('');
          }}
        >
          Continue
        </button>
        {status._page && <p className="mt-3 text-sm text-red-600">{status._page}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Official pricelist</h1>
        <button
          type="button"
          className="text-sm underline"
          onClick={() => writeToken('')}
        >
          Sign out
        </button>
      </header>
      <p className="text-sm text-gray-600">
        Changes go live on the public /quote page once saved. Tiers must not overlap. Quantities are whole pieces; prices are per piece in PHP.
      </p>
      {status._page && <p className="text-sm text-red-600">{status._page}</p>}

      {drafts.map((d, index) => (
        <section key={d.key} className="rounded border p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              aria-label={`Label for ${d.key}`}
              className="rounded border px-2 py-1 font-medium"
              value={d.label}
              onChange={(e) => update(index, { label: e.target.value })}
            />
            <code className="text-xs text-gray-500">{d.key}</code>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={d.active} onChange={(e) => update(index, { active: e.target.checked })} />
              Active
            </label>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-1">Min qty</th>
                <th>Max qty</th>
                <th>Price per piece (₱)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, rowIndex) => (
                <tr key={rowIndex}>
                  <td><input aria-label="Min quantity" inputMode="numeric" className="w-28 rounded border px-2 py-1" value={r.min} onChange={(e) => updateRow(index, rowIndex, { min: e.target.value })} /></td>
                  <td><input aria-label="Max quantity" inputMode="numeric" className="w-28 rounded border px-2 py-1" value={r.max} onChange={(e) => updateRow(index, rowIndex, { max: e.target.value })} /></td>
                  <td><input aria-label="Price" inputMode="decimal" className="w-28 rounded border px-2 py-1" value={r.price} onChange={(e) => updateRow(index, rowIndex, { price: e.target.value })} /></td>
                  <td>
                    <button type="button" className="text-red-600" onClick={() => update(index, { rows: d.rows.filter((_, i) => i !== rowIndex) })}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => update(index, { rows: [...d.rows, { min: '', max: '', price: '' }] })}>
              Add tier
            </button>
            <button type="button" className="rounded bg-black px-3 py-1 text-sm text-white" onClick={() => save(index)}>
              Save {d.label}
            </button>
            {status[d.key] && <span className="text-sm">{status[d.key]}</span>}
          </div>
        </section>
      ))}

      <section className="rounded border border-dashed p-4 space-y-3">
        <h2 className="font-medium">Add a product category</h2>
        <div className="flex flex-wrap gap-3">
          <input aria-label="New category key" placeholder="key e.g. sports-jersey" className="rounded border px-2 py-1" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <input aria-label="New category label" placeholder="Label" className="rounded border px-2 py-1" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={addCategory}>Add category</button>
        </div>
        {status._new && <p className="text-sm text-red-600">{status._new}</p>}
        <p className="text-xs text-gray-500">Add tiers to the new category, then save it to publish on /quote.</p>
      </section>
    </main>
  );
}
