import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditSeoHtml, TARGET_KEYWORDS } from './seo-audit.ts';

const GOOD_TITLE = 'Custom Jackets Philippines | Corporate Uniform Manila';
const GOOD_DESC =
  'Custom jackets Philippines from our Cainta Rizal factory. Corporate uniform manufacturer Manila, embroidery services Philippines, MOQ 20 pcs.';

const GOOD_HTML = `<!doctype html><html lang="en"><head>
<title>${GOOD_TITLE}</title>
<meta name="description" content="${GOOD_DESC}">
<link rel="canonical" href="https://jacket-ai.vercel.app/">
<meta property="og:title" content="Custom Jackets">
<meta property="og:description" content="Custom jackets">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"MJIC"},{"@type":["LocalBusiness","Store"]}]}</script>
</head><body><h1>Customized Jackets</h1><p>${TARGET_KEYWORDS.join(' ')} and more.</p></body></html>`;

test('a well-formed page passes every structural check', () => {
  const audit = auditSeoHtml(GOOD_HTML);
  assert.equal(audit.checks.find((c) => c.id === 'canonical')?.status, 'pass');
  assert.equal(audit.checks.find((c) => c.id === 'json-ld')?.status, 'pass');
  assert.equal(audit.checks.find((c) => c.id === 'h1')?.status, 'pass');
  assert.equal(audit.checks.find((c) => c.id === 'keywords')?.status, 'pass');
  assert.deepEqual(audit.jsonLdTypes.sort(), ['LocalBusiness', 'Organization', 'Store']);
  assert.equal(audit.score, 100);
});

test('placeholder canonical from the old template fails', () => {
  const html = GOOD_HTML.replace('https://jacket-ai.vercel.app/', 'https://REPLACE-WITH-YOUR-DOMAIN.netlify.app/');
  assert.equal(auditSeoHtml(html).checks.find((c) => c.id === 'canonical')?.status, 'fail');
});

test('canonical on a different host warns', () => {
  const html = GOOD_HTML.replace('https://jacket-ai.vercel.app/', 'https://example.com/');
  assert.equal(auditSeoHtml(html).checks.find((c) => c.id === 'canonical')?.status, 'warn');
});

test('missing keywords are reported and invalid JSON-LD fails', () => {
  const html = '<html><head><title>x</title><script type="application/ld+json">{bad</script></head><body><h1>a</h1></body></html>';
  const audit = auditSeoHtml(html);
  assert.equal(audit.checks.find((c) => c.id === 'json-ld')?.status, 'fail');
  assert.equal(audit.checks.find((c) => c.id === 'keywords')?.status, 'fail');
  assert.equal(audit.keywords.every((k) => k.occurrences === 0), true);
});

test('keyword matching ignores case and HTML entities', () => {
  const html = '<html><body><p>Embroidery&nbsp;Services Philippines: EMBROIDERY SERVICES PHILIPPINES</p></body></html>';
  const hit = auditSeoHtml(html).keywords.find((k) => k.keyword === 'Embroidery Services Philippines');
  assert.equal(hit?.occurrences, 2);
});
