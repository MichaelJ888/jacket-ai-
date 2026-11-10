<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# jacket-ai — MJIC business automation

Next.js 16 (App Router) + React 19 + Tailwind 4 + Supabase app automating MJIC's uniform/embroidery business: customer chat, costing, leads, orders, payment verification, Telegram staff bot, cron reminders. Deployed on Vercel (Hobby tier) at https://jacket-ai.vercel.app.

## Commands
- `npm run dev` / `npm run lint` — dev server / eslint
- `npm run build` — MUST stay `next build --webpack`; Turbopack panics on this project's global CSS
- `npm run db:push` — apply `supabase/schema.sql` via Supabase Management API (needs `SUPABASE_ACCESS_TOKEN` in `.env.local`)
- `npm run crm:sync` — idempotent upsert of every `orders` client into `crm_contacts` + backfill `orders.contact_id` (so the COO admin panel lists them); `-- --dry-run` previews
- `npm run memory -- <note|decision|issue|attempt|fix|summary|archive>` — cloud agent memory (see bridge below)
- Deploy: `npx vercel --prod --yes` (builds from local files; does not need `git push`)

## Architecture
- API routes: `app/api/*/route.ts` — all Node runtime, JSON responses. Route inventory: [AUTOMATION_CHECKLIST.md](AUTOMATION_CHECKLIST.md).
- Shared server helpers: [app/api/_lib/integrations.ts](app/api/_lib/integrations.ts) — Supabase admin client, Telegram helpers (`sendTelegramMessage` / `sendTelegramDirectMessage` / `sendTelegramPhoto` + `escapeTelegramHtml`, all via `fetchWithRetry`), staff/payroll/task helpers, `composeBossStyleMessage`. Always import these; never write a per-route Telegram fetch helper.
- DB: `supabase/schema.sql` — append-only and idempotent (`create table if not exists`), one table per concern, all tables RLS-locked (service-role access only). Apply with `npm run db:push`.
- Scheduling: `vercel.json` = daily native crons only (Hobby tier); `.github/workflows/scheduler.yml` = sub-daily crons (5/45-min) via GitHub Actions hitting routes with `Authorization: Bearer $CRON_SECRET`.
- Frontend logic is extracted into `*-logic.ts` files co-located with `*.test.ts` next to the page (e.g. `app/dashboard/financials/`).

## Conventions & pitfalls
- `next.config.ts` sets `ignoreBuildErrors` + `ignoreDuringBuilds` — TS/eslint failures do NOT block deploys; run `npm run lint` (and `tsc`) yourself before shipping.
- Supabase `.insert({...})` without `.select()` returns `data: null` — chain `.select().single()` when the route needs the inserted row.
- Several routes use a "skip auth when the secret env var is unset" pattern — they are OPEN by default; audit any new route using it (see `order-status` history in the checklist).
- Third-party fetches outside `_lib/integrations.ts` need an explicit `signal: AbortSignal.timeout(...)`.
- `app/api/chat/route.ts` `MJIC_SYSTEM_PROMPT` contains exact business numbers (phone, prices, GCash) — never paraphrase or LLM-compress it.
- Tests: `*.test.ts` use `node:test` but have no npm script, and plain `node --test` currently fails on their extensionless imports (`./financial-logic` needs a loader or `.ts` extension). Don't claim tests pass without actually running them.
- Windows machine quirks: plain `node` resolves to a broken `C:\Windows\System32\node` stub — call `& "C:\Program Files\nodejs\node.exe"` for one-off scripts. `git push` can fail with `getaddrinfo() thread failed to start` (needs VS Code restart; Vercel deploys work independently).

## References
- [AUTOMATION_CHECKLIST.md](AUTOMATION_CHECKLIST.md) — REQUIRED reading before any new automation, webhook, cron, schema, or deploy task; includes credential status table.
- [.github/agents/mjic-automation-engineer.agent.md](.github/agents/mjic-automation-engineer.agent.md) — specialized agent for automation/API/schema/deploy work.
- [README.md](README.md) — stock create-next-app boilerplate (low value).

## Telegram → VS Code dev queue
The CEO sends coding jobs from Telegram (`/dev <task>` = auto-approved; code-looking messages = queued for `/approve`; `/biz` forces business chat; `/queue`, `/ideas` list state). They land in `dev_tasks`. Approved jobs run in two places: (1) cloud: the webhook dispatches [.github/workflows/devq-cloud.yml](.github/workflows/devq-cloud.yml), which runs the Copilot CLI and opens a `devq/<id>` PR for the CEO to merge (never pushes to main); (2) PC fallback: `npm run devq:worker` (Copilot CLI) claims approved jobs when the cloud dispatch fails. Cloud secrets needed in GitHub: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `COPILOT_GITHUB_TOKEN` (fine-grained PAT with Copilot Requests); `GITHUB_PAT` on Vercel needs Actions: write. Claims older than 45 min are released automatically. Manual: `npm run devq -- list | next | done <id> "text" | fail <id> "reason" | watch`. Never run destructive/irreversible actions from a queued job without confirming first. Unattended: `npm run devq:worker` runs CEO-approved jobs one at a time via the Copilot CLI (needs one-time `copilot login` on the PC; never pushes, deploys, or migrates).

<!-- >>> projectmem bridge >>> -->
## Agent memory (MANDATORY) — cloud-hosted, no local MCP process

This project's persistent memory lives in Supabase table `public.agent_memory_events`
(see `supabase/schema.sql`), read/written via `scripts/memory.mjs`. The local
Python projectmem MCP server (`.vscode/mcp.json`) is retired — it consumed
desktop RAM and is not part of the production automation system.

SESSION START — before answering ANY question about this project, run
`npm run memory -- summary` (or the "Memory: Session-start summary" VS Code task)
to load recent notes/decisions/issues/fixes.

DURING work:
  - On a bug discovery → `npm run memory -- issue "..." --location=path/to/file.ts`
  - After each fix attempt → `npm run memory -- attempt "..." --outcome=worked|failed`
  - After confirmation → `npm run memory -- fix "..." --issue=<event id>`
  - On a design choice → `npm run memory -- decision "..."`
  - On a gotcha / setup detail → `npm run memory -- note "..."`
  - When a decision REPLACES an older one → add `--supersedes=<old event id>`
    (ids come from `npm run memory -- summary`).

Do not edit `agent_memory_events` rows directly via SQL — always go through
`scripts/memory.mjs` so the log stays append-only and auditable.
<!-- <<< projectmem bridge <<< -->

## Completion log
- 2026-11-02 — Digitizer (`/admin/digitizer`): fixed "Maximum call stack size exceeded" (spread `push(...)` on large PES/point arrays → loop appends). Added inch sizing (0.5–12 in), AI stitch auto-tune + fabric presets (`app/api/_lib/digitize/stitch-settings.ts`), advanced settings drawer, AI Smart Improve (high-precision pass), redesigned page. Commit `f52e546` on main; prod deploy Ready; `verify:live` 11/11; `npm test` 328/328; `tsc --noEmit` clean.
- Not implemented: underlay styles, auto-trim toggle, Pantone/Isacord mapping, Bernina ART/VIP output.


## Completion log � thread color matcher + DBHS calibration
- Commit ce23d2a: CIE76 Lab matcher (thread-match.ts), DST reader (dst-reader.ts), optional threadPalette in digitizer.
- Tests: npm test 333/333 with MJIC_DST_FIXTURE; tsc --noEmit and eslint clean.
- Prod: aliased https://jacket-ai.vercel.app; npm run verify:live 11/11.
- Open: no Pantone/Isacord palette data loaded; DBHS max stitch 8.73mm vs worksheet 6.7mm (cap unchanged at 7.0mm).
- public/image-library.json remains an unreviewed local change, intentionally not committed.

## Completion log — DST decoder + image library (2026-11-03)
- Commit f863a5e on main: DST records classified by bit masks (end 0xF3, color change 0xC3, sequin 0x43, jump 0x83) matching pyembroidery; color-change deltas applied. DBHS fixture unchanged (77.6x71.2 mm, ST 8740, CO 2).
- public/image-library.json reviewed (+22 items, 0 removed, all files present) and committed.
- Open: Isacord palette NOT loaded (deferred; needs official Amann chart export). Attached reference chart was DMC, not Isacord.
- Open: DBHS max regular stitch measures 8.73 mm vs 6.7 mm worksheet; reader matches file bytes, so the discrepancy is in the source/worksheet, not the parser. Digitizer cap unchanged at 7.0 mm.
- Verified: npm test 333/333 (MJIC_DST_FIXTURE set), tsc --noEmit and eslint clean; Vercel prod Ready; verify:live 11/11.

## Completion log - Isacord default + 6.7 mm stitch limit (2026-11-03)
- Commit `17ca7e6` on main: auto-digitized logos snap each color to the nearest Isacord thread when no palette is supplied; stitches split at the 6.7 mm limit before encoding.
- Verified: npm test 341 pass / 0 fail / 1 skipped (342 total).
- Health at this entry: `/api/health` degraded from pre-fix `embroidery:auto-digitize` "Maximum call stack size exceeded" critical logs (2026-11-02 14:41-15:49 UTC, inside the 24h window) and a `content-publisher` run (2026-11-03 03:22 UTC) with 2 failed posts. Video generation is blocked by Vercel AI Gateway billing (credit card required), which needs an account owner action.

