import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { NextResponse } from 'next/server';
import { assessReceiptRisk } from '../_lib/fraud';
import { getSupabaseAdmin, reportCriticalError, sendTelegramMessage } from '../_lib/integrations';

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const image = typeof body.image === 'string' ? body.image : '';
    const expectedAmount = Number(body.expectedAmount);
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;

    if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || !Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      return NextResponse.json({ error: 'A valid payment image and expected amount are required.' }, { status: 400 });
    }

    const result = await generateText({
      model: google('gemini-3.6-flash'),
      system: 'You verify payment screenshots conservatively. Never invent values. Return only valid JSON.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Read this GCash/Maya payment screenshot. Expected deposit: PHP ${expectedAmount.toFixed(2)}. Return JSON only with keys: amount (number or null), reference (string or null), transactionDate (string or null), recipient (string or null), confidence (number 0 to 1), tamperSigns (array of short strings describing visible signs of editing, e.g. mismatched fonts, misaligned text, pasted amount, inconsistent status bar; empty array if none), notes (string).` },
          { type: 'image', image },
        ],
      }],
    });

    const jsonText = result.text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) return NextResponse.json({ verified: false, error: 'OCR returned no structured result.' }, { status: 422 });
    const parsed = JSON.parse(jsonText) as { amount?: number | null; reference?: string | null; transactionDate?: string | null; recipient?: string | null; confidence?: number; tamperSigns?: unknown; notes?: string };
    const amount = Number(parsed.amount);
    const confidence = Number(parsed.confidence || 0);
    const amountMatches = Number.isFinite(amount) && Math.abs(amount - expectedAmount) <= 0.01 && confidence >= 0.85;
    let verified = amountMatches;
    let risk = { score: 0, flags: [] as string[], suspicious: false };
    let verificationId: string | null = null;

    const supabase = getSupabaseAdmin();
    if (supabase) {
      let duplicateReference = false;
      if (parsed.reference) {
        const { count } = await supabase.from('payment_verifications').select('id', { count: 'exact', head: true }).eq('reference', parsed.reference);
        duplicateReference = (count || 0) > 0;
      }
      risk = assessReceiptRisk({ amount: Number.isFinite(amount) ? amount : null, expectedAmount, reference: parsed.reference || null, transactionDate: parsed.transactionDate || null, recipient: parsed.recipient || null, tamperSigns: Array.isArray(parsed.tamperSigns) ? parsed.tamperSigns.map(String) : [], duplicateReference });
      if (risk.suspicious) verified = false;
      const { data: verification, error } = await supabase.from('payment_verifications').insert({
        conversation_id: conversationId,
        expected_amount: expectedAmount,
        detected_amount: Number.isFinite(amount) ? amount : null,
        reference: parsed.reference || null,
        transaction_date: parsed.transactionDate || null,
        recipient: parsed.recipient || null,
        confidence,
        verified,
        notes: parsed.notes || null,
        fraud_score: risk.score,
        fraud_flags: risk.flags,
      }).select().single();
      if (error) console.error('Payment verification insert failed:', error.message);
      verificationId = verification?.id || null;
      if (risk.suspicious) void sendTelegramMessage(`<b>SUSPICIOUS PAYMENT RECEIPT</b>\nRisk \n\nReference: \nDo NOT start production until you confirm the money arrived.`);
      if (!error && verificationId && verified) {
        const { error: statusError } = await supabase.from('order_status_log').insert({ verification_id: verificationId, status: 'READY_FOR_PURCHASE_ORDER', notes: 'OCR amount matched expected deposit; staff approval still required.' });
        if (statusError) console.error('Order status log insert failed:', statusError.message);
      }
    }

    return NextResponse.json({ verified, fraudScore: risk.score, fraudFlags: risk.flags, verificationId, expectedAmount, amount: Number.isFinite(amount) ? amount : null, reference: parsed.reference || null, transactionDate: parsed.transactionDate || null, recipient: parsed.recipient || null, confidence, notes: parsed.notes || '' });
  } catch (error) {
    console.error('Payment OCR error:', error);
    await reportCriticalError('payment-verify', error);
    return NextResponse.json({ verified: false, error: error instanceof Error ? error.message : 'Payment OCR failed.' }, { status: 502 });
  }
}
