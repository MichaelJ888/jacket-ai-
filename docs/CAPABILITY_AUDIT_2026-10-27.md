# Project #1: MJIC capability audit - 2026-10-27

## Executive status and evidence boundaries

This is an implementation and point-in-time operational audit, not a numerical
rating or a guarantee of autonomous operation. Project #2 was not touched.
No live publishing, customer/staff/supplier messaging, payroll payments,
delivery bookings, purchases, paid model generation or sports-feed subscriptions
were performed for this audit.

The starting source/deployment was `8085eef35d4c056a99f7aeb6ac0f00bc13a08883`.
Initial local and remote `main` matched and the working tree was clean.

At `2026-10-27T03:33:48Z` (11:33 Manila), production `/api/health` returned
HTTP 200 **degraded**, not fully healthy:

- Environment, database, storage, recent critical errors and retry backlog passed.
- Critical errors and retry backlog were both zero.
- Scheduled-job health reported an unsuccessful last `content-publisher` run.
- The publisher's last recorded status was `degraded`; the Instagram publishing
  diagnostic was also degraded. These warnings were not suppressed.
- Facebook publishing's last diagnostic heartbeat was `ok`, but a diagnostic
  heartbeat is not proof of a published post.

The follow-up read-only diagnostic found Instagram code `missing_account`.
This indicates account resolution failed; it does not distinguish an unlinked
Page account from failed discovery. The missing explicit Instagram ID alone
would not establish this, because linked-Page discovery is supported.
The publisher recorded zero published/failed/video-started/requeued items in
that run. Calendar aggregates were:

| Platform | Status counts |
| --- | --- |
| Facebook | 6 AWAITING_VIDEO, 10 FAILED, 3 PUBLISHED, 2 READY |
| Instagram | 6 AWAITING_VIDEO, 12 SKIPPED, 2 READY, 1 NEEDS_CREDENTIALS |
| YouTube | 6 AWAITING_VIDEO |
| TikTok | 6 AWAITING_VIDEO |

These are historical database statuses, not independently checked external
posts. They are not reset, retried or deleted to create a green audit result.

Read-only service-role probes found the relevant tables reachable. Aggregate
counts included 54 calendar rows, 3 payroll runs, 4 swarm jobs, 4 development
tasks, one digitization job and one PDF quote. There were no ledger entries,
staff tasks, purchase orders or dispatch requests at that read. Counts are not
proof that any requested business outcome completed successfully; no customer
records, captions, prices or financial row contents were inspected.

### Classification

- **VERIFIED END-TO-END**: a bounded test exercised the requested path and checked
  its downstream result. The type of environment/test is always stated.
- **IMPLEMENTED / PARTIALLY VERIFIED**: code, tests or configuration exist,
  but the requested complete live outcome is not established.
- **BLOCKED**: a specific credential, permission, provider or physical condition
  prevents the requested validation/operation.
- **NOT IMPLEMENTED**: no complete implementation of the requested capability
  was found; generic components do not count as that capability.
- **NOT TESTED**: the outcome was not exercised in this audit.

## Environment isolation

The checker found no missing local or Production names. Preview and Development
each still lack:

`CRON_SECRET`, `SCHEDULER_TOKEN`, `ADMIN_TOKEN`, `PAYMENT_WEBHOOK_SECRET`,
`MANYCHAT_WEBHOOK_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`.

**They are not proven isolated:** the same unbranched
`NEXT_PUBLIC_SUPABASE_URL` setting targets Production, Preview and Development.
The API permitted private confirmation that this URL matches the local target.
Service-role equality could not be established from encrypted metadata, and
missing webhook secrets do not prevent every possible database write.

No new nonproduction auth secrets were generated, live credentials copied,
provider callbacks registered, or test writes performed. Enabling more
nonproduction integrations is **blocked pending a separate test database and,
where required, real provider test apps**. Use mocked-provider fixtures/CI
until that isolation exists; do not make a fake Meta app secret.

The env checker now reports shared URL metadata explicitly. Distinct metadata
entries would still be classified as unverified, not automatically isolated.

## GitHub cloud runner