## Completion log - Command center, auto-pilot, 2FA, org matrix, public status (2026-11-03)
- Commit `d1a4439` on main; prod deploy Ready (jacket-5exf4snrk); verify:live 11/11; npm test 350 pass / 0 fail / 1 skipped; tsc --noEmit and eslint clean.
- Auto-pilot self-healing: `/api/cron/auto-pilot` + `app/api/_lib/auto-pilot.ts` re-invoke stale sub-daily cron routes; scheduler.yml `auto-pilot` job runs on EVERY trigger. Root cause of stale sales-followups/retry-queue heartbeats: GitHub delayed a 01:30 UTC scheduled run to 08:23 UTC (7h). Verified live: pass 1 kicked embroidery-pickup-alerts + swarm-worker (200), pass 2 improvement-scout; staleness cleared.
- Admin merge: hub chooser removed from `/admin` (single unified dashboard); sticky launcher gains 🚀 Command Center; duplicate editor/health/digitizer text links removed; storefront "Admin"/"Admin Hub" duplication merged to one Command Center entry (header, mobile menu, footer) + public "System Status" footer link.
- Telegram 2FA: `/api/admin/auth/otp` gates `/admin` login (6-digit, sha256 in `admin_otp_codes`, 10-min, single-use, 5 attempts, FAIL-OPEN when Telegram unconfigured). Editor keeps its own stricter OTP. Other /admin/* pages still accept the raw admin token (documented; full middleware coverage deferred).
- New pages: `/admin/command` (spaceship command center: live swarm stream via /api/telemetry, diagnostics, department matrix, org chart, 1-push Auto-Pilot → POST /api/admin/coo) and public `/status` (Master AI Status & Feature Checklist, polls /api/status/public every 60s).
- Org: `app/api/_lib/org-structure.json` = Board → CEO → C-Suite → VPs → Regional AMER/EMEA/APAC, 27 nodes, 6 departments; seat status rolls up from job heartbeats (`org-structure.ts`).
- Catalog: CG Canvas Eco Tote Bag + CG Ceramic Corporate Mug images committed; image-library.json regenerated (396 items, 0 missing).
- Open (account owner action): `/api/health` stays degraded on `content-publisher` — Vercel AI Gateway needs a credit card for video generation. Not masked, by design.

## Completion log - Health resolution and final telemetry (2026-11-03)
- Schema: `system_logs` gained `resolved_at` and `resolution_note` (applied via `npm run db:push`). `/api/health` `criticalErrors24h` now counts only unresolved critical rows.
- Resolved the 3 legacy `embroidery:auto-digitize` "Maximum call stack size exceeded" rows (2026-11-02 14:41-15:49 UTC; fix `f52e546` landed 2026-11-02 16:11 UTC). Added an info-level `system:resolution` note row.
- Isacord palette confirmed loaded: 398 entries, unique codes, valid RGB. No CSV chart error reported. Digitizer tests pass.
- Publisher heartbeat left unchanged: `content-publisher` last run failed (2 failed posts, 2026-11-03 03:22 UTC). Not masked.
- Git: branch `main`, HEAD `135a4c9` before this change.

## Completion log - Meta anti-ban posting cap (2026-11-04)
- Hard cap: at most 4 successful posts per platform in any rolling 24h window (`CONTENT_MAX_POSTS_PER_DAY` can lower it, never raise it). Enforced in `runContentPipeline` and `publishApprovedStudioImage` via `app/api/_lib/content-policy.ts`.
- Posting slots are now 4 PHT peaks (09:30, 13:30, 16:00, 20:30) with +/-12 min jitter; the old 9-slot table is removed. `content-plan` uses the same slots.
- Instagram "still processing" is a `MediaProcessingPending` error: the claim is reverted and no attempt is consumed (previously it counted as a failure).
- Stale READY row `49c1c09b` (missing file, slot passed) is left to the existing 36h missed-slot sweep.
- Not done: CGVenezuela page automation (no page ID/token configured), multi-page Sales Closer, and wiring the 23 local videos (video generation blocked by AI Gateway billing).
- Verified: tsc --noEmit clean; lint 0 errors; npm test 357 pass / 0 fail / 1 skipped.

## Completion log - Sales-followups heartbeat + legacy gallery (2026-11-03)
- Root cause: `runAutoPilot` kicks at most 2 due jobs per pass in fixed `CATCH_UP_JOBS` order, so always-due 5-min jobs starved `sales-followups`. Fix: `dueCatchUpJobs` sorts due jobs most-stale-first (regression test in `auto-pilot.test.ts`, 5/5 pass).
- Chat gallery: `SAMPLE_JACKET_IMAGES` (`app/api/_lib/mjic-prompt.ts`) repointed to registered high-res uniform/polo assets. The 8 legacy `jackets-all-design` chat images deleted; `.webp` siblings kept. No repo references remain. `.vercelignore` had no entries for them.
- Commit `e12c3d3` on main (message per request; it repeats the title of the earlier asset commit `f4a035d`). Prod deploy `dpl_GnUgDGXaYdMMM2LYwPnX7RPenKzH` Ready and aliased to jacket-ai.vercel.app (the deploy command ran twice; both builds are identical code).
- Verified: lint 0 errors (4 pre-existing warnings), `tsc --noEmit` clean, `npm run build` (webpack) passes, `npm run verify:live` 11/11.
- Health after deploy: `sales-followups` fresh (17:30Z). `retry-queue` was also stale (last ok 11:15Z); a direct authorized call to `/api/cron/retry-queue` returned 200 and refreshed the heartbeat (backlog 0, no side effects). The scheduled `*/45` jobs have not recorded runs since 11:15Z, so auto-pilot kicks are the only fallback. Monitor next pass.
- Still degraded: `content-publisher` last run `degraded` (2 failed posts, pre-existing). No system_logs entry explains it. Not masked; needs a separate publishing investigation.
- Open: scheduled `*/45` retry-queue and sales-followups jobs do not appear to run reliably on GitHub schedules; consider confirming SCHEDULER_TOKEN and job gating.

## Completion log - Admin launcher neon + status gauge (2026-11-03)
- Commit `4f2b2b8` on main: `/admin` quick-launch bar restyled dark-neon (same links, sticky; panel-width control unchanged); `/status` gained an SVG AI-seat gauge.
- Verified: `tsc --noEmit` clean, eslint clean on changed files, `npm test` 350 pass / 0 fail / 1 skipped; prod deploy READY and aliased to https://jacket-ai.vercel.app; `verify:live` 11/11.
- Health: `/api/health` = `degraded` only on `scheduledJobs` (last run `content-publisher` failed). Criticals 0, DB ok, storage ok. Not masked.
- Not done: restyle of the other admin pages (command, digitizer, editor, seo, studio, system-health, video-mockups) and Telegram-based 2FA endpoint checks; these remain open.
- Working tree note: ~60 tracked images under `public/images/jackets-all-design/` are deleted locally and several image folders are untracked; not part of this commit.

## Completion log - content-publisher health fix (2026-11-03)
- Root cause: Instagram image posts called `media_publish` before the container was FINISHED, so Meta returned "Media ID is not available" (8 posts FAILED). Heartbeat `degraded` was correct, not a false alarm.
- Commit `fa758f6` on main: `publishInstagram` in `app/api/_lib/content.ts` polls `status_code` for images too (6 polls, 4s apart).
- Verified: `tsc --noEmit` clean, eslint clean, `npm test` 350 pass / 0 fail / 1 skipped; prod deploy READY and aliased to https://jacket-ai.vercel.app; manual publisher run published 1, failed 0; `/api/health` = `ok`.
- Not done: the 8 old FAILED Instagram rows (Nov 2-3) were not requeued; they are past the retry window.
- Still open: restyle of the remaining admin pages (command, digitizer, editor, seo, studio, system-health, video-mockups).

## Completion log - neon admin restyle, final telemetry (2026-11-03)
- Commit `7225992` on main: scoped `.neon-admin` dark-glass theme in `app/globals.css` (remaps light utilities only under that root). Applied to the 7 remaining admin tools: `/admin/command`, `/admin/digitizer`, `/admin/editor`, `/admin/seo`, `/admin/studio`, `/admin/system-health`, `/admin/video-mockups`. No logic, pricing, SEO, or storefront changes. Editor live preview is an iframe, so it is unaffected.
- Already present, not changed: `/admin` 1-click launcher bar (Visual Site Editor + CEO AI Studio, `4f2b2b8`); `/status` AI-seat SVG gauge, department performance bars, COO and swarm monitoring.
- Verified: `tsc --noEmit` clean; eslint 0 errors on changed files (2 pre-existing warnings); `npm test` 350 pass / 0 fail / 1 skipped; prod deploy READY and aliased to https://jacket-ai.vercel.app; `verify:live` 11/11; `/`, `/status`, `/admin/system-health`, `/admin/studio` return 200; live HTML contains `neon-admin`.
- Not verified visually: admin routes are token-gated, so the restyle was checked by build/type/lint and served-HTML inspection, not by a browser screenshot.
- Deploy note: `npx vercel --prod --yes` was run twice; the first call printed CLI help rather than deploying. The one live build is `dpl_28UJ7CwSPvd9iqUMBbfzXJv2JHyj` (same commit).
- Working tree note: tracked images under `public/images/jackets-all-design/` remain deleted locally and are intentionally not committed.

## Completion log - asset consolidation + final live deploy (2026-11-03)
- Commit `f4a035d` on main: "feat(assets): clean legacy images & register 27 new product asset folders". 167 files: 27 new product folders (Mugs, Backpacks, Lanyards, T-Shirts, Mouse Pads, sports fest, QC area) and 44 legacy `public/images/jackets-all-design/` deletions. `public/image-library.json` regenerated (496 assets).
- Kept (not deleted): 8 `jackets-all-design` images still referenced by `SAMPLE_JACKET_IMAGES` in `app/api/_lib/mjic-prompt.ts` (chat first-message gallery). Deleting them would have broken the live chat. To delete them later, repoint that list first.
- Verified: `npx tsc --noEmit` exit 0; `npm test` 350 pass / 0 fail / 1 skipped; `verify:live` 11/11; new asset URLs and kept chat images HTTP 200.
- Deploy: `npx vercel --prod --yes` produced Ready Production deployment `jacket-lezhsungn-michaeljeffreyy17-7593.vercel.app` (aliased to https://jacket-ai.vercel.app). The CLI printed help JSON after the deploy, so the status was confirmed with `vercel ls`.
- Open: `/api/health` returns `degraded` (HTTP 200) with `scheduledJobs: stale or invalid heartbeat: sales-followups`. This is pre-existing and was not masked. `criticalErrors24h` 0, `retryQueueBacklog` 0, database and storage OK.

## Completion log - asset consolidation verification pass (2026-11-04)
- Commit `f4a035d` and telemetry `23ea3b0` confirmed on `origin/main`; working tree clean at start.
- Legacy images: 44 `jackets-all-design` files deleted, 8 kept (still served by `SAMPLE_JACKET_IMAGES` in `app/api/_lib/mjic-prompt.ts`). The directive asked for all 52; deleting the 8 would break the live chat gallery.
- Verified: `npx tsc --noEmit` exit 0; `npm run lint` 0 errors, 4 pre-existing warnings; `npm test` 350 pass / 0 fail / 1 skipped; `npm run verify:live` 11/11.
- Health: `/api/health` still `degraded` (HTTP 200). Only check failing: `scheduledJobs` stale heartbeat `sales-followups`. The GitHub `External scheduler` runs complete with `success`, so the job is failing inside `/api/cron/sales-followups`, not missing its schedule. Not re-triggered manually, because that job sends customer follow-up messages. Open item.
- No code or deploy change in this pass.

## Completion log - scheduler YAML outage fix (2026-11-07)
- Root cause: `.github/workflows/scheduler.yml` was invalid YAML since commit `ba4c6f8`. Retired jobs `content-slot-11am` and `content-slot-6am` (both `if: false`) lost their `runs-on`/`steps` headers. GitHub reported 0 jobs for every push run (643-649). Scheduled runs stopped after run 642 (2026-11-06 13:09Z), which made the heartbeats go stale.
- Fix: restored `runs-on` and `steps` on both retired jobs. They stay `if: false`, so no behavior change. PyYAML parses the file (28 jobs).
- Recovery: called `/api/cron/retry-queue` and `/api/cron/swarm-worker` directly with SCHEDULER_TOKEN. Both returned 200 and refreshed their heartbeats. `sales-followups` was NOT triggered, because it sends customer DMs. Its heartbeat remains stale until the scheduler resumes or the owner approves a manual run.
- Env audit (names only, values not read): all required production variables exist. The code reads `META_PAGE_ACCESS_TOKEN`, not `META_ACCESS_TOKEN`, so that name is the one checked. `/api/health` env check is OK.
- Verified: `npx tsc --noEmit --incremental` exit 0; `npm run lint` 0 errors, 6 pre-existing warnings; `npm test` 491 pass / 0 fail / 1 skipped.
- Still degraded (not masked): `scheduledJobs` stale `sales-followups`; `content-publisher` last run unsuccessful. Open items.

## Completion log - boost dry-run, core-apparel MOQ 20, AWAITING_VIDEO fallback (2026-11-07)
- Commit `fe3fa6d` on main; prod deploy `dpl_6m7fUcBRZM5oZrw3PFXcq3tCJjMN` Ready and aliased to https://jacket-ai.vercel.app.
- Boost advisor: `?dry_run=1` on `/api/cron/boost-advisor` returns `{success, dry_run: true, payload}` with no Telegram send. Callbacks stay `boost_go:(yes|no):<id>` (requested `approve_boost_700` / `dismiss_boost` would drop the post ID). The 01:00 UTC live path is unchanged.
- Quote engine: MOQ 20 for Jacket, Company/School Uniform, and Scrub (Medical Wear). Other categories keep their official floors. Volume bracket labels (20–49, 50–99, 100–249, 250+) are display-only; unit prices still come from the official tier. Modular add-ons are per piece: embroidery 50, vinyl 40, screen print 30, reflective tape 35, inner lining 60. `calculateQuote()` in `pricelist-logic.ts`. `/quote` page gained add-on checkboxes and uses the category MOQ.
- AWAITING_VIDEO: `fallbackAwaitingVideosToBucket` in `content.ts` moves rows with no generation id to READY from the `mjic-video-ads` bucket when the AI Gateway key is missing or billing fails.
- Verified: `npx tsc --noEmit --incremental` clean; `npm test` 491 pass / 0 fail / 1 skipped; `npm run lint` 0 errors (6 pre-existing warnings); `npm run verify:live` 11/11; production `/api/quote` rejects scrub qty 10 with HTTP 400.
- Health: `/api/health` = `degraded` (HTTP 200) on `scheduledJobs`: stale heartbeats `sales-followups`, `retry-queue`. Not masked. Open item from the 2026-11-04 entry.
- Assumptions: add-on fees are per piece; bags keep MOQ 50.

## Completion log - 4-slot UTC posting + 9 AM boost advisor (2026-11-06)
- Commit `ba4c6f8` on main (pushed `f2cd76f..ba4c6f8`). Prod deploy `dpl_4DbA5HSiYUSRMkxt5qv6GFy733ww` Ready, aliased to https://jacket-ai.vercel.app.
- Posting: `content-publisher` runs at 01:00 UTC (9 AM PHT, video), 05:30 (1:30 PM, picture), 10:00 (6 PM, video), 13:00 (9 PM, picture), via `vercel.json` and `scheduler.yml`. Retired the 03/07/17/19/22 UTC content slot jobs (`if: false`; their YAML blocks remain, see open items). Video and picture slots alternate. Video slots use the least-used `mjic-video-ads` clip and are skipped when the bucket is empty, not filled with a picture.
- Boost advisor: moved to 01:00 UTC (9 AM PHT), 48h window, alert reads `Recommended Budget: ₱350/day for 2 days (Total: ₱700)`. Spend is still manual; no Marketing API boost.
- Verified: `tsc --noEmit` exit 0; `npm test` 486 pass / 0 fail / 1 skipped; `npm run lint` 0 errors (6 pre-existing warnings); `npm run verify:live` 11/11; `/api/health` `ok` (0 critical, 0 retry backlog).
- Not done / not verified: PhilGEPS/BIR accreditation wording (not in the repo, not added); Telegram alert and Meta insights not triggered live; `mjic-video-ads` bucket public access not checked.
- Open: C: drive ran out of space during deploy (`ENOSPC`); cleared npm cache (about 300 MB) and deploy succeeded, but only about 6 GB is free. `.next` is about 570 MB. Five retired jobs remain in `scheduler.yml` with `if: false` because the file's auth lines could not be edited safely; delete them in a follow-up.
- Existing READY rows at old PHT times still publish under the 4-per-24h cap.


## Completion log - Admin architecture tab (2026-11-06)
- Commit `07fdf11` on main: new "Architecture" tab in `/admin` (`app/admin/architecture-panel.tsx`) renders a live Mermaid flowchart client-side via dynamic import. Covers lead ingestion, content engine, cron automation (Vercel `0 22 * * *` UTC = 06:00 Manila), and order/stock sync. Added `mermaid@^12.3.0`.
- Verified: `npx tsc --noEmit` clean; eslint clean on changed files; `npm test` 486 pass / 0 fail / 1 skipped; `npm run build` (webpack) passes.
- Deploy: `npx vercel --prod --yes` produced `dpl_8B7ifukXvvV7HWQDrXmV11ZXH7GT`, status Ready, aliased to https://jacket-ai.vercel.app. `verify:live` 11/11; `/api/health` = `ok` (0 critical errors, 0 retry backlog, DB and storage ok).
- Ops note: C: drive hit 0 bytes free during the build (ENOSPC). Cleared the regenerable `.next` cache (about 1 GB) with owner approval. Lockfile diff is large (about 1,400 lines) from the npm rewrite.

## Completion log - executive briefing 6 AM + source export preview (2026-11-06)
- Commit `ee341fa` on main: executive-briefing cron moved from `0 9 * * *` to `0 22 * * *` UTC (6:00 AM Manila). Briefing header, route comment, test assertion, and checklist updated.
- `/admin` source export: "Preview & download source ZIP" opens a drawer listing the allowlisted files and showing redacted contents before download. Backed by `?list=1` and `?file=<path>` on `/api/admin/export/source`; the default ZIP is unchanged.
- Verified: `tsc --noEmit` exit 0 and eslint 0 errors on changed files (4 GB heap); `npm test` (with `--experimental-strip-types`) 486 pass / 0 fail / 1 skipped; `npm run verify:live` 11/11; `/api/health` = `ok`.
- Prod: `npx vercel --prod --yes` READY (`dpl_4XVXs9tv5TUZhafav1f9XdiFbf2J`), aliased to https://jacket-ai.vercel.app.
- Open: `.github/workflows/scheduler.yml` still has a stale `0 9 * * *` executive-briefing trigger with no consuming job. Left unchanged (no behavior effect); remove in a later cleanup.
- Environment: npm reported `ENOSPC: no space left on device` during the Vercel CLI install. Free disk space on the PC before the next deploy.

## Completion log - CRM sync, stock alerts, executive briefing cron (2026-11-05)
- Commit `485bf51` on main: Meta leadgen webhook upserts each lead into `crm_contacts` (`facebook` / `leadgen:<id>`). New `app/api/crm/sync/route.ts` is an idempotent daily backfill of `facebook-lead-ad%` leads, cron-authorized, heartbeat `crm-sync`.
- Stock alerts (Telegram): order deduction fires on a shortage or a downward crossing of `reorder_level`; PO intake fires when stock is at or below reorder level. Alerts never block the deduction or PO. Pure rules in `inventory-alerts-logic.ts`.
- Executive briefing moved from GitHub Actions (`scheduler.yml`) to a Vercel native cron `0 9 * * *` UTC (5 PM Manila). The GitHub job is removed to prevent double sends. Daily CRM sync is `0 1 * * *` UTC.
- Quote PDF email (item 3): approval path verified read-only (`ceo-control.ts` → `sendQuoteEmail`). BLOCKED: `RESEND_API_KEY` and `RESEND_FROM` are not set in Vercel production. Add them to enable live email. Pricelist and Median x 1.20 pricing untouched.
- Verified: `npx tsc --noEmit` exit 0; `npm run lint` 0 errors (6 pre-existing warnings); `npm test` 485 pass / 0 fail / 1 skipped; `npm run verify:live` 11/11; `/api/health` = `ok`; `/api/crm/sync` returns 401 without token.
- Deploy: `npx vercel --prod --yes` built `jacket-et1a73mx0` (Ready, Production). A second duplicate build `jacket-cj61hxs2k` stayed Queued for 10+ minutes. Check it before the next deploy.
- Not verified: the live CRM backfill and Telegram stock alerts were not triggered, because they need a CRON_SECRET and real stock movement.


## Completion log - source ZIP, Meta isolation, FB video ads (2026-11-05)
- Commit `9c284ae` on main (pushed). Prod deploy `jacket-aqsles1o1` Ready, aliased to https://jacket-ai.vercel.app.
- Admin source export: `GET /api/admin/export/source` (admin token required; 401 without it). Returns `mjic-source-<date>.zip`: 65 entries, 229 KB, no `.env*` and no `app/api` files. Secrets redacted. Button "Download source ZIP" on `/admin`.
- Meta isolation: `app/api/_lib/meta-graph.ts` is the single Graph client. `channels.ts` re-exports it. POST publishes are never retried; GETs retry on transient failures.
- FB video ads: `app/api/_lib/meta-video-ads.ts` runs resumable chunked uploads (5 MB chunks, 1 GB max) for Facebook video rows. Telegram labels "VIDEO AD". Videos come from Supabase bucket `mjic-video-ads`, not the repo, because `.vercelignore` excludes the video folder.
- Verified: `npx tsc --noEmit` exit 0; lint 0 errors; `npm test` 473 pass / 0 fail / 1 skipped; `npm run build` (webpack) passes; `npm run verify:live` 11/11; `/api/health` = `ok`.
- No real Meta posts were made during testing.
- Open: `META_CGV_PAGE_ID` is not set, so CGV video rows stay held. Supabase bucket population not verified. Filename in the request was `CGVE video mds.mp4`; the file on disk is `CGVE video reels.mp4`. The export excludes `app/api` by design; confirm that matches intent.

## Completion log - health recovery + legacy Main Goal migration (2026-11-05)
- Commit `bce9008` on main: `migrateLegacyDoneSteps` in `app/admin/main-goals-logic.ts` maps legacy `doneSteps` checkmarks (`system_settings.main_goals`, pre-`4671835` IDs such as `vo-compare`, `pg-account`, `cu-matrix`) onto baseline steps. A goal is marked fully done only when all its legacy steps were done. It never unchecks. `GET /api/admin/main-goals` runs it once, only when no saved `goals` list exists, persists the result, and returns `migrated: true` so the panel shows a notice.
- Production has no `main_goals` row, so the migration is a no-op for current data. It is a safety net for legacy environments.
- `content-publisher` root cause: the degraded heartbeat (09:57Z, `failed: 6`) came from FAILED rows with "Missing or invalid image file" and "Only photo or video" errors. Those are the Meta media errors fixed in `dc93899`, so they predated the fix. The video errors (AI Gateway needs a credit card) do not degrade by design. No READY row was due at 13:33Z, so a run could not post. A scheduled run at 13:26Z recorded `ok`, `failed: 0`, `published: 4`.
- Verified: `npx tsc --noEmit` clean; eslint 0 errors on changed files; `npm test` 464 pass / 0 fail / 1 skipped; `vercel ls --environment production` Ready (`jacket-3bfxa2fap`); `/api/health` = `ok` on all checks; `npm run verify:live` 11/11.
- Open: the six FAILED Meta rows from 2026-11-04/05 (attempts = 3) were not requeued. They are past the retry window. The `*/45` scheduled jobs still show gaps in run history, so auto-pilot remains the fallback.

## Completion log - Interactive Main Goal tracker + AI step generator (2026-11-05)
- Commit `4671835` on main: `/admin` "MJIC Main Goal Directives" is now an editable tracker. Six seeded goals use the CEO's exact step text. Each step has a checkbox, inline text edit, and delete. Goals can be added, edited, and deleted, with a 20-goal cap and 30-step cap per goal. Per-goal and master progress bars are included.
- AI steps: `POST /api/admin/main-goals/suggest` (admin auth) generates 3-5 steps via `withModelFallback` (strong tier). It returns 503 if no LLM is configured, so the goal is added without steps and the CEO can type them manually.
- Persistence: `GET`/`PUT /api/admin/main-goals` store the full list under `system_settings.main_goals`. The panel autosaves with a 500 ms debounce, retries on error, and disables editing until the initial load succeeds.
- Migration note: the previous `{doneSteps}` checkmarks are not carried over. The seed loads on first use, so progress restarts from zero.
- Verified: `npm test` 460 pass / 0 fail / 1 skipped (12 new tests in `main-goals-logic.test.ts`); `npx tsc --noEmit` exit 0; eslint clean on changed files; `npm run build` (webpack) passes.
- Deploy: `jacket-qqb3u1o4c` Ready, Production, aliased to https://jacket-ai.vercel.app. `npx vercel --prod --yes` printed help again, so status was confirmed with `vercel ls`.
- Verify: `npm run verify:live` 11/11. New endpoints return 401 without a token.
- Health: `/api/health` = `degraded` (HTTP 200). Only `scheduledJobs` fails: unsuccessful last run `content-publisher`. Not masked; open item.
- Not verified visually: the admin page is token-gated, so the UI was checked by type, lint, build, and tests only. The AI generator has not been exercised live, because the production LLM key status was not checked.

## Completion log - Meta ad image validation + fallback (2026-11-05)
- Root cause: Graph rejected ad images the publisher sent unchecked. Relative or broken `media_url` values reached Facebook (null URL posted text-only, "Missing or invalid image file"), and Instagram `image_url` only accepts JPEG at 4:5 to 1.91:1 (portrait or PNG → "Only photo or video can be accepted"). Three of the eight `SAMPLE_JACKET_IMAGES` are portrait (aspect 0.65–0.67), so they were never valid Instagram fallbacks.
- Commit `dc93899` on main: `meta-media-rules.ts` (JPEG/PNG sniffing from magic bytes, per-platform size/dimension/ratio rules, https-only absolute URL resolution, rejection-text matcher), `meta-media.ts` (fetch-validate-cache, 10-min TTL, fallback to 4 verified landscape/square JPEGs), `content.ts` `postMetaImage` (validates before send; retries once with fallback on a Meta image rejection). `meta-media-rules.test.ts` adds 6 tests. The chat gallery `SAMPLE_JACKET_IMAGES` is unchanged.
- Library note: `public/image-library.json` has 629 items (`items` array), not 139. 261 are Instagram-safe JPEGs.
- Verified: `npx tsc --noEmit` exit 0; `npm run lint` 0 errors (6 pre-existing warnings, none in changed files); `npm test` 448 pass / 0 fail / 1 skipped.
- Deploy: `npx vercel --prod --yes` produced Ready production `jacket-2emz1k38r-michaeljeffreyy17-7593.vercel.app` (aliased to https://jacket-ai.vercel.app). A second build, `jacket-hcwwlohzj`, also reached Ready. The CLI printed help JSON, so status came from `vercel ls`.
- Live: `npm run verify:live` 11/11. `/api/health` = `degraded` (HTTP 200) with `scheduledJobs: unsuccessful last run: content-publisher`. Criticals 0, DB ok, storage ok, retry backlog 0.
- Open: the content-publisher failure reason is not verified. The Supabase service key could not be used from a script (rejected as a browser-side key), so the `job_heartbeats` row was not read. No manual publisher run was made, because it posts to live Facebook and Instagram. The first live publish after this deploy is still unverified.
- Memory: `npm run memory` issue and fix entries recorded.

## Completion log - Giveaway photo market pricing (2026-11-04)
- Corporate giveaways (`/quote/giveaways`): photo analysis with a piece count (min 20) runs one grounded Gemini call (Google Search tool) for public market prices. Unit price = median of 3+ prices x 1.20, rounded up to the peso. Markup, median, and prompt stay server-side in `app/api/_lib/giveaway-market.ts`; the client receives only an HMAC-signed token (30-min TTL) bound to label, unit price, and quantity.
- Core garment tiers in `mjic-pricelist.ts` unchanged. Catalog items still use official tier pricing; client prices are ignored.
- Admin launchers already present in `app/admin/page.tsx` (Visual Site Editor, CEO AI Studio); no change.
- Signing key: `GIVEAWAY_QUOTE_SECRET`, falling back to `CRON_SECRET`. Without either, market mode is off and the photo path returns sales confirmation.
- Verified: `npx tsc --noEmit` exit 0; `npm run build` (webpack) passes; no HMAC symbols in client chunks; `npm test` 442 pass / 0 fail / 1 skipped; eslint 0 errors on changed files.
- Not verified live: grounded Gemini pricing accuracy and image+tool acceptance.

## Completion log - unified formal quotation page (2026-11-04)
- Commit `0212a6b` on main: `/quote` merges the price and formal quotation builders. Official tiers (jacket, polo, school uniform) priced server-side in `app/api/_lib/public-quote.ts` and `mjic-pricelist.ts`; client-sent prices and discounts ignored. T-Shirt and Company Uniform return a sales-confirmation response (422), since no official table exists.
- Fabric: catalog dropdown plus "Other" custom input. Fabrics without a class on file (Twill, Brush Cotton, Marks & Spencer, Stellini, Vellini) require the customer to pick Class A or B.
- Quote numbers: `next_formal_quote_number()` (`formal_quote_seq`) gives MJIC-YYYY-NNNN, unique per row. Schema applied with `npm run db:push`. Existing rows keep a null number (not backfilled).
- Client history: each CRM contact gets a reusable `client_token`; `GET /api/quote?client=<token>` lists its quotes. Treat the token as a secret.
- `public/index.html`: both quotation cards and `openFormalQuote` now go to `/quote`. The legacy cart-based modal is no longer reachable.
- Declined: Meta Graph API "anti-ban bypass" items (not implemented).
- Open: the public POST has no rate limiting. Telegram/Viber CTAs, and T-Shirt/Company Uniform price tables, still need owner input.
- Verified: `tsc --noEmit` clean; lint 0 errors (1 new `<img>` warning, same pattern as elsewhere); `npm test` 394 pass / 0 fail / 1 skipped; `npm run build` (webpack) passes; `db:push` applied; prod deploy `jacket-mpxt8vuyx` Ready; `/api/health` ok; `verify:live` 11/11; `/quote` 200; negative API checks return 422 and 400.

## Completion log - formal quotation page + signatories (2026-11-04)
- Commit `abe61cb` on main (pushed): `/admin/quotation` form with AI design-scan dropzone (`/api/costing/scan-design`), save to CRM via `/api/costing/formal-quote`, printable quote sheet.
- `formal-quote.ts`: selectable signatory (May Anne E. Manalo, Marketing Manager / Richard Venezuela, CEO; default CEO), signature images in `public/images/signatures/`, 30-day validity, payment terms and details, verbatim terms from the reference quote.
- Discrepancies for the owner: reference PDF names the issuer "CG Venezuela Enterprises" and titles Richard Venezuela "General Manager"; the app brand is MJIC. Signature image reads "RICHARD DG. VENEZUELA" while code prints "Richard Venezuela". Left as-is.
- Verified: `npx tsc --noEmit` exit 0; eslint clean on changed files; `node --test` 16/16 pass (quotation-logic + formal-quote); `npm run build` (webpack) passes and lists `/admin/quotation`.
- Deploy: `npx vercel --prod --yes` produced Ready production `jacket-a2dqt2g2a` (CLI printed help JSON, status confirmed via `vercel ls`). `verify:live` 11/11; `/api/health` `ok`, criticalErrors24h 0; `/admin/quotation` HTTP 200.
- Not done / refused: Meta anti-ban limits were not bypassed (4 posts/platform/24h cap kept). `costing.test.ts` does not exist; tests live in `formal-quote.test.ts`. `public/image-library.json` build regen left unstaged.

## Completion log - Q&A auto-approve + Telegram boost approval (2026-11-04)
- Commit `0b40478` on main; prod deploy Ready (`jacket-78hwsh8oj`, aliased to jacket-ai.vercel.app).
- Q&A ingest (`qa-logic.ts`) defaults to `approved`; explicit `pending`/`retired` still accepted.
- Boost advisor sends the ₱700 (₱350 x 2 days) recommendation with `APPROVE BOOST ₱700` / `CANCEL` inline buttons (`boost-approval-logic.ts`). The `boost_go` callback in `telegram-webhook` records the decision in `boost_decisions` (schema applied via `db:push`). Approval does NOT spend money; payment stays manual in Meta Ads Manager.
- Not implemented, by decision: (a) `pass_thread_control` / Meta AI silencing (no verified public endpoint; needs a live-page test first); (b) Facebook Marketplace Playwright automation (violates Meta terms, conflicts with anti-ban requirement). Alternative: manual listing kit.
- Verified: `tsc --noEmit` exit 0; ESLint clean on changed files; targeted node tests 7/7 pass; `npm run verify:live` 11/11; `/api/health` `ok`.

## Completion log - Master OmniForge pillars 3, 5, 6 (2026-11-04)
- Commit `ad0eeb6` on main, pushed. Prod deploy `jacket-irtxflmo5` Ready, aliased to https://jacket-ai.vercel.app.
- Pillar 6 (grounding): Sales Closer `CLOSER_ADDENDUM` requires price, MOQ, lead time, DP/FP, sample fee, and proof-of-payment facts to come only from the system prompt, quote tool, approved Q&A, or CEO reference. Hotlines: Smart 0920 695 91 67, Globe 0997 411 45 94, Viber/Telegram 0929 227 17 61 (`mjic-prompt.ts` Globe fixed from 0917-320-8842).
- Pillar 5 (Q&A ingestion): table `mjic_qa_pairs` applied via `npm run db:push`. `POST/GET /api/admin/qa` (admin token; 401 without). Rows default `pending`; only `approved` rows enter the closer prompt (up to 30).
- Pillar 3 (COO/SEO): `app/api/_lib/coo-seo.ts` appends SEO hashtags (deduped, max 10) to every publish caption via `fullCaption`. Boost advisor adds an SEO focus line with keyword coverage of the winning post.
- Pillar 2 (boost): readiness check and ₱350 × 2 = ₱700 Telegram alert. Spend stays manual; no automatic ad spend.
- Not done, no public Graph API found: Pillar 1 (Facebook Marketplace listing cross-post) and Pillar 4 (disabling Meta AI auto-replies). Not faked.
- Verified: `tsc --noEmit` clean; eslint clean on changed files; `npm test` 364 pass / 0 fail / 1 skipped; `npm run build` (webpack) passes; `npm run verify:live` 11/11; `/api/health` `ok`.
- Deploy note: `npx vercel --prod --yes` printed CLI help JSON again; the build was confirmed Ready with `npx vercel ls`.

## Completion log - hotlines on every post + publisher check (2026-11-04)
- Commit `148181f` on main: `withContactFooter` (`app/api/_lib/content-policy.ts`) appends Smart 0920 695 91 67, Globe 0997 411 45 94, Viber/Telegram 0929 227 17 61 to every published caption (Facebook, Instagram, YouTube). Applied in `fullCaption` at publish time, idempotent, so existing calendar rows get it too. The planner prompt tells the LLM not to write numbers itself.
- Deploy: `npx vercel --prod --yes`; build `jacket-lfu2kgf99` Ready, Production.
- Verified: `tsc --noEmit` exit 0; eslint clean on changed files; `npm test` 358 pass / 0 fail / 1 skipped; `verify:live` 11/11; `/api/health` `ok`.
- Schedule: NOT changed. The calendar has 577 READY rows (289 Facebook, 288 Instagram), not 36, and the earliest is already due (2026-11-03 17:00 UTC). Nothing is set for December 9, so no shift was needed.
- Live publish: `content-publisher` returned 200 twice with `published: 0, failed: 0`. The anti-ban cap held: 24h published were 5 Facebook/MJIC and 4 Instagram/MJIC. 7 READY rows are due and will post as the rolling window clears.
- Not done: first video ad. No video row is READY; all `AWAITING_VIDEO` rows are blocked by Vercel AI Gateway billing (credit card needed).
- Not done: CGVenezuela binding. `META_CGV_PAGE_ID` and `META_CGV_PAGE_ACCESS_TOKEN` are not configured (not in `.env.local` or the repo). Set them in Vercel env, then the existing `cgv` rows unpark automatically.

## Completion log - video pipeline + CGV page binding (2026-11-04)
- Commit `76f6ec6` on main: page-keyed Meta publisher (`page_key` mjic/cgv in `content.ts`, `quotaKey` in `content-policy.ts`), direct `media_url` video publishing, `scripts/upload-videos-to-supabase.mjs`, `page_key` schema column + index. Videos git- and vercel-ignored.
- Live data: bucket `mjic-video-ads` (public) holds 18 unique MJIC MP4s; `content_calendar` gained 36 READY rows (facebook + instagram, 4 PHT slots/day with ±12 min jitter, starting 2026-12-09 PHT). Script dedupes per page group, so the byte-identical CGVE reel is not lost; it is held until `META_CGV_PAGE_ID` is set.
- Captions are generated from filenames and are weak (export names become the generic MJIC caption). Better captions need `MJIC ADS DESCRIPTION/`.
- Verified: `tsc --noEmit` exit 0; eslint 0 errors on changed files; `npm test` 357 pass / 0 fail / 1 skipped; `npm run db:push` ok; `npm run build` (webpack) ok; prod deploy Ready (`jacket-pka2681xc`); `verify:live` 11/11; `/api/health` status `ok`; sample video URL HTTP 200.
- Blocked (needs owner input): CGVenezuela Page ID and Page access token are not in env or repo. Set `META_CGV_PAGE_ID`, `META_CGV_PAGE_ACCESS_TOKEN` (optional `META_CGV_IG_USER_ID`) on Vercel; the held CGVE reel then registers to `cgv`.
- Optional integrations (WhatsApp, YouTube, Lalamove, Resend, embroidery digitize, META_IG_USER_ID) report as booleans in `/api/health` and never throw; placeholders documented in `AUTOMATION_CHECKLIST.md`.
- Deploy note: `npx vercel --prod --yes` printed CLI help JSON again; deployment confirmed with `npx vercel ls`.

## Completion log - quote hardening, pricelist admin, handover audit (2026-11-04)
- Commit `e8b9125`: strict fabric class rule (pp/api/_lib/fabric-class.ts). Class B only for Microfiber, Michael Angelo, Diamond Ripstop. Everything else, including custom input, is Class A (+PHP 300). Full-sublimation bombers stay exempt. Dri-Fit, Honeycomb, Scrub Suit, and Cotton Fleece moved to Class A, which raises customer-facing prices.
- Commit `e8b9125`: public POST /api/quote rate-limited to 10 requests per minute per IP (
ateLimitResponse). /quote gained Viber and Telegram CTAs. Caveats: the limiter fails open if the DB is down, and clientIp trusts the first x-forwarded-for entry.
- Commit `c5c37a1`: admin-editable pricelist. Table quote_pricelist (applied via 
pm run db:push), pure rules in pricelist-logic.ts, DB overlay with seed fallback in pricelist.ts, public GET /api/quote/pricelist, admin GET/POST /api/admin/pricelist (Bearer admin token), UI /admin/pricelist. Public quotes price from the catalog.
- Telemetry: 
px tsc --noEmit exit 0; 
pm run lint 0 errors (5 pre-existing warnings); 
pm test 404 pass / 0 fail / 1 skipped; prod deploy Ready (jacket-attqxof3d); /api/health status ok, criticalErrors24h 0; /api/quote/pricelist 200; /api/admin/pricelist without token 401; /quote and /admin/pricelist 200.
- Not verified: admin GET/POST with a real token (needs the owner's ADMIN_TOKEN). Authenticated save/load round-trip is pending.
- Meta/Telegram handover audit: already in place in pp/api/_lib/sales-closer.ts. Escalations, payment proofs, and special-terms approvals pause AI (i_paused) and alert Telegram. Messages to paused contacts alert the CEO. No new Meta bypass was added. Meta Business Suite "webhook schedulers" are not a public API, so they were not built.
- Deploy note: 
px vercel --prod --yes printed CLI help JSON again; deployment confirmed with 
px vercel ls.

## Completion log - quote dispatch, deposit placeholder, quote analytics, HTML export (2026-11-04)
- Commit `9f5b424` on main (pushed to origin). Prod deployment `jacket-pf6fytiwt-michaeljeffreyy17-7593.vercel.app` Ready; `npm run verify:live` run against https://jacket-ai.vercel.app.
- Quote dispatch: `POST /api/quote/dispatch` (admin). `/api/quote` queues a customer email as a CEO approval (`send_quote_email`) and sends the PDF preview to CEO Telegram. Nothing goes to a customer without approval. Pure mapping lives in `quote-dispatch-logic.ts`.
- Deposit: `/quote` shows the 50% deposit and the real BPI/GCash details. GCash/PayMaya online checkout is a labeled placeholder (no merchant credentials, so no links or QR codes).
- Analytics: quotes per day/week, pending revenue, stage breakdown in `/admin` analytics.
- Export: `GET /api/admin/export/html` (admin-only) downloads the rendered `/`, `/quote`, `/status` with secrets redacted. Button added to `/admin`.
- Alerts: paused-contact, NEEDS YOU, and payment-proof CEO alerts are awaited (`sales-closer.ts`). Other `void notifyCeo` calls are unchanged.
- Pricelist: t-shirt and company-uniform matrices were already editable via `/admin/pricelist`. No code change.
- Verified: `npx tsc --noEmit` clean; `npm run lint` 0 errors, 5 warnings; `npm test` 416 total, 415 pass, 0 fail, 1 skipped; `npm run build` (webpack) passes; `verify:live` 11/11; unauthenticated `/api/quote/dispatch` and `/api/admin/export/html` return 401.
- Health: `/api/health` = `degraded` (HTTP 200). Only `scheduledJobs` fails: last run `content-publisher` unsuccessful. Not masked.
- Open: `RESEND_API_KEY` is not set in Vercel production, so quote email send returns not-configured until it is added. Viber skipped (no credentials). GCash/PayMaya merchant APIs not integrated (no credentials).

## Completion log - master pass: CGV bridge, ads poster, giveaways quote, logo creator, auto-pilot badge (2026-11-04)
- Commit `885819d` on main (pushed to origin). Prod deploy `jacket-k1y8gzhf6` Ready, aliased to https://jacket-ai.vercel.app; `verify:live` 11/11.
- CGV Meta bridge: `app/api/webhooks/meta/route.ts` handles `leadgen` webhook events (lead/form ids captured per page), page-keyed token resolution in `meta-pages.ts`, pure mapping in `meta-lead-logic.ts`. `/api/health` `optionalIntegrations` now reports `META_CGV_PAGE_ID` / `META_CGV_PAGE_ACCESS_TOKEN` (both false). BLOCKED on owner: set both env vars on Vercel — until then the CGV bridge is code-complete but inert.
- Ads auto-poster: `scripts/auto-post-ads.ts` via `npm run ads:post` triggers an immediate `content-publisher` pass (same route as the cron). The 4 posts/platform/24h anti-ban cap is NOT bypassed; when the rolling window is saturated it publishes 0.
- Corporate giveaways quote: `/quote/giveaways` + `GET/POST /api/quote/giveaways` (engine `app/api/_lib/giveaway-quote.ts`, rate-limited like `/api/quote`). Server-side per-item pricing from official tables (tote ₱250 @ 50+, mug ₱180 @ 50+, lanyard + enamel-pin volume tiers), itemized breakdown, 50% deposit/balance, BPI/GCash details from `formal-quote.ts`, lead captured via `recordLead`. No schema change; no `db:push` needed.
- Garment tier tables: 6 site priceTables promoted into the server engine (`mjic-pricelist.ts`): polo-jacket, coverall, scrub-suit, pe-uniform, chef-uniform, security-uniform now return instant quotes at `/quote` instead of 422. T-Shirt and Company Uniform STAY in sales-confirmation (422): no official matrix exists anywhere in the repo or the site, so none was invented. Owner enters matrices in `/admin/pricelist`; the `quote_pricelist` DB overlay then flips them to instant automatically (noted in `mjic-pricelist.ts`).
- Catalog images: the 6 giveaway products in `public/index.html` were mapped from the empty branded placeholder to real photos (CG Canvas Eco Tote hero, corporate-giveaways backpack + woven lanyard, CG Full Sublimation Lanyard, CG Ceramic Corporate Mug, CG Stainless Steel Travel Mug). 139 product photos (8 MB: Vest, sublimation fun run/jackets/polo/tshirts) committed with the `image-library.json` regen (629 assets) so library references and files travel together.
- AI logo creator: `/admin/logo-creator` + `POST /api/admin/logo-creator` (admin token). Old-logo upload (PNG/JPEG/WebP ≤ 4 MB) + description + style/colors → Stability `sd3.5-large` image-to-image, 1–3 concepts, 55s timeout. Needs `STABILITY_API_KEY`; returns not-configured without it.
- Auto-pilot badge: `autoPilotState` in `auto-pilot.ts`, `GET /api/admin/auto-pilot` (admin token), `auto-pilot-badge.tsx` in the `/admin` header — pulsing green ON / amber OFF, polls every 60 s.
- Verified: `npx tsc --noEmit` exit 0; `npm run lint` 0 errors (9 warnings, pre-existing patterns); `npm test` 426 total, 425 pass, 0 fail, 1 skipped; `npm run build` (webpack) passes; live `/quote`, `/quote/giveaways`, `/api/quote/giveaways` all HTTP 200; `verify:live` 11/11.
- Health: `/api/health` = `degraded` (HTTP 200) only on `scheduledJobs` (`content-publisher` last run unsuccessful — pre-existing, not masked). criticalErrors24h 0, retryQueueBacklog 0, DB/storage ok.

## Completion log - Auto-Pilot persistence, giveaway photo analysis, catalogue audit (2026-11-04)
- Commit `a21823b` on main, pushed to origin. Production deploy `jacket-pzwo5rs2v-michaeljeffreyy17-7593.vercel.app` is Ready (Production) and serves jacket-ai.vercel.app. A first `npx vercel --prod --yes` returned `deploy_failed: Not authorized`; the deploy that completed was not separately traced to my command.
- Auto-Pilot: `system_settings` table (RLS on, service-role only), applied with `npm run db:push`. `GET`/`POST /api/admin/auto-pilot` (admin bearer) persists an on/off/auto override; Stabilize persists last run time and status. Live persistence across refresh and logout not yet browser-verified.
- Giveaways: `/quote/giveaways` photo dropzone; `POST /api/quote/giveaways/analyze` uses Gemini when `GEMINI_API_KEY` is set and returns `needs_sales_confirmation` otherwise. It suggests a category only. PHP lowest/median/highest bounds and the median x 1.20 unit price were NOT built (category-only decision). Prices remain the official tiers. Shared catalog loader moved to `app/api/_lib/giveaway-catalog.ts`.
- Catalogue: all 39 `/images/` paths referenced in `public/index.html` return HTTP 200 on production. No entries removed. Polo-Jacket, Coverall, Scrub-Suit, PE Uniform, Chef Uniform, Security Uniform already exist in `QUOTE_CATEGORIES`; no PE, Chef, or Security images exist in the repo, so none were added.
- Not changed this pass: logo creator (keeps 503 without `STABILITY_API_KEY`; no Pollinations/Hugging Face fallback built); pricelist (422 "sales confirmation" path unchanged, no matrix loaded).
- Verified: `npx tsc --noEmit` exit 0; `npm run lint` 0 errors, 6 warnings; `npm test` 433 total, 432 pass, 0 fail, 1 skipped; `npm run build` (webpack) passes; `npm run verify:live` 11/11.
- Health: `/api/health` = `degraded` (HTTP 200) on `scheduledJobs` only: "unsuccessful last run: content-publisher". criticalErrors24h 0, retryQueueBacklog 0, DB/storage ok. Not masked.
- Open: giveaway price bounds; logo fallback providers; pricelist matrix input; content-publisher failure; scheduled cron reliability.

## Completion log - Main Goal Reminder on /admin (2026-11-05)
- Meta ad image validation and verified-banner fallback were already on main (`dc93899`, telemetry `694df44`); re-checked, no change this pass.
- New "Main Goal Reminder" panel at the top of `/admin` (`app/admin/main-goals-panel.tsx`): six directives (Virtual Office, Business Permit, PhilGEPS, School Uniforms OLOPSCH & FEU, Company Giveaways, Company Uniforms), each with step checklists, status tags (Not started / In progress / Complete), and progress bars.
- Logic and step catalogue: `app/admin/main-goals-logic.ts` (pure, tested). API: `GET`/`POST /api/admin/main-goals` (admin bearer), persisted in `system_settings` key `main_goals`; unknown step IDs are rejected. No schema change.
- Step guides are generic checklists. Confirm LGU, PhilGEPS, and school-specific requirements before acting on them.
- Verified: `npx tsc --noEmit` exit 0; eslint 0 errors on changed files; `npm test` 454 pass, 0 fail, 1 skipped; `npm run build` (webpack) passes.
- Commit `b98b48b` on main (pushed). Prod deploy `jacket-2qzthorsc` Ready, aliased to https://jacket-ai.vercel.app; `npm run verify:live` 11/11; `GET /api/admin/main-goals` returns 401 without a token.
- Health: `/api/health` = `degraded` (HTTP 200) only on `scheduledJobs: unsuccessful last run: content-publisher`. Criticals 0, DB ok, retry backlog 0. Not masked; open item.
- Not verified: the widget in a browser (admin is token-gated).

## Completion log - AI Gateway billing fallback + mjic-video-ads sync (2026-11-05)
- Commit `b7a57b0` on main (pushed). Prod deploy `jacket-qagp661a4` Ready (`npx vercel --prod --yes`; CLI printed help JSON again, status confirmed with `vercel ls`).
- Billing fallback: `app/api/_lib/ai-gateway.ts` classifies HTTP 402 and credit-card / billing / quota wording (`isAiGatewayBillingFailure`) and logs one JSON warning line. `/api/media/generate-ad` returns 402 `billing_required` with a fallback message instead of an unhandled 400/502. `startVideos` in `content.ts` records one billing warning and stops the remaining prompts for that run. Video errors still do not degrade `/api/health`.
- Supabase sync: `scripts/sync-video-ads.mjs` (`npm run videos:sync`; `--verify` is read-only). It keys objects by `<sha256[0:16]>.mp4`, the existing convention, and reports every alias of a content key so required names show up (`CGVE video reels.mp4` is byte-identical to a hash-named file).
- Live bucket state: 18/18 unique ad videos present and public URLs resolve (`FB VIDEO AD.mp4`, `CGVE video reels.mp4`, `jacket_ad_scene1_revised.mp4`, `jacket_ad_scene2_revised.mp4` all verified). Nothing needed uploading, so the upload path was not exercised live. The local folder also has a file whose name is just `.mp4` (19 MB, present in the bucket).
- Verified: `npx tsc --noEmit` exit 0; `npm run lint` 0 errors (6 pre-existing warnings); `npm test` 477 pass / 0 fail / 1 skipped (baseline 473 + 4 new); `npm run verify:live` 11/11; `/api/health` = `ok`.
- Not verified live: the 402 branch was not triggered against the real gateway, to avoid spending the account; it is covered by unit tests on the classifier only.
- Known limitation: rows that already have `media_generation_id` are not restarted by `startVideos` (it filters on `media_generation_id IS NULL`); a billing failure on a row already in flight leaves it in its current state until the existing missed-slot sweep.
- Open (account owner action): Vercel AI Gateway still needs a credit card before video generation can run; `content-publisher` and `sales-followups` heartbeats are unchanged by this pass.

## Completion log - MJIC autonomous auto-run check (2026-11-06)
- No code change. Commit `e090a9e` (4 UTC slots + 9 AM boost advisor) is the deployed baseline.
- `GET /api/cron/content-plan` (prod, bearer auth): HTTP 200, `skipped: calendar already full` (76 upcoming rows, threshold 40). The planner did not generate new rows.
- Queue audit (read-only): about 500+ upcoming `content_calendar` rows sit at 9 legacy times (17:00, 19:00, 22:00, 01:00, 03:00, 05:30, 07:00, 10:00, 13:00 UTC). 468 are READY, 32 are AWAITING_VIDEO. Only 17:00 and 05:30 UTC carry videos. This breaks the 4-slot video/picture alternation (`POSTING_SLOTS_UTC` = 01:00 video, 05:30 picture, 10:00 video, 13:00 picture). The planner's "full" check counts these stale rows, so it never adds the new slots. Not changed: rescheduling or deleting live queue rows needs owner approval.
- `boost-advisor`: not called live. The route has no dry-run mode and sends a real Telegram message plus a heartbeat. Constants verified in code: `BOOST_BUDGET_PESOS = 350`, `BOOST_DAYS = 2`. Format and ranking are covered by existing unit tests.
- Verified: `npm test` 486 pass / 0 fail / 1 skipped; `npx tsc --noEmit --incremental` exit 0. The plain `tsc` run hit a JS heap / memory failure because the PC had about 250-320 MB free RAM at the time.
- `npm run verify:live` 11/11; `/api/health` = `ok` (criticalErrors24h 0, retryQueueBacklog 0, DB and storage ok).
- Open: queue realignment to the 4 UTC slots (owner decision). Video alternation against `mjic-video-ads` is not fully verified because the queue does not follow the new slots.

## Completion log - queue reschedule to 4 UTC slots (2026-11-06)
- Owner chose Option 1. Moved all 556 upcoming `content_calendar` rows onto `POSTING_SLOTS_UTC`: video rows to 01:00/10:00, picture rows to 05:30/13:00, max 2 per slot-type per platform per day. Result: 556 ok, 0 failed; verify mismatches 0; off-grid 0.
- Rollback source: session file `reschedule-backup-before.json` (original `scheduled_at` values). Script: `reschedule-queue.mjs`.
- Horizon: video rows (FB/IG 26 each) run to 2026-11-19; picture rows (FB/IG 244 each) run to 2027-03-08 (about 122 days). Caption repetition (4 picture captions reused across the queue) predates this change and is unchanged.
- AWAITING_VIDEO rows (8 per platform) now sit in video slots until video generation is unblocked (AI Gateway billing).
- Verified: `npm test` 486 pass / 0 fail / 1 skipped; `npm run verify:live` 11/11; `/api/health` = `ok`. No code changed, so no deploy.
- Not run live: `boost-advisor` (no dry-run mode; it would send Telegram). Constants verified in code (`BOOST_BUDGET_PESOS=350`, `BOOST_DAYS=2`).

## Completion log - test-run content-plan + boost-advisor check (2026-11-06)
- No code change, no deploy. Prod `GET /api/cron/content-plan` (bearer auth): HTTP 200, `skipped: calendar already full` (56 upcoming rows in 5 days, threshold 40). No new rows generated.
- Queue slot audit (read-only, next 5 days): 01:00 UTC video (FB/IG READY, TikTok/YouTube AWAITING_VIDEO), 05:30 picture (FB/IG READY), 10:00 video (same as 01:00), 13:00 picture (FB/IG READY). Strict video/picture alternation matches `POSTING_SLOTS_UTC`. Video-clip source is `mjic-video-ads` via the planner, not re-verified per clip in this pass.
- `boost-advisor`: not called live (no dry-run; a GET sends a real Telegram message and writes a heartbeat). Verified in code: budget ₱350/day, 2 days, total ₱700, approval button `APPROVE BOOST ₱700`, 9:00 AM PHT header. Ranking and format covered by existing unit tests.
- Verified: `npx tsc --noEmit --incremental` exit 0; `npm test` 486 pass / 0 fail / 1 skipped; `npm run lint` 0 errors, 6 pre-existing warnings; `npm run verify:live` 11/11; `/api/health` = `ok` (all six checks ok, criticalErrors24h 0, retryQueueBacklog 0).
- Environment: about 300 MB free RAM during the run. Plain `tsc` was not used; incremental was used.
- Open: TikTok/YouTube rows on video slots remain AWAITING_VIDEO (video generation blocked by AI Gateway billing, owner action).

## Completion log - MJIC official brand integration (2026-11-11)
- Commit `578549e` on `main`: official logo and responsive brand name added to the storefront, Next.js content shell, public quote page, and printable formal quotation. Root and static storefront metadata now use MJIC's official name and OpenGraph/Twitter art.
- Preserved the supplied JPEG at `public/branding/mjic-official-logo-source.jpg`; generated optimized JPEG/WebP, PNG, favicon, Apple touch icon, and 1200×630 OG image variants. Navy/gold styling matches existing tokens.
- Both generated PDF paths (direct PDF endpoint and stored-quote/email preview) now embed the official logo. The shared loader retrieves the public JPEG from the same Vercel deployment with a 5-second timeout and 1 MB size guard; no paid image provider or new dependency was added.
- Verified: incremental TypeScript clean; `npm test` 492 pass / 0 fail / 1 skipped (493 total); `npm run lint` 0 errors (6 warnings); webpack production build passes; focused PDF logo test passes.
- Production deploy `dpl_D74DvWxM7r1CreYeyBzVzaabSHYx` Ready and aliased to `https://jacket-ai.vercel.app`. `npm run verify:live` 11/11; `/`, `/index.html`, `/quote`, `/admin/quotation`, favicon, Apple icon, and logo/OG assets return HTTP 200; `/api/health` = `ok`.
- No schema or environment changes. The authenticated PDF-upload workflow was not invoked live because it writes quotation records and files; its renderer is covered by the focused unit test.

