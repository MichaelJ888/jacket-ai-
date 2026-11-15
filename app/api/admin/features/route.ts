import { NextResponse } from 'next/server';
import { MJIC_DETECTED_ROUTE_PATHS } from '../../_lib/mjic-feature-routes.generated';
import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { writeSetting } from '../../_lib/system-settings';
import { MJIC_FEATURES, normalizeCustomFeatures, routeFeatures, validCustomFeature } from '../../../../lib/mjic-features';

export const dynamic = 'force-dynamic';
const SETTING_KEY = 'mjic_custom_features';

type FeatureSetting = { features?: unknown };

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const { data: setting, error } = await supabase.from('system_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
  if (error) return NextResponse.json({ error: `Could not read feature registry: ${error.message}` }, { status: 503 });
  const customFeatures = normalizeCustomFeatures((setting?.value as FeatureSetting | null)?.features);
  return NextResponse.json({
    features: [...MJIC_FEATURES, ...routeFeatures(MJIC_DETECTED_ROUTE_PATHS), ...customFeatures],
    detectedRoutes: MJIC_DETECTED_ROUTE_PATHS,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  let body: { title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!validCustomFeature(body.title)) {
    return NextResponse.json({ error: 'Feature title must contain 3 to 120 characters.' }, { status: 400 });
  }
  const { data: setting, error: readError } = await supabase.from('system_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
  if (readError) return NextResponse.json({ error: `Could not read feature registry: ${readError.message}` }, { status: 503 });
  const current = normalizeCustomFeatures((setting?.value as FeatureSetting | null)?.features);
  const title = body.title.trim();
  if ([...MJIC_FEATURES, ...current].some((feature) => feature.title.toLocaleLowerCase() === title.toLocaleLowerCase())) {
    return NextResponse.json({ error: 'That feature is already registered.' }, { status: 409 });
  }
  if (current.length >= 100) return NextResponse.json({ error: 'Feature registry is full.' }, { status: 409 });
  const features = [...current.map((feature) => feature.title), title];
  const error = await writeSetting(supabase, SETTING_KEY, { features });
  if (error) return NextResponse.json({ error: `Could not persist feature registry: ${error}` }, { status: 503 });
  return NextResponse.json({ feature: normalizeCustomFeatures([title])[0] }, { status: 201 });
}
