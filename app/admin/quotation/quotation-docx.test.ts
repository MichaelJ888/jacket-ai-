import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { createFormalQuoteDocx } from './quotation-docx.ts';

test('creates a styled DOCX package with quote totals, approved terms, and escaped customer text', () => {
  const bytes = createFormalQuoteDocx({
    quoteNumber: 'MJIC-2026-0001',
    customerName: 'A & B <Uniforms>',
    customerContact: 'buyer@example.com',
    productName: 'Company polo',
    createdAt: '2026-11-11T00:00:00.000Z',
    quote: {
      quantity: 20,
      unitPrice: 850,
      programFee: 1000,
      subtotal: 18000,
      discount: 500,
      total: 17500,
      deposit: 8750,
      balance: 8750,
      paymentTerms: '50% downpayment & 50% upon delivery',
      signatory: { name: 'Richard Venezuela', title: 'CEO' },
    },
    terms: ['Terms & conditions'],
    paymentDetails: ['Bank transfer details'],
  });
  const files = unzipSync(bytes);
  const contentTypes = strFromU8(files['[Content_Types].xml']);
  const document = strFromU8(files['word/document.xml']);
  const styles = strFromU8(files['word/styles.xml']);

  assert.match(contentTypes, /wordprocessingml\.document\.main\+xml/);
  assert.match(document, /A &amp; B &lt;Uniforms&gt;/);
  assert.match(document, /MJIC-2026-0001/);
  assert.match(document, /PHP 17,500\.00/);
  assert.match(document, /Terms &amp; conditions/);
  assert.match(styles, /TableGrid/);
});