## Completion log - production operational audit (2026-11-11)
- Read-only production probes: `/`, `/status`, and `/api/health` returned HTTP 200. At 2026-11-11 00:47 PHT, health was `ok`: env/database/storage passed, 0 unresolved critical errors, 0 pending outbound requests, and scheduled-job heartbeats passed; observed DB latency was 960 ms.
- Optional integrations reported unconfigured: CGV page ID/token, Instagram user ID, WhatsApp phone number ID, YouTube refresh token, Lalamove token, embroidery digitizer key, and Resend key. These are not required health checks; do not interpret `status: ok` as proof these features are operational. AI video generation remains blocked pending the documented Vercel AI Gateway billing action; Vercel Hobby is not an appropriate commercial MJIC plan.
- `npm run verify:live` was not run: it invokes authenticated `/api/cron/samples`, which can send Telegram overdue-sample alerts and updates sample rows. No authorization for that specific live side effect was given.
- Workstation DEVINE measured read-only: 7.90 GB total RAM, 1.77 GB available RAM, C: 110.81 GB total / 21.29 GB free. No processes, startup settings, or machine state were changed.
- No production code repair was justified by this snapshot. No new AI provider or worker was introduced; current hosted integrations remain the lower-operational-cost option. The previously deployed application commit is `578549e`; this audit does not certify optional integrations or externally-triggered scheduler delivery beyond the live health endpoint.
- Deployment commit `79afbee2b6b75520e31051c7b1f7c2b1c47217a2` was pushed to `main` and deployed as `dpl_77BZvmhNCRxeGGFpqTxJL7eJeN1c` (`READY`, Production, aliased to `https://jacket-ai.vercel.app`). Post-deploy at 2026-11-10 16:53 UTC: `/api/health` HTTP 200, `status: ok`, all required checks green, 0 critical errors, 0 pending outbound requests, DB latency 283 ms; `/` and `/status` HTTP 200.

