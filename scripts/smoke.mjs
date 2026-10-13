// Post-deploy smoke test. Exit 1 on failure (CI uses this to trigger rollback).
import { loadEnvLocal, smokeTest, ensureProductionPublic } from './lib/autopilot.mjs';

loadEnvLocal();

if (process.argv.includes('--heal-only')) {
  const fix = await ensureProductionPublic();
  console.log(fix.changed ? `Protection fixed (${fix.current} -> preview)` : `Protection already ok (${fix.current ?? 'public'})`);
  process.exit(0);
}

let result = await smokeTest();
if (!result.ok && process.env.VERCEL_TOKEN) {
  // Deployment Protection is the usual culprit: re-apply the setting once and retry.
  try {
    const fix = await ensureProductionPublic();
    if (fix.changed) {
      console.log(`Re-applied protection fix (was ${fix.current}); retrying smoke test`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      result = await smokeTest();
    }
  } catch (error) {
    console.error('Protection fix failed:', error instanceof Error ? error.message : error);
  }
}

if (result.ok) {
  console.log('Smoke test passed');
} else {
  console.error('Smoke test FAILED:\n- ' + result.failures.join('\n- '));
  process.exit(1);
}