| Secret | Current metadata result | Audit action |
| --- | --- | --- |
| `COPILOT_GITHUB_TOKEN` | Missing; unavailable locally | No substitution or token invention |
| `SUPABASE_SERVICE_ROLE_KEY` | Present after sync | Added only because missing, from the authorized local configuration |
| `NEXT_PUBLIC_SUPABASE_URL` | Present after sync | Added only because missing, from the authorized local configuration |
| `TELEGRAM_BOT_TOKEN` | Already present | Not overwritten |
| `TELEGRAM_CHAT_ID` | Already present | Not overwritten |

The local Supabase credentials passed a read-only HEAD request to `dev_tasks`
before the two missing values were set. The official GitHub CLI portable
release was downloaded from `cli/cli`, verified against its SHA-256 release
checksum, and used to encrypt values via stdin. No secret values were placed
in command arguments, output, source files or plaintext temporary files.

The canonical GitHub repository and secret/workflow reads returned HTTP 200.
`devq-cloud.yml` is active. Its run list contained zero runs at the audit.
Workflow-permission and main-protection inspection returned HTTP 403, so neither
setting, Copilot entitlement, nor remaining billing quota is certified here.
A failed earlier probe with incorrectly loaded configuration was not treated
as evidence that the actual repository was missing.

No synthetic coding task was dispatched: the Copilot credential is absent and
new paid generation is prohibited by this task. Four pre-existing dev tasks
were queued, zero claimed, and none done at the baseline read. They were not
claimed, rewritten or deleted by the audit.

The intended path remains **Telegram -> dev task -> GitHub Actions -> Copilot
CLI -> branch/PR -> CEO notification**. This is not a connection to the open
local VS Code chat, and it does not automatically merge or deploy future PRs.

## Capability matrix

The source inspections below were read-only except the explicitly described
scoped fixes. Tests use synthetic inputs/mocked providers, not business actions.

