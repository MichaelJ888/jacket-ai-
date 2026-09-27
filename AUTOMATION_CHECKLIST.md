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
- Vercel account is **Hobby tier**: native crons only run once/day. Anything more frequent must call `/api/cron/staff-reminders?type=watch` from an external scheduler (cron-job.org, GitHub Actions) or upgrade to Pro.
- Embroidery pickup alerts require an external scheduler to call `/api/cron/embroidery-pickup-alerts` every 5 minutes with `Authorization: Bearer $CRON_SECRET`; this route will not run on time from a Hobby native cron.
- After any Supabase schema change: run `npm run db:push` to apply `supabase/schema.sql` automatically (requires `SUPABASE_ACCESS_TOKEN` in `.env.local`, a personal access token from https://supabase.com/dashboard/account/tokens — never commit it), then run `npm run lint && npm run build` before `npx vercel --prod --yes`.

## Credit / token conservation rules
- [ ] Scope every request to specific files (`#file:app/api/operations/route.ts`) instead of "the whole project."
- [ ] Reuse `sendTelegramMessage` / `sendTelegramDirectMessage` / `sendTelegramPhoto` / `composeBossStyleMessage` from `_lib/integrations.ts` — never re-implement Telegram calls per route.
- [ ] One Supabase table per concern, added via `supabase/schema.sql` (append, don't rewrite existing sections).
- [ ] Smoke-test new endpoints with a single representative request, then delete the test row — don't loop test calls.

## Sensitive/legacy items to flag, not silently ignore
- [ ] Local `.env.local` Supabase service-role key has been observed returning 401 against the live project — verify against Vercel's env value before trusting local test results.