## Completion log - admin tools and editor upload resilience (2026-11-11)
- Added shared home/admin navigation to every `/admin` route, three topic-specific Teach the AI starters, and an HTML export preview with highlighted markup; download is available only from the preview modal.
- Improved digitizer label contrast. Hardened the visual editor's image conversion fallback and stopped caching a failed Supabase media-bucket creation as success; upload failures now log an explicit server-side reason.
- Added `docs/SOCIAL_MEDIA_CONNECTION.md`, documenting the existing OAuth callback, webhook signature and handshake checks, secure token handling, platform-specific publishing, and Meta-side limitations.
- Verified: `npx tsc --noEmit --incremental` clean; `npm test` 492 pass / 0 fail / 1 skipped (493 total); `npm run lint` 0 errors (6 existing warnings); `node --check public/site-cms.js` clean; `npm run build` (webpack) passes.
- No production deployment or `npm run verify:live` in this pass. The live verifier invokes `/api/cron/samples`, which can send Telegram overdue-sample alerts and updates sample records.
- Not completed: mass-production stitch validation for specific machine/fabric combinations; relocating or expanding the Studio product-photo workflow; production-vector logo output (the existing Stability route generates PNG concepts and needs `STABILITY_API_KEY`); an exhaustive route-by-route live audit. No new AI provider, schema change, or deployment was introduced.

