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
