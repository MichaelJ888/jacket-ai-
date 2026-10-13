// One-command, idempotent setup + deploy: npm run bootstrap [-- --skip-deploy --skip-schema --skip-env]
import { spawnSync } from 'node:child_process';
import { loadEnvLocal, ensureProductionPublic, syncMissingEnv, smokeTest, notifyTelegram } from './lib/autopilot.mjs';

loadEnvLocal();
const flags = new Set(process.argv.slice(2));
const log = [];

function run(label, command, args) {
  console.log(`\n== ${label}`);
  const res = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status})`);
  log.push(`ok: ${label}`);
}

async function step(label, fn) {
  console.log(`\n== ${label}`);
  const detail = await fn();
  log.push(`ok: ${label}${detail ? ` (${detail})` : ''}`);
}

try {
  if (!process.env.VERCEL_TOKEN) throw new Error('VERCEL_TOKEN missing. Create it once at https://vercel.com/account/tokens and add it to .env.local.');

  if (!flags.has('--skip-schema')) run('db:push schema', process.execPath, ['scripts/apply-schema.mjs']);
  if (!flags.has('--skip-env')) await step('sync missing env vars', async () => `${(await syncMissingEnv()).join(', ') || 'none missing'}`);
  await step('production protection', async () => {
    const fix = await ensureProductionPublic();
    return fix.changed ? `changed ${fix.current} -> preview` : `already ${fix.current ?? 'public'}`;
  });
  if (!flags.has('--skip-deploy')) run('vercel deploy --prod', 'npx', ['vercel', '--prod', '--yes', '--token', process.env.VERCEL_TOKEN]);

  await step('smoke test', async () => {
    const result = await smokeTest();
    if (!result.ok) throw new Error(result.failures.join('; '));
  });

  await notifyTelegram(`Bootstrap OK\n${log.join('\n')}`);
  console.log('\nBootstrap complete.');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nBootstrap FAILED: ${message}`);
  await notifyTelegram(`Bootstrap FAILED: ${message}\n${log.join('\n')}`);
  process.exit(1);
}
