import assert from 'node:assert/strict';
import test from 'node:test';

import { marketQuoteLine, quoteFromLines, seedGiveawayCatalog } from './giveaway-quote.ts';
import {
  buildMarketPricePrompt,
  buildMarketVerdict,
  marketMedian,
  marketUnitPrice,
  MARKET_QUOTE_TTL_MS,
  parseMarketReply,
  signMarketQuote,
  verifyMarketQuote,
} from './giveaway-market.ts';

const SECRET = 'test-secret';
const NOW = 1_800_000_000_000;

test('market median uses the middle value, or the mean of the two middle values', () => {
  assert.equal(marketMedian([90, 100, 110]), 100);
  assert.equal(marketMedian([90, 100, 110, 130]), 105);
  assert.equal(marketMedian([110, 90, 100]), 100, 'input order does not matter');
});

test('market median needs at least three valid observations and drops implausible prices', () => {
  assert.equal(marketMedian([100, 110]), null);
  assert.equal(marketMedian([100, 110, 0, -5, 900000]), null, 'zero, negative, and absurd prices are discarded');
  assert.equal(marketMedian([100, 110, 120, Number.NaN]), 110);
});

test('unit price is median x 1.20, rounded up to the whole peso', () => {
  assert.equal(marketUnitPrice(100), 120);
  assert.equal(marketUnitPrice(101), 122, '121.2 rounds up to 122');
  assert.equal(marketUnitPrice(83.33), 100, 'cent rounding keeps float error from adding a peso');
});

test('parses the grounded model reply and ignores text around the JSON', () => {
  const reply = parseMarketReply('Here you go: {"category":"mug","confidence":0.9,"observations":[{"price_php":95,"source":"a"},{"price_php":"110","source":"b"},{"source":"c"}]} thanks');
  assert.ok(reply);
  assert.equal(reply.category, 'mug');
  assert.equal(reply.confidence, 0.9);
  assert.deepEqual(reply.prices, [95, 110]);
  assert.equal(parseMarketReply('no json here'), null);
  assert.equal(parseMarketReply('{not json}'), null);
});

test('market prompt lists the catalog keys and forbids invented prices', () => {
  const prompt = buildMarketPricePrompt(seedGiveawayCatalog());
  assert.match(prompt, /mug:/);
  assert.match(prompt, /Never invent|Use only prices you found/);
});

test('signed token round-trips and carries label, unit price, and quantity', () => {
  const token = signMarketQuote({ label: 'Mug', unitPrice: 120, quantity: 20, issuedAt: NOW }, SECRET);
  assert.deepEqual(verifyMarketQuote(token, SECRET, NOW + 1000), { label: 'Mug', unitPrice: 120, quantity: 20, issuedAt: NOW });
});

test('token is rejected when tampered, signed with another secret, expired, or from the future', () => {
  const token = signMarketQuote({ label: 'Mug', unitPrice: 120, quantity: 20, issuedAt: NOW }, SECRET);
  const [body, sig] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ label: 'Mug', unitPrice: 1, quantity: 20, issuedAt: NOW })).toString('base64url');

  assert.equal(verifyMarketQuote(`${forgedBody}.${sig}`, SECRET, NOW), null, 'changed price fails the signature');
  assert.equal(verifyMarketQuote(token, 'other-secret', NOW), null, 'wrong secret fails');
  assert.equal(verifyMarketQuote(token, SECRET, NOW + MARKET_QUOTE_TTL_MS + 1), null, 'expired after 30 minutes');
  assert.equal(verifyMarketQuote(token, SECRET, NOW - 120_000), null, 'issued in the future fails');
  assert.equal(verifyMarketQuote(`${body}.${sig}.extra`, SECRET, NOW), null);
  assert.equal(verifyMarketQuote(undefined, SECRET, NOW), null);
});

test('token rejects quantities below the 20-piece market minimum', () => {
  const token = signMarketQuote({ label: 'Mug', unitPrice: 120, quantity: 5, issuedAt: NOW }, SECRET);
  assert.equal(verifyMarketQuote(token, SECRET, NOW), null);
});

test('verdict: market-priced only with a confident match, enough prices, and a secret', () => {
  const catalog = seedGiveawayCatalog();
  const reply = { category: 'mug', confidence: 0.9, prices: [90, 100, 110] };

  const verdict = buildMarketVerdict(reply, catalog, 20, SECRET, NOW);
  assert.equal(verdict.status, 'market_priced');
  if (verdict.status !== 'market_priced') return;
  assert.equal(verdict.category, 'mug');
  assert.equal(verdict.label, catalog.find((c) => c.key === 'mug')!.label, 'label comes from the catalog, not model text');
  assert.equal(verdict.unitPrice, 120);
  assert.equal(verdict.quantity, 20);
  assert.equal(verifyMarketQuote(verdict.quoteToken, SECRET, NOW)?.unitPrice, 120);

  assert.equal(buildMarketVerdict(reply, catalog, 20, null, NOW).status, 'suggested', 'no secret: no price is returned');
  assert.equal(buildMarketVerdict({ ...reply, prices: [100] }, catalog, 20, SECRET, NOW).status, 'suggested', 'too few prices: no price');
  assert.equal(buildMarketVerdict({ ...reply, confidence: 0.4 }, catalog, 20, SECRET, NOW).status, 'needs_sales_confirmation');
  assert.equal(buildMarketVerdict({ ...reply, category: 'unknown-item' }, catalog, 20, SECRET, NOW).status, 'needs_sales_confirmation');
  assert.equal(buildMarketVerdict(null, catalog, 20, SECRET, NOW).status, 'needs_sales_confirmation');
});

test('photo-priced line totals: 20 pieces at 120 = 2,400 with a 1,200 deposit', () => {
  const quote = quoteFromLines([marketQuoteLine('Mug', 120, 20)]);
  assert.equal(quote.subtotal, 2400);
  assert.equal(quote.deposit, 1200);
  assert.equal(quote.balance, 1200);
  assert.equal(quote.totalQuantity, 20);
  assert.equal(quote.lines[0].label, 'Mug (photo quote)');
});
