// On-site SEO audit for the public homepage. Pure functions only (no network), so it is unit-testable.

export const SEO_SITE_ORIGIN = 'https://jacket-ai.vercel.app';

export const TARGET_KEYWORDS = [
  'Custom Jackets Philippines',
  'Corporate Uniform Manufacturer Manila',
  'Customized Apparel Supplier Cainta Rizal',
  'Embroidery Services Philippines',
  'Garments Factory Rizal',
] as const;

export type SeoStatus = 'pass' | 'warn' | 'fail';
export type SeoCheck = { id: string; label: string; status: SeoStatus; detail: string };
export type SeoKeywordResult = { keyword: string; occurrences: number; per1000Words: number; inTitle: boolean; inDescription: boolean };
export type SeoAudit = {
  score: number;
  checks: SeoCheck[];
  keywords: SeoKeywordResult[];
  jsonLdTypes: string[];
  wordCount: number;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

function decodeEntities(value: string) {
  return value.replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (match, name: string) => ENTITIES[name] ?? match);
}

function firstMatch(html: string, pattern: RegExp) {
  const match = pattern.exec(html);
  return match ? decodeEntities(match[1].trim()) : null;
}

function metaContent(html: string, attr: 'name' | 'property', key: string) {
  const tag = new RegExp(`<meta\\b[^>]*\\b${attr}=["']${key}["'][^>]*>`, 'i').exec(html);
  if (!tag) return null;
  return firstMatch(tag[0], /\bcontent=["']([^"']*)["']/i);
}

function jsonLdTypes(html: string): { types: string[]; parseErrors: number } {
  const types = new Set<string>();
  let parseErrors = 0;
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const collect = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      const type = record['@type'];
      if (typeof type === 'string') types.add(type);
      else if (Array.isArray(type)) type.forEach((t) => typeof t === 'string' && types.add(t));
      if (record['@graph']) collect(record['@graph']);
    }
  };
  for (const block of blocks) {
    try {
      collect(JSON.parse(block[1]));
    } catch {
      parseErrors += 1;
    }
  }
  return { types: [...types], parseErrors };
}

function visibleText(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (haystack.match(new RegExp(escaped, 'gi')) ?? []).length;
}

export function auditSeoHtml(html: string, expectedOrigin = SEO_SITE_ORIGIN): SeoAudit {
  const checks: SeoCheck[] = [];
  const add = (id: string, label: string, status: SeoStatus, detail: string) => checks.push({ id, label, status, detail });

  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? '';
  const description = metaContent(html, 'name', 'description') ?? '';
  const canonical = firstMatch(html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0] ?? '', /\bhref=["']([^"']*)["']/i);
  const lang = firstMatch(html, /<html[^>]*\blang=["']([^"']+)["']/i);
  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  const text = visibleText(html);
  const wordCount = text ? text.split(' ').length : 0;

  if (!title) add('title', 'Title tag', 'fail', 'Missing <title>.');
  else if (title.length < 30 || title.length > 60) add('title', 'Title length', 'warn', `${title.length} chars (ideal 30–60).`);
  else add('title', 'Title length', 'pass', `${title.length} chars.`);

  if (!description) add('meta-description', 'Meta description', 'fail', 'Missing meta description.');
  else if (description.length < 120 || description.length > 160) add('meta-description', 'Meta description length', 'warn', `${description.length} chars (ideal 120–160).`);
  else add('meta-description', 'Meta description length', 'pass', `${description.length} chars.`);

  if (!canonical || canonical.includes('REPLACE-WITH')) add('canonical', 'Canonical URL', 'fail', 'Canonical missing or placeholder.');
  else if (!canonical.startsWith(expectedOrigin)) add('canonical', 'Canonical URL', 'warn', `Points to ${canonical}, expected ${expectedOrigin}.`);
  else add('canonical', 'Canonical URL', 'pass', canonical);

  add('lang', 'HTML lang attribute', lang ? 'pass' : 'warn', lang ? `lang="${lang}"` : 'Missing lang attribute.');
  add('h1', 'Single H1', h1Count === 1 ? 'pass' : 'warn', `${h1Count} <h1> tag(s).`);

  const ogTitle = metaContent(html, 'property', 'og:title');
  const ogDescription = metaContent(html, 'property', 'og:description');
  add(
    'open-graph',
    'Open Graph title + description',
    ogTitle && ogDescription ? 'pass' : 'warn',
    ogTitle && ogDescription ? 'Present.' : 'Missing og:title or og:description.',
  );

  const ld = jsonLdTypes(html);
  if (ld.parseErrors > 0) add('json-ld', 'JSON-LD structured data', 'fail', `${ld.parseErrors} block(s) fail to parse.`);
  else if (ld.types.length === 0) add('json-ld', 'JSON-LD structured data', 'fail', 'No JSON-LD found.');
  else add('json-ld', 'JSON-LD structured data', 'pass', ld.types.join(', '));

  const keywords: SeoKeywordResult[] = TARGET_KEYWORDS.map((keyword) => {
    const occurrences = countOccurrences(text, keyword);
    return {
      keyword,
      occurrences,
      per1000Words: wordCount ? Math.round((occurrences / wordCount) * 1000 * 10) / 10 : 0,
      inTitle: countOccurrences(title, keyword) > 0,
      inDescription: countOccurrences(description, keyword) > 0,
    };
  });
  const missing = keywords.filter((k) => k.occurrences === 0).map((k) => k.keyword);
  add(
    'keywords',
    'Target keyword coverage',
    missing.length === 0 ? 'pass' : missing.length === keywords.length ? 'fail' : 'warn',
    missing.length === 0 ? `All ${keywords.length} target keywords present.` : `Missing on page: ${missing.join('; ')}.`,
  );

  const weights: Record<SeoStatus, number> = { pass: 1, warn: 0.5, fail: 0 };
  const score = Math.round((checks.reduce((sum, c) => sum + weights[c.status], 0) / checks.length) * 100);

  return { score, checks, keywords, jsonLdTypes: ld.types, wordCount };
}
