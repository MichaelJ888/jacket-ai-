// Shared helpers for bootstrap / smoke scripts. Zero dependencies (Node 20+).
import { readFileSync } from 'node:fs';

export function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // .env.local is optional (CI exports vars directly)
  }
}

export const PROJECT = () => process.env.VERCEL_PROJECT_ID || 'jacket-ai';
export const BASE_URL = () => (process.env.APP_BASE_URL || 'https://jacket-ai.vercel.app').replace(/\/$/, '');

export async function vercelApi(path, { method = 'GET', body } = {}) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN is not set');
  const url = new URL(`https://api.vercel.com${path}`);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Vercel API ${method} ${path} -> ${res.status}: ${JSON.stringify(json?.error ?? json)}`);
  return json;
}

// Option A: only previews stay behind Vercel Authentication; production is public.
export async function ensureProductionPublic() {
  const project = await vercelApi(`/v9/projects/${PROJECT()}`);
  const current = project.ssoProtection?.deploymentType ?? null;
  if (current === null || current === 'preview') return { changed: false, current };
  await vercelApi(`/v9/projects/${PROJECT()}`, { method: 'PATCH', body: { ssoProtection: { deploymentType: 'preview' } } });
  return { changed: true, current };
}

const ENV_SKIP = new Set(['VERCEL_OIDC_TOKEN', 'SUPABASE_ACCESS_TOKEN']);

function localEnv() {
  const out = {};
  try {
    for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env.local
  }
  return out;
}

// Non-destructive: only creates variables missing on Vercel production, never overwrites.
export async function syncMissingEnv() {
  const existing = await vercelApi(`/v9/projects/${PROJECT()}/env`);
  const present = new Set(
    (existing.envs || []).filter((e) => [].concat(e.target || []).includes('production')).map((e) => e.key),
  );
  const missing = Object.entries(localEnv())
    .filter(([key, value]) => value && !present.has(key) && !ENV_SKIP.has(key))
    .map(([key, value]) => ({ key, value, type: 'encrypted', target: ['production'] }));
  if (missing.length) await vercelApi(`/v10/projects/${PROJECT()}/env`, { method: 'POST', body: missing });
  return missing.map((entry) => entry.key);
}

async function probe(path, init) {
  const res = await fetch(`${BASE_URL()}${path}`, { ...init, signal: AbortSignal.timeout(20000), redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body
  }
  return { status: res.status, text, json };
}

const blockedByVercel = (r) =>
  /Authentication Required|vercel\.com\/sso-api|_vercel_sso_nonce/i.test(r.text) || (r.status === 401 && !r.json) || [301, 302, 307].includes(r.status);

// Probe payloads carry no lead content, so nothing is written to the CRM.
export async function smokeTest() {
  const failures = [];
  try {
    const open = await probe('/api/webhooks/manychat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (blockedByVercel(open)) failures.push('Vercel Deployment Protection is blocking the webhook (HTML/redirect instead of JSON 401)');
    else if (open.status !== 401) failures.push(`webhook accepted an unauthenticated request (HTTP ${open.status}); expected 401`);

    const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
    if (secret) {
      const authed = await probe('/api/webhooks/manychat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-manychat-secret': secret }, body: '{}' });
      if (authed.status !== 400 || !authed.json?.error) failures.push(`authenticated webhook probe returned HTTP ${authed.status}; expected 400 "No lead content found"`);
    }

    const health = await probe('/api/health', {});
    if (!health.json?.status) failures.push(`/api/health did not return JSON (HTTP ${health.status})`);
    else if (!health.json.checks?.database?.ok) failures.push(`/api/health database check failed: ${JSON.stringify(health.json.checks?.database)}`);
    else if (health.json.status !== 'ok') console.warn(`WARN /api/health is ${health.json.status}: ${JSON.stringify(health.json.checks)}`);
  } catch (error) {
    failures.push(`smoke test crashed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: failures.length === 0, failures };
}

export async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
