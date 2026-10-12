import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseQuoteModel } from './chat-model-router.ts';

test('routes general product and business FAQs to the inexpensive tier', () => {
  assert.equal(shouldUseQuoteModel([{ role: 'user', content: 'What fabrics do you offer?' }]), false);
  assert.equal(shouldUseQuoteModel([{ role: 'user', content: 'Where is your showroom?' }]), false);
});

test('routes quote requests and specific garment orders to the quote tier', () => {
  assert.equal(shouldUseQuoteModel([{ role: 'user', content: 'Can you give me a quotation?' }]), true);
  assert.equal(shouldUseQuoteModel([{ role: 'user', content: 'We need 100 jackets with embroidery.' }]), true);
});

test('keeps short order-detail follow-ups in an active quote conversation on the quote tier', () => {
  assert.equal(
    shouldUseQuoteModel([
      { role: 'user', content: 'Please quote custom jackets for our team.' },
      { role: 'assistant', content: 'How many pieces and what embroidery do you need?' },
      { role: 'user', content: 'Polyester with our embroidered logo.' },
    ]),
    true,
  );
});

test('does not treat unrelated numbers or FAQ product specifications as quotes', () => {
  assert.equal(shouldUseQuoteModel([{ role: 'user', content: 'Are you open until 5?' }]), false);
  assert.equal(shouldUseQuoteModel([{ role: 'user', content: 'Do you use embroidery?' }]), false);
});

test('supports text-part user messages', () => {
  assert.equal(
    shouldUseQuoteModel([{ role: 'user', parts: [{ type: 'text', text: 'How much for 50 uniforms?' }] }]),
    true,
  );
});
