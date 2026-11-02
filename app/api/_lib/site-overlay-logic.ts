// Server-side snapshot of the homepage editor state and the DB-backed SEO override. Pure functions only.

export const OVERLAY_STORAGE_KEY = 'site_overlay';
export const SEO_OVERRIDE_KEY = 'site_seo_overrides';

// Everything the Visual Editor persists. crmOrders and teamSchedules are internal and never returned publicly.
export const OVERLAY_KEYS = ['siteSettings', 'products', 'testimonials', 'clientNames', 'updates', 'paymentQR', 'showTestimonials', 'showClientList', 'crmOrders', 'fabrics', 'teamSchedules'] as const;
export const PUBLIC_OVERLAY_KEYS = ['siteSettings', 'products', 'testimonials', 'clientNames', 'updates', 'paymentQR', 'showTestimonials', 'showClientList', 'fabrics'] as const;

const MAX_OVERLAY_CHARS = 1_500_000;

export const B2B_SEO_KEYWORDS = [
  'Custom Jackets Philippines',
  'Corporate Uniform Manufacturer Manila',
  'Customized Apparel Supplier Cainta Rizal',
  'Embroidery Services Philippines',
] as const;

export type SeoOverride = { keywords: string[]; jsonLd: Record<string, unknown>; updatedAt: string };

export function sanitizeOverlay(body: unknown): { ok: true; doc: Record<string, unknown> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Expected an object.' };
  const source = body as Record<string, unknown>;
  const doc: Record<string, unknown> = {};
  for (const key of OVERLAY_KEYS) if (key in source) doc[key] = source[key];
  if (Object.keys(doc).length === 0) return { ok: false, error: 'No editable sections found.' };
  if (JSON.stringify(doc).length > MAX_OVERLAY_CHARS) return { ok: false, error: 'Site data is too large to publish.' };
  return { ok: true, doc };
}

export function publicOverlay(doc: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!doc) return null;
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_OVERLAY_KEYS) if (key in doc) out[key] = doc[key];
  return Object.keys(out).length ? out : null;
}

// Merges the required B2B keywords into any existing override, keeping earlier ones and dropping duplicates.
export function buildSeoOverride(existing: Partial<SeoOverride> | null | undefined, now: string): SeoOverride {
  const keywords = Array.from(new Set([...(existing?.keywords ?? []), ...B2B_SEO_KEYWORDS]));
  return {
    keywords,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Michael Jeffrey International Corporation',
      url: 'https://jacket-ai.vercel.app/',
      description: 'Customized jackets, corporate uniforms, and embroidery services in the Philippines.',
      areaServed: 'Philippines',
      knowsAbout: keywords,
      keywords: keywords.join(', '),
    },
    updatedAt: now,
  };
}
