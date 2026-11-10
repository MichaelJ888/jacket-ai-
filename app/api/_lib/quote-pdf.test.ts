import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { renderQuotePdf } from './quote-pdf.ts';

test('quotation PDF embeds the official MJIC logo', async () => {
  const logo = new Uint8Array(
    await readFile(new URL('../../../public/branding/mjic-official-logo.jpg', import.meta.url)),
  );
  const pdfBytes = await renderQuotePdf(
    {
      quoteNumber: 'MJIC-2026-0001',
      clientName: 'Test Client',
      items: [{ description: 'Custom jacket', quantity: 20, unitPrice: 850 }],
    },
    logo,
  );
  const pdf = await PDFDocument.load(pdfBytes);

  assert.equal(pdf.getPageCount(), 1);
  assert.match(Buffer.from(pdfBytes).toString('latin1'), /\/Subtype\s*\/Image/);
});
