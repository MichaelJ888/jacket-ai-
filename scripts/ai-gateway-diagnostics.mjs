import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CREDITS_URL = 'https://ai-gateway.vercel.sh/v1/credits';

function readLocalKey(contents) {
  const match = contents.match(/^\s*AI_GATEWAY_API_KEY\s*=\s*(.*?)\s*$/m);
  if (!match) return '';
  return match[1].replace(/^(['"])(.*)\1$/, '$2').trim();
}

export async function inspectCredits(apiKey, fetcher = fetch) {
  if (!apiKey) return { ok: false, status: null, error: 'AI_GATEWAY_API_KEY is not configured.' };
  const response = await fetcher(CREDITS_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = response.status === 401 || response.status === 403
      ? 'Gateway rejected the key or the key lacks team access.'
      : response.status === 402
        ? 'Gateway billing/credits are unavailable; check the Vercel AI Gateway billing page.'
        : `Gateway credits endpoint returned HTTP ${response.status}.`;
    return { ok: false, status: response.status, error };
  }
  const body = await response.json();
  const balance = Number(body.balance);
  const totalUsed = Number(body.total_used);
  if (!Number.isFinite(balance) || !Number.isFinite(totalUsed)) {
    return { ok: false, status: response.status, error: 'Gateway response did not contain valid credit totals.' };
  }
  return { ok: true, status: response.status, balance, totalUsed };
}

async function main() {
  let apiKey = process.env.AI_GATEWAY_API_KEY || '';
  if (!apiKey) {
    try {
      apiKey = readLocalKey(await readFile(resolve(process.cwd(), '.env.local'), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const result = await inspectCredits(apiKey);
  if (result.ok) {
    console.log(`AI Gateway credits: $${result.balance.toFixed(2)} remaining; $${result.totalUsed.toFixed(2)} used.`);
    console.log('Read-only check; no model generation or paid request was made.');
    return;
  }
  console.error(`AI Gateway diagnostic failed${result.status ? ` (HTTP ${result.status})` : ''}: ${result.error}`);
  console.error('For this provider, check Vercel Dashboard → AI Gateway → Credits/Billing. A separate model-provider subscription is not needed to inspect this balance; generation still requires available credits or provider billing.');
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export { readLocalKey };
