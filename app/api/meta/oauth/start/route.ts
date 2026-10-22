import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../../_lib/auth';
import { publicBaseUrl } from '../../../_lib/channels';
import { buildAuthorizeUrl, createOAuthState, META_CTX_COOKIE, META_NONCE_COOKIE, metaOAuthConfig, oauthRedirectUri, parseOAuthContext } from '../../../_lib/meta-oauth';

export const dynamic = 'force-dynamic';

// POST (admin bearer) { context?: 'popup' | 'connect' | 'admin' }: returns the Facebook login URL and plants the CSRF nonce + return-context cookies.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const config = metaOAuthConfig();
  if (!config) return NextResponse.json({ error: 'META_APP_ID and META_APP_SECRET must be set.' }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { context?: string };
  const { state, nonce } = createOAuthState(config.appSecret);
  const response = NextResponse.json({ url: buildAuthorizeUrl(config.appId, oauthRedirectUri(publicBaseUrl()), state) });
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/api/meta/oauth', maxAge: 600 };
  response.cookies.set(META_NONCE_COOKIE, nonce, cookie);
  response.cookies.set(META_CTX_COOKIE, parseOAuthContext(body.context), cookie);
  return response;
}
