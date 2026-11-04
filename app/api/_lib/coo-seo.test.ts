import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_HASHTAGS, SEO_HASHTAGS, keywordCoverage, seoHashtags } from './coo-seo.ts';

test('seoHashtags keeps post tags first, dedupes case-insensitively, and caps the list', () => {
  const tags = seoHashtags(['#MJIC', '#custompjackets', '#CustomJackets']);
  assert.equal(tags[0], '#MJIC');
  assert.equal(new Set(tags.map((tag) => tag.toLowerCase())).size, tags.length);
  assert.ok(tags.length <= MAX_HASHTAGS);
  assert.ok(SEO_HASHTAGS.slice(0, MAX_HASHTAGS - 1).every((tag) => tags.includes(tag)));
});

test('seoHashtags drops malformed tags', () => {
  const tags = seoHashtags(['not a tag', '#ok', '#bad-tag']);
  assert.ok(tags.includes('#ok'));
  assert.ok(!tags.some((tag) => tag.includes(' ') || tag.includes('-')));
});

test('keywordCoverage counts target keywords case-insensitively', () => {
  assert.equal(keywordCoverage(''), 0);
  assert.ok(keywordCoverage('CUSTOM   jackets philippines') > 0);
  assert.ok(keywordCoverage('Embroidery Services Philippines and Garments Factory Rizal') > 0.3);
});
