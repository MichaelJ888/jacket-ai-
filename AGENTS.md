<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# jacket-ai — MJIC business automation

Next.js 16 (App Router) + React 19 + Tailwind 4 + Supabase app automating MJIC's uniform/embroidery business: customer chat, costing, leads, orders, payment verification, Telegram staff bot, cron reminders. Deployed on Vercel (Hobby tier) at https://jacket-ai.vercel.app.

## Commands
- `npm run dev` / `npm run lint` — dev server / eslint
- `npm run build` — MUST stay `next build --webpack`; Turbopack panics on this project's global CSS
- `npm run db:push` — apply `supabase/schema.sql` via Supabase Management API (needs `SUPABASE_ACCESS_TOKEN` in `.env.local`)
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
