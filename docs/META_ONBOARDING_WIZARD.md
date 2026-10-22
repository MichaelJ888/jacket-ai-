# Proposal + Issue: Automated OAuth Onboarding Wizard (`/dashboard/connect`)

> GitHub issue body below. Title: **Automated OAuth Onboarding Wizard for buyers (Facebook/Instagram connect)**
> Suggested labels: `enhancement`, `onboarding`, `meta`.

## Problem
Connecting a Facebook Page / Instagram account currently needs the admin tab in `/admin` and an admin bearer token.
Tier-plan customers must not touch Graph API Explorer or System User tokens, and while our Meta app is in Development Mode only
admins/testers/developers can complete the login. Meta App Review and Business Verification are Meta-side processes and cannot be automated; the product must guide users gracefully around them.

## Already built (baseline)
- `app/api/_lib/meta-oauth.ts`: signed state + nonce cookie, code to long-lived token, `/me/accounts` Page tokens, webhook auto-subscribe, `meta_connections` table.
- `POST /api/meta/oauth/start`, `GET /api/meta/oauth/callback`, `GET|DELETE /api/meta/connections` (all admin-bearer except callback).
- Admin tab "Connect Facebook / Instagram" in `app/admin/page.tsx`.

## Scope

### 1. Buyer wizard page `/dashboard/connect`
- Large **Connect via Facebook Login** button; opens the OAuth dialog as a popup (`window.open`), with full-page redirect fallback if blocked.
- Callback finishes with a small page that `postMessage`s the result to the opener (origin-checked) and closes; wizard then refreshes status.
- Steps UI: 1 Log in, 2 Choose Pages, 3 Webhook check, 4 Done. Clear error text for denied permission / expired state / no Pages granted.
- Auth: buyers need their own session (not the shared admin token). Decide tenant model first (see Open questions); until then keep admin-only.
- Extract UI logic into `connect-logic.ts` + `connect-logic.test.ts` per repo convention.

### 2. Development Mode guide (graceful fallback)
- Detect mode server-side (Graph `GET /{app-id}?fields=...` app-token call, or probe error codes 200/10 on login) and show a banner: "App is in Development Mode - only Testers can connect."
- "Add a Tester" button: deep link to `https://developers.facebook.com/apps/{META_APP_ID}/roles/roles/` (no public API exists to add testers for arbitrary users; this is a redirect plus instructions, not true one-click).
- Live-mode checklist card: privacy URL, data-deletion URL (already live), Business Verification, App Review permissions (`pages_messaging`, `pages_manage_metadata`, `instagram_manage_messages`), with status the admin can tick.

### 3. Automated health check
- `GET /api/meta/connections/health?pageId=`: verifies token via `debug_token`, Page reachable, `GET /{page}/subscribed_apps` contains our app and fields, IG link present. Returns per-check pass/fail + fix hint.
- "Re-subscribe" and "Re-check" buttons; wizard polls after connect so users never guess.
- Optional daily cron (vercel.json) that flags broken connections to Telegram via `sendTelegramMessage`.

## Acceptance criteria
- A tester can connect a Page from `/dashboard/connect` with no Graph Explorer or token pasting; token saved in `meta_connections`, webhook subscribed, health shows all green.
- Popup blocked, denied permission, and expired state each show a recoverable message.
- Non-tester in Development Mode sees the guide instead of a raw Facebook error.
- Tokens never returned to the browser; all new routes fail closed; third-party fetches have `AbortSignal.timeout`.
- `tsc`, `npm run lint`, and new `*.test.ts` pass.

## Out of scope / Meta-side (manual)
App Review submission, Business Verification, screencasts, switching app to Live. Cannot be auto-approved.

## Open questions
- Tenant model: one `tenant_id` per buyer on `meta_connections`, and how buyers authenticate to `/dashboard/*`.
- One shared Meta app for all buyers (needs our App Review once) vs. per-client apps (each needs its own review; not recommended).
