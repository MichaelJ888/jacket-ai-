"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { describeError, parseOAuthMessage, wizardStep } from "./connect-logic";
import AssistantPanel from "./assistant-panel";

type Tenant = { name: string | null; email: string | null; plan: string; pageLimit: number };
type Page = { page_id: string; page_name: string | null; ig_user_id: string | null; webhook_subscribed: boolean; subscribe_error: string | null };
type Check = { id: string; label: string; ok: boolean; hint?: string };
type Health = { healthy: boolean; checks: Check[] };

const STEPS = ["Log in to Facebook", "Choose your Pages", "Webhook check", "Done"];
const json = { "Content-Type": "application/json" };

export default function ConnectPage() {
  const [loaded, setLoaded] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [configured, setConfigured] = useState(true);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [request, setRequest] = useState({ name: "", contact: "", note: "" });
  const [requested, setRequested] = useState(false);

  const checkHealth = useCallback(async (pageId: string, resubscribe = false) => {
    const r = await fetch(resubscribe ? "/api/meta/connections/health" : `/api/meta/connections/health?pageId=${encodeURIComponent(pageId)}`, resubscribe ? { method: "POST", headers: json, body: JSON.stringify({ pageId }) } : { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    setHealth((current) => ({ ...current, [pageId]: { healthy: data.healthy, checks: data.checks } }));
  }, []);

  const load = useCallback(async () => {
    const session = await (await fetch("/api/meta/session", { cache: "no-store" })).json().catch(() => ({}));
    setConfigured(session.oauthConfigured !== false);
    setTenant(session.tenant || null);
    if (session.tenant) {
      const r = await fetch("/api/meta/connections", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        setPages(data.pages);
        await Promise.all((data.pages as Page[]).map((page) => checkHealth(page.page_id)));
      }
    } else setPages([]);
    setLoaded(true);
  }, [checkHealth]);

  const handleResult = useCallback((result: ReturnType<typeof parseOAuthMessage>) => {
    if (!result) return;
    setConnecting(false);
    if (result.status === "connected") {
      const extra = [
        result.failed ? `${result.failed} could not subscribe the webhook - use Re-subscribe.` : "",
        result.limit ? "Some Pages were not added because your plan's Page limit is reached." : "",
        result.skipped && !result.limit ? "Some Pages already belong to another account." : "",
      ].filter(Boolean).join(" ");
      setNotice({ kind: "ok", text: `Connected ${result.pages} Page(s). ${extra}`.trim() });
    } else setNotice({ kind: "error", text: describeError(result.reason) });
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("meta")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleResult(parseOAuthMessage({ type: "mjic-meta-oauth", ...Object.fromEntries(params) }, window.location.origin, window.location.origin));
      window.history.replaceState(null, "", "/dashboard/connect");
    } else void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => handleResult(parseOAuthMessage(event.data, event.origin, window.location.origin));
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [handleResult]);

  async function connect() {
    setNotice(null);
    // Open synchronously so the browser doesn't treat the popup as unsolicited.
    const popup = window.open("about:blank", "mjic-fb-login", "width=640,height=760");
    const r = await fetch("/api/meta/oauth/start", { method: "POST", headers: json, body: JSON.stringify({ context: popup ? "popup" : "connect" }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) {
      popup?.close();
      setNotice({ kind: "error", text: data.error || "Could not start Facebook login." });
      return;
    }
    setConnecting(true);
    if (popup) {
      popup.location.href = data.url;
      const timer = window.setInterval(() => { if (popup.closed) { window.clearInterval(timer); setConnecting(false); void load(); } }, 800);
    } else window.location.href = data.url;
  }

  async function disconnect(pageId: string) {
    const r = await fetch(`/api/meta/connections?pageId=${encodeURIComponent(pageId)}`, { method: "DELETE" });
    setNotice(r.ok ? { kind: "ok", text: "Page disconnected." } : { kind: "error", text: "Failed to disconnect." });
    void load();
  }

  async function signOut() {
    await fetch("/api/meta/session", { method: "DELETE" });
    setNotice(null);
    void load();
  }

  async function sendRequest() {
    const r = await fetch("/api/meta/access-request", { method: "POST", headers: json, body: JSON.stringify(request) });
    const data = await r.json().catch(() => ({}));
    if (r.ok) setRequested(true);
    else setNotice({ kind: "error", text: data.error || "Could not send your request." });
  }

  const step = useMemo(() => wizardStep(pages, connecting, Object.fromEntries(Object.entries(health).map(([id, h]) => [id, h.healthy]))), [pages, connecting, health]);

  if (!loaded) return <main className="mx-auto max-w-2xl p-6 text-sm text-zinc-500">Loading...</main>;

  return (
    <main className="mx-auto max-w-2xl p-6 text-zinc-900">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Connect your Facebook / Instagram</h1>
          <p className="mt-1 text-sm text-zinc-600">One click. We save your Page access and turn on messaging automatically - no tokens, no webhook URLs.</p>
        </div>
        {tenant && <button className="text-xs underline" onClick={() => void signOut()}>Sign out</button>}
      </div>

      {tenant && <p className="mt-3 text-sm">Hi <strong>{tenant.name || "there"}</strong> - plan <strong className="capitalize">{tenant.plan}</strong> ({pages.length}/{tenant.pageLimit} Pages used)</p>}

      <ol className="my-5 flex gap-2 text-xs">
        {STEPS.map((label, index) => (
          <li key={label} className={`flex-1 rounded px-2 py-1 text-center ${index + 1 < step ? "bg-green-100" : index + 1 === step ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-500"}`}>{index + 1}. {label}</li>
        ))}
      </ol>

      {notice && <p className={`mb-3 rounded p-2 text-sm ${notice.kind === "ok" ? "bg-green-100" : "bg-red-100"}`}>{notice.text}</p>}

      <button className="w-full rounded bg-blue-600 px-6 py-4 text-lg font-semibold text-white disabled:opacity-50" disabled={!configured || connecting} onClick={() => void connect()}>
        {connecting ? "Waiting for Facebook..." : tenant ? "Connect another Page" : "Continue with Facebook"}
      </button>
      {!configured && <p className="mt-2 text-sm text-red-600">Facebook connection is not available yet. Please contact support.</p>}

      <ul className="mt-6 space-y-3">
        {pages.map((page) => {
          const h = health[page.page_id];
          return (
            <li key={page.page_id} className="rounded border border-zinc-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <strong>{page.page_name || page.page_id}{page.ig_user_id ? <span className="ml-2 rounded bg-pink-100 px-2 py-0.5 text-xs font-normal">Instagram linked</span> : null}</strong>
                <span className={`rounded px-2 py-0.5 text-xs ${h ? (h.healthy ? "bg-green-100" : "bg-red-100") : "bg-zinc-100"}`}>{h ? (h.healthy ? "Healthy" : "Needs attention") : "Checking..."}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {h?.checks.map((check) => (
                  <li key={check.id} className={check.ok ? "text-green-700" : "text-red-700"}>
                    {check.ok ? "✓" : "✗"} {check.label}{!check.ok && check.hint ? <span className="block pl-4 text-xs text-zinc-600">{check.hint}</span> : null}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-4 text-xs">
                <button className="underline" onClick={() => void checkHealth(page.page_id)}>Re-check</button>
                <button className="underline" onClick={() => void checkHealth(page.page_id, true)}>Re-subscribe</button>
                <button className="text-red-600 underline" onClick={() => void disconnect(page.page_id)}>Disconnect</button>
              </div>
            </li>
          );
        })}
        {tenant && !pages.length && <li className="text-sm text-zinc-500">No Pages connected yet.</li>}
      </ul>

      {tenant && pages.length > 0 && <AssistantPanel />}

      {!tenant && (
        <details className="mt-8 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Facebook says &quot;App not available&quot; or won&apos;t let you in?</summary>
          <p className="mt-2">Our app is still waiting for Meta&apos;s final approval, so new accounts are let in by hand. Leave your details and we&apos;ll add you right away - you&apos;ll get a Facebook invite to accept, then just press the button above.</p>
          {requested ? (
            <p className="mt-3 rounded bg-green-100 p-2">Thanks! We&apos;ve been notified and will add you shortly.</p>
          ) : (
            <div className="mt-3 space-y-2">
              <input className="w-full rounded border border-zinc-300 bg-white px-2 py-1" placeholder="Your name" value={request.name} onChange={(e) => setRequest({ ...request, name: e.target.value })} />
              <input className="w-full rounded border border-zinc-300 bg-white px-2 py-1" placeholder="Email or profile link of your Facebook account" value={request.contact} onChange={(e) => setRequest({ ...request, contact: e.target.value })} />
              <button className="rounded bg-zinc-900 px-3 py-1 text-white" onClick={() => void sendRequest()}>Request access</button>
            </div>
          )}
        </details>
      )}
    </main>
  );
}
