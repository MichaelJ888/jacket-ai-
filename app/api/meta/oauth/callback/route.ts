import { NextResponse } from 'next/server';
import { publicBaseUrl } from '../../../_lib/channels';
import {
  connectPagesFromUserToken,
  exchangeCodeForLongLivedToken,
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

function clearCookies(response: NextResponse) {
  for (const name of [META_NONCE_COOKIE, META_CTX_COOKIE]) response.cookies.set(name, '', { path: '/api/meta/oauth', maxAge: 0 });
  return response;
}

// Popup flow: tell the opener (origin-pinned) and close. No token or page data is exposed, only the outcome.
function popupResult(params: Record<string, string>) {
  const origin = new URL(publicBaseUrl()).origin;
  const payload = JSON.stringify({ type: 'mjic-meta-oauth', ...params }).replace(/</g, '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><title>Facebook connection</title><p style="font-family:sans-serif">You can close this window.</p><script>
try { window.opener && window.opener.postMessage(${payload}, ${JSON.stringify(origin)}); } catch (e) {}
window.close();
</script>`;
  return clearCookies(new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }));
}

function finish(context: OAuthContext, params: Record<string, string>) {
  if (context === 'popup') return popupResult(params);
  const url = new URL(context === 'connect' ? '/dashboard/connect' : '/admin', publicBaseUrl());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return clearCookies(NextResponse.redirect(url));
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
    const pages = await connectPagesFromUserToken(userToken);
    const failed = pages.filter((page) => !page.webhook_subscribed).length;
    return finish(context, { meta: 'connected', pages: String(pages.length), failed: String(failed) });
  } catch (error) {
    return finish(context, { meta: 'error', reason: error instanceof Error ? error.message : 'Connection failed' });
  }
}
