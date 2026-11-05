import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_GATEWAY_BILLING_MESSAGE, isAiGatewayBillingFailure } from './ai-gateway.ts';

test('HTTP 402 from the gateway is a billing failure', () => {
  assert.equal(isAiGatewayBillingFailure({ statusCode: 402, message: 'Payment Required' }), true);
  assert.equal(isAiGatewayBillingFailure({ status: 402 }), true);
});

test('credit card and credit exhaustion wording is a billing failure', () => {
  assert.equal(isAiGatewayBillingFailure(new Error('AI Gateway requires a valid credit card')), true);
  assert.equal(isAiGatewayBillingFailure(new Error('Insufficient credits to start this model')), true);
  assert.equal(isAiGatewayBillingFailure({ message: 'request failed', responseBody: '{"error":"quota exceeded"}' }), true);
});

test('unrelated gateway errors are not billing failures', () => {
  assert.equal(isAiGatewayBillingFailure({ statusCode: 500, message: 'Internal server error' }), false);
  assert.equal(isAiGatewayBillingFailure(new Error('Model not found')), false);
  assert.equal(isAiGatewayBillingFailure(null), false);
});

test('billing message points at the gateway dashboard', () => {
  assert.match(AI_GATEWAY_BILLING_MESSAGE, /vercel\.com\/dashboard\/ai-gateway/);
});
