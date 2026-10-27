import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCustomerKnowledge } from './knowledge-logic.ts';

test('excludes supplier and internal-cost knowledge from customer prompts', () => {
  const serialized = serializeCustomerKnowledge([
    { category: 'faq', title: 'MOQ', content: 'Custom orders start at 20 pieces.' },
    { category: 'supplier', title: 'Supplier', content: 'Private supplier contact.' },
    { category: 'internal_cost', title: 'Fabric cost', content: 'Confidential unit cost.' },
  ]);
  assert.deepEqual(JSON.parse(serialized), [
    { category: 'faq', title: 'MOQ', content: 'Custom orders start at 20 pieces.' },
  ]);
});

test('bounds customer knowledge and removes null characters', () => {
  const serialized = serializeCustomerKnowledge([
    { category: 'product', title: 'A\u0000'.repeat(100), content: 'B\u0000'.repeat(2000) },
    { category: 'tone', title: 'Later', content: 'A later item.' },
  ], 1500);
  const items = JSON.parse(serialized);
  assert.equal(serialized.length <= 1500, true);
  assert.equal(items.some((item: { title: string }) => item.title.includes('\u0000')), false);
});
