// One-shot Meta repair: System User token -> Page token -> verify -> subscribe Page -> save to .env.local + Vercel.
//   node scripts/meta-heal.mjs                    uses META_SYSTEM_USER_TOKEN from .env.local
//   node scripts/meta-heal.mjs --token=<token>    uses a fresh token (also saved as META_SYSTEM_USER_TOKEN)
//   node scripts/meta-heal.mjs --check            only report health, change nothing (safe for cron/CI)
// A "Never expire" System User token yields a Page token that does not expire, so this normally runs once.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnvLocal, vercelApi, PROJECT } from './lib/autopilot.mjs';

loadEnvLocal();
const GRAPH = 'https://graph.facebook.com/v21.0';
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const tokenArg = args.find((a) => a.startsWith('--token='))?.slice(8);
const systemToken = tokenArg || process.env.META_SYSTEM_USER_TOKEN;
const pageId = process.env.META_PAGE_ID;
const fields = 'messages,messaging_postbacks,feed';

async function graph(path, { method = 'GET', token } = {}) {
  const res = await fetch(`${GRAPH}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(body.error || body));
  return body;
}

function setEnvLocal(key, value) {
  const file = new URL('../.env.local', import.meta.url);
  let text = readFileSync(file, 'utf8');
  const line = `${key}=${value}`;
  text = new RegExp(`^${key}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${key}=.*$`, 'm'), () => line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(file, text);
}

async function setVercelEnv(key, value) {
  await vercelApi(`/v10/projects/${PROJECT()}/env?upsert=true`, { method: 'POST', body: { key, value, type: 'encrypted', target: ['production', 'preview', 'development'] } });
}

if (!systemToken || !pageId) { console.error('Need META_SYSTEM_USER_TOKEN (or --token=) and META_PAGE_ID'); process.exit(1); }

try {
  const sys = (await graph(`/debug_token?input_token=${systemToken}`, { token: systemToken })).data;
  console.log(`System token: valid=${sys.is_valid} type=${sys.type} expires_at=${sys.expires_at || 'never'} scopes=${(sys.scopes || []).join(',')}`);
  if (!sys.is_valid) throw new Error('System User token is invalid. Generate a new one (Business Settings > System users > Generate token, expiry: Never).');

  const accounts = (await graph('/me/accounts?fields=id,name,access_token', { token: systemToken })).data || [];
  const page = accounts.find((p) => p.id === pageId) || accounts[0];
  if (!page?.access_token) throw new Error('System User has no Page assigned with Full control.');
  if (page.id !== pageId) console.log(`META_PAGE_ID mismatch: env=${pageId} actual=${page.id}; using actual.`);
  const pid = page.id;
  const pt = (await graph(`/debug_token?input_token=${page.access_token}`, { token: page.access_token })).data;
  console.log(`Page: ${page.name} (${pid}) token valid=${pt.is_valid} expires_at=${pt.expires_at || 'never'}`);

  const subs = (await graph(`/${pid}/subscribed_apps`, { token: page.access_token })).data || [];
  console.log('Subscribed apps:', subs.map((s) => `${s.name}[${(s.subscribed_fields || []).join(',')}]`).join('; ') || 'NONE');
  if (checkOnly) process.exit(pt.is_valid && subs.length && page.id === pageId ? 0 : 2);

  await graph(`/${pid}/subscribed_apps?subscribed_fields=${fields}`, { method: 'POST', token: page.access_token });
  console.log('Page subscribed to', fields);

  setEnvLocal('META_PAGE_ID', pid);
  await setVercelEnv('META_PAGE_ID', pid);
  setEnvLocal('META_SYSTEM_USER_TOKEN', systemToken);
  setEnvLocal('META_PAGE_ACCESS_TOKEN', page.access_token);
  await setVercelEnv('META_SYSTEM_USER_TOKEN', systemToken);
  await setVercelEnv('META_PAGE_ACCESS_TOKEN', page.access_token);
  console.log('Saved to .env.local and Vercel production. Redeploy to apply: npx vercel --prod --yes');
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
}
