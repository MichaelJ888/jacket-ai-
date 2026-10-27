import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectCredits, readLocalKey } from './ai-gateway-diagnostics.mjs';

test('reads only the AI Gateway key without printing or evaluating it', () => {
  assert.equal(readLocalKey('NEXT_PUBLIC_SUPABASE_URL=https://example.test\nAI_GATEWAY_API_KEY="test-secret"\n'), 'test-secret');
  assert.equal(readLocalKey('OTHER_KEY=abc\n'), '');
});

test('reports credit balance from the read-only Gateway endpoint', async () => {
  const result = await inspectCredits('key', async (url, init) => {
    assert.equal(url, 'https://ai-gateway.vercel.sh/v1/credits');
    assert.match(init.headers.Authorization, /^Bearer key$/);
    return Response.json({ balance: '12.50', total_used: '4.25' });
  });
  assert.deepEqual(result, { ok: true, status: 200, balance: 12.5, totalUsed: 4.25 });
});

test('reports unavailable Gateway billing without exposing response bodies', async () => {
  const result = await inspectCredits('key', async () => new Response('sensitive provider response', { status: 402 }));
  assert.deepEqual(result, {
    ok: false,
    status: 402,
    error: 'Gateway billing/credits are unavailable; check the Vercel AI Gateway billing page.',
  });
});