| # | Capability and classification | Owning implementation / table or job | Evidence and exact gap | Cheapest next step, validation and cost boundary |
| --- | --- | --- | --- | --- |
| 1 | Browser mockups: **VERIFIED END-TO-END in local browser tests**; unattended cloud video: **IMPLEMENTED / PARTIALLY VERIFIED** | [video studio](../app/admin/video-mockups/video-mockup-studio.tsx), [browser spec](../e2e/video-mockups.spec.ts), [generation route](../app/api/media/generate-ad/route.ts), `media_ad_generations` | Canvas/MediaRecorder creates an eight-second WebM while the tab stays open. Hosted Veo operation/poll/storage code is separate. No hosted video was generated in this audit. | Keep device-local mockups for no-provider-charge previews. Mock hosted start/poll/storage; a real Veo job requires accepted metered use, not a claim of free unattended rendering. |
| 2 | Actual MJIC Facebook post: **IMPLEMENTED / PARTIALLY VERIFIED** | [content pipeline](../app/api/_lib/content.ts), [Meta preflight](../app/api/_lib/meta-publishing.ts), `content_calendar`, `content-publisher` | POST API path and token/app/Page/scope preflight exist; no actual post/delivery was tested. Image rows can be scheduled READY; video approval is separate. Browser drafts are never queued automatically. | A controlled, specifically authorized test post is needed to verify external delivery. Do not equate preflight `ready` with posting. No publishing or schedule change was performed. |
| 3 | AI sales closer inbound -> CRM -> delivered reply: **IMPLEMENTED / PARTIALLY VERIFIED** | [Meta webhook](../app/api/webhooks/meta/route.ts), [ManyChat webhook](../app/api/webhooks/manychat/route.ts), [sales closer](../app/api/_lib/sales-closer.ts), `crm_contacts`, `inbox_messages` | Signature/auth checks, contact/message persistence and channel send paths exist. Live delivery and ManyChat's external flow remain unverified. | Test a controlled test contact and verify delivery plus CRM result. Use mocks first; real LLM/provider use may be metered. |
| 4 | Telegram `/dev` -> cloud coding PR: **BLOCKED** | [dev queue](../app/api/_lib/dev-queue.ts), [cloud workflow](../.github/workflows/devq-cloud.yml), [worker](../scripts/devq-worker.mjs), `dev_tasks` | Two missing Supabase secrets were set; Copilot secret is still absent. Workflow is active but no run/PR smoke exists. Failure exits and PR completion handoff were repaired and regression-tested. | Supply a supported Copilot credential with verified entitlement/quotas through secure configuration, then run one harmless task when permitted. Do not repurpose the management PAT or launch paid generation. |
| 5 | Embroidery export: **IMPLEMENTED / PARTIALLY VERIFIED**; mass production: **BLOCKED on physical QA** | [digitize route](../app/api/embroidery/auto-digitize/route.ts), [digitizer](../app/api/_lib/digitize/index.ts), `digitize_jobs`, `embroidery_jobs` | Built-in DST/EXP/PES/JEF export, preview and heuristic checks exist. Structural-file tests do not establish fabric/thread/machine stitch quality. | Representative machine import and supervised sew-out are required. Use the existing implementation, not a new paid provider; physical QA costs time/material. |
| 6 | CRM/ERP: **IMPLEMENTED / PARTIALLY VERIFIED** | [CRM API](../app/api/crm/route.ts), [admin](../app/admin/page.tsx), [financial dashboard](../app/dashboard/financials/page.tsx), CRM/operations tables | Authenticated pipeline reads and stage/pause/reply writes exist. No complete shared CRM/ERP UI and cross-module live workflow were established. Static local CRM state is not a shared database screen. | Map existing screens to APIs and test mocked reads/writes. Build only the missing interface/wiring, not a replacement ERP service. |
| 7 | Saturday sewer / 1st-and-16th employee payroll: **IMPLEMENTED / PARTIALLY VERIFIED** | [payroll cron](../app/api/cron/payroll/route.ts), [payroll](../app/api/_lib/payroll.ts), [period logic](../app/api/_lib/payroll-logic.ts), `payroll_runs` | Manila date logic, due-day calculation and unique period keys exist. Three rows and a successful heartbeat do not verify payroll accuracy or payment. Recovery changes are covered with injected failures, not live payouts. | Reconcile synthetic/staging period outputs with an accountant before real payroll. Never treat payroll calculation as permission to transfer funds. |
| 8 | Accounting and biweekly profit output: **IMPLEMENTED / PARTIALLY VERIFIED** | [finance](../app/api/_lib/ceo-finance.ts), [report logic](../app/api/_lib/finance-logic.ts), [digest](../app/api/cron/ceo-digest/route.ts), `ledger_entries` | Ledger/project totals and month/year reporting exist; digest is month-to-date, not a verified fortnightly report. Live ledger count was zero. Sewer attendance accrual exclusion was repaired; name matching is not canonical worker-ID reconciliation. | Add/test explicit fortnight boundaries over the existing ledger and reconcile source transactions. No new accounting service is needed; no actual financial report can be inferred from empty ledger rows. |
| 9 | Staff tasks and acknowledgments: **IMPLEMENTED / PARTIALLY VERIFIED** | [shared helpers](../app/api/_lib/integrations.ts), [Telegram webhook](../app/api/telegram-webhook/route.ts), [reminders](../app/api/cron/staff-reminders/route.ts), `staff_tasks` | Task records, urgent direct notification, reminders and DONE handling exist. A distinct received/accepted acknowledgment is not established; live task count was zero. | Add explicit acknowledgment only if required; mock assignment/completion first and use a linked test staff account for permitted delivery verification. |
| 10 | Client updates/follow-ups: **IMPLEMENTED / PARTIALLY VERIFIED** | [follow-up cron](../app/api/cron/sales-followups/route.ts), [delivery state](../app/api/_lib/sales-followups-logic.ts), CRM/inbox tables | Daytime/shadow-mode/Meta-window handling exists. Failed delivery previously consumed a successful follow-up or review marker; corrected with regression tests. No real client was messaged. | Controlled recipient test plus downstream status inspection is needed. Retain the existing two-follow-up limit and scheduled retry; no new model service. |
| 11 | Supplier material lists / draft POs: **IMPLEMENTED / PARTIALLY VERIFIED** | [costing](../app/api/costing/route.ts), [BOM](../app/api/_lib/bom.ts), `purchase_orders`, `suppliers_directory` | Quantities/costing and draft PO storage exist. A supplier can be unassigned; complete supplier selection/approval/send is not verified. Live PO count was zero. | Validate material-to-supplier mapping and approval with synthetic data before any supplier contact or binding order. |
| 12 | Cheapest Lalamove / emergency dispatch: **BLOCKED** | [logistics](../app/api/logistics/route.ts), [dispatch](../app/api/_lib/dispatch.ts), `dispatch_requests`, retry queue | Approval-gated request and provider/retry path exist. Production Lalamove URL/token are absent; no multi-option price comparator is evidenced. Zero dispatch rows at read. | Human quote comparison until supported partner API and cost rules are available. No booking was made; cheapest total cost cannot be promised without actual comparable quotes. |
| 13 | Updates to two CEOs: **NOT IMPLEMENTED as requested** | [Telegram helpers](../app/api/_lib/integrations.ts), [webhook authorization](../app/api/telegram-webhook/route.ts) | Primary alert helper uses one configured chat and CEO authorization uses one identity/private-chat fallback. Two independent recipients and per-recipient delivery tracking were not established. | Configure explicit consenting recipients and separately enforce their authorization; test shared-helper fanout with mocks before live notifications. No recipient IDs were invented. |
| 14 | COO delegation / one-year CEO break: **IMPLEMENTED / PARTIALLY VERIFIED for controls only** | [CEO controls](../app/api/_lib/ceo-control.ts), [agent tools](../app/api/_lib/ceo-agent.ts), `ceo_settings`, `approvals` | Vacation/shadow settings, spending thresholds and approval tools exist. A complete delegated-approver/department-authority model and every action-boundary enforcement were not established. | Define a limited authority roster, enforce permitted actions and test escalation/kill switches. One-year unattended business operation is not a verifiable code-only promise. |
| 15 | Department swarms / self-healing: **IMPLEMENTED / PARTIALLY VERIFIED** | [swarm](../app/api/_lib/swarm.ts), [durable jobs](../app/api/_lib/swarm-jobs.ts), [worker](../app/api/cron/swarm-worker/route.ts), `swarm_jobs` | Generic lead/worker/skeptic/merger state, locks and bounded retries exist; department-specific ownership/permissions do not. Synchronous admin cap is now aligned with the existing 100-agent CEO cap. | Test resume/failure/cost bounds with fake runners; use deterministic watchdog/retry first. A 100-agent cap is not a spending budget or zero-cost operation. |
| 16 | Formal quotations: **IMPLEMENTED / PARTIALLY VERIFIED** | [PDF quote](../app/api/quote-pdf/route.ts), `pdf_quotes` | Branded PDF/private storage/signed URL path exists and one live row was counted. Caller-supplied prices and optional send are not independent price/margin approval. | Test totals, approved prices and PDF content using synthetic inputs; controlled artifact verification is needed before customer delivery. |
| 17 | Per-project material quantities: **IMPLEMENTED / PARTIALLY VERIFIED** | [BOM](../app/api/_lib/bom.ts), [inventory helpers](../app/api/_lib/integrations.ts), inventory tables | Quantity estimation/stock comparison exist. Inventory deduction reads/updates stock separately from its audit record; retry-safe atomic reservation/deduction is not established. | A separately reviewed database idempotency constraint/transactional operation and isolated concurrency tests are required. No live stock or schema was changed by this audit. |
| 18 | Embroidery/DTF/silkscreen task dispatch: **IMPLEMENTED / PARTIALLY VERIFIED** | [operations](../app/api/operations/route.ts), [shared helpers](../app/api/_lib/integrations.ts), `embroidery_jobs`, `staff_tasks` | Embroidery dispatch and general tasks exist; dedicated DTF/silkscreen production specs/acknowledgments were not established. | Extend existing task types/spec validation rather than buy another queue. Use fabricated jobs; no real service was ordered. |
| 19 | Subcontractor finding/negotiation and 500-piece approval/order: **NOT IMPLEMENTED as an end-to-end sourcing workflow** | [subcontractor payroll](../app/api/_lib/payroll.ts), `subcon_jobs`, generic approvals | Job/payroll tracking exists, but not verified discovery, legitimacy, competitive negotiation, the requested threshold and final-order chain. | Start with a human-verified quote shortlist and persisted CEO approval. External contacts/orders remain separate authorized business actions. |
| 20 | Alibaba research/negotiation and approved bulk order: **NOT IMPLEMENTED as requested** | [generic agent tools](../app/api/_lib/ceo-agent.ts), [approvals](../app/api/_lib/ceo-control.ts) | Generic supplier/swarm tools are not an Alibaba API, manufacturer verification, negotiation or binding-order workflow. | Use legitimate accessible supplier research and a CEO-approved quote record. Do not bypass login/platform controls or invent supplier legitimacy/prices. |
| 21 | Ecommerce catalogue: **IMPLEMENTED / PARTIALLY VERIFIED** | [site entry](../app/page.tsx), [static catalogue](../public/index.html) | Product catalogue and quote/cart controls exist. Browser-local edits are not a centralized product database. | Keep catalogue/quote UX and test data contracts; add shared inventory/catalogue persistence only where required. No checkout provider was activated. |
| 22 | Daily image relevance/dedup and website updates: **NOT IMPLEMENTED as requested** | [content planning](../app/api/_lib/content.ts), [static website](../public/index.html) | Recent-caption avoidance and fixed sample-image selection are not visual matching, image deduplication or daily deployment of the website. | Start with approved topic-to-asset mappings and image IDs/hashes with deterministic tests, not paid visual calls. Shared publishing/deployment needs separate validation. |
| 23 | Cart and checkout: **IMPLEMENTED / PARTIALLY VERIFIED** | [static website](../public/index.html), `addToQuote` / `saveQuote` | Session-storage quote cart and WhatsApp/Viber/lead handoff exist. This is not durable multi-device cart, payment or confirmed ecommerce checkout. | Label the quotation boundary clearly; test session persistence and failed lead handoff. A new payment flow is larger scoped work, not an audit fix. |
| 24 | Admin and all its features: **IMPLEMENTED / PARTIALLY VERIFIED; full live surface NOT TESTED** | [admin](../app/admin/page.tsx), [COO panel](../app/admin/coo-panel.tsx), [video admin](../app/admin/video-mockups/page.tsx), admin API routes | Authenticated prices/book/teaching/overview/connect and video surfaces exist. Existing browser tests cover the video flow, not every admin action; legacy local saves are not shared website updates. | Inventory screen/API contracts and add isolated UI tests. Do not use mutating production actions to declare every button verified. |
| 25 | Repository discovery and safe integration: **IMPLEMENTED / PARTIALLY VERIFIED** | [scout](../app/api/_lib/scout.ts), [repo watch](../app/api/cron/repo-watch/route.ts), [strategy](./REPO_STRATEGY.md), `repo_candidates` / ideas | Discovery/metadata/license filtering and proposals exist, not automatic safe adoption. Workflow scout cadence is every 30 minutes while strategy text describes weekly scanning; model analyses may be metered. | Reconcile intended cadence and budget explicitly; this audit did not change schedules or auto-install repos. Require compatibility/license/tests/PR evidence before integration. |
| 26 | Alex Eala live sports: **IMPLEMENTED / PARTIALLY VERIFIED for manual display only** | [static sports panels](../public/index.html), local-storage sports settings/countdown | Manual schedule/countdown/links exist; no verified live score feed. Defaults included September 24 fixtures and September 22 verification text, stale at audit date. | Suppress expired/unverified fixtures and maintain a shared verified schedule. A licensed live feed and broadcast-link rights are not available merely from a countdown. |
| 27 | NBA live sports: **IMPLEMENTED / PARTIALLY VERIFIED for manual display only** | [static sports panels](../public/index.html), local-storage schedule/countdown | Manual display/team selection/countdown exist; defaults included October 5 dates and unconfirmed opponents, not an actual live feed. | Date/placeholder validation and a verified shared source are needed. Do not invent games/scores or unauthorized stream URLs. |

