import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../_lib/auth';
import { getSupabaseAdmin, sendTelegramDocument } from '../_lib/integrations';
import { quoteTotals, renderQuotePdf, type QuoteItem } from '../_lib/quote-pdf';

export const dynamic = 'force-dynamic';

// Body: { clientName, projectName?, contact?, items: [{ description, quantity, unitPrice }], notes?, validDays?, depositPct?, sendTelegram? }
// Returns a 7-day signed download URL for the PDF (stored in the private `quotes` bucket).
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const body = await request.json().catch(() => ({}));
  const items: QuoteItem[] = (Array.isArray(body.items) ? body.items : [])
    .map((item: Record<string, unknown>) => ({ description: String(item.description || '').slice(0, 200), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) }))
    .filter((item: QuoteItem) => item.description && item.quantity > 0 && Number.isFinite(item.unitPrice) && item.unitPrice >= 0);
  if (!items.length) return NextResponse.json({ error: 'items[] with description, quantity and unitPrice are required' }, { status: 400 });

  const stamp = new Date();
  const quoteNumber = `Q-${stamp.toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const depositPct = Number(body.depositPct) > 0 && Number(body.depositPct) <= 100 ? Number(body.depositPct) : 50;
  const clientName = String(body.clientName || '').slice(0, 120);
  const pdf = await renderQuotePdf({ quoteNumber, clientName, projectName: body.projectName ? String(body.projectName).slice(0, 120) : undefined, contact: body.contact ? String(body.contact).slice(0, 120) : undefined, items, notes: body.notes ? String(body.notes).slice(0, 600) : undefined, validDays: Number(body.validDays) || 7, depositPct, issuedAt: stamp });

  const created = await supabase.storage.createBucket('quotes', { public: false });
  if (created.error && !/already exists/i.test(created.error.message)) return NextResponse.json({ error: created.error.message }, { status: 500 });
  const path = `${stamp.getUTCFullYear()}/${quoteNumber}.pdf`;
  const upload = await supabase.storage.from('quotes').upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
  const signed = await supabase.storage.from('quotes').createSignedUrl(path, 7 * 86400);

  const totals = quoteTotals(items, depositPct);
  await supabase.from('pdf_quotes').insert({ quote_number: quoteNumber, client_name: clientName || null, project_name: body.projectName || null, total: totals.subtotal, storage_path: path, payload: { items, depositPct } });
  if (body.sendTelegram) await sendTelegramDocument(pdf, `${quoteNumber}.pdf`, `<b>${quoteNumber}</b> for ${clientName || 'client'} - PHP ${totals.subtotal.toLocaleString('en-PH')}`);
  return NextResponse.json({ success: true, quoteNumber, total: totals.subtotal, deposit: totals.deposit, url: signed.data?.signedUrl || null });
}
