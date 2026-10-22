import { NextResponse } from 'next/server';
import { rateLimitResponse } from '../../../_lib/rate-limit';
import { publicBaseUrl } from '../../../_lib/channels';
import { buildAuthorizeUrl, createOAuthState, META_CTX_COOKIE, META_NONCE_COOKIE, metaOAuthConfig, oauthRedirectUri, parseOAuthContext } from '../../../_lib/meta-oauth';

export const dynamic = 'force-dynamic';

// Public on purpose: this is the "Continue with Facebook" button for buyers. The signed state + nonce cookie protect the callback.
// POST { context?: 'popup' | 'connect' | 'admin' } returns the Facebook login URL and plants the CSRF nonce + return-context cookies.
export async function POST(request: Request) {
  const limited = await rateLimitResponse(request, 'meta-oauth-start', 30, 600);
  if (limited) return limited;
  const config = metaOAuthConfig();
  if (!config) return NextResponse.json({ error: 'Facebook connection is not configured yet.' }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { context?: string };
  const { state, nonce } = createOAuthState(config.appSecret);
  const response = NextResponse.json({ url: buildAuthorizeUrl(config.appId, oauthRedirectUri(publicBaseUrl()), state) });
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/api/meta/oauth', maxAge: 600 };
  response.cookies.set(META_NONCE_COOKIE, nonce, cookie);
  response.cookies.set(META_CTX_COOKIE, parseOAuthContext(body.context), cookie);
  return response;
}
