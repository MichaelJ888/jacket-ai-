import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  getNextCategory,
  buildHashtags,
  MJIC_TRUST_FAQS,
  injectFaqsIntoSystemPrompt,
  type ProductCategory,
} from './mjic-commercial-engine.ts';

test('getNextCategory: sequential rotation without repeats', () => {
  const categories: ProductCategory[] = ['varsity-jackets', 'corporate-uniforms', 'school-uniforms', 'custom-bags', 'corporate-giveaways', 'safety-jackets'];
  
  let current: ProductCategory | undefined;
  for (let i = 0; i < 12; i++) {
    current = getNextCategory(current);
    const idx = i % 6;
    assert.strictEqual(current, categories[idx], `rotation cycle ${i} should match`);
  }
});

test('buildHashtags: 10-hashtag cap with Tier1 + category', () => {
  const tags = buildHashtags('varsity-jackets');
  assert.strictEqual(tags.length, 10, 'should have exactly 10 hashtags');
  assert.ok(tags.includes('#MJIC'), 'Tier1 always present');
  assert.ok(tags.includes('#VarsityJacketsPH'), 'category-specific present');
  
  // Verify no duplicates.
  const unique = new Set(tags);
  assert.strictEqual(unique.size, tags.length, 'no duplicate hashtags');
});

test('buildHashtags: different categories have different category-specific tags', () => {
  const varsity = buildHashtags('varsity-jackets');
  const uniforms = buildHashtags('corporate-uniforms');
  
  // Both share Tier1 hashtags, but have different category-specific ones.
  const varsitySpecific = varsity.filter(tag => tag.includes('Varsity'));
  const uniformSpecific = uniforms.filter(tag => tag.includes('Uniform'));
  
  assert.ok(varsitySpecific.length > 0, 'varsity tags should include Varsity');
  assert.ok(uniformSpecific.length > 0, 'uniform tags should include Uniform');
  
  // Check that no Varsity tag appears in uniforms and vice versa.
  const varsityInUniforms = varsity.filter(tag => uniforms.includes(tag) && tag.includes('Varsity'));
  assert.strictEqual(varsityInUniforms.length, 0, 'Varsity tags should not appear in Uniform category');
});

test('MJIC_TRUST_FAQS: contains 10+ key FAQ points', () => {
  const faqs = MJIC_TRUST_FAQS.toLowerCase();
  assert.ok(faqs.includes('since 2004') || faqs.includes('25'), 'founding year');
  assert.ok(faqs.includes('free') && faqs.includes('mock'), 'free mockup');
  assert.ok(faqs.includes('free delivery'), 'free delivery');
  assert.ok(faqs.includes('sample'), 'sample');
  assert.ok(faqs.includes('15'), 'lead time mention');
  assert.ok(faqs.includes('embroidery') || faqs.includes('dtf') || faqs.includes('sublimation'), 'production methods');
  assert.ok(faqs.includes('50'), 'payment terms');
});

test('injectFaqsIntoSystemPrompt: appends FAQs without corruption', () => {
  const originalPrompt = 'You are MJIC sales agent.';
  const enhanced = injectFaqsIntoSystemPrompt(originalPrompt);
  
  assert.ok(enhanced.includes(originalPrompt), 'original prompt preserved');
  assert.ok(enhanced.includes('MJIC TRUST & FAQ CONTEXT'), 'FAQ section added');
  assert.ok(enhanced.includes('since 2004'), 'FAQ content included');
});
