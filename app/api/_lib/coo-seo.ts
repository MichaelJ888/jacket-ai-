// Pure SEO/COO helpers shared by the publisher and boost advisor. No network access.
import { TARGET_KEYWORDS } from './seo-audit.ts';

export const SEO_HASHTAGS = [
  '#CustomJackets',
  '#CorporateUniformManila',
  '#CustomApparelPH',
  '#EmbroideryPhilippines',
  '#GarmentsFactoryRizal',
  '#MadeInPH',
] as const;

export const MAX_HASHTAGS = 10;

// Keeps the post's own hashtags first, then adds SEO tags that are not already present, up to MAX_HASHTAGS.
export function seoHashtags(existing: readonly string[], max = MAX_HASHTAGS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...existing, ...SEO_HASHTAGS]) {
    const clean = tag.trim();
    if (!/^#[A-Za-z0-9]+$/.test(clean)) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

// Share of target keywords (case-insensitive, whitespace-insensitive) present in a caption, 0..1.
export function keywordCoverage(caption: string): number {
  const normalized = caption.toLowerCase().replace(/\s+/g, ' ');
  const hits = TARGET_KEYWORDS.filter((keyword) => normalized.includes(keyword.toLowerCase())).length;
  return hits / TARGET_KEYWORDS.length;
}
