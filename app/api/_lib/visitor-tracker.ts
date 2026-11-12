import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';

const LOCATION_HEADERS = [
  'x-vercel-ip-country',
  'x-vercel-ip-country-region',
  'x-vercel-ip-city',
  'x-vercel-ip-timezone',
  'cf-ipcountry',
  'accept-language',
  'sec-ch-ua-platform',
  'sec-ch-ua-mobile',
] as const;

export type VisitorLog = {
  ip_address: string | null;
  page_path: string;
  user_agent: string | null;
  traffic_source: string;
  referrer: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  request_headers: Record<string, string>;
};

function boundedHeader(request: Request, name: string, limit = 200) {
  const value = request.headers.get(name)?.trim();
  return value ? value.slice(0, limit) : null;
}

function requestIp(request: Request) {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return isIP(realIp) ? realIp : null;

  const forwardedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedIp && isIP(forwardedIp) ? forwardedIp : null;
}

function safeReferrer(request: Request, currentUrl: URL) {
  const value = request.headers.get('referer');
  if (!value) return { referrer: null, trafficSource: 'direct' };

  try {
    const referrerUrl = new URL(value);
    if (referrerUrl.protocol !== 'http:' && referrerUrl.protocol !== 'https:') {
      return { referrer: null, trafficSource: 'direct' };
    }
    const referrer = referrerUrl.origin;
    return {
      referrer,
      trafficSource: referrerUrl.host === currentUrl.host ? 'internal' : referrerUrl.hostname.slice(0, 150),
    };
  } catch {
    return { referrer: null, trafficSource: 'direct' };
  }
}

export function createVisitorLog(request: Request): VisitorLog {
  const url = new URL(request.url);
  const referrerData = safeReferrer(request, url);
  const headers = Object.fromEntries(
    LOCATION_HEADERS.flatMap((name) => {
      const value = boundedHeader(request, name);
      return value ? [[name, value]] : [];
    }),
  );
  const utmSource = url.searchParams.get('utm_source')?.trim().slice(0, 150);
  const trafficSource = utmSource || referrerData.trafficSource;

  return {
    ip_address: requestIp(request),
    page_path: url.pathname.slice(0, 500),
    user_agent: boundedHeader(request, 'user-agent', 512),
    traffic_source: trafficSource,
    referrer: referrerData.referrer,
    country: headers['x-vercel-ip-country'] ?? headers['cf-ipcountry'] ?? null,
    region: headers['x-vercel-ip-country-region'] ?? null,
    city: headers['x-vercel-ip-city'] ?? null,
    timezone: headers['x-vercel-ip-timezone'] ?? null,
    request_headers: headers,
  };
}

export async function recordVisitorLog(request: NextRequest) {
  const { getSupabaseAdmin } = await import('./integrations.ts');
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error('Visitor tracking failed: Supabase admin client is not configured.');
    return;
  }

  const { error } = await supabase
    .from('visitor_logs')
    .insert(createVisitorLog(request))
    .abortSignal(AbortSignal.timeout(5000));

  if (error) console.error('Visitor tracking failed to insert visitor_logs row:', error.message);
}
