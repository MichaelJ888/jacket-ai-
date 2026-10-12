# MJIC Automation Checklist (Cost-Optimized Agent Protocol)

Read this before starting any new automation, webhook, or deployment task. Reference files by path (`#file`) instead of re-pasting their contents.

## Before building anything new
- [ ] Check `app/api/` for an existing route that already does this (see inventory below) — extend it, don't duplicate it.
- [ ] Check `app/api/_lib/integrations.ts` for an existing helper (Supabase, Telegram, payroll, tasks) before writing a new one.
- [ ] Check `supabase/schema.sql` for an existing table before creating a new one.

## Existing API routes (app/api/)
`chat`, `costing`, `cron/staff-reminders`, `cron/embroidery-pickup-alerts`, `cron/memory-archive`, `cron/retry-queue`, `embroidery/auto-digitize`, `leads`, `logistics`, `operations`, `order-status`, `payment-verify`, `telegram-notify`, `telegram-webhook`, `test-db`, `webhooks/manychat`, `webhooks/meta`.

- `cron/retry-queue` processes the durable `outbound_request_queue` table (Lalamove booking retries after provider outages); scheduled every 45 min via the GitHub Actions `retry-queue` job in `.github/workflows/scheduler.yml`.

## Build & deploy
- Build command is `next build --webpack` (Turbopack panics on this project's global CSS — do not remove `--webpack`).
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
| `META_APP_SECRET` | Meta (FB/IG/WhatsApp) webhook signature verification | ❌ `.env.local` has a placeholder value (`your-meta-app-secret`) — needs the real app secret from Meta for Developers |
| `META_WEBHOOK_VERIFY_TOKEN` | Meta webhook handshake | ✅ Set on Vercel production, verified live (GET handshake echoes challenge correctly) — still need to enter this same value in Meta's dashboard once the app exists |
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
- Optional env (features park as NEEDS_CREDENTIALS / undelivered until set): `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN`, `TIKTOK_ACCESS_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`, `CONTENT_AUTO_APPROVE=1`, `CONTENT_VIDEOS_PER_WEEK`.

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
| `/admin/video-mockups` (page) | Admin token/password (validated via `/api/admin/prices`) | Browser-local 8-second WebM mockup; customer images stay on the device |
| `/api/admin/prices`, `/api/admin/price-book`, `/api/admin/overview`, `/api/admin/voice` | Bearer admin | Admin APIs |
| `/api/costing` (+ `/api/costing/po`) | open (costing) / admin (PO) | Per-order BOM from admin prices; draft supplier POs |
| `/api/quote-pdf` | Bearer admin | Branded PDF quote, private `quotes` bucket |
| `/api/payment-verify` | open | Now scores fraud risk (duplicate ref, recipient, date, tamper) |
| `/api/cron/insights` | CRON_SECRET | Weekly reorder forecast + price advice (Mon 9am Manila) |
| `/api/cron/repo-watch` | CRON_SECRET | Monthly repo metadata watch |
| `/api/embroidery/auto-digitize` | CRON_SECRET | Built-in DST/EXP/PES/JEF digitizer + QA + preview (`embroidery-files` bucket) |
| `/api/media/generate-ad` | CRON_SECRET | Now secured |

Env: optional `ADMIN_PASSWORD` (separate admin login).

| /api/cron/improvement-scout | CRON_SECRET | Weekly (Wed 11am Manila) GitHub scan; shortlists permissive-licence repos into repo_candidates and alerts CEO. Optional env GITHUB_TOKEN for higher rate limits. |

## Auth tokens & rate limiting (hardening)
- `CRON_SECRET` — Vercel native crons only (Vercel sends it automatically). `SCHEDULER_TOKEN` — GitHub Actions scheduler (set it as a repo secret AND a Vercel env var). Both accepted by cron routes only.
- `ADMIN_TOKEN` / `ADMIN_PASSWORD` — admin UI + admin writes (`/api/admin/*`, `/api/orders`, `/api/crm`, `/api/voice`, `/api/content/plan`, `/api/costing*`, `/api/logistics`, `/api/operations*`, `/api/dashboard/financials`). `CRON_SECRET` no longer works there.
- `MEMORY_TOKEN` — `/api/memory/summary` (admin tokens also accepted).
- `TELEGRAM_WEBHOOK_SECRET` — if set, `/api/telegram-webhook` requires the matching `X-Telegram-Bot-Api-Secret-Token` (re-run Telegram `setWebhook` with `secret_token`).
- All guards fail closed when no token is configured. Rate limits (Postgres `rate_limit_hit`, fail-open): chat 20/min, leads 5/5min, payment-verify 6/5min, telegram-notify 5/5min, proofs 30/5min, telegram-webhook 120/min, per IP.

## Cloud pull-request validation
- `.github/workflows/ci.yml` runs `npm ci`, lint, tests, and `next build --webpack` on pull requests. It needs no application secrets, does not deploy, and does not let an agent change code.
- To make it a merge gate, configure the target branch's GitHub ruleset/branch protection to require one approving review and the `CI / Validate` status check. Workflow runs alone do not enforce either rule.
- The workflow uses GitHub-hosted runners and caches npm/Next.js build data. AI reviewer/model calls are intentionally not enabled; add them only after selecting a provider, budget, and token permissions.
