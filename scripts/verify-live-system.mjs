// Read-only live verification for production. Pings the quota, subcon, sample and cron routes
// with the scoped bearer tokens from .env.local, confirms unauthenticated calls are rejected,
// and counts CRM contacts. Secret values are never printed.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MIN_CLIENTS = Number(process.env.VERIFY_MIN_CLIENTS || 49);

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const env = { ...loadEnvFile(resolve(ROOT, '.env.local')), ...process.env };
const BASE = (env.VERIFY_BASE_URL || env.APP_BASE_URL || 'https://jacket-ai.vercel.app').replace(/\/$/, '');
const ADMIN_TOKEN = env.ADMIN_TOKEN || env.ADMIN_PASSWORD;
const CRON_SECRET = env.CRON_SECRET || env.SCHEDULER_TOKEN;

const results = [];

async function call(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const res = await fetch(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(30_000), redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function checkAuthed(name, path, token, tokenLabel, extra) {
  if (!token) return record(name, false, `missing ${tokenLabel} in .env.local`);
  const r = await call(path, token);
  if (r.error) return record(name, false, `network error: ${r.error}`);
  if (r.status === 401) return record(name, false, `401 Unauthorized with ${tokenLabel}`);
  const ok = r.status === 200 && r.json?.success !== false && (!extra || extra(r.json));
  record(name, ok, `HTTP ${r.status}${extra && r.json ? ` ${extra.label?.(r.json) ?? ''}` : ''}`);
}

async function checkUnauthenticated(path) {
  const r = await call(path, null);
  record(`fail-closed without token: ${path}`, r.status === 401, `HTTP ${r.status}`);
}

async function main() {
  console.log(`Target: ${BASE}\n`);

  await checkAuthed('subcons directory', '/api/subcons', ADMIN_TOKEN, 'ADMIN_TOKEN');
  await checkAuthed('production quota', '/api/production-quota', ADMIN_TOKEN, 'ADMIN_TOKEN');
  await checkAuthed('sample tracker', '/api/samples', ADMIN_TOKEN, 'ADMIN_TOKEN');
  await checkAuthed('cron samples (overdue alerts)', '/api/cron/samples', CRON_SECRET, 'CRON_SECRET');
  // Same bearer-token calls the admin panel makes after login; no session bypass.
  await checkAuthed('admin panel: overview', '/api/admin/overview', ADMIN_TOKEN, 'ADMIN_TOKEN');
  await checkAuthed('admin panel: prices', '/api/admin/prices', ADMIN_TOKEN, 'ADMIN_TOKEN');

  const crm = await call('/api/crm', ADMIN_TOKEN);
  if (!ADMIN_TOKEN) record('CRM client count', false, 'missing ADMIN_TOKEN');
  else if (crm.status === 401) record('CRM client count', false, '401 Unauthorized');
  else {
    const pipeline = crm.json?.pipeline || {};
    const total = Object.values(pipeline).reduce((sum, n) => sum + (Number(n) || 0), 0);
    record('CRM client count', crm.status === 200 && total >= MIN_CLIENTS, `HTTP ${crm.status}, ${total} contacts (min ${MIN_CLIENTS})`);
  }

  for (const path of ['/api/subcons', '/api/production-quota', '/api/samples', '/api/cron/samples']) {
    await checkUnauthenticated(path);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main();