## Scoped repairs and known residual risks

1. Missing-only encrypted GitHub secret synchronization and workflow-state
   checking were added to the existing bootstrap script, with tests.
2. The worker now propagates failure/auth/idle-target exits, validates a full
   UUID before access, and defers successful cloud completion until the PR
   handoff. Notification contains the PR URL rather than promising a PR before
   one exists. Failure/no-change paths are explicit. Real Copilot execution
   remains blocked.
3. Env diagnostics now distinguish a shared Supabase URL from actual isolation.
4. Failed follow-ups no longer advance successful-send counters/timestamps;
   failed review requests remain retryable.
5. Subcontractor payroll recovery reserves the completion timestamp while the
   job remains OPEN, reuses existing job-keyed payroll runs across periods,
   verifies intended unique-key conflicts and only closes after confirming a
   run. Injected-failure/concurrency tests are not a live PostgreSQL test.
6. Monthly attendance accrual excludes registered sewer names, because sewer
   payroll separately includes attendance. Matching is normalized-name-based;
   aliases need reconciliation before real accounting reliance.
7. Synchronous swarm requests now use the same 100-agent ceiling as background
   CEO requests. No real agents were invoked.

Remaining source risks not silently “fixed” by unrelated speculative changes:

- Inventory deduction needs database-level atomic idempotency.
- The fictional order ticker labels simulated orders as recent client activity;
  remove it or clearly disclose simulation before representing it as actual sales.
