import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../_lib/integrations';

const STYLE_RULES = {
  windbreaker: { shellYards: 2, liningYards: 1.5, zipperPieces: 1, snapSets: 0, ribbingSets: 0 },
  varsity: { shellYards: 2, liningYards: 1.5, zipperPieces: 1, snapSets: 0, ribbingSets: 0 },
  corporate: { shellYards: 2, liningYards: 1.5, zipperPieces: 1, snapSets: 0, ribbingSets: 0 },
  bomber: { shellYards: 1.6, liningYards: 1.25, zipperPieces: 0, snapSets: 8, ribbingSets: 1 },
} as const;

type Style = keyof typeof STYLE_RULES;

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function telegramHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

async function notifyTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }) });
  } catch (error) { console.error('Costing Telegram notification failed:', error); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const style = String(body.style || 'corporate').toLowerCase() as Style;
    const rule = STYLE_RULES[style];
    const quantity = number(body.quantity);
    const tones = Math.min(5, Math.max(1, Math.floor(number(body.tones, 1))));
    const isSample = Boolean(body.isSample);
    if (!rule || quantity <= 0) return NextResponse.json({ error: 'Valid style and quantity are required.' }, { status: 400 });

    const shellAllowance = isSample ? 0 : number(body.shellAllowanceYards, 5);
    const liningAllowance = isSample ? 0 : number(body.liningAllowanceYards, 0);
    const zipperAllowance = isSample ? 0 : Math.max(0, Math.floor(number(body.zipperAllowancePieces, 4)));
    const shellYards = quantity * rule.shellYards + shellAllowance;
    const liningYards = quantity * rule.liningYards + liningAllowance;
    const zipperType = String(body.zipperType || 'FZ Zipper 36-inch');
    const centerZippers = quantity * rule.zipperPieces + zipperAllowance;
    const continuousZipperYards = (body.hoodOrPocketZippers ? quantity * number(body.continuousZipperYardsPerPiece, 0.25) : 0) + (isSample ? 0 : number(body.continuousZipperAllowanceYards, 0));
    const snapSets = quantity * rule.snapSets;
    const ribbingSets = quantity * rule.ribbingSets;
    const toneYards = Array.from({ length: tones }, (_, index) => ({ tone: index + 1, yards: Number((shellYards * (index === 0 ? 0.5 : 0.5 / (tones - 1 || 1))).toFixed(2)) }));

    const materials = [
      { material: 'Shell fabric', quantity: shellYards, unit: 'yards', unitCost: number(body.shellFabricUnitCost) },
      { material: 'Lining', quantity: liningYards, unit: 'yards', unitCost: number(body.liningUnitCost) },
      { material: zipperType, quantity: centerZippers, unit: 'pieces', unitCost: number(body.zipperUnitCost) },
      { material: 'Continuous zipper', quantity: continuousZipperYards, unit: 'yards', unitCost: number(body.continuousZipperUnitCost) },
      { material: 'Snap buttons', quantity: snapSets, unit: 'sets', unitCost: number(body.snapSetUnitCost) },
      { material: 'Ribbing', quantity: ribbingSets, unit: 'sets', unitCost: number(body.ribbingSetUnitCost) },
    ].filter((item) => item.quantity > 0).map((item) => ({ ...item, totalCost: Number((item.quantity * item.unitCost).toFixed(2)) }));
    const totalCost = Number(materials.reduce((sum, item) => sum + item.totalCost, 0).toFixed(2));

    const costing = { style, quantity, tones, isSample, assumptions: { shellYardsPerPiece: rule.shellYards, liningYardsPerPiece: rule.liningYards, shellAllowance, liningAllowance, zipperAllowance, toneYards, zipperType }, materials, totalCost };
    if (body.save !== false) {
      const supabase = getSupabaseAdmin();
      if (supabase) {
        const { error } = await supabase.from('project_costings').insert({ project_name: body.projectName || null, client_name: body.clientName || null, company_name: body.companyName || null, contact: body.contact || null, style, quantity, is_sample: isSample, costing, total_cost: totalCost, status: 'PENDING_APPROVAL' });
        if (error) console.error('Project costing save failed:', error.message);
      }
    }

    void notifyTelegram(`<b>PROJECT COSTING READY</b>\nClient: ${telegramHtml(String(body.clientName || 'Not provided'))}\nProject: ${telegramHtml(String(body.projectName || style))}\nQuantity: ${quantity}\nMaterial estimate: <b>₱${totalCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</b>\nStatus: <b>PENDING APPROVAL</b>`);
    return NextResponse.json({ success: true, costing });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Costing failed' }, { status: 400 });
  }
}
