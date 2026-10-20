// Exchange a User/System User token for the Page Access Token of META_PAGE_ID.
// Usage: node scripts/meta-page-token.mjs <USER_OR_SYSTEM_USER_TOKEN> [pageId]
// Token needs pages_show_list, pages_messaging, pages_manage_metadata (Graph API Explorer or Business Settings > System Users > Generate token).
// A Page token derived from a long-lived user/system-user token does not expire.
const GRAPH = 'https://graph.facebook.com/v21.0';
const userToken = process.argv[2] || process.env.META_SYSTEM_USER_TOKEN;
const pageId = process.argv[3] || process.env.META_PAGE_ID || '102703242681559';

if (!userToken) {
  console.error('Usage: node scripts/meta-page-token.mjs <token> [pageId]');
  process.exit(1);
}

async function graph(path) {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${userToken}` }, signal: AbortSignal.timeout(15000) });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body.error || body));
  return body;
}

try {
  const direct = await graph(`/${pageId}?fields=id,name,access_token`).catch(() => null);
  let page = direct?.access_token ? direct : null;
  if (!page) {
    const list = await graph('/me/accounts?fields=id,name,access_token&limit=100');
    page = (list.data || []).find((p) => p.id === pageId);
  }
  if (!page?.access_token) throw new Error(`No access_token for page ${pageId}. Assign the Page (full control) to the System User / use a user token with pages_show_list.`);
  console.log(`Page: ${page.name} (${page.id})`);
  console.log(`META_PAGE_ACCESS_TOKEN=${page.access_token}`);
  console.log('\nSubscribe the page to the webhook (messages, messaging_postbacks, feed):');
  console.log(`curl -X POST "${GRAPH}/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed" -H "Authorization: Bearer ${page.access_token.slice(0, 6)}..."`);
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
}