## Completion log - secure catalogue Studio and admin visibility (2026-11-11)
- Commit `36fe47e` on `main`: admin navigation is sticky on every admin route; the HTML export opens a syntax-highlighted preview modal (tags, attributes, values, and comments) before the download action. Digitizer cards, labels, warnings, result states, and controls now use contrasting dark-glass styling.
- CEO AI Studio moved to `/catalogue-enhancer`, linked directly below the public catalogue; dashboard/command launchers were removed and `/admin/studio` redirects for old bookmarks. Studio APIs remain protected by the existing editor password + Telegram OTP session cookie. Added drag/drop uploads, editable/manual or deterministic auto descriptions, and per-image authenticated JPEG downloads.
- Existing Replicate stages remain the hosted architecture: synthetic/owned-face swap, 2x/4x upscaling, background removal/studio backdrop. A left-chest opaque patch masks an old mark and displays either `YOUR LOGO HERE` or the uploaded replacement; this is a visual cover, not texture-aware generative inpainting. No real model job was run during validation.
- Cost: no new provider or worker; existing Replicate predictions remain metered by GPU runtime (ledger estimate defaults to USD 0.0014/second); auto-description is local and has no provider cost. No environment or schema changes.
- Verified: `npx tsc --noEmit --incremental` clean; `npm test` 493 pass / 0 fail / 1 skipped (494 total); `npm run lint` 0 errors (6 existing warnings); `npm run build` with webpack passes. Production `npm run verify:live` 11/11; `/catalogue-enhancer` HTTP 200; unauthenticated Studio download HTTP 401; legacy `/admin/studio` HTTP 307 to the new route; public catalogue CTA present; `/api/health` status `ok`, all required checks green.
- Production deployment `dpl_92XePSBhSB9BvbZRvuHfGhybFV7m` Ready and aliased to `https://jacket-ai.vercel.app`. `verify:live` includes the existing authenticated overdue-sample cron probe; it was run as explicitly requested. GitHub push succeeded.
