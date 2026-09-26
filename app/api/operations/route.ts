import { NextResponse } from 'next/server';
import {
  clockInStaff,
  clockOutStaff,
  createEmbroideryJob,
  createPurchaseOrder,
  createStaffTask,
  sendTelegramPhoto,
} from '../_lib/integrations';

const STAFF = new Set(['Jonathan', 'Linda']);

function normalizeStaffName(value: unknown) {
  if (typeof value !== 'string') return null;
  const staffName = [...STAFF].find((name) => name.toLowerCase() === value.trim().toLowerCase());
  return staffName || null;
}

async function sendTelegramNotification(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch (error) {
    console.error('Operations Telegram notification error:', error);
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'clock_in' || action === 'clock_out') {
      const staffName = normalizeStaffName(body.staffName);
      if (!staffName) return NextResponse.json({ error: 'staffName must be Jonathan or Linda' }, { status: 400 });
      const result = action === 'clock_in' ? await clockInStaff(staffName) : await clockOutStaff(staffName);
      if (result.error) return NextResponse.json({ success: false, error: result.error }, { status: 400 });

      const record = result.data;
      const alert = action === 'clock_in'
        ? `⏰ <b>ATTENDANCE CLOCK-IN</b>\nStaff: <b>${staffName}</b>\nTime: ${new Date(record?.time_in || Date.now()).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`
        : `🏁 <b>ATTENDANCE CLOCK-OUT</b>\nStaff: <b>${staffName}</b>\nTotal: <b>${Math.floor(Number(record?.total_minutes || 0) / 60)} hrs ${Number(record?.total_minutes || 0) % 60} mins</b>\nEarned: <b>₱${Number(record?.total_earned || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</b>`;
      void sendTelegramNotification(alert);
      return NextResponse.json({ success: true, record });
    }

    if (action === 'create_purchase_order') {
      const supplierName = typeof body.supplierName === 'string' ? body.supplierName.trim() : '';
      const materialType = typeof body.materialType === 'string' ? body.materialType.trim() : '';
      const quantity = Number(body.quantity);
      const unitCost = Number(body.unitCost);
      if (!supplierName || !materialType || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
        return NextResponse.json({ error: 'supplierName, materialType, positive quantity, and valid unitCost are required' }, { status: 400 });
      }

      const result = await createPurchaseOrder({ supplierName, materialType, quantity, unitCost });
      if (result.error) return NextResponse.json({ success: false, error: result.error }, { status: 502 });
      const po = result.data;
      void sendTelegramNotification([
        '📦 <b>NEW SUPPLIER PURCHASE ORDER</b>',
        `PO Number: <b>${escapeHtml(po.po_number)}</b>`,
        `Supplier: <b>${escapeHtml(supplierName)}</b>`,
        `Material: <b>${escapeHtml(materialType)}</b>`,
        `Quantity: <b>${quantity.toLocaleString('en-PH')}</b>`,
        `Total Cost: <b>₱${Number(po.total_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</b>`,
        'Status: <b>PENDING MANAGER APPROVAL</b>',
      ].join('\n'));
      return NextResponse.json({ success: true, purchaseOrder: po });
    }

    if (action === 'dispatch_embroidery_job') {
      const placement = typeof body.placement === 'string' ? body.placement.trim() : '';
      const threadColors = Array.isArray(body.threadColors) ? body.threadColors : [];
      if (!placement) return NextResponse.json({ error: 'placement is required' }, { status: 400 });

      const result = await createEmbroideryJob({
        projectName: body.projectName,
        clientName: body.clientName,
        companyName: body.companyName,
        contact: body.contact,
        garmentStyle: body.garmentStyle,
        quantity: Number(body.quantity) || undefined,
        placement,
        widthInches: Number(body.widthInches) || undefined,
        heightInches: Number(body.heightInches) || undefined,
        stitchCount: Number(body.stitchCountOverride) || undefined,
        threadColors,
        logoImage: typeof body.logoImage === 'string' ? body.logoImage : undefined,
        embroidererName: body.embroidererName,
        embroidererContact: body.embroidererContact,
        notes: body.notes,
      });
      if (result.error) return NextResponse.json({ success: false, error: result.error }, { status: 502 });
      const job = result.data;

      const caption = [
        '🧵 <b>EMBROIDERY DISPATCH — SPECS FOR ARTIST</b>',
        `Project: <b>${escapeHtml(String(body.projectName || 'Not provided'))}</b>`,
        `Client: <b>${escapeHtml(String(body.clientName || 'Not provided'))}</b>`,
        `Garment: <b>${escapeHtml(String(body.garmentStyle || 'Not specified'))}</b> x <b>${Number(body.quantity) || 0}</b> pcs`,
        `Placement: <b>${escapeHtml(placement)}</b>`,
        `Estimated Stitch Count: <b>${Number(job.stitch_count).toLocaleString('en-PH')}</b>`,
        threadColors.length ? `Thread Colors: <b>${escapeHtml(threadColors.map((color: { name?: string }) => color?.name || String(color)).join(', '))}</b>` : '',
        body.embroidererName ? `Assigned Embroiderer: <b>${escapeHtml(String(body.embroidererName))}</b> (${escapeHtml(String(body.embroidererContact || 'no contact given'))})` : '',
        body.notes ? `Notes: ${escapeHtml(String(body.notes))}` : '',
      ].filter(Boolean).join('\n');

      if (job.logo_image) void sendTelegramPhoto(job.logo_image, caption);
      else void sendTelegramNotification(caption);

      return NextResponse.json({ success: true, embroideryJob: job });
    }

    if (action === 'add_task') {
      const staffName = normalizeStaffName(body.staffName);
      const taskText = typeof body.taskText === 'string' ? body.taskText.trim() : '';
      const priority = ['normal', 'urgent', 'emergency'].includes(body.priority) ? body.priority : 'normal';
      if (!staffName || !taskText) return NextResponse.json({ error: 'staffName (Jonathan/Linda) and taskText are required' }, { status: 400 });

      const result = await createStaffTask({ staffName, taskText, priority, dueAt: body.dueAt });
      if (result.error) return NextResponse.json({ success: false, error: result.error }, { status: 502 });
      void sendTelegramNotification(`📝 <b>NEW TASK LOGGED</b>\nStaff: <b>${staffName}</b>\nPriority: <b>${priority.toUpperCase()}</b>\nTask: ${escapeHtml(taskText)}`);
      return NextResponse.json({ success: true, task: result.data });
    }

    return NextResponse.json({ error: 'Invalid action provided' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid operations request';
    console.error('Operations route error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
