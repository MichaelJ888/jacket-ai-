import { NextResponse } from 'next/server';
import {
  clockInStaff,
  clockOutStaff,
  createEmbroideryJob,
  createPurchaseOrder,
  createStaffTask,
  escapeTelegramHtml,
  sendTelegramMessage,
  sendTelegramPhoto,
} from '../_lib/integrations';

const STAFF = new Set(['Jonathan', 'Linda']);

function normalizeStaffName(value: unknown) {
  if (typeof value !== 'string') return null;
  const staffName = [...STAFF].find((name) => name.toLowerCase() === value.trim().toLowerCase());
  return staffName || null;
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
      void sendTelegramMessage(alert);
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
      void sendTelegramMessage([
        '📦 <b>NEW SUPPLIER PURCHASE ORDER</b>',
        `PO Number: <b>${escapeTelegramHtml(po.po_number)}</b>`,
        `Supplier: <b>${escapeTelegramHtml(supplierName)}</b>`,
        `Material: <b>${escapeTelegramHtml(materialType)}</b>`,
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
        `Job ID: <code>${job.id}</code>`,
        `Project: <b>${escapeTelegramHtml(String(body.projectName || 'Not provided'))}</b>`,
        `Client: <b>${escapeTelegramHtml(String(body.clientName || 'Not provided'))}</b>`,
        `Garment: <b>${escapeTelegramHtml(String(body.garmentStyle || 'Not specified'))}</b> x <b>${Number(body.quantity) || 0}</b> pcs`,
        `Placement: <b>${escapeTelegramHtml(placement)}</b>`,
        `Estimated Stitch Count: <b>${Number(job.stitch_count).toLocaleString('en-PH')}</b>`,
        threadColors.length ? `Thread Colors: <b>${escapeTelegramHtml(threadColors.map((color: { name?: string }) => color?.name || String(color)).join(', '))}</b>` : '',
        body.embroidererName ? `Assigned Embroiderer: <b>${escapeTelegramHtml(String(body.embroidererName))}</b> (${escapeTelegramHtml(String(body.embroidererContact || 'no contact given'))})` : '',
        body.notes ? `Notes: ${escapeTelegramHtml(String(body.notes))}` : '',
      ].filter(Boolean).join('\n');

      if (job.logo_image) void sendTelegramPhoto(job.logo_image, caption);
      else void sendTelegramMessage(caption);

      return NextResponse.json({ success: true, embroideryJob: job });
    }

    if (action === 'add_task') {
      const staffName = normalizeStaffName(body.staffName);
      const taskText = typeof body.taskText === 'string' ? body.taskText.trim() : '';
      const priority = ['normal', 'urgent', 'emergency'].includes(body.priority) ? body.priority : 'normal';
      if (!staffName || !taskText) return NextResponse.json({ error: 'staffName (Jonathan/Linda) and taskText are required' }, { status: 400 });

      const result = await createStaffTask({ staffName, taskText, priority, dueAt: body.dueAt });
      if (result.error) return NextResponse.json({ success: false, error: result.error }, { status: 502 });
      void sendTelegramMessage(`📝 <b>NEW TASK LOGGED</b>\nStaff: <b>${staffName}</b>\nPriority: <b>${priority.toUpperCase()}</b>\nTask: ${escapeTelegramHtml(taskText)}`);
      return NextResponse.json({ success: true, task: result.data });
    }

    return NextResponse.json({ error: 'Invalid action provided' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid operations request';
    console.error('Operations route error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
