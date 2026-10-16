# Voice AI for inbound client calls (Retell)

**Verdict:** yes, integrated. Retell was chosen over Bland/Vapi for signed webhooks and first-class custom functions (about $0.07-0.15/min all-in, billed per second).

## Cheapest strategy
1. **Only answer what you miss.** Use carrier conditional call forwarding (no-answer / busy / after-hours) to the Retell number. Staff still pick up normally; AI pays per minute only on missed calls.
2. Cheap LLM in the Retell agent, max call duration about 5 min, voicemail detection on, end call after silence.
3. The agent only quotes prices from the shared MJIC prompt and otherwise captures a lead. No long back-and-forth.
4. Outbound calling is NOT enabled (telemarketing/consent rules). Add later behind a CEO approval.

## What the code does
- `POST /api/voice-call` - Retell webhook. Verifies `X-Retell-Signature` (HMAC-SHA256, 5 min window), stores `voice_calls`, sends ONE Telegram summary per call. Returns 503 until `RETELL_API_KEY` is set.
- `POST /api/voice-call/tools` - custom functions: `check_order_status(order_number)` (stage only, and only if caller ID matches the order phone), `create_lead(name, request, contact?)`, `request_human_callback(reason)`.
- `GET /api/voice-call/prompt` (admin auth) - returns the agent prompt (exact MJIC prices + voice rules) and the URLs to paste into Retell.
- The CEO bot can read call data via `query_business_data` (`voice_calls`) and `system_introspection`.

## One-command agent setup
After you have `RETELL_API_KEY` (and `ADMIN_TOKEN`) in `.env.local`, run `npm run voice:setup`. It creates the Retell LLM + agent with the MJIC prompt, the 3 functions, a 5-minute call cap, 20s silence hangup, voicemail hangup, and the webhook URL. Re-run with `RETELL_LLM_ID` / `RETELL_AGENT_ID` set to update instead of create.

## Carrier forwarding (missed / busy / unreachable only)
On the business mobile (GSM codes; replace `NUMBER` with the Retell number in 09/+63 form your carrier accepts). Support varies by carrier and plan - test each code by calling from another phone:
- No answer after 20s: `**61*NUMBER**20#` then call
- Busy: `**67*NUMBER#` then call
- Unreachable / phone off: `**62*NUMBER#` then call
- Cancel all forwarding: `##002#` then call
For a landline/PLDT/Globe At Home line, ask the provider to enable "call forward on busy / no answer"; codes differ (often `*92`/`*90`).
After-hours-only handling is not possible with carrier codes; do it by turning on "forward all" (`**21*NUMBER#`) when closing and `##21#` when opening, or use your PBX schedule.

## Setup you must do (cannot be automated)
1. Create a Retell account, buy/import a number. **Philippine (+63) numbers are usually not sold directly - use a SIP trunk or Twilio and verify coverage first.**
2. Create an agent; paste `general_prompt` from `/api/voice-call/prompt`; add the three custom functions with URL `https://jacket-ai.vercel.app/api/voice-call/tools`.
3. Set the agent/account webhook to `https://jacket-ai.vercel.app/api/voice-call` (events: call_ended, call_analyzed; call_inbound optional).
4. Vercel env: `RETELL_API_KEY` (the key must be the webhook-enabled key). Redeploy.
5. Set up call forwarding with your telco to the Retell number.
