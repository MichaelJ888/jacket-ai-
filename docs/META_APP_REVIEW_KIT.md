# Meta App Review kit (copy-paste ready)

Meta does not allow App Review, Business Verification or the OAuth Redirect URI to be automated. Everything else is prepared here so each is a ~10 minute, one-time paste job. Check progress in **/admin -> Connect tab -> Meta setup doctor**.

## One-time order of work
1. **Valid OAuth Redirect URI** - App dashboard -> Facebook Login -> Settings -> add `https://jacket-ai.vercel.app/api/meta/oauth/callback`. (Doctor shows a direct link.)
2. **Register callbacks** - press the button in the setup doctor (sets the Deauthorize callback to `/api/meta/deauthorize`). Data deletion instructions URL: `https://jacket-ai.vercel.app/data-deletion`.
3. **App settings -> Basic** - Privacy Policy `https://jacket-ai.vercel.app/privacy`, Terms `https://jacket-ai.vercel.app/terms`, category Business, app icon 1024x1024 (`public/mjic-app-icon-draft.png` is a draft).
4. **Business Verification** (Business Settings -> Security Center): legal name, address, phone, plus one document (SEC/DTI registration, business permit or utility bill). Needed for Advanced Access.
5. **Add Testers** while waiting - buyers who press "request access" on `/dashboard/connect` arrive on Telegram with the Roles link.
6. **Submit App Review** for the permissions below, then switch the app to **Live**.

## Permissions to request (Advanced Access)
| Permission | Paste this as the use case |
|---|---|
| `pages_show_list` | After Facebook Login the customer picks which of their Pages to connect. We list the Pages they manage. |
| `pages_messaging` | The connected Page's customer messages (Messenger) are answered by our AI sales assistant, which replies to the person who messaged within the 24-hour window. |
| `pages_manage_metadata` | We subscribe the Page to our webhook (messages, postbacks, feed) so incoming messages and comments reach the assistant. Done once, automatically, at connection time. |
| `pages_read_engagement` | Needed to read Page comments/posts delivered by the feed webhook so we can reply privately to commenters. |
| `instagram_basic` | Identify the Instagram Business account linked to the connected Page. |
| `instagram_manage_messages` | Reply to Instagram DMs received by the connected business account with the same AI assistant. |
| `email`, `public_profile` | Standard Login: create the customer's account and show their name. |

## Screencast script (2-3 min, English captions)
1. Open `https://jacket-ai.vercel.app/dashboard/connect`; click **Continue with Facebook**.
2. Show the Facebook dialog, tick the Page, accept all permissions.
3. Back on the wizard: show the Page with green checks (token valid, webhook subscribed, messages/postbacks/comments enabled).
4. From a second Facebook account message the Page; show the AI reply arriving in Messenger.
5. Repeat the same with an Instagram DM to the linked account.
6. Click **Disconnect** and show the Page disappears (data removal), then **Sign out**.

## Reviewer notes (paste in "Notes")
"Log in at /dashboard/connect with the supplied tester account. No separate password exists: identity is the Facebook account. Message the connected test Page from another account to see the automated reply. The deauthorize callback deletes the account and Page tokens; instructions at /data-deletion."

## Provide Meta with
Test user credentials (create under App Roles -> Test Users), a test Page with an Instagram Business account linked, and the screencast.
