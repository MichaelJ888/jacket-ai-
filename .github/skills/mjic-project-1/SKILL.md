---
name: mjic-project-1
description: Execute MJIC Project #1 automation, social-content, and knowledge-base work with safe production checks. Use for MJIC business automation tasks such as Meta social posting and boost recommendations, live publishing and AI Gateway diagnostics, admin knowledge base uploads, and Sales Closer data injection.
argument-hint: Describe the MJIC Project #1 change or operational task to execute.
---

Execute the requested MJIC Project #1 task in this repository. Follow the MJIC Automation Engineer guidance in [the agent file](../../agents/mjic-automation-engineer.agent.md). Read [AGENTS.md](../../../AGENTS.md), [AUTOMATION_CHECKLIST.md](../../../AUTOMATION_CHECKLIST.md), and the relevant Next.js 16 guide under `node_modules/next/dist/docs/` before changing application code. Reuse existing routes, Supabase tables, Meta/Telegram helpers, and Sales Closer behavior before adding new abstractions.

## Social posting and boost recommendations

- The 9:30 AM Manila Telegram advisor should prefer the highest-engagement eligible post from the previous 24 hours. Use available Meta metrics, show the metric source, and never describe total views as organic reach. Meta's current Page Insights APIs may not expose organic unique reach; disclose when that metric is unavailable.
- Apply weekday content priorities as a tie-breaker or fallback: Monday/Tuesday corporate jackets and company giveaways; Wednesday/Thursday safety jackets, reflectorized and industrial wear; Friday/Saturday sports, varsity, and team/event wear. Sunday uses the best general-performing post.
- Recommend a fixed ₱350/day. Any one-click campaign action must be an explicit, CEO-authenticated button and strictly capped to a single 24-hour run unless the CEO separately configures a different limit. Never create a recurring or uncapped campaign.
- Do not claim that a Telegram button launches an ad unless a fully configured, tested Meta Marketing API integration actually launches it. If ad-account identity, permissions, payment readiness, or campaign inputs are missing, report the exact blocker and do not spend.
- Keep recommendations informational when metrics or marketing permissions are unavailable. Do not fabricate reach, shares, or performance.

## Live publishing and AI Gateway

- Publish publicly only when the user explicitly requests a live post and a usable, approved image/video and caption are present in the workspace or attachments. If the referenced media is absent, do not substitute unrelated images or invent business claims.
- Run Meta token/page/Instagram preflight before publishing. Report exactly which destinations succeeded or failed; do not treat a preflight as proof of publication.
- Diagnose AI Gateway credits with the read-only `npm run ai-gateway:check` command. Never print keys or bypass billing, purchase credits, or start a billable generation without explicit user authorization. Explain that checking credits is free/read-only; generation can incur usage charges.

## Admin knowledge base and Sales Closer

- Add CEO-managed Q&A, tone guidance, catalog/product images, size charts, material costs, and supplier information through authenticated admin surfaces and append-only/idempotent schema changes.
- Keep supplier lists, internal material costs, and confidential operational data out of customer-facing AI prompts and messages. Inject only explicitly customer-safe facts into the MJIC Sales Closer, as quoted/reference data that cannot override system rules, pricing policy, or privacy constraints.
- Store uploaded files privately, validate size and MIME type, and expose asset links only through authenticated or short-lived signed URLs.
- Preserve the Sales Closer's authoritative exact business facts in [mjic-prompt.ts](../../../app/api/_lib/mjic-prompt.ts); do not paraphrase or overwrite them with uploaded documents.

## Final validation and delivery

Run `npx tsc --noEmit`, `npm run lint`, and `npm test`. For schema changes, follow the checklist's database push procedure and verify the production behavior before deployment. Commit and deploy only when the user explicitly asks for those actions; never report success for external actions that were not confirmed by the provider.
