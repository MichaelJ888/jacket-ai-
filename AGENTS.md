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
