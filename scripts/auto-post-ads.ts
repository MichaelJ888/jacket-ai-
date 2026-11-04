// Immediate FB/IG ads publishing pass ("auto-post ads engine").
// Delegates to the existing capped publisher route — this script never bypasses the Meta
// anti-ban policy (max 4 successful posts per platform per rolling 24h, enforced server-side
// in app/api/_lib/content-policy.ts).
//
// Usage (Node 24+, type-stripped TypeScript):
//   node scripts/auto-post-ads.ts              # preview: due READY rows + remaining safe posting slots (no posting)
//   node scripts/auto-post-ads.ts --apply      # run one publishing pass on the live site now
//   node scripts/auto-post-ads.ts --apply --base=http://localhost:3000   # run against a local dev server
//
// Env (.env.local auto-loaded):
//   Preview: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   Apply:   SCHEDULER_TOKEN or CRON_SECRET, APP_BASE_URL (defaults to https://jacket-ai.vercel.app)
import { readFileSync } from 'node:fs';

try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // optional when variables are already exported
}

const apply = process.argv.includes('--apply');
const baseArg = process.argv.find((arg) => arg.startsWith('--base='));
const base = (baseArg ? baseArg.slice('--base='.length) : process.env.APP_BASE_URL || 'https://jacket-ai.vercel.app').replace(/\/$/, '');

// Same policy as content-policy.ts: hard cap 4/platform/24h; CONTENT_MAX_POSTS_PER_DAY can only lower it.
const HARD_CAP = 4;
const envCap = Number(process.env.CONTENT_MAX_POSTS_PER_DAY);
const dailyCap = Number.isFinite(envCap) && envCap > 0 ? Math.min(HARD_CAP, Math.floor(envCap)) : HARD_CAP;

type Row = { platform: string; page_key: string | null };

function groupCounts(rows: Row[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.page_key === 'cgv' ? 'cgv' : 'mjic'} · ${row.platform}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function rest<T>(path: string): Promise<T[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for the preview.');
    process.exit(1);
  }
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) {
    console.error(`Supabase REST ${response.status} for ${path}`);
    process.exit(1);
  }
  return (await response.json()) as T[];
}

async function preview() {
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const due = await rest<Row & { scheduled_at: string }>(`content_calendar?status=eq.READY&scheduled_at=lte.${encodeURIComponent(now)}&select=platform,page_key,scheduled_at&order=scheduled_at.asc&limit=200`);
  const published = await rest<Row>(`content_calendar?status=eq.PUBLISHED&published_at=gte.${encodeURIComponent(since)}&select=platform,page_key&limit=1000`);
  const blocked = await rest<Row>(`content_calendar?status=in.(NEEDS_CREDENTIALS,FAILED)&select=platform,page_key&limit=1000`);

  console.log(`Auto-post ads preview — ${now}`);
  console.log(`Daily cap per platform (rolling 24h): ${dailyCap}`);
  console.log('\nDue now (READY, slot reached):');
  if (due.length === 0) console.log('  none');
  for (const [key, count] of groupCounts(due)) console.log(`  ${key}: ${count}`);
  console.log('\nPublished in the last 24h vs safe cap:');
  if (published.length === 0) console.log('  none');
  for (const [key, count] of groupCounts(published)) console.log(`  ${key}: ${count}/${dailyCap} (${Math.max(0, dailyCap - count)} slots left)`);
  if (blocked.length > 0) {
    console.log('\nParked (NEEDS_CREDENTIALS/FAILED, not counted as attempts):');
    for (const [key, count] of groupCounts(blocked)) console.log(`  ${key}: ${count}`);
  }
  if (!process.env.META_CGV_PAGE_ID) console.log('\nNote: META_CGV_PAGE_ID is not set — cgv-page rows stay parked until it is configured.');
  console.log('\nRun with --apply to execute one capped publishing pass now.');
}

async function runPass() {
  const token = process.env.SCHEDULER_TOKEN || process.env.CRON_SECRET || '';
  if (!token) {
    console.error('Missing SCHEDULER_TOKEN or CRON_SECRET for --apply.');
    process.exit(1);
  }
  console.log(`Triggering capped publishing pass: GET ${base}/api/cron/content-publisher`);
  const response = await fetch(`${base}/api/cron/content-publisher`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(70_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(data, null, 2));
  if (!response.ok || data.success === false) process.exit(1);
}

if (apply) await runPass();
else await preview();
