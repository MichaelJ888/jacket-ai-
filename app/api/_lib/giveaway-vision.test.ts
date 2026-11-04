import assert from 'node:assert/strict';
import test from 'node:test';

import { seedGiveawayCatalog } from './giveaway-quote.ts';
import {
  GIVEAWAY_PHOTO_MAX_CHARS,
  isValidGiveawayPhoto,
  NO_PROVIDER_VERDICT,
  parseGiveawayVerdict,
} from './giveaway-vision.ts';

const catalog = seedGiveawayCatalog();
const firstKey = catalog[0].key;
const NEEDS_CONFIRMATION = { status: 'needs_sales_confirmation' };

test('accepts only small PNG/JPEG/WEBP data URLs', () => {
  assert.equal(isValidGiveawayPhoto('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isValidGiveawayPhoto('data:image/jpeg;base64,/9j/4AAQ'), true);
  assert.equal(isValidGiveawayPhoto('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(isValidGiveawayPhoto('https://example.com/a.png'), false);
  assert.equal(isValidGiveawayPhoto(undefined), false);
  assert.equal(isValidGiveawayPhoto(`data:image/png;base64,${'A'.repeat(GIVEAWAY_PHOTO_MAX_CHARS)}`), false);
});

test('no evidence: unparseable or non-JSON model output needs sales confirmation', () => {
  assert.deepEqual(parseGiveawayVerdict('I cannot tell.', catalog).status, NEEDS_CONFIRMATION.status);
  assert.deepEqual(parseGiveawayVerdict('{"category": ', catalog).status, NEEDS_CONFIRMATION.status);
});

test('no evidence: unknown category key is rejected, never guessed', () => {
  const verdict = parseGiveawayVerdict('{"category":"made-up-item","confidence":0.99}', catalog);
  assert.equal(verdict.status, 'needs_sales_confirmation');
});

test('no evidence: low confidence needs sales confirmation', () => {
  const verdict = parseGiveawayVerdict(`{"category":"${firstKey}","confidence":0.4}`, catalog);
  assert.equal(verdict.status, 'needs_sales_confirmation');
});

test('no evidence: "none" category needs sales confirmation', () => {
  const verdict = parseGiveawayVerdict('{"category":"none","confidence":0.95}', catalog);
  assert.equal(verdict.status, 'needs_sales_confirmation');
});

test('a confident catalog match is suggested with its official label', () => {
  const verdict = parseGiveawayVerdict(`Here: {"category":"${firstKey}","confidence":0.9}`, catalog);
  assert.equal(verdict.status, 'suggested');
  if (verdict.status === 'suggested') {
    assert.equal(verdict.category, firstKey);
    assert.equal(verdict.label, catalog[0].label);
    assert.equal(verdict.confidence, 0.9);
  }
});

test('missing GEMINI_API_KEY path returns the sales-confirmation verdict', () => {
  assert.equal(NO_PROVIDER_VERDICT.status, 'needs_sales_confirmation');
});
