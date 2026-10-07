import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type QuoteItem = { description: string; quantity: number; unitPrice: number };
export type QuoteInput = {
  quoteNumber: string;
  clientName: string;
  projectName?: string;
  contact?: string;
  items: QuoteItem[];
  notes?: string;
  validDays?: number;
  depositPct?: number;
  issuedAt?: Date;
};

// Business details copied verbatim from MJIC_SYSTEM_PROMPT.
const BUSINESS = {
  name: 'MJIC',
  address: "#22 Bayabas St., Elmar's Subdivision, Brgy. Cupang, Antipolo City (behind SM Masinag)",
  phones: 'Viber/Smart 0920-695-9167 | Globe 0917-320-8842 | DITO 0934-768-7987',
  payment: 'GCash / Maya: RICHARD DG VENEZUELA (0929-227-1761)',
};

// pdf-lib's standard fonts are WinAnsi only, so the peso sign is written as "PHP".
const php = (value: number) => `PHP ${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clean = (value: string) => value.replace(/[^\x20-\x7E]/g, '?');

export function quoteTotals(items: QuoteItem[], depositPct = 50) {
  const subtotal = Number(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0).toFixed(2));
  const deposit = Number(((subtotal * depositPct) / 100).toFixed(2));
  return { subtotal, deposit, balance: Number((subtotal - deposit).toFixed(2)) };
}

export async function renderQuotePdf(input: QuoteInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.4, 0.4, 0.45);
  const depositPct = input.depositPct ?? 50;
  const issued = input.issuedAt || new Date();
  const valid = new Date(issued.getTime() + (input.validDays ?? 7) * 86400000);
  const fmt = (date: Date) => date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });

  let y = 800;
  const text = (value: string, x: number, size = 10, useBold = false, color = ink, maxWidth?: number) => {
    let line = clean(value);
    const f = useBold ? bold : font;
    if (maxWidth) while (line.length > 1 && f.widthOfTextAtSize(line, size) > maxWidth) line = line.slice(0, -1);
    page.drawText(line, { x, y, size, font: f, color });
  };

  text(BUSINESS.name, 40, 26, true);
  y -= 16; text(BUSINESS.address, 40, 8, false, muted);
  y -= 11; text(BUSINESS.phones, 40, 8, false, muted);
  page.drawText('QUOTATION', { x: 400, y: 800, size: 20, font: bold, color: ink });
  page.drawText(clean(input.quoteNumber), { x: 400, y: 784, size: 10, font, color: muted });
  y -= 30;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 1, color: ink });

  y -= 22; text('Prepared for', 40, 8, false, muted); text('Date', 400, 8, false, muted);
  y -= 13; text(input.clientName || 'Valued Client', 40, 12, true, ink, 330); text(fmt(issued), 400, 10);
  y -= 13; if (input.contact) text(input.contact, 40, 9, false, muted, 330); text(`Valid until ${fmt(valid)}`, 400, 9, false, muted);
  if (input.projectName) { y -= 13; text(`Project: ${input.projectName}`, 40, 10, false, ink, 500); }

  y -= 28;
  page.drawRectangle({ x: 40, y: y - 5, width: 515, height: 20, color: rgb(0.93, 0.93, 0.95) });
  text('Description', 46, 9, true); text('Qty', 340, 9, true); text('Unit price', 385, 9, true); text('Amount', 478, 9, true);
  y -= 22;
  for (const item of input.items.slice(0, 22)) {
    text(item.description, 46, 9, false, ink, 285);
    text(String(item.quantity), 340, 9);
    text(php(item.unitPrice), 385, 9);
    text(php(item.quantity * item.unitPrice), 478, 9);
    y -= 17;
  }
  page.drawLine({ start: { x: 40, y: y + 8 }, end: { x: 555, y: y + 8 }, thickness: 0.5, color: muted });

  const totals = quoteTotals(input.items, depositPct);
  y -= 10; text('Total', 380, 11, true); text(php(totals.subtotal), 460, 11, true);
  y -= 16; text(`Deposit (${depositPct}%) to start production`, 330, 9); text(php(totals.deposit), 478, 9);
  y -= 14; text('Balance before release', 330, 9); text(php(totals.balance), 478, 9);

  y -= 34; text('Payment', 40, 9, true);
  y -= 13; text(BUSINESS.payment, 40, 9);
  y -= 13; text(`Production starts after the ${depositPct}% deposit is received. Please send your payment screenshot for verification.`, 40, 8, false, muted, 515);
  if (input.notes) { y -= 24; text('Notes', 40, 9, true); y -= 13; for (const line of input.notes.split('\n').slice(0, 6)) { text(line, 40, 9, false, ink, 515); y -= 12; } }
  y -= 24; text('Prices are valid for the period stated above. Thank you for choosing MJIC.', 40, 8, false, muted);

  return pdf.save();
}
