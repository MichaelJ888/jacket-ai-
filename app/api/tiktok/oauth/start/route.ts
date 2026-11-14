import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../../_lib/auth';
import { publicBaseUrl } from '../../../_lib/channels';
import {
  buildTikTokAuthorizeUrl,
  createTikTokOAuthState,
  TIKTOK_OAUTH_COOKIE,
  tiktokOAuthConfig,
} from '../../../_lib/tiktok-oauth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const config = tiktokOAuthConfig();
  if (!config) return NextResponse.json({ error: 'TikTok OAuth app credentials are not configured.' }, { status: 503 });

  const redirectUri = `${publicBaseUrl().replace(/\/+$/, '')}/api/tiktok/oauth/callback`;
  const { state, nonce } = createTikTokOAuthState(config.clientSecret);
  const url = buildTikTokAuthorizeUrl(config.clientKey, redirectUri, state);
  const response = NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(TIKTOK_OAUTH_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/tiktok/oauth',
    maxAge: 600,
  });
  return response;
}
