@AGENTS.md

<!-- >>> projectmem bridge >>> -->
## Agent memory (MANDATORY) — cloud-hosted, no local MCP process

This project's persistent memory lives in Supabase table `public.agent_memory_events`
(see `supabase/schema.sql`), read/written via `scripts/memory.mjs`. The local
Python projectmem MCP server (`.vscode/mcp.json`) is retired — it consumed
desktop RAM and is not part of the production automation system.

SESSION START — before answering ANY question about this project, run
`npm run memory -- summary` to load recent notes/decisions/issues/fixes.

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
