# Secure Facebook, Instagram, and social publishing setup

This guide describes the connections that exist in the application today. Keep
all credentials in the deployment platform's encrypted environment variables or
the protected Supabase connection table. Never commit tokens, paste them into
browser code, or put them in screenshots or support messages.

## 1. Prepare the Meta accounts

1. Use a Facebook Page owned by the MJIC Business Portfolio.
2. For Instagram publishing and messaging, use a professional Instagram account
   linked to that Facebook Page. Confirm the Page administrator has full control
   of both accounts.
3. In Meta for Developers, create or select the MJIC app and configure Facebook
   Login, the app domains, privacy policy, data-deletion URL, and the HTTPS
   callback below. During Development Mode, only app admins, developers, and
   testers can authorize it. App Review and Business Verification are Meta-side
   approval steps; this application cannot grant them.

## 2. Configure server-side secrets

Set these in Vercel for the environments where the integration will run. Use
local `.env.local` only for local development.

| Variable | Purpose |
| --- | --- |
| `META_APP_ID` | Meta application ID; safe to display only in the authenticated admin setup UI. |
| `META_APP_SECRET` | OAuth code exchange and webhook signature verification. Secret. |
| `META_WEBHOOK_VERIFY_TOKEN` | Private value shared with Meta for webhook handshake verification. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only access to store Page connections. Secret. |
| `APP_BASE_URL` | Optional canonical public origin; production defaults to the Vercel production URL or `https://jacket-ai.vercel.app`. |

Do not set `META_PAGE_ACCESS_TOKEN` for a new OAuth-connected Page unless a
specific legacy integration requires it. OAuth stores each Page's token in
`meta_connections` and the server resolves it without returning it to the
browser. `META_SYSTEM_USER_TOKEN` and `META_PAGE_TOKENS` are optional
server-side alternatives for managed Page discovery or explicit Page mappings.
The CG Venezuela bridge has separate optional variables
`META_CGV_PAGE_ID` and `META_CGV_PAGE_ACCESS_TOKEN`.

## 3. Register OAuth and webhook URLs in Meta

For production, register these exact URLs:

- Valid OAuth redirect URI:
  `https://jacket-ai.vercel.app/api/meta/oauth/callback`
- Page webhook callback:
  `https://jacket-ai.vercel.app/api/webhooks/meta`
- Deauthorization callback:
  `https://jacket-ai.vercel.app/api/meta/deauthorize`

The OAuth redirect is derived from `APP_BASE_URL` when configured. If the
production domain changes, update both `APP_BASE_URL` and the allowlisted
redirect URI in Meta.

In the Meta Webhooks product, select the Page object and enter the value of
`META_WEBHOOK_VERIFY_TOKEN` as the verify token. The GET handshake fails closed
when the server variable is missing. Webhook POST requests must include a valid
`X-Hub-Signature-256` generated with `META_APP_SECRET`; unsigned requests are
rejected.

The current OAuth flow requests `public_profile`, `pages_show_list`,
`pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`,
`instagram_basic`, and `instagram_manage_messages`. Meta may require app review
or business verification for production access to these permissions.

## 4. Connect a Page through the admin UI

1. Sign in at `/admin` and open **Connect Facebook / Instagram**.
2. Select **Connect Facebook / Instagram** and authorize the requested
   permissions in Meta. The callback validates a signed, short-lived OAuth
   state and a same-site nonce cookie.
3. Select the Page(s) and grant the requested access. The server exchanges the
   authorization code, retrieves Page tokens, records the Page and linked
   Instagram account, and attempts the Page webhook subscription.
4. Review the Meta setup doctor and connected Page status in `/admin`. The
   browser receives connection status, not Page access tokens.
5. To disconnect, use the app's connection management rather than revoking or
   copying tokens manually. Reauthorization is needed if Meta access is
   withdrawn or expires.

The Page subscription currently requests `messages`, `messaging_postbacks`, and
`feed`. The webhook handler also contains lead-ad and Instagram-comment
handlers, but those events need their corresponding Meta permissions and
subscriptions enabled and reviewed separately; do not assume that connecting
a Page alone enables every webhook event.

## 5. Understand publishing and platform fan-out

Facebook and Instagram publishing is driven by the server-side
`content_calendar` and the scheduled content publisher. Each platform has its
own calendar row, media validation, posting quota, and credentials. Queueing a
post for one platform does not automatically create a post on another.

The application also has publishing paths for YouTube and TikTok, but those
platforms do not use Facebook/Instagram Graph API credentials. Configure and
verify each platform's own integration and calendar rows before expecting
cross-platform publishing. A Meta Page connection alone cannot authorize
YouTube or TikTok. YouTube uses `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
and `YOUTUBE_REFRESH_TOKEN`. TikTok uses `TIKTOK_ACCESS_TOKEN` and optionally
`TIKTOK_PRIVACY_LEVEL`; its current default is `SELF_ONLY`, so it is not public
by default. Use the existing scheduler and publisher; do not bypass the
per-platform posting limits or publish directly from a browser.

## 6. Safe verification checklist

- Confirm the admin setup doctor reports OAuth configured and the intended Page
  and linked Instagram account.
- Confirm Meta's Page webhook test reaches `/api/webhooks/meta`; the endpoint
  should reject an invalid signature and should only accept a valid handshake
  token during GET verification.
- Review production logs for webhook failures without recording or printing
  access tokens.
- Verify each platform integration independently. Avoid live test posts unless
  an authorized operator has approved the post and confirmed the posting quota.
- Never run authenticated cron verification against production if it can send
  customer messages, Telegram notifications, or social posts without first
  reviewing that route's side effects.

## Current limitations

- Meta permissions, app review, Business Verification, and Page ownership are
  controlled by Meta and require an authorized account owner.
- The webhook route can process leadgen and Instagram comment events, but the
  current automatic Page subscription is not proof that those event fields are
  enabled.
- "Fan-out" is scheduled per-platform publishing, not a single Meta API action
  that mirrors every post to every social network.