- Sports defaults can display stale/unconfirmed fixtures.
- Scheduled image publishing does not share the browser planner's draft-only
  approval policy; that planner's metadata does not gate the server publisher.
- A monthly/annual report and daily digest are not a fortnightly accounting run.
- Account inspection permissions, provider approvals, physical embroidery QA,
  recipient configuration, reconciliation and existing service billing remain
  outside a passing local build.

## Validation and persistence

The final local gates completed sequentially:

| Gate | Actual result |
| --- | --- |
| Corrected payroll/finance/swarm focused tests | 20 passed |
| Full unit/script suite | 159 passed, zero failures |
| ESLint | Passed, zero warnings/errors |
| Webpack production build | Passed, Next 16.4.3; 33 static pages |
| Post-build `tsc --noEmit` | Passed |
| Video mockup browser tests | 2 passed |
| `npm audit --audit-level=high` | Zero vulnerabilities reported |
| Workflow YAML | Parsed; one job, seven steps |
| Report relative links / `git diff --check` | Passed |
| Environment checker | Passed core/name checks, with shared-database and missing-nonproduction warnings |
| Runner checker | Exit 1: only missing `COPILOT_GITHUB_TOKEN`; workflow active |

Unit tests emitted existing `MODULE_TYPELESS_PACKAGE_JSON` warnings. No claim
of warning-free test output is made. The corrected concurrency test initially
failed because its overridden mock omitted event recording; instrumentation was
fixed without weakening the two-attempt/shared-date assertions, then the focused
suite and full suite passed. No live payroll run was used for validation.
Build/type-generation/browser startup were not run concurrently against the
same `.next` directory.

Final counts, commit/deployment outcomes and any remaining failures are recorded
in the completion response and project memory. A secret-name validator correctly
continues to exit 1 while the Copilot secret is absent; this is a real readiness
blocker, not a failed local regression test.

## Next priorities (maximum three)

1. **Cloud runner:** obtain a supported Copilot credential/entitlement within the
   accepted cost policy, confirm repository PR permissions and run one harmless
   end-to-end task. Owner: authorized GitHub/Copilot account administrator.
2. **Isolation and state safety:** provision/verify a separate test database,
   reconcile worker identities and review the atomic inventory migration, then
   run failure/concurrency integration tests. Owner: database/operations maintainer.
3. **Controlled business validation:** resolve the real publisher diagnostics and
   validate selected sales, quote and payroll outputs with intended recipients/
   accountants; keep physical sew-out and external transactions explicitly gated.
   Owner: CEO/business operator and implementation engineer.
