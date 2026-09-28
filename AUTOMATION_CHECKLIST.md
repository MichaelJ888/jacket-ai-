# MJIC Automation Checklist (Cost-Optimized Agent Protocol)

Read this before starting any new automation, webhook, or deployment task. Reference files by path (`#file`) instead of re-pasting their contents.

## Before building anything new
- [ ] Check `app/api/` for an existing route that already does this (see inventory below) — extend it, don't duplicate it.
- [ ] Check `app/api/_lib/integrations.ts` for an existing helper (Supabase, Telegram, payroll, tasks) before writing a new one.
- [ ] Check `supabase/schema.sql` for an existing table before creating a new one.

## Existing API routes (app/api/)
`chat`, `costing`, `cron/staff-reminders`, `cron/embroidery-pickup-alerts`, `embroidery/auto-digitize`, `leads`, `logistics`, `operations`, `order-status`, `payment-verify`, `telegram-notify`, `telegram-webhook`, `test-db`, `webhooks/manychat`, `webhooks/meta`.

## Build & deploy
- Build command is `next build --webpack` (Turbopack panics on this project's global CSS — do not remove `--webpack`).
- Vercel account is **Hobby tier**: native crons only run once/day. More-frequent jobs are handled by `.github/workflows/scheduler.yml` (GitHub Actions), which calls `/api/cron/staff-reminders?type=watch` every 45 min and `/api/cron/embroidery-pickup-alerts` every 5 min with `Authorization: Bearer $CRON_SECRET`. Requires repo secrets `APP_BASE_URL` and `CRON_SECRET` set under GitHub repo Settings → Secrets → Actions.
- After any Supabase schema change: run `npm run db:push` to apply `supabase/schema.sql` automatically (requires `SUPABASE_ACCESS_TOKEN` in `.env.local`, a personal access token from https://supabase.com/dashboard/account/tokens — never commit it), then run `npm run lint && npm run build` before `npx vercel --prod --yes`.

## Cloud-hosted agent memory (replaces local projectmem MCP)
- `public.agent_memory_events` (Supabase table, in `supabase/schema.sql`) is the append-only log for notes/decisions/issues/attempts/fixes — no local Python process required. Has a `project` column (default `jacket-ai`) so the same table can be reused across repos via `--project=<name>`.
- Use `npm run memory -- note "..."`, `decision "..."`, `issue "..." --location=path`, `attempt "..." --outcome=worked|failed`, `fix "..." --issue=<id>`, and `npm run memory -- summary` to read recent entries. Script: `scripts/memory.mjs`.
- Run the "Memory: Session-start summary" VS Code task (`.vscode/tasks.json`) at the start of a session instead of relying on memory alone.
- Read-only cloud access without the CLI: `GET /api/memory/summary` (auth: `Authorization: Bearer $CRON_SECRET`, optional `?scope=` / `?project=` / `?limit=` query params).
- Retention: table is append-only and will grow unbounded. Review and archive (export + delete) events older than ~6 months once the table exceeds a few thousand rows — no automated cleanup job exists yet.
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

`STABILITY_API_KEY` / `REPLICATE_API_KEY` are configured on Vercel and in `.env.local` but no route currently calls them — dead config, fine to leave for future embroidery/image-gen work or remove.

## Credit / token conservation rules
- [ ] Scope every request to specific files (`#file:app/api/operations/route.ts`) instead of "the whole project."
- [ ] Reuse `sendTelegramMessage` / `sendTelegramDirectMessage` / `sendTelegramPhoto` / `composeBossStyleMessage` from `_lib/integrations.ts` — never re-implement Telegram calls per route.
- [ ] One Supabase table per concern, added via `supabase/schema.sql` (append, don't rewrite existing sections).
- [ ] Smoke-test new endpoints with a single representative request, then delete the test row — don't loop test calls.

## Sensitive/legacy items to flag, not silently ignore
- [ ] Local `.env.local` Supabase service-role key has been observed returning 401 against the live project — verify against Vercel's env value before trusting local test results.
