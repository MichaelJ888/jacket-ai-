// Server-side snapshot of the homepage editor state and the DB-backed SEO override. Pure functions only.

export const OVERLAY_STORAGE_KEY = 'site_overlay';
export const SEO_OVERRIDE_KEY = 'site_seo_overrides';

// Everything the Visual Editor persists. crmOrders and teamSchedules are internal and never returned publicly.
export const OVERLAY_KEYS = ['siteSettings', 'products', 'testimonials', 'clientNames', 'updates', 'paymentQR', 'showTestimonials', 'showClientList', 'crmOrders', 'fabrics', 'teamSchedules'] as const;
export const PUBLIC_OVERLAY_KEYS = ['siteSettings', 'products', 'testimonials', 'clientNames', 'updates', 'paymentQR', 'showTestimonials', 'showClientList', 'fabrics'] as const;

const MAX_OVERLAY_CHARS = 1_500_000;

export const B2B_SEO_KEYWORDS = [
  'Custom Jackets Philippines',
  'Customized Corporate Uniform Manufacturer Manila',
  'Customized Apparel Supplier Cainta Rizal and Taguig BGC',
  'Embroidery Services Philippines',
  'Corporate Uniform Manufacturer Manila',
] as const;

const FAQ_ITEMS = [
  { q: 'What is the minimum order quantity?', a: 'The minimum order is 20 pieces per style.' },
  { q: 'Is delivery free?', a: 'Delivery within Metro Manila is free.' },
  { q: 'Do you provide a free mock-up?', a: 'Yes, a digital mock-up is free before production.' },
  { q: 'Is the first logo embroidery free?', a: 'The first logo embroidery is free on your order.' },
];

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
  const url = 'https://jacket-ai.vercel.app/';
  return {
    keywords,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${url}#organization`,
          name: 'Michael Jeffrey International Corporation',
          url,
          description: 'Customized jackets, corporate uniforms, and embroidery services in the Philippines. Minimum order 20 pieces.',
          areaServed: ['Philippines', 'Metro Manila', 'Cainta, Rizal', 'Taguig (BGC)', 'Manila'],
          knowsAbout: keywords,
          keywords: keywords.join(', '),
        },
        {
          '@type': 'FAQPage',
          '@id': `${url}#faq`,
          mainEntity: FAQ_ITEMS.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        },
      ],
    },
    updatedAt: now,
  };
}

