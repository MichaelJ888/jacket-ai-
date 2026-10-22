"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { describeError, parseOAuthMessage, rolesUrl, wizardStep } from "./connect-logic";

type Page = { page_id: string; page_name: string | null; ig_user_id: string | null; webhook_subscribed: boolean; subscribe_error: string | null };
type Check = { id: string; label: string; ok: boolean; hint?: string };
type Health = { healthy: boolean; checks: Check[] };

const STEPS = ["Log in to Facebook", "Choose your Pages", "Webhook check", "Done"];

export default function ConnectPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  const [appId, setAppId] = useState<string | undefined>();
  const [configured, setConfigured] = useState(true);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const call = useCallback(async (path: string, init: RequestInit = {}, auth = token) => {
    const response = await fetch(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${auth}` }, cache: "no-store" });
    return { ok: response.ok, data: await response.json().catch(() => ({})) };
  }, [token]);

  const checkHealth = useCallback(async (pageId: string, auth = token, resubscribe = false) => {
    const r = resubscribe
      ? await call("/api/meta/connections/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId }) }, auth)
      : await call(`/api/meta/connections/health?pageId=${encodeURIComponent(pageId)}`, {}, auth);
    if (r.ok) setHealth((current) => ({ ...current, [pageId]: { healthy: r.data.healthy, checks: r.data.checks } }));
  }, [call, token]);

  const load = useCallback(async (auth = token) => {
    const r = await call("/api/meta/connections", {}, auth);
    if (!r.ok) return false;
    setPages(r.data.pages);
    setAppId(r.data.appId || undefined);
    setConfigured(r.data.oauthConfigured);
    await Promise.all((r.data.pages as Page[]).map((page) => checkHealth(page.page_id, auth)));
    return true;
  }, [call, checkHealth, token]);

  const handleResult = useCallback((result: ReturnType<typeof parseOAuthMessage>, auth: string) => {
    if (!result) return;
    setConnecting(false);
    if (result.status === "connected") {
      setNotice({ kind: "ok", text: `Connected ${result.pages} Page(s).${result.failed ? ` ${result.failed} could not subscribe the webhook - use Re-subscribe.` : ""}` });
      void load(auth);
    } else setNotice({ kind: "error", text: describeError(result.reason) });
  }, [load]);

  useEffect(() => {
    void (async () => {
      const saved = sessionStorage.getItem("mjic_admin");
      if (saved && (await load(saved))) { setToken(saved); setAuthed(true); }
      const params = new URLSearchParams(window.location.search);
      if (params.get("meta")) {
        handleResult(parseOAuthMessage({ type: "mjic-meta-oauth", ...Object.fromEntries(params) }, window.location.origin, window.location.origin), saved || "");
        window.history.replaceState(null, "", "/dashboard/connect");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => handleResult(parseOAuthMessage(event.data, event.origin, window.location.origin), token);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [handleResult, token]);

  async function login() {
    if (await load(token)) { sessionStorage.setItem("mjic_admin", token); setAuthed(true); setNotice(null); }
    else setNotice({ kind: "error", text: "Wrong password." });
  }

  async function connect() {
    setNotice(null);
    // Open synchronously so the browser doesn't treat the popup as unsolicited.
    const popup = window.open("about:blank", "mjic-fb-login", "width=640,height=760");
    const r = await call("/api/meta/oauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: popup ? "popup" : "connect" }) });
    if (!r.ok || !r.data.url) {
      popup?.close();
      setNotice({ kind: "error", text: r.data.error || "Could not start Facebook login." });
      return;
    }
    setConnecting(true);
    if (popup) {
      popup.location.href = r.data.url;
      const timer = window.setInterval(() => { if (popup.closed) { window.clearInterval(timer); setConnecting(false); void load(); } }, 800);
    } else window.location.href = r.data.url;
  }

  async function disconnect(pageId: string) {
    const r = await call(`/api/meta/connections?pageId=${encodeURIComponent(pageId)}`, { method: "DELETE" });
    setNotice(r.ok ? { kind: "ok", text: "Page disconnected." } : { kind: "error", text: r.data.error || "Failed to disconnect." });
    void load();
  }

  const step = useMemo(() => wizardStep(pages, connecting, Object.fromEntries(Object.entries(health).map(([id, h]) => [id, h.healthy]))), [pages, connecting, health]);

  if (!authed) {
    return (
      <main className="mx-auto max-w-sm p-6 text-zinc-900">
        <h1 className="mb-3 text-xl font-bold">Connect Facebook / Instagram</h1>
        <input className="w-full rounded border border-zinc-300 px-2 py-1" type="password" placeholder="Admin password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void login()} />
        <button className="mt-2 rounded bg-zinc-900 px-3 py-1 text-sm text-white" onClick={() => void login()}>Sign in</button>
        {notice && <p className="mt-3 text-sm text-red-600">{notice.text}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6 text-zinc-900">
      <h1 className="text-2xl font-bold">Connect your Facebook / Instagram</h1>
      <p className="mt-1 text-sm text-zinc-600">Log in once. We save the Page access and turn on messaging automatically - no tokens, no webhook URLs.</p>

      <ol className="my-5 flex gap-2 text-xs">
        {STEPS.map((label, index) => (
          <li key={label} className={`flex-1 rounded px-2 py-1 text-center ${index + 1 < step ? "bg-green-100" : index + 1 === step ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-500"}`}>{index + 1}. {label}</li>
        ))}
      </ol>

      {notice && <p className={`mb-3 rounded p-2 text-sm ${notice.kind === "ok" ? "bg-green-100" : "bg-red-100"}`}>{notice.text}</p>}

      <button className="w-full rounded bg-blue-600 px-6 py-4 text-lg font-semibold text-white disabled:opacity-50" disabled={!configured || connecting} onClick={() => void connect()}>
        {connecting ? "Waiting for Facebook..." : "Connect via Facebook Login"}
      </button>
      {!configured && <p className="mt-2 text-sm text-red-600">The Meta app is not configured on the server (META_APP_ID / META_APP_SECRET).</p>}

      <ul className="mt-6 space-y-3">
        {pages.map((page) => {
          const h = health[page.page_id];
          return (
            <li key={page.page_id} className="rounded border border-zinc-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <strong>{page.page_name || page.page_id}</strong>
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
                <button className="underline" onClick={() => void checkHealth(page.page_id, token, true)}>Re-subscribe</button>
                <button className="text-red-600 underline" onClick={() => void disconnect(page.page_id)}>Disconnect</button>
              </div>
            </li>
          );
        })}
        {!pages.length && <li className="text-sm text-zinc-500">No Pages connected yet.</li>}
      </ul>

      <details className="mt-8 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium">Can&apos;t log in? Development Mode guide</summary>
        <p className="mt-2">Until Meta approves the app (App Review + Business Verification) only people with a role on the app can connect. Add them as Testers:</p>
        <ol className="ml-5 mt-2 list-decimal space-y-1">
          <li>Open the <a className="underline" href={rolesUrl(appId)} target="_blank" rel="noreferrer">app Roles page</a> and choose Add People - Tester.</li>
          <li>The person accepts the invite at <a className="underline" href="https://developers.facebook.com/requests" target="_blank" rel="noreferrer">developers.facebook.com/requests</a>.</li>
          <li>Come back here and press Connect.</li>
        </ol>
        <p className="mt-2 text-xs text-zinc-600">Going Live needs: privacy URL, data-deletion URL, Business Verification, and approval of pages_messaging, pages_manage_metadata and instagram_manage_messages.</p>
      </details>
    </main>
  );
}
