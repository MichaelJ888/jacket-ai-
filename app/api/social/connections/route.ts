import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { checkPageHealth } from '../../_lib/meta-health';
import { listConnections } from '../../_lib/meta-oauth';
import {
  SOCIAL_PROVIDER_IDS,
  socialConnection,
  socialProviderConfigured,
  type SocialProvider,
} from '../../_lib/social-connections';

export const dynamic = 'force-dynamic';

function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === 'string' && SOCIAL_PROVIDER_IDS.some((provider) => provider === value);
}

function configuredEnvironmentNames() {
  return new Set(Object.keys(process.env).filter((name) => Boolean(process.env[name])));
}

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const mjicPageId = process.env.META_PAGE_ID;
    const configuredNames = configuredEnvironmentNames();
    const pages = mjicPageId && mjicPageId !== process.env.META_CGV_PAGE_ID
      ? (await listConnections()).filter((page) => page.page_id === mjicPageId)
      : [];
    const connections = SOCIAL_PROVIDER_IDS.map((provider) => {
      const configured = socialProviderConfigured(provider, configuredNames);
      if (provider === 'facebook') {
        return socialConnection(
          provider,
          pages.length ? 'unverified' : 'not_linked',
          pages.length ? `${pages.length} Facebook Page connection(s); run a health check.` : 'No Facebook Page is linked.',
          configured,
        );
      }
      if (provider === 'instagram') {
        const linked = pages.filter((page) => page.ig_user_id);
        return socialConnection(
          provider,
          linked.length ? 'unverified' : 'not_linked',
          linked.length ? `${linked.length} Instagram account connection(s); run a health check.` : 'No Instagram business account is linked.',
          configured,
        );
      }
      if (provider === 'youtube' || provider === 'tiktok') {
        return socialConnection(
          provider,
          configured ? 'unverified' : 'not_linked',
          configured ? 'Publishing credentials are present; live token validity has not been checked.' : 'Not linked. Platform credentials are not configured.',
          configured,
        );
      }
      return socialConnection(provider, 'not_linked', 'Not linked. Platform app credentials and authorization are required.', false);
    });
    return NextResponse.json({ connections }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load social connections.' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { provider?: unknown } | null;
  if (!isSocialProvider(body?.provider)) return NextResponse.json({ error: 'A supported provider is required.' }, { status: 400 });
  if (body.provider !== 'facebook' && body.provider !== 'instagram') {
    return NextResponse.json({ error: 'Live health checks are not available for this provider yet.' }, { status: 409 });
  }

  try {
    const mjicPageId = process.env.META_PAGE_ID;
    const configuredNames = configuredEnvironmentNames();
    const pages = mjicPageId && mjicPageId !== process.env.META_CGV_PAGE_ID
      ? (await listConnections()).filter((page) => page.page_id === mjicPageId)
      : [];
    const relevantPages = body.provider === 'instagram' ? pages.filter((page) => page.ig_user_id) : pages;
    if (!relevantPages.length) {
      return NextResponse.json({
        connection: socialConnection(body.provider, 'not_linked', 'No matching account is linked.', socialProviderConfigured(body.provider, configuredNames)),
      });
    }
    const results = await Promise.all(relevantPages.map(async (page) => ({
      page,
      health: await checkPageHealth(page.page_id, page.ig_user_id),
    })));
    const healthy = results.some(({ health }) => (
      body.provider === 'facebook'
        ? health.healthy
        : health.healthy && health.checks.some((check) => check.id === 'instagram' && check.ok)
    ));
    const connection = socialConnection(
      body.provider,
      healthy ? 'active' : 'error',
      healthy ? 'Live provider checks passed.' : 'The linked account failed a token, webhook, or account health check.',
      socialProviderConfigured(body.provider, configuredNames),
    );
    return NextResponse.json({
      connection,
      pages: results.map(({ page, health }) => ({
        name: page.page_name,
        healthy: body.provider === 'facebook'
          ? health.healthy
          : health.healthy && health.checks.some((check) => check.id === 'instagram' && check.ok),
        checks: health.checks,
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Social health check failed.' },
      { status: 502 },
    );
  }
}
