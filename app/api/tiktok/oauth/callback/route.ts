import { NextResponse } from 'next/server';
import { publicBaseUrl } from '../../../_lib/channels';
import {
  exchangeTikTokAuthorizationCode,
  saveTikTokTokens,
  TIKTOK_OAUTH_COOKIE,
  tiktokOAuthConfig,
  verifyTikTokOAuthState,
} from '../../../_lib/tiktok-oauth';

export const dynamic = 'force-dynamic';

function readCookie(request: Request, name: string) {
  return new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(request.headers.get('cookie') || '')?.[1] || null;
}

function finish(result: 'connected' | 'error', reason?: string) {
  const target = new URL('/admin', publicBaseUrl());
  target.searchParams.set('tiktok', result);
  if (reason) target.searchParams.set('reason', reason);
  const response = NextResponse.redirect(target, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(TIKTOK_OAUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/tiktok/oauth',
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const config = tiktokOAuthConfig();
  if (!config) return finish('error', 'TikTok OAuth is not configured.');

  const validState = verifyTikTokOAuthState(
    params.get('state'),
    readCookie(request, TIKTOK_OAUTH_COOKIE),
    config.clientSecret,
  );
  if (!validState) return finish('error', 'The TikTok login session expired or could not be verified. Please retry.');
  if (params.has('error')) return finish('error', 'TikTok authorization was denied.');

  const code = params.get('code');
  if (!code) return finish('error', 'TikTok did not return an authorization code.');

  try {
    const redirectUri = `${publicBaseUrl().replace(/\/+$/, '')}/api/tiktok/oauth/callback`;
    const tokens = await exchangeTikTokAuthorizationCode(code, redirectUri, config.clientKey, config.clientSecret);
    await saveTikTokTokens(tokens);
    return finish('connected');
  } catch (error) {
    console.error('TikTok OAuth callback failed:', error instanceof Error ? error.message : 'Unknown error');
    return finish('error', 'TikTok connection failed. Check server configuration and try again.');
  }
}
