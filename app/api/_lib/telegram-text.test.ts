import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTelegramText } from './telegram-text.ts';

test('repairs UTF-8 emoji and dash misread as cp1252', () => {
  assert.equal(sanitizeTelegramText('ðŸšš DELIVERY'), '🚚 DELIVERY');
  assert.equal(sanitizeTelegramText('Order â€” ready'), 'Order — ready');
});

test('leaves clean UTF-8 text untouched', () => {
  const clean = '🧾 ORDER CREATED — ₱1,500 · Señora ñ';
  assert.equal(sanitizeTelegramText(clean), clean);
});

test('leaves lone mojibake-looking text that is not valid UTF-8 unchanged', () => {
  assert.equal(sanitizeTelegramText('Ã'), 'Ã');
});

test('strips control characters but keeps newlines and tabs', () => {
  assert.equal(sanitizeTelegramText('a\u0007b\u0085c\nd\te'), 'abc\nd\te');
});

test('normalizes to NFC', () => {
  assert.equal(sanitizeTelegramText('e\u0301'), 'é');
});
