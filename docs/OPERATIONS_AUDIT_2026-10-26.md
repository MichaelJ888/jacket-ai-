# MJIC cloud operations audit - 2026-10-26

## Verified outcome

Production deployment `dpl_BjyZ15sHjBfCG9dPdCjeTASbVZ1G` is `READY` at
https://jacket-ai.vercel.app. Changes were deployed from the validated local
working tree, including the existing browser-only campaign/video work. This
audit did not create a Git commit or push to GitHub.

After deployment:

- The home page and `/admin/video-mockups` returned HTTP 200. The latter's
  title is `Video Mockups & Campaign Planner | MJIC Admin`.
- `/api/health` returned HTTP 200 with all six checks passing: environment,
  database, storage, critical errors, retry backlog, and scheduled jobs.
- Exactly one authorized `/api/cron/consultant` recovery run returned HTTP 200,
  `success: true`, and `notified: true` in 14,812 ms. This generated one real
  report and delivered it to the configured CEO Telegram chat.
- The consultant heartbeat was `ok` at `2026-10-26T15:10:43.164Z`
  (23:10:43 Manila).
- Supabase security advisor WARN findings fell from 2 to 0 after the narrow
  grant correction below. Informational advisor findings were not treated as
  application errors or grounds for speculative schema changes.

These are point-in-time observations, not a guarantee of future uptime.

## Confirmed defects and repairs

| Problem | Evidence | Repair |
| --- | --- | --- |
| False-green operational health | Query errors/null counts could look like zero errors; failed job statuses and invalid dates were ignored | Added tested fail-closed evaluation, explicit query-error logging, and status/date checks. Retry queue and swarm-worker heartbeats are now monitored alongside publishing and sales follow-ups. |
| Failed weekly consultant | GitHub run #367 failed on October 26; a matching `cron-consultant` system log recorded an aborted operation due to timeout | Reduced model budget from 50 to 30 seconds and individual attempts from 40 to 12 seconds, capped output at 1,600 tokens, rejected empty reports, and preserved fallback to existing configured models. One production recovery run succeeded. |
| Consultant failures left an old successful heartbeat or returned success despite no delivery | Generation errors returned before recording a heartbeat; undelivered notifications returned HTTP 200 | Generation exceptions/configuration failures now record `error`; delivery failures record `not-sent` and return HTTP 503. |
| Builds could ship TypeScript errors; obsolete Next.js ESLint configuration | `ignoreBuildErrors` bypass and unsupported `eslint` config were present | Restored default TypeScript build checking and removed obsolete configuration. Lint remains a separate gate. |
| Excess client execution grants on an RLS event-trigger function | Supabase advisor reported two warnings; catalog inspection confirmed PUBLIC/anon/authenticated EXECUTE | Revoked only those grants on `public.rls_auto_enable()`. Verified postgres/service_role retain EXECUTE, client effective privileges are false, and `ensure_rls` remains enabled. Appended the idempotent correction to `supabase/schema.sql`. |

Only the narrow RLS grant correction was applied to the live database, not
the entire schema file. No data was deleted and no credentials were rotated.

## Account and environment coverage

### Vercel

- Project/environment/deployment reads succeeded. The 10 recent deployments
  inspected before changes were READY; the new production deployment is READY.
- Production contained all required environment-variable names (30 variables
  in the inspected metadata).
- Preview and Development each had 19 variables and lacked seven names required
  by the production health contract: `CRON_SECRET`, `SCHEDULER_TOKEN`,
  `ADMIN_TOKEN`, `PAYMENT_WEBHOOK_SECRET`, `MANYCHAT_WEBHOOK_SECRET`,
  `META_WEBHOOK_VERIFY_TOKEN`, and `META_APP_SECRET`.
- Production credentials were not copied into non-production environments.
  Missing webhook/scheduler secrets intentionally fail closed; provisioning them
  safely also requires deciding on isolated non-production databases/accounts.
- The API did not expose usable plaintext for sensitive values, so equality with
  local secrets and database isolation across environments remain unverified.
- Account/team identity requests returned 404/403 while project-scoped requests
  worked. This was not a verified whole-account or billing/plan entitlement audit.

### Supabase, AI providers, and Telegram

- Target Supabase project was `ACTIVE_HEALTHY`; local service-role REST
  authentication and read-only checks of 12 critical tables succeeded.
- Security/performance advisors were readable. The initial findings were
  56 security INFO, 2 security WARN, and 27 performance INFO; the two security
  warnings were removed and verified.
- Vercel AI Gateway model listing succeeded (480 models). Gemini model metadata
  listed all five default pool models with generation support. Listing access
  alone does not prove budget, quota, or generation reliability.
- The production consultant recovery verified one actual generation/delivery
  path, not every provider, model, or account integration.
- Telegram bot/webhook metadata succeeded with zero pending updates and no
  reported last webhook error at audit time.
- Meta publishing remains blocked by the previously recorded missing
  `pages_manage_posts` permission; this audit did not publish anything or grant
  unavailable provider permissions.

### GitHub scheduler and local editor

- Recent workflow metadata was readable. The failed consultant run was traced
  using matching technical system logs; GitHub job-log download returned 401.
- Some successful frequent-job heartbeats were hours old despite nominal
  5/45-minute schedules. The six-hour health tolerance accommodates observed
  GitHub delays; it is not a promised execution interval.
- No new scheduler was installed or paid plan purchased. Existing GitHub
  Actions and Vercel native schedules continue independently of this desktop.
- Local VS Code CLI was available (1.143.0), task references resolved, and no
  inspected workspace setting disabled validation. `code --status` reported a
  local DirectComposition `CheckFormatSupport` error, not a cloud server error.
  Extension-list results do not prove account entitlement or authentication.
- VS Code account secrets, browser credentials, and unrelated account contents
  were not accessed.
- Local secrets were used in memory only. `.env.local` and `.vercel` are ignored
  by Git. Not every optional credential was exercised; no token values are
  included in this report.

## Validation

- `npm run lint`: exit 0, with one pre-existing unused `_lines` warning in
  `app/api/_lib/sales-closer.ts`.
- `npm test`: 125 passed, 0 failed, including seven new health regression tests.
- Focused health/provider-pool run: 12 passed, 0 failed.
- `npm run build`: passed using webpack with TypeScript checking enabled.
- `node_modules\.bin\tsc.cmd --noEmit`: passed.
- `npm run test:e2e -- e2e/video-mockups.spec.ts`: 2 passed after the final build.
- `git diff --check`: passed.

Remaining non-fatal tooling warnings: Node's typeless-package warning for
TypeScript tests, and Next.js ignoring an unrelated parent-directory lockfile.
The unrelated lockfile and existing lint warning were not changed.

## Continuing operation and boundaries

Routine monitoring reuses the existing health endpoint, watchdog, durable retry
queue, heartbeats, and capped swarm worker. Deterministic checks are cheaper and
more testable than introducing another paid always-on AI swarm.

The existing watchdog receives failed health checks and can alert the CEO.
The existing retry queue/swarm controls remain in place; this work does not
authorize agents to invent credentials, purchase plans, disable access controls,
change arbitrary account settings, or promise prevention of every future error.
GitHub scheduling delays, provider outages, quota exhaustion, missing OAuth
permissions, billing eligibility, and non-production isolation remain external
operational constraints.

Source changes remain in the local working tree. Production is deployed, but
GitHub source is not updated by a Vercel CLI deployment; a future deployment
from an older Git commit could overwrite these repairs until the changes are
committed and merged through the repository's normal workflow.
