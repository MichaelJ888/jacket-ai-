"use client";

import { useCallback, useEffect, useState } from "react";
import CooPanel from "./coo-panel";
import RecipientsPanel from "./recipients-panel";
import AnalyticsDashboard from "./analytics-dashboard";

type Price = { key: string; name: string; category: string; unit: string; unit_cost: number; supplier_name: string | null; updated_at: string };
type Overview = {
  priceBook: Array<{ style: string; selling_price: number; target_margin_pct: number; labor_cost: number }>;
  costings: Array<{ id: string; client_name: string | null; project_name: string | null; style: string; quantity: number; total_cost: number; status: string }>;
  purchaseOrders: Array<{ po_number: string; supplier_name: string; material_type: string; total_cost: number; status: string }>;
  quotes: Array<{ quote_number: string; client_name: string | null; total: number }>;
  receipts: Array<{ reference: string | null; detected_amount: number | null; verified: boolean; fraud_score: number; fraud_flags: string[] }>;
};
type KnowledgeItem = { id: string; category: string; title: string; content: string; file_name: string | null; mime_type: string | null; created_at: string; asset_url: string | null };

const STYLES = ["windbreaker", "varsity", "corporate", "bomber"];
const input = "rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900";
const button = "rounded bg-zinc-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<"dashboard" | "prices" | "book" | "teach" | "knowledge" | "overview" | "connect" | "coo" | "recipients">("dashboard");
  const [pages, setPages] = useState<Array<{ page_id: string; page_name: string | null; ig_user_id: string | null; webhook_subscribed: boolean; subscribe_error: string | null }>>([]);
  const [oauthConfigured, setOauthConfigured] = useState(true);
  const [setup, setSetup] = useState<Array<{ id: string; label: string; ok: boolean; manual?: boolean; hint?: string; link?: string }>>([]);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string | null; email: string | null; plan: string }>>([]);
  const [plans, setPlans] = useState<string[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({ name: "", category: "fabric", unit: "yards", unitCost: "", supplierName: "" });
  const [audience, setAudience] = useState("client");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [knowledgeCategory, setKnowledgeCategory] = useState("faq");
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null);

  const call = useCallback(async (path: string, init: RequestInit = {}, auth = token) => {
    const response = await fetch(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${auth}` }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }, [token]);

  const refresh = useCallback(async (auth = token) => {
    const [p, o] = await Promise.all([call("/api/admin/prices", {}, auth), call("/api/admin/overview", {}, auth)]);
    if (p.ok) setPrices(p.data.prices);
    if (o.ok) setOverview(o.data);
    return p.ok;
  }, [call, token]);

  const loadKnowledge = useCallback(async (auth = token) => {
    const result = await call("/api/admin/knowledge", {}, auth);
    if (result.ok) setKnowledgeItems(result.data.items);
    else setMessage(result.data.error || "Could not load the knowledge base.");
  }, [call, token]);

  const loadPages = useCallback(async (auth = token) => {
    const r = await call("/api/meta/connections", {}, auth);
    if (r.ok) { setPages(r.data.pages); setOauthConfigured(r.data.oauthConfigured); }
    const [s, t] = await Promise.all([call("/api/admin/meta-setup", {}, auth), call("/api/admin/tenants", {}, auth)]);
    if (s.ok) setSetup(s.data.checks);
    if (t.ok) { setTenants(t.data.tenants); setPlans(Object.keys(t.data.plans)); }
  }, [call, token]);

  async function registerCallbacks() {
    const r = await call("/api/admin/meta-setup", { method: "POST" });
    if (r.ok) { setSetup(r.data.checks); setMessage(r.data.registered.ok ? "Callbacks registered." : `Could not register: ${r.data.registered.error}`); }
  }

  async function saveKnowledge() {
    const form = new FormData();
    form.set("category", knowledgeCategory);
    form.set("title", knowledgeTitle);
    form.set("content", knowledgeContent);
    if (knowledgeFile) form.set("file", knowledgeFile);
    const result = await call("/api/admin/knowledge", { method: "POST", body: form });
    if (!result.ok) return setMessage(result.data.error || "Knowledge upload failed.");
    setMessage(`Saved "${result.data.item.title}" to the knowledge base.`);
    setKnowledgeTitle("");
    setKnowledgeContent("");
    setKnowledgeFile(null);
    await loadKnowledge();
  }

  async function removeKnowledge(id: string) {
    const result = await call(`/api/admin/knowledge?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setMessage(result.ok ? "Knowledge item removed." : result.data.error || "Could not remove the knowledge item.");
    if (result.ok) await loadKnowledge();
  }

  async function changePlan(id: string, plan: string) {
    const r = await call("/api/admin/tenants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, plan }) });
    setMessage(r.ok ? "Plan updated." : r.data.error || "Failed.");
    void loadPages();
  }

  async function connectMeta() {
    const r = await call("/api/meta/oauth/start", { method: "POST" });
    if (r.ok && r.data.url) window.location.href = r.data.url;
    else setMessage(r.data.error || "Could not start Facebook login.");
  }

  async function disconnectMeta(pageId: string) {
    const r = await call(`/api/meta/connections?pageId=${encodeURIComponent(pageId)}`, { method: "DELETE" });
    setMessage(r.ok ? "Page disconnected." : r.data.error || "Failed to disconnect.");
    void loadPages();
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("meta")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab("connect");
      setMessage(params.get("meta") === "connected"
        ? `Connected ${params.get("pages")} Page(s). ${params.get("failed") !== "0" ? `${params.get("failed")} could not auto-subscribe the webhook.` : "Webhooks subscribed automatically."}`
        : `Facebook connection failed: ${params.get("reason") || "unknown error"}`);
      window.history.replaceState(null, "", "/admin");
    }
    const saved = sessionStorage.getItem("mjic_admin");
    if (saved) {
      void (async () => {
        const response = await fetch("/api/admin/prices", { headers: { Authorization: `Bearer ${saved}` } });
        if (response.ok) { setToken(saved); setPrices((await response.json()).prices); setAuthed(true); void refresh(saved); void loadPages(saved); void loadKnowledge(saved); }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login() {
    if (await refresh(token)) { sessionStorage.setItem("mjic_admin", token); setAuthed(true); setMessage(""); void loadPages(token); void loadKnowledge(token); }
    else setMessage("Wrong password.");
  }

  async function savePrice(row: { name: string; key?: string; category: string; unit: string; unitCost: number; supplierName?: string | null }) {
    const result = await call("/api/admin/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) });
    setMessage(result.ok ? `Saved ${row.name}` : result.data.error || "Save failed");
    await refresh();
  }

  async function removePrice(key: string) {
    if (!confirm("Delete this material?")) return;
    await call(`/api/admin/prices?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    await refresh();
  }

  async function savePriceBook(row: { style: string; sellingPrice: number; targetMarginPct: number; laborCost: number }) {
    const result = await call("/api/admin/price-book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) });
    setMessage(result.ok ? `Saved ${row.style}` : result.data.error || "Save failed");
    await refresh();
  }

  async function teach(preview: boolean) {
    const form = new FormData();
    form.set("audience", audience);
    form.set("text", pasted);
    if (file) form.set("file", file);
    const result = await call(`/api/admin/voice${preview ? "?preview=1" : ""}`, { method: "POST", body: form });
    if (!result.ok) return setMessage(result.data.error || "Upload failed");
    setMessage(preview ? `Found ${result.data.found} examples. First: ${JSON.stringify(result.data.sample?.[0] || {})}` : `Saved ${result.data.saved} examples for ${result.data.audience}.`);
    if (!preview) { setPasted(""); setFile(null); }
  }

  async function draftPos(id: string) {
    const result = await call("/api/costing/po", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ costingId: id }) });
    setMessage(result.ok ? `Drafted ${result.data.drafted.length} POs (skipped ${result.data.skipped.length})` : result.data.error || "Failed");
    await refresh();
  }

  if (!authed) {
    return (
      <main className="mx-auto max-w-sm p-8">
        <h1 className="mb-4 text-xl font-bold">MJIC Admin</h1>
        <input className={`${input} w-full`} type="password" placeholder="Admin password" value={token} onChange={(event) => setToken(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void login()} />
        <button className={`${button} mt-3`} onClick={() => void login()}>Sign in</button>
        {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
      </main>
    );
  }

  const peso = (value: number) => `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

  return (
    <main className="mx-auto max-w-5xl p-6 text-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">MJIC Admin</h1>
        <div className="flex items-center gap-4">
          <a className="text-sm underline" href="/admin/editor">Visual editor</a>
          <a className="text-sm underline" href="/admin/video-mockups">Local video mockups</a>
          <button className="text-sm underline" onClick={() => { sessionStorage.removeItem("mjic_admin"); setAuthed(false); setToken(""); }}>Sign out</button>
        </div>
      </div>
      <nav className="mb-4 flex gap-2">
        {([["dashboard", "Dashboard"], ["prices", "Material prices"], ["book", "Selling prices"], ["teach", "Teach the AI"], ["knowledge", "Knowledge Base"], ["overview", "Overview"], ["connect", "Connect Facebook / Instagram"], ["coo", "COO & all customers"], ["recipients", "Telegram recipients"]] as const).map(([id, label]) => (
          <button key={id} className={`rounded px-3 py-1 text-sm ${tab === id ? "bg-zinc-900 text-white" : "bg-zinc-200"}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {message && <p className="mb-3 rounded bg-amber-100 p-2 text-sm">{message}</p>}

      {tab === "dashboard" && <AnalyticsDashboard token={token} />}
      {tab === "coo" && <CooPanel token={token} />}
      {tab === "recipients" && <RecipientsPanel token={token} />}
      {tab === "connect" && (
        <section>
          <p className="mb-3 text-sm text-zinc-600">One click: log in to Facebook, pick your Pages, and we save the long-lived Page token and subscribe the webhook automatically.</p>
          <button className="rounded bg-blue-600 px-6 py-3 text-base font-semibold text-white disabled:opacity-50" disabled={!oauthConfigured} onClick={connectMeta}>Connect Facebook / Instagram</button>
          {!oauthConfigured && <p className="mt-2 text-sm text-red-600">META_APP_ID and META_APP_SECRET are not set on the server.</p>}
          <h3 className="mb-1 mt-5 text-sm font-semibold">Meta setup doctor</h3>
          <ul className="space-y-1 text-sm">
            {setup.map((c) => (
              <li key={c.id}>
                {c.manual ? "☐" : c.ok ? "✅" : "❌"} {c.label}
                {c.hint && !c.ok ? <span className="block pl-6 text-xs text-zinc-600">{c.hint}{c.link ? <> <a className="underline" href={c.link} target="_blank" rel="noreferrer">Open</a></> : null}</span> : null}
              </li>
            ))}
          </ul>
          <button className="mt-2 rounded bg-zinc-900 px-3 py-1 text-sm text-white" onClick={registerCallbacks}>Register callbacks</button>
          <h3 className="mb-1 mt-5 text-sm font-semibold">Buyers</h3>
          <ul className="space-y-1 text-sm">
            {tenants.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded border border-zinc-200 p-2">
                <span>{t.name || "(no name)"} <span className="text-xs text-zinc-500">{t.email}</span></span>
                <select className="rounded border border-zinc-300 px-1 text-xs" value={t.plan} onChange={(e) => void changePlan(t.id, e.target.value)}>{plans.map((p) => <option key={p} value={p}>{p}</option>)}</select>
              </li>
            ))}
            {!tenants.length && <li className="text-xs text-zinc-500">No buyers yet.</li>}
          </ul>          <ul className="mt-4 space-y-2">
            {pages.map((page) => (
              <li key={page.page_id} className="flex items-center justify-between rounded border border-zinc-200 p-3 text-sm">
                <span>
                  <strong>{page.page_name || page.page_id}</strong>
                  {page.ig_user_id && <span className="ml-2 rounded bg-pink-100 px-2 py-0.5 text-xs">Instagram linked</span>}
                  <span className={`ml-2 rounded px-2 py-0.5 text-xs ${page.webhook_subscribed ? "bg-green-100" : "bg-red-100"}`}>{page.webhook_subscribed ? "Webhook active" : `Webhook failed${page.subscribe_error ? `: ${page.subscribe_error}` : ""}`}</span>
                </span>
                <button className="text-red-600 underline" onClick={() => disconnectMeta(page.page_id)}>Disconnect</button>
              </li>
            ))}
            {!pages.length && <li className="text-sm text-zinc-500">No Pages connected yet.</li>}
          </ul>
        </section>
      )}

      {tab === "knowledge" && (
        <section className="space-y-3">
          <p className="text-sm text-zinc-600">Upload client Q&amp;A, Boss Richard tone guidance, catalog/product images, size charts, material costs, and supplier lists. Supplier and internal-cost records stay out of customer-facing AI prompts.</p>
          <div className="flex flex-wrap gap-2">
            <select className={input} value={knowledgeCategory} onChange={(event) => setKnowledgeCategory(event.target.value)}>
              <option value="faq">Client Q&amp;A</option><option value="tone">Tone guidance</option><option value="product">Product/catalog</option>
              <option value="size_chart">Size chart</option><option value="internal_cost">Internal material costs</option><option value="supplier">Supplier list</option><option value="template">Template (internal)</option>
            </select>
            <input className={input} placeholder="Title" maxLength={120} value={knowledgeTitle} onChange={(event) => setKnowledgeTitle(event.target.value)} />
            <input key={knowledgeFile?.name || "empty"} type="file" accept=".txt,.docx,.pdf,.xlsx,.jpg,.jpeg,.png,.webp" onChange={(event) => setKnowledgeFile(event.target.files?.[0] || null)} />
          </div>
          <textarea className={`${input} h-36 w-full`} maxLength={20000} placeholder="Paste facts, Q&A, or a short image description (optional when a document is uploaded)." value={knowledgeContent} onChange={(event) => setKnowledgeContent(event.target.value)} />
          <button className={button} disabled={!knowledgeTitle.trim() || (!knowledgeContent.trim() && !knowledgeFile)} onClick={() => void saveKnowledge()}>Save knowledge item</button>
          <h2 className="pt-4 font-semibold">Saved knowledge</h2>
          <div className="space-y-2">
            {knowledgeItems.map((item) => (
              <article key={item.id} className="flex items-start justify-between gap-3 rounded border border-zinc-200 p-3 text-sm">
                <div>
                  <strong>{item.title}</strong><span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs">{item.category}</span>
                  {item.file_name && <p className="text-xs text-zinc-500">{item.file_name}</p>}
                  {item.asset_url && <p><a className="text-xs underline" href={item.asset_url} target="_blank" rel="noreferrer">Preview private image (link expires in 5 minutes)</a></p>}
                  <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600">{item.content.slice(0, 500)}</p>
                </div>
                <button className="shrink-0 text-xs text-red-600 underline" onClick={() => void removeKnowledge(item.id)}>Delete</button>
              </article>
            ))}
            {!knowledgeItems.length && <p className="text-sm text-zinc-500">No knowledge items uploaded.</p>}
          </div>
        </section>
      )}

      {tab === "prices" && (
        <section>
          <p className="mb-2 text-sm text-zinc-600">Edit any price and press Save. The BOM/costing, supplier POs and pricing advice all use these prices (history is kept).</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th>Material</th><th>Category</th><th>Unit</th><th>Cost / unit</th><th>Supplier</th><th /></tr></thead>
            <tbody>
              {prices.map((row) => <PriceRowEditor key={`${row.key}-${row.updated_at}`} row={row} onSave={savePrice} onDelete={removePrice} />)}
              <tr className="border-t">
                <td><input className={input} placeholder="New material" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
                <td><select className={input} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{["fabric", "accessory", "trim", "other"].map((c) => <option key={c}>{c}</option>)}</select></td>
                <td><input className={`${input} w-20`} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></td>
                <td><input className={`${input} w-24`} type="number" value={draft.unitCost} onChange={(e) => setDraft({ ...draft, unitCost: e.target.value })} /></td>
                <td><input className={input} value={draft.supplierName} onChange={(e) => setDraft({ ...draft, supplierName: e.target.value })} /></td>
                <td><button className={button} disabled={!draft.name || draft.unitCost === ""} onClick={() => { void savePrice({ name: draft.name, category: draft.category, unit: draft.unit, unitCost: Number(draft.unitCost), supplierName: draft.supplierName }); setDraft({ ...draft, name: "", unitCost: "" }); }}>Add</button></td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {tab === "book" && (
        <section>
          <p className="mb-2 text-sm text-zinc-600">Your selling price per piece, labor cost and target margin per style. Used by pricing advice (it only recommends; it never changes the chat prices by itself).</p>
          {STYLES.map((style) => <BookRow key={style} style={style} current={overview?.priceBook.find((row) => row.style === style)} onSave={savePriceBook} />)}
        </section>
      )}

      {tab === "teach" && (
        <section className="space-y-3">
          <p className="text-sm text-zinc-600">Upload your Word (.docx) or .txt client-safe chat/Q&amp;A file, and/or paste text. Use lines like <code>Client: ...</code> and <code>Me: ...</code> (or <code>Q:</code>/<code>A:</code>). Without those markers each paragraph is saved as one of your replies. Put supplier lists and internal costs in the Knowledge Base&apos;s internal categories instead.</p>
          <select className={input} value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="client">Replies to clients</option><option value="employee">Replies to employees</option><option value="supplier">Replies to suppliers</option>
          </select>
          <div><input type="file" accept=".docx,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
          <textarea className={`${input} h-48 w-full`} placeholder="Or paste Q&A here" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <div className="flex gap-2"><button className={button} onClick={() => void teach(true)}>Preview</button><button className={button} onClick={() => void teach(false)}>Save to AI memory</button></div>
        </section>
      )}

      {tab === "overview" && overview && (
        <section className="space-y-6 text-sm">
          <List title="Recent costings / BOMs" rows={overview.costings.map((c) => ({ id: c.id, text: `${c.client_name || c.project_name || c.style} · ${c.quantity} pcs · ${peso(c.total_cost)} · ${c.status}` }))} action={{ label: "Draft POs", run: draftPos }} />
          <List title="Supplier POs" rows={overview.purchaseOrders.map((p) => ({ id: p.po_number, text: `${p.po_number} · ${p.supplier_name} · ${p.material_type} · ${peso(p.total_cost)} · ${p.status}` }))} />
          <List title="PDF quotes" rows={overview.quotes.map((q) => ({ id: q.quote_number, text: `${q.quote_number} · ${q.client_name || ""} · ${peso(q.total)}` }))} />
          <List title="Payment receipts (fraud check)" rows={overview.receipts.map((r, i) => ({ id: String(i), text: `${r.reference || "no ref"} · ${peso(r.detected_amount || 0)} · ${r.verified ? "verified" : "NOT verified"} · risk ${r.fraud_score}${r.fraud_flags?.length ? ` · ${r.fraud_flags.join(", ")}` : ""}` }))} />
        </section>
      )}
    </main>
  );
}

function PriceRowEditor({ row, onSave, onDelete }: { row: Price; onSave: (row: { name: string; key: string; category: string; unit: string; unitCost: number; supplierName: string }) => void; onDelete: (key: string) => void }) {
  const [cost, setCost] = useState(String(row.unit_cost));
  const [supplier, setSupplier] = useState(row.supplier_name || "");
  return (
    <tr className="border-t">
      <td>{row.name}</td><td>{row.category}</td><td>{row.unit}</td>
      <td><input className={`${input} w-24`} type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></td>
      <td><input className={input} value={supplier} onChange={(e) => setSupplier(e.target.value)} /></td>
      <td className="space-x-2"><button className={button} onClick={() => onSave({ name: row.name, key: row.key, category: row.category, unit: row.unit, unitCost: Number(cost), supplierName: supplier })}>Save</button><button className="text-xs text-red-600" onClick={() => onDelete(row.key)}>Delete</button></td>
    </tr>
  );
}

function BookRow({ style, current, onSave }: { style: string; current?: { selling_price: number; target_margin_pct: number; labor_cost: number }; onSave: (row: { style: string; sellingPrice: number; targetMarginPct: number; laborCost: number }) => void }) {
  const [price, setPrice] = useState(String(current?.selling_price ?? 0));
  const [margin, setMargin] = useState(String(current?.target_margin_pct ?? 35));
  const [labor, setLabor] = useState(String(current?.labor_cost ?? 0));
  return (
    <div className="mb-2 flex items-center gap-2 text-sm">
      <span className="w-28 capitalize">{style}</span>
      <label>Price <input className={`${input} w-24`} type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label>Labor <input className={`${input} w-24`} type="number" value={labor} onChange={(e) => setLabor(e.target.value)} /></label>
      <label>Margin % <input className={`${input} w-20`} type="number" value={margin} onChange={(e) => setMargin(e.target.value)} /></label>
      <button className={button} onClick={() => onSave({ style, sellingPrice: Number(price), targetMarginPct: Number(margin), laborCost: Number(labor) })}>Save</button>
    </div>
  );
}

function List({ title, rows, action }: { title: string; rows: Array<{ id: string; text: string }>; action?: { label: string; run: (id: string) => void } }) {
  return (
    <div>
      <h2 className="mb-1 font-semibold">{title}</h2>
      {rows.length === 0 && <p className="text-zinc-500">Nothing yet.</p>}
      {rows.map((row) => <div key={row.id} className="flex items-center justify-between border-t py-1"><span>{row.text}</span>{action && <button className="text-xs underline" onClick={() => action.run(row.id)}>{action.label}</button>}</div>)}
    </div>
  );
}
