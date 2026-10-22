import { NextResponse } from 'next/server';
import { publicBaseUrl } from '../../../_lib/channels';
import { sessionCookieFor, upsertTenantFromProfile } from '../../../_lib/tenants';
import {
  connectPagesFromUserToken,
  exchangeCodeForLongLivedToken,
  fetchFacebookProfile,
  META_CTX_COOKIE,
  META_NONCE_COOKIE,
  metaOAuthConfig,
  oauthRedirectUri,
  parseOAuthContext,
  verifyOAuthState,
  type OAuthContext,
} from '../../../_lib/meta-oauth';

export const dynamic = 'force-dynamic';

function readCookie(request: Request, name: string) {
  return new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(request.headers.get('cookie') || '')?.[1];
}

type Session = ReturnType<typeof sessionCookieFor>;

function clearCookies(response: NextResponse, session?: Session) {
  for (const name of [META_NONCE_COOKIE, META_CTX_COOKIE]) response.cookies.set(name, '', { path: '/api/meta/oauth', maxAge: 0 });
  if (session) response.cookies.set(session.name, session.value, session.options);
  return response;
}

// Popup flow: tell the opener (origin-pinned) and close. No token or page data is exposed, only the outcome.
function popupResult(params: Record<string, string>, session?: Session) {
  const origin = new URL(publicBaseUrl()).origin;
  const payload = JSON.stringify({ type: 'mjic-meta-oauth', ...params }).replace(/</g, '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><title>Facebook connection</title><p style="font-family:sans-serif">You can close this window.</p><script>
try { window.opener && window.opener.postMessage(${payload}, ${JSON.stringify(origin)}); } catch (e) {}
window.close();
</script>`;
  return clearCookies(new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }), session);
}

function finish(context: OAuthContext, params: Record<string, string>, session?: Session) {
  if (context === 'popup') return popupResult(params, session);
  const url = new URL(context === 'admin' ? '/admin' : '/dashboard/connect', publicBaseUrl());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return clearCookies(NextResponse.redirect(url), session);
}

// Facebook redirects here after the user approves. Auth = the signed state + nonce cookie set by /start.
export async function GET(request: Request) {
  const context = parseOAuthContext(readCookie(request, META_CTX_COOKIE));
  const config = metaOAuthConfig();
  if (!config) return finish(context, { meta: 'error', reason: 'Meta app is not configured' });

  const params = new URL(request.url).searchParams;
  if (!verifyOAuthState(params.get('state'), readCookie(request, META_NONCE_COOKIE), config.appSecret)) {
    return finish(context, { meta: 'error', reason: 'Invalid or expired login session. Please try again.' });
  }
  if (params.get('error')) return finish(context, { meta: 'error', reason: params.get('error_description') || 'Permission was denied' });
  const code = params.get('code');
  if (!code) return finish(context, { meta: 'error', reason: 'Missing authorization code' });

  try {
    const { userToken } = await exchangeCodeForLongLivedToken(code, oauthRedirectUri(publicBaseUrl()), config.appId, config.appSecret);
    const tenant = await upsertTenantFromProfile(await fetchFacebookProfile(userToken));
    const session = sessionCookieFor(tenant.id);
    if (!session) return finish(context, { meta: 'error', reason: 'Server session secret is not configured' });
    const { connected, skipped } = await connectPagesFromUserToken(userToken, tenant);
    const failed = connected.filter((page) => !page.webhook_subscribed).length;
    const result: Record<string, string> = { meta: 'connected', pages: String(connected.length), failed: String(failed), skipped: String(skipped.length) };
    if (skipped.some((item) => item.reason === 'plan_limit')) result.limit = '1';
    return finish(context, result, session);
  } catch (error) {
    return finish(context, { meta: 'error', reason: error instanceof Error ? error.message : 'Connection failed' });
  }
}
