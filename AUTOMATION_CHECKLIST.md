# MJIC Automation Checklist (Cost-Optimized Agent Protocol)

Read this before starting any new automation, webhook, or deployment task. Reference files by path (`#file`) instead of re-pasting their contents.

## Before building anything new
- [ ] Check `app/api/` for an existing route that already does this (see inventory below) — extend it, don't duplicate it.
- [ ] Check `app/api/_lib/integrations.ts` for an existing helper (Supabase, Telegram, payroll, tasks) before writing a new one.
- [ ] Check `supabase/schema.sql` for an existing table before creating a new one.

## Existing API routes (app/api/)
`chat`, `costing`, `cron/staff-reminders`, `cron/client-pulse`, `cron/embroidery-pickup-alerts`, `cron/memory-archive`, `cron/retry-queue`, `embroidery/auto-digitize`, `leads`, `logistics`, `operations`, `orders`, `order-status`, `payment-verify`, `telegram-notify`, `telegram-webhook`, `test-db`, `webhooks/manychat`, `webhooks/meta`.

- `cron/client-pulse` sends the boss a per-client next-action list (every open order, its stage, how long it's been there, and what to do next) 2x daily at 6AM & 1PM Manila via the `client-pulse` job in `.github/workflows/scheduler.yml`. Stage→action map lives in `app/api/_lib/client-pulse.ts`. Boss updates orders from Telegram: `ORDER <client> | <project> | <total>`, `MOVE <client-or-ORD#> <stage>` (aliases: deposit/paid/po/cutting/embroidery/sewing/qc/packing/ready/shipped/delivered/done/hold/cancel), `CLIENTS` (on-demand list). Bulk-import existing clients: `node scripts/import-orders.mjs clients.csv [--apply]` (dry-run default). The MJIC Client Project Status template (11 milestones) is wired in: `STAGE_MILESTONE` in `client-pulse.ts` maps each order stage to its template milestone (shown as a 📋 line in the pulse), and the template text is stored as a `template`-category `mjic_knowledge_items` row (seeded by `node scripts/seed-status-template.mjs`; `template` is an internal category kept out of customer-facing AI prompts).

- `cron/retry-queue` processes the durable `outbound_request_queue` table (Lalamove booking retries after provider outages); scheduled every 45 min via the GitHub Actions `retry-queue` job in `.github/workflows/scheduler.yml`.

## Build & deploy
- Build command is `next build --webpack` (Turbopack panics on this project's global CSS — do not remove `--webpack`).
- TypeScript errors now block `next build`; the obsolete Next.js 16 `eslint` config and `ignoreBuildErrors` bypass were removed. Run `npm run lint` separately.
- Vercel account is **Hobby tier**: native crons only run once/day. More-frequent jobs are handled by `.github/workflows/scheduler.yml` (GitHub Actions), which calls `/api/cron/staff-reminders?type=watch` every 45 min and `/api/cron/embroidery-pickup-alerts` every 5 min with `Authorization: Bearer $CRON_SECRET`. Requires repo secrets `APP_BASE_URL` and `CRON_SECRET` set under GitHub repo Settings → Secrets → Actions.
- After any Supabase schema change: run `npm run db:push` to apply `supabase/schema.sql` automatically (requires `SUPABASE_ACCESS_TOKEN` in `.env.local`, a personal access token from https://supabase.com/dashboard/account/tokens — never commit it), then run `npm run lint && npm run build` before `npx vercel --prod --yes`.

## Cloud-hosted agent memory (replaces local projectmem MCP)
- `public.agent_memory_events` (Supabase table, in `supabase/schema.sql`) is the append-only log for notes/decisions/issues/attempts/fixes — no local Python process required. Has a `project` column (default `jacket-ai`) so the same table can be reused across repos via `--project=<name>`.
- Use `npm run memory -- note "..."`, `decision "..."`, `issue "..." --location=path`, `attempt "..." --outcome=worked|failed`, `fix "..." --issue=<id>`, and `npm run memory -- summary` to read recent entries. Script: `scripts/memory.mjs`.
- Run the "Memory: Session-start summary" VS Code task (`.vscode/tasks.json`) at the start of a session instead of relying on memory alone.
- Read-only cloud access without the CLI: `GET /api/memory/summary` (auth: `Authorization: Bearer $CRON_SECRET`, optional `?scope=` / `?project=` / `?limit=` query params).
- Retention: rows older than 6 months are archived — copied to `agent_memory_events_archive`, then deleted from the live table, with an audit `note` event — by the daily `/api/cron/memory-archive` Vercel cron (`CRON_SECRET` auth). Manual run: `npm run memory -- archive [--months=6] [--dry-run] [--project=x]`. History is never lost, only moved.
- This replaces the desktop-only `.vscode/mcp.json` projectmem server for anything that should persist as part of the production system's history.

## Required credentials — status as of 2026-09-28
| Variable | Needed for | Status |
|---|---|---|
| `CRON_SECRET` | Auth for both cron routes | ✅ Set on Vercel production + `.env.local`, verified live (401 without it, 200 with it) |
| `PAYMENT_WEBHOOK_SECRET` | Auth for `/api/order-status` (previously open to anyone — fixed) | ✅ Set on Vercel production + `.env.local` |
| `AI_GATEWAY_API_KEY` | AI video ad generation via Veo 3.1 (`media/generate-ad`) | ✅ Already set on Vercel production |
| `MANYCHAT_WEBHOOK_SECRET` | ManyChat lead webhook auth | ✅ Already set on Vercel production |
| `LALAMOVE_API_URL` / `LALAMOVE_API_TOKEN` | Live dispatch booking (`logistics` route) instead of manual-approval fallback | ❌ Not set — needs a Lalamove Open API partner account |
| `EMBROIDERY_DIGITIZE_API_URL` / `EMBROIDERY_DIGITIZE_API_KEY` | Auto logo→DST digitizing instead of manual queue | ❌ Not set — needs Ink/Stitch self-hosted endpoint or EmbroideryIO account |
| `META_APP_SECRET` | Meta (FB/IG/WhatsApp) webhook signature verification | ✅ Set on Vercel production + `.env.local`; used successfully to configure app-level Page webhook fields on 2026-10-20 |
| `META_WEBHOOK_VERIFY_TOKEN` | Meta webhook handshake | ✅ Set on Vercel production and verified against the Meta app callback handshake on 2026-10-20 |
| `APP_BASE_URL`, `CRON_SECRET` (as **GitHub Actions** repo secrets, separate from Vercel env) | External scheduler workflow | ✅ Set by user in GitHub repo settings 2026-09-28 — workflow will start firing on its next `*/5`/`*/45` min tick |

`STABILITY_API_KEY` / `REPLICATE_API_KEY` were dead config (no route ever called them) — removed from `.env.local` 2026-10-04. Still set on Vercel production env, left for possible future embroidery/image-gen work (`npx vercel env rm <NAME> production` to purge there too).

## Credit / token conservation rules
- [ ] Scope every request to specific files (`#file:app/api/operations/route.ts`) instead of "the whole project."
- [ ] Reuse `sendTelegramMessage` / `sendTelegramDirectMessage` / `sendTelegramPhoto` / `composeBossStyleMessage` from `_lib/integrations.ts` — never re-implement Telegram calls per route.
- [ ] One Supabase table per concern, added via `supabase/schema.sql` (append, don't rewrite existing sections).
- [ ] Smoke-test new endpoints with a single representative request, then delete the test row — don't loop test calls.

## Sensitive/legacy items to flag, not silently ignore
- [ ] Local `.env.local` Supabase service-role key has been observed returning 401 against the live project — verify against Vercel's env value before trusting local test results.

## Goal 2 routes (sales closer, CRM, autoposter)
- `/api/health` (+ `/api/test-db` alias): service-role health check, public, JSON status ok/degraded/down.
- `/api/webhooks/meta`, `/api/webhooks/manychat`: inbound DMs/comments -> `_lib/sales-closer.ts` -> `crm_contacts` / `inbox_messages`.
- `/api/crm`, `/api/voice`, `/api/content/plan`: Bearer `CRON_SECRET`. Pipeline view/human reply, voice ingestion (client/employee/supplier), content calendar.
- Crons: `cron/sales-followups` + `cron/content-publisher` (GitHub Actions, 45 min), `cron/content-plan` (Vercel daily).
- Social posting schedule (Manila time, GitHub Actions `scheduler.yml`): `cron/content-publisher` also runs at 9:00, 11:00, 13:30, 15:00, 18:00, 21:00, 01:00, 03:00, 06:00. `planContent` assigns one idea per slot (FB+IG for images; FB/IG/YouTube/TikTok for videos). The publisher claims each row by incrementing `attempts` with `status='READY'` and `attempts` as the optimistic lock, so overlapping runs cannot double-post.
- `cron/boost-advisor` (GitHub Actions, 9:30 AM Manila): ranks published Facebook/Instagram posts from the previous 24 hours using Meta insights, with a weekday-theme fallback (Mon/Tue corporate, Wed/Thu safety, Fri/Sat team/event). Current Facebook Insights no longer exposes organic-only unique reach; the advisor labels Facebook's available total unique media views accurately. It recommends P350/day but does not spend; a Marketing API one-click boost requires a configured ad account, permissions, payment readiness, and a bounded campaign flow.
- Admin Knowledge Base (`/admin` → Knowledge Base; `/api/admin/knowledge`): stores Q&A, tone, product/catalog, size-chart, internal-cost and supplier records. Files live in private Supabase Storage bucket `mjic-knowledge`; only `faq`, `tone`, `product`, and `size_chart` items enter the Sales Closer prompt or customer asset flow. Internal costs and supplier records remain admin-only.
- AI Gateway credits can be checked without generating billable content using `npm run ai-gateway:check`; it reads `AI_GATEWAY_API_KEY` from the process environment or `.env.local` and calls the read-only Gateway credits endpoint.
- Meta Page Messenger setup: `META_PAGE_ACCESS_TOKEN` + `META_PAGE_ID` are set on Vercel production; Page `102703242681559` and app `4741182989447689` are subscribed to `messages`, `messaging_postbacks`, and `feed`, with production callback `https://jacket-ai.vercel.app/api/webhooks/meta` (verified 2026-10-20).
- ManyChat live loop still needs its External Request flow configured in ManyChat: POST to `/api/webhooks/manychat`, send `MANYCHAT_WEBHOOK_SECRET` in `x-manychat-secret`, map the returned v2 `content.messages[0].text` into a Send Message step, then test with a controlled test contact and verify its CRM record/reply.
- Optional integrations still requiring provider credentials/configuration: `META_IG_USER_ID`, `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN`, `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN`, `TIKTOK_ACCESS_TOKEN`, `RESEND_API_KEY` / `RESEND_FROM`, `LALAMOVE_API_URL` / `LALAMOVE_API_TOKEN`, `EMBROIDERY_DIGITIZE_API_URL` / `EMBROIDERY_DIGITIZE_API_KEY`, `RETELL_API_KEY`, `CONTENT_AUTO_APPROVE=1`, and `CONTENT_VIDEOS_PER_WEEK`.

## Goal 4/5 additions
- `_lib/ceo-control.ts`: `ceo_settings` (shadow_mode, vacation_mode, autonomy_limit_php) + `approvals` inbox (Telegram `appr:yes|no:<id>` buttons handled in telegram-webhook). CEO toggles modes by chatting the Telegram bot (`set_operating_mode` tool).
- Shadow mode: AI drafts go to the CEO on Telegram, not to customers; follow-ups paused.
- Crons (GitHub Actions): `cron/watchdog` (45 min: health + bottlenecks), `cron/ceo-digest` (daily 8am Manila, weekly scorecard on Mondays), `cron/backup` (weekly JSON to private `db-backups` bucket, keeps 8).
- Special-terms requests (discount, installment, bulk, rush) go to an approval; the AI sends only a holding line.
- Model failover: Gemini -> Anthropic when `ANTHROPIC_API_KEY` is set.
- `/api/chat` routes general FAQs to Gemini Flash and quote/order-detail requests to Claude Sonnet; quote requests require `ANTHROPIC_API_KEY`.

## Batch: BOM, quotes, fraud, insights, digitizer (admin-protected)
| Route | Auth | Purpose |
| --- | --- | --- |
| `/admin` (page) | ADMIN_PASSWORD or CRON_SECRET | Material prices, selling prices, Teach the AI (.docx/.txt), overview |
| `/admin/video-mockups` (page) | Admin token/password (validated via `/api/admin/prices`) | Browser-local 8-second WebM mockup + free campaign planner; customer images stay on the device |
| `/api/admin/prices`, `/api/admin/price-book`, `/api/admin/overview`, `/api/admin/voice` | Bearer admin | Admin APIs |
| `/api/costing` (+ `/api/costing/po`) | open (costing) / admin (PO) | Per-order BOM from admin prices; draft supplier POs |
| `/api/quote-pdf` | Bearer admin | Branded PDF quote, private `quotes` bucket |
| `/api/payment-verify` | open | Now scores fraud risk (duplicate ref, recipient, date, tamper) |
| `/api/cron/insights` | CRON_SECRET | Weekly reorder forecast + price advice (Mon 9am Manila) |
| `/api/cron/repo-watch` | CRON_SECRET | Monthly repo metadata watch |
| `/api/embroidery/auto-digitize` | CRON_SECRET | Built-in DST/EXP/PES/JEF digitizer + QA + preview (`embroidery-files` bucket) |
| `/api/media/generate-ad` | CRON_SECRET | Now secured |

Env: optional `ADMIN_PASSWORD` (separate admin login).

### Browser-only video ad planning (2026-10-26)
- Open `/admin/video-mockups` from Admin. Supply a real product photo or approved mockup and optional logo; set the client name, product label, CTA, and English/Taglish caption language. Product and CTA are included in the silent 720 x 1280, 24 fps, 8-second WebM. Copy uses deterministic templates, not a paid AI call. Changing campaign inputs invalidates an older video download so it cannot be mistaken for the current creative.
- Select Facebook, Instagram, YouTube, TikTok, LinkedIn, or Other networks, with one account label per line. Download the campaign draft JSON to persist captions, suggested voiceover text (not synthesized), format requirements, and account notes. Unsaved settings are lost on reload; artwork is not included in the JSON.
- All exports are `DRAFT` / `NOT_SUBMITTED`, with `APPROVED_CAMPAIGNS_ONLY`, `autoPublishEligible: false`, and `queuedForPublishing: false`. Local labels do not authorize accounts. This rollout does not upload media, create server approvals/calendar rows, trigger paid generation, alter existing cron behavior, or publish. The draft policy is metadata, not a new enforcement gate on the existing publisher.
- The existing publisher in `app/api/_lib/content.ts` targets one configured account per Facebook/Instagram/YouTube/TikTok platform; multiple OAuth connections do not yet mean multi-account publishing. LinkedIn and other networks are manual export only. WebM may require MP4/H.264 conversion. TikTok needs user consent, `video.publish`, a verified media URL domain, and audit for public posts; credentials alone do not prove readiness.
- Existing Veo / AI Gateway rendering remains separate and paid. FFmpeg/Remotion workers are deferred by the browser-only rollout choice; there is no claimed CapCut API integration. A browser tab must remain open to render, so this option is not unattended video production.
- Hosting is not automatically free for business use: [Vercel Hobby](https://vercel.com/docs/plans/hobby) is restricted to non-commercial personal use. MJIC needs an eligible commercial plan; no billing or deployment changes are made by this feature.

| /api/cron/improvement-scout | CRON_SECRET | Weekly (Wed 11am Manila) GitHub scan; shortlists permissive-licence repos into repo_candidates and alerts CEO. Optional env GITHUB_TOKEN for higher rate limits. |

## Auth tokens & rate limiting (hardening)
- `CRON_SECRET` — Vercel native crons only (Vercel sends it automatically). `SCHEDULER_TOKEN` — GitHub Actions scheduler (set it as a repo secret AND a Vercel env var). Both accepted by cron routes only.
- `ADMIN_TOKEN` / `ADMIN_PASSWORD` — admin UI + admin writes (`/api/admin/*`, `/api/orders`, `/api/crm`, `/api/voice`, `/api/content/plan`, `/api/costing*`, `/api/logistics`, `/api/operations*`, `/api/dashboard/financials`). `CRON_SECRET` no longer works there.
- `MEMORY_TOKEN` — `/api/memory/summary` (admin tokens also accepted).
- `TELEGRAM_WEBHOOK_SECRET` — if set, `/api/telegram-webhook` requires the matching `X-Telegram-Bot-Api-Secret-Token` (re-run Telegram `setWebhook` with `secret_token`).
- All guards fail closed when no token is configured. Rate limits (Postgres `rate_limit_hit`, fail-open): chat 20/min, leads 5/5min, payment-verify 6/5min, telegram-notify 5/5min, proofs 30/5min, telegram-webhook 120/min, per IP.

## Visual editor & analytics dashboard (2026-era batch)
| Route | Auth | Purpose |
|---|---|---|
| `/admin/editor` (page) | Editor session cookie | Visual CMS: inline text, image swap, card reorder, theme colours, Publish. Stage 1 password (`EDITOR_PASSWORD`), stage 2 Telegram OTP to chat 7329264426 or `TELEGRAM_CEO_USER_ID`. |
| `/api/site` | Public, `no-store` | Published site document. `public/site-cms.js` polls it every 20 s. |
| `/api/admin/editor/login`, `/verify` | Password (+ OTP) | Issues the 6-digit OTP via Telegram DM, then sets the httpOnly `mjic_editor` cookie (8 h). |
| `/api/admin/editor` GET / POST / DELETE | Editor cookie | Read draft, publish (sanitised), sign out. |
| `/api/admin/editor/media` | Editor cookie | Image upload (PNG/JPEG/WebP/GIF, 5 MB) to public bucket `site-media`. |
| `/api/admin/analytics` | Admin bearer | 14-day Manila-time enquiries, orders, sample status, log severity, job heartbeats, alert metrics. Feeds the `/admin` Dashboard tab. |

- Storage: table `site_content` (key `site` for the document, `editor_otp:<chatId>` for OTP hashes). RLS on, service role only.
- `EDITOR_PASSWORD` must be set in `.env.local` and on Vercel production. It is in `PRODUCTION_SYNC_KEYS`. Session and OTP keys are derived from it.
- Cron run history is not stored as a table. The dashboard uses `job_heartbeats` (last run and status). Alert metrics are derived from `system_logs` and `outbound_request_queue`.
- Tests: `app/api/_lib/site-content-logic.test.ts`, `app/api/_lib/analytics-logic.test.ts`. Run with `node --test <file>` (Node 24 strips types).

- `.github/workflows/ci.yml` runs `npm ci`, lint, tests, and `next build --webpack` on pull requests. It needs no application secrets, does not deploy, and does not let an agent change code.
- To make it a merge gate, configure the target branch's GitHub ruleset/branch protection to require one approving review and the `CI / Validate` status check. Workflow runs alone do not enforce either rule.
- The workflow uses GitHub-hosted runners and caches npm/Next.js build data. AI reviewer/model calls are intentionally not enabled; add them only after selecting a provider, budget, and token permissions.

## Operational health and automatic recovery
- Reuse `/api/health`, `/api/cron/watchdog`, `/api/cron/retry-queue`, and the capped `/api/cron/swarm-worker`; no additional always-on AI swarm is needed for routine infrastructure checks.
- Operational health fails closed on Supabase query errors, missing counts, failed job statuses, and invalid heartbeat timestamps. Sales follow-ups, content publishing, retry processing, and swarm processing must have a successful heartbeat within six hours (a tolerance for GitHub scheduler delays, not a six-hour execution target).
- Weekly consultant generation has a 30-second model budget, 12-second attempts, and a 1,600-token output cap to leave room for data collection and delivery in the 60-second route. Empty reports, provider failures, and undelivered Telegram reports are failures; all write a non-success heartbeat.
- The schema conditionally removes client EXECUTE privileges from Supabase's `public.rls_auto_enable()` event-trigger function without disabling the automatic RLS trigger. Apply only this narrow grant correction to an existing database when no full schema deployment is required.
- Preview and Development must use isolated databases and scoped test credentials. Missing production-only webhook/scheduler credentials are not a reason to copy production secrets blindly. Environment-variable presence and model-list access do not prove successful billable generation or token equality.

### Environment diagnostics and Meta publishing guardrails (2026-10-27)
- `npm run env:check` runs `scripts/sync-env-check.mjs`: audit local configuration and unbranched Production/Preview/Development variable metadata. Output contains names, counts, HTTP statuses and warnings, never secret values. Run on Node 22.18+.
- `npm run env:check -- --sync-missing-production` can add only allowlisted, nonempty local values missing in Production. Existing values are never overwritten, management credentials are excluded, and Preview/Development are never modified. Newly added values require a deployment before runtime use. Metadata-only checks cannot certify token validity, secret equality or database isolation.
- Optional Vercel `/v2/user` and `/v2/teams` 403/404 responses are inspection warnings, not deployment failures. `--github-job=<numeric-job-id>` also checks GitHub log access without downloading logs; 401 there is a warning. Project/env API errors, other statuses and failed core health remain failures. Warning-only audits exit 0; errors exit 1. This does not bypass authentication or suppress genuine runtime failures.
- Facebook/Instagram publishing now validates canonical Meta app/webhook config, resolved Page token, expiry/data-access expiry, matching app/Page and platform publishing scopes using read-only Graph calls. Existing saved/discovered Page-token fallback remains supported. Messaging-only tenant connections do not need publishing scopes.
- `pages_manage_posts` + `pages_read_engagement` are required for Facebook publishing; Instagram needs `instagram_basic` + `instagram_content_publish`. Diagnostics cannot grant Meta approval or permissions. Do not automatically widen the messaging OAuth request to scopes that the app has not been approved to use.
- Blocked posts remain `NEEDS_CREDENTIALS` without consuming publish attempts; they requeue only after successful validation. Preflight results are shared within a publisher run. Meta publish errors 190/10/200 are also treated as credential blocks if access changes after validation. Other platforms continue processing.
- Meta failures create warning diagnostics and use the shared Telegram helper to alert the CEO. Unchanged problems have a durable six-hour alert cooldown; failed notifications are logged and can retry. Alert persistence/delivery failures do not crash the publishing queue. Daily `meta-health` also checks the configured MJIC publishing token even when no OAuth Page rows exist.
- Missing webhook verification/signature secrets explicitly return HTTP 503; incorrect presented tokens/signatures still fail authentication. No fallback disables signature validation. The publisher records degraded status for parked/failed items and error status for infrastructure failures.
- `npm test` includes the script audit/warning-policy regressions and Meta publishing tests. No new dependencies, paid AI calls, provider accounts or schedules were added by these guardrails; existing hosting/provider quotas and billing terms still apply.
- Follow-up to the source-sync push: the functioning Trivy workflow reported patched HIGH/CRITICAL dependency advisories. Minimum Next/Zod versions were raised to `16.4.1` / `4.6.6`, ESLint's Next configuration to `16.4.1`, and the compatible transitive Undici lock entry to `7.30.1`. The resolved lockfile uses Next `16.4.3` and Zod `4.6.7`; no scanner findings were suppressed.
- A read-only live Meta health run on 2026-10-27 returned `publishing.code=ready`, with the configured app/Page and Facebook publishing scopes verified. This supersedes the earlier missing-scope observation for that token at that time; it does not prove a successful publish, and no content was published by the audit.

### Cloud-runner activation and capability audit (2026-10-27)
- `npm run runner:check` audits all five cloud-runner secret names and verifies that `devq-cloud.yml` is active. Success means metadata readiness only, not Copilot entitlement, valid secret values, dispatch permission, available quota or successful task execution.
- `npm run runner:check -- --sync-missing` uses the official GitHub CLI to encrypt and set only missing allowlisted secrets from available local configuration. Values travel via stdin, not command arguments or plaintext files. Use `--gh-path=<executable>` when `gh` is not on PATH. It never replaces existing secrets or substitutes a management PAT for the missing Copilot credential. Install official `gh` separately if needed; no runtime dependency was added.
- The two missing Supabase runner secrets were synchronized and their names verified. `COPILOT_GITHUB_TOKEN` remains missing and unavailable locally. Do not dispatch a synthetic coding task or claim hands-off execution until supported Copilot credentials, entitlement and the no-new-cost constraint can be verified.
- The cloud workflow validates secret presence and the full task UUID before dependency/CLI installation or claiming. Failed/needs-input tasks and unclaimable targeted tasks return nonzero exits; PR creation cannot run after them. Successful cloud code execution defers the `done` state until the PR handoff, whose completion message includes the PR URL. No changes still produces an explicit no-changes result. This remains a PR workflow, not remote control of the local VS Code chat.
- The env checker now identifies shared Supabase URL metadata. Production, Preview and Development currently share one URL setting; missing webhook secrets do **not** prove database isolation. No nonproduction credentials were enabled and no nonproduction writes were tested.
- Follow-up delivery failures no longer consume successful follow-up counts or mark a review request sent. Subcontractor payroll recovery, sewer attendance accrual exclusion and the synchronous swarm's 100-agent ceiling have focused regression coverage; none of those tests issues payments or runs paid models.
- See `docs/CAPABILITY_AUDIT_2026-10-27.md` for the requested 27-feature matrix, remaining blockers, physical/provider test requirements and exact verification boundaries. Existing schedules were not changed.

### MJIC operations batch (stage aliases, quota, subcons, samples, D.P. lock)
- Payment aliases: `paid`/`full paid`/`fullpaid`/`binayaran`/`full balance` → S10 (balance). Only `dp`/`downpayment`/`down payment`/`deposit` → S05. Applied in `client-pulse.ts`, `vision-parse.ts`, `order-stages.ts` legacy map, and `scripts/import-orders.mjs`.
- D.P. lock: `confirmDeposit` books the down payment as ledger income (`dp:<orderId>`) and upserts `material_fund_locks`. Operational payments (non-`raw_materials`) that would dip into locked funds are rejected in `createPaymentRequest` (`fund-guard.ts`). `GET /api/dashboard/financials` returns `fundLock`. Orders verified before this change have no lock until backfilled.
- New admin routes (Bearer `ADMIN_TOKEN`/`ADMIN_PASSWORD`): `GET|POST /api/production-quota` (seeded once with mock starting targets: month 1000 pcs, year 12000 pcs via `on conflict do nothing`; CEO can overwrite or clear with POST), `GET|POST /api/subcons` (upsert by name, Telegram notice), `GET|POST|PATCH /api/samples` (LOST/DAMAGED alert). UI: `/dashboard/operations`.
- New cron: `GET /api/cron/samples` (CRON_SECRET/SCHEDULER_TOKEN), daily 00:30 UTC in `vercel.json`, Telegram alert for OUT samples past `expected_return_at`, once per day per sample.

### Ms. Anne automation (daily client updates, sample alerts, release notices)
- `GET /api/cron/anne-daily-updates` (CRON_SECRET/SCHEDULER_TOKEN), daily `0 0 * * *` UTC = 8:00 AM Manila in `vercel.json`. Sends Ms. Anne one DM per open order (status, last movement, pending items), after a header. Runs once per Manila date via `ceo_settings.anne_daily_update_sent_on`. Logic: `app/api/_lib/anne-daily-update-logic.ts`; runner: `anne-daily-update.ts`. If Anne's chat ID is unset, it returns an error and does not mark the day, so it retries.
- Sample retrieval (`sample-return-logic.ts`): a sample is due when the client has paid the down payment (stage S06+, COMPLETED, or a `deposit_verification_id`), or when there has been no client movement for 14 days (`STALE_SAMPLE_DAYS`, previously 30).
- Release notices: add an entry at the top of `app/api/_lib/release-notes.json` and push to `main`. `.github/workflows/release-announce.yml` waits until the deployment serves that head (`GET /api/cron/release-announcements?expect=<id>`, 409 until live), then DMs Anne each unannounced release once. The ledger is `ceo_settings.announced_release_ids`.
- Admin password: `ADMIN_PASSWORD` and `ADMIN_TOKEN` were rotated together, because both held the same old value and `isAdminAuthorized` accepts either as a Bearer token. Keep them in sync.
- Tables added to `supabase/schema.sql`: `production_quotas`, `subcon_directory`, `sample_items`, `material_fund_locks` (all RLS-locked).
- Anne Manalo chat ID resolution (`getAnneChatId` in `integrations.ts`): `ANNE_MANALO_TELEGRAM_CHAT_ID` env wins, then the `ceo_settings` key `anne_manalo_chat_id`, else none (alerts go to the CEO group only, the safety fallback). The ID auto-binds from either of two matches (`detectAndBindAnneChat`, never overwrites a saved ID): a private DM to the bot from the exact full name "Anne Manalo" (case-insensitive), or a message in the CEO group from a first name of exactly "Anne" (`isAnneFirstNameSender`; the group match is the looser, accepted privacy trade-off). The saved ID is her user ID, the target for direct messages. Her DM only reaches her if she has started a private chat with the bot; the CEO group is told if the DM was refused. Manage it in `/admin` → "Telegram recipients" (`GET|POST /api/admin/recipients`).
- `scripts/import-orders.mjs --apply` now also upserts `crm_contacts` (channel `csv_import`, external_id = phone or client name) so CSV clients appear in the admin CRM list.
