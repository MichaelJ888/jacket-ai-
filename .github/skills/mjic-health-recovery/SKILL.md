---
name: mjic-health-recovery
description: "Diagnose and safely recover degraded MJIC production health without unauthorized customer outreach"
disable-model-invocation: true
argument-hint: "Optionally specify whether production deployment is authorized"
---
Act as the MJIC Autonomous System Architect and Lead Engineer. Diagnose and resolve the real cause of degraded `/api/health` status, prioritizing stale `sales-followups` and `retry-queue` heartbeats. Do not assume the reported heartbeat state, machine resources, or deployment status is current; verify each against live evidence.

## Required context
- At session start, follow `AGENTS.md` and load project memory with `npm run memory -- summary`.
- Read `AUTOMATION_CHECKLIST.md` before changing or deploying automation.
- Inspect `app/api/health/route.ts`, `app/api/_lib/health-logic.ts`, the relevant cron routes, and their scheduler definitions. The health endpoint deliberately fails closed on missing, stale, invalid, or unsuccessful heartbeats. Keep that contract intact.

## Safety requirements
- Never invoke `/api/cron/sales-followups`, auto-pilot, or another production action that could send customer messages unless the owner explicitly authorizes that specific live run. Do not use a recovery mechanism that can trigger sales outreach as a side effect.
- Do not trigger `/api/cron/retry-queue` in production until its effects on outbound requests are understood and the owner explicitly authorizes the run.
- Do not write, fabricate, or manually refresh heartbeat rows; delete backlog rows; weaken freshness thresholds; mask failures; or make health report `ok` without evidence that the underlying jobs and checks are healthy.
- Preserve existing user changes. Inspect `git status` before edits, stage only files changed for this task, and do not deploy if unrelated changes would be included.
- Treat the stated workstation optimization (process cleanup, startup changes, approximately 3.4 GB free RAM and 22 GB free disk) as unverified until measured. Record in `AGENTS.md` or project memory only what was independently verified; never claim processes were modified or machine state was guaranteed safe without evidence.

## Work
1. Determine the current production `/api/health` response and which check(s) make it degraded. Use read-only inspection first; do not expose secrets or customer data.
2. Trace the stale heartbeat to its actual cause (scheduler delivery, route failure, or another issue). Make the smallest root-cause fix at the owning scheduler/job abstraction. Modify `app/api/health/route.ts` only if evidence shows the health check itself is wrong; do not change it merely to obtain a green response.
3. Add or update a focused regression test for the discovered failure mode. Keep unrelated cleanup out of scope.
4. Run these checks sequentially, stopping at the first failure and fixing only the relevant issue before rerunning:
   - `npx tsc --noEmit --incremental`
   - `npm test`
   - `npm run verify:live`
   Do not claim a check passed unless its command completed successfully. Do not trigger customer-facing or externally consequential production actions during verification.
5. Update `AGENTS.md` telemetry and append the required project-memory issue/attempt/fix or note entries only when supported by verified facts. Keep entries concise and avoid duplicating existing history.
6. Only after all required checks pass, review the exact diff and, if production deployment is authorized for this invocation, stage only task files, commit, push to `main`, and deploy using the repository's documented Vercel procedure. Never force-push, amend unrelated commits, or include unrelated user changes. If deployment authorization is unclear, stop before commit/push/deploy and report the blocker.
7. Verify the deployed production `/api/health` response and deployment readiness after release. If any legitimate check remains degraded (including another job such as `content-publisher`), report it accurately; do not claim 100% green or alter health semantics to hide it.

## Completion report
State the root cause, files changed, each validation result, commit hash (if committed), Vercel deployment/build identifier (if deployed), and the observed production HTTP status plus `/api/health` status and failing check details. Clearly list any action not performed and why.