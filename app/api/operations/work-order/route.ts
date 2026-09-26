import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const SIZE_KEYS = ['S', 'M', 'L', 'XL', '2XL'] as const;
type SizeKey = (typeof SIZE_KEYS)[number];

type SizeRatio = Record<SizeKey, number>;

type EmbroiderySpecs = {
  placement: string;
  widthInches?: number;
  heightInches?: number;
  stitchCount?: number;
  threadColors?: string[];
  notes?: string;
};

type WorkOrder = {
  workOrderNumber: string;
  projectName: string;
  clientName: string;
  garmentStyle: string;
  fabric: string;
  quantity: number;
  cuttingYardage: number;
  yardageUnit: string;
  sizeRatio: SizeRatio;
  embroidery: EmbroiderySpecs;
  targetDeadline: string;
  assignedTo: string;
  notes: string;
};

const sizeRatioSchema = z.object({
  S: z.number().int().nonnegative(),
  M: z.number().int().nonnegative(),
  L: z.number().int().nonnegative(),
  XL: z.number().int().nonnegative(),
  '2XL': z.number().int().nonnegative(),
}).strict();

const workOrderSchema = z.object({
  workOrderNumber: z.string().trim().min(1).max(60).optional(),
  projectName: z.string().trim().min(1).max(120),
  clientName: z.string().trim().min(1).max(120).default('Not provided'),
  garmentStyle: z.string().trim().min(1).max(120).default('Not specified'),
  fabric: z.string().trim().min(1).max(120).default('Not specified'),
  quantity: z.number().int().positive(),
  cuttingYardage: z.number().finite().positive(),
  yardageUnit: z.enum(['yard', 'yards']).default('yards'),
  sizeRatio: sizeRatioSchema,
  embroidery: z.object({
    placement: z.string().trim().min(1).max(120),
    widthInches: z.number().finite().positive().optional(),
    heightInches: z.number().finite().positive().optional(),
    stitchCount: z.number().int().positive().optional(),
    threadColors: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    notes: z.string().trim().max(500).default(''),
  }).strict(),
  targetDeadline: z.string().trim().min(1).max(80),
  assignedTo: z.string().trim().min(1).max(80).default('Linda / Jonathan'),
  notes: z.string().trim().max(500).default(''),
}).strict().superRefine((value, context) => {
  const ratioTotal = SIZE_KEYS.reduce((total, size) => total + value.sizeRatio[size], 0);
  if (ratioTotal !== value.quantity) {
    context.addIssue({ code: 'custom', path: ['sizeRatio'], message: `size ratio total (${ratioTotal}) must match quantity (${value.quantity})` });
  }
});

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function ascii(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?');
}

function pdfEscape(value: string) {
  return ascii(value).replace(/[\\()]/g, (character) => `\\${character}`);
}

function wrap(value: string, maxCharacters: number) {
  const words = ascii(value || '-').split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= maxCharacters) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}

function buildPdf(workOrder: WorkOrder) {
  const commands: string[] = [];
  const colors = {
    navy: '0.05 0.12 0.24',
    gold: '0.65 0.47 0.08',
    ink: '0.12 0.15 0.19',
    muted: '0.37 0.42 0.49',
    rule: '0.78 0.80 0.83',
    paper: '0.97 0.97 0.95',
  };
  const left = 42;
  const right = 553;
  let y = 790;

  const fill = (color: string) => commands.push(`${color} rg`);
  const stroke = (color: string) => commands.push(`${color} RG`);
  const line = (x1: number, y1: number, x2: number, y2: number) => commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  const rect = (x: number, top: number, width: number, height: number, mode = 'S') => commands.push(`${x} ${top - height} ${width} ${height} re ${mode}`);
  const write = (value: string, x: number, top: number, size = 9, font = 'F1') => commands.push(`BT /${font} ${size} Tf ${x} ${top} Td (${pdfEscape(value)}) Tj ET`);
  const section = (title: string) => {
    fill(colors.navy); rect(left, y, right - left, 19, 'f');
    fill('1 1 1'); write(title, left + 8, y - 13, 9, 'F2');
    y -= 29;
  };
  const labelValue = (label: string, value: string, x: number, width: number) => {
    fill(colors.muted); write(label.toUpperCase(), x, y, 7, 'F2');
    fill(colors.ink); write(value || '-', x, y - 13, 10);
    stroke(colors.rule); line(x, y - 18, x + width, y - 18);
  };

  fill(colors.paper); rect(0, 842, 595, 842, 'f');
  fill(colors.navy); write('MICHAEL JEFFREY INTERNATIONAL CORPORATION', left, y, 14, 'F2');
  fill(colors.gold); write('SHOP FLOOR PRODUCTION CONTROL', left, y - 17, 8, 'F2');
  fill(colors.ink); write('WORK ORDER SHEET', 421, y - 4, 12, 'F2');
  fill(colors.muted); write(`WO: ${workOrder.workOrderNumber}`, 421, y - 19, 8);
  y -= 48;
  stroke(colors.gold); line(left, y, right, y); y -= 22;

  section('ORDER IDENTIFICATION');
  labelValue('Project', workOrder.projectName, left, 245);
  labelValue('Client', workOrder.clientName, 311, 242);
  y -= 37;
  labelValue('Garment / Style', workOrder.garmentStyle, left, 245);
  labelValue('Fabric', workOrder.fabric, 311, 242);
  y -= 37;
  labelValue('Total pieces', formatNumber(workOrder.quantity), left, 150);
  labelValue('Target deadline', workOrder.targetDeadline, 215, 180);
  labelValue('Assigned cutting', workOrder.assignedTo, 410, 143);
  y -= 42;

  section('CUTTING PLAN - EXACT MATERIAL REQUIREMENT');
  fill(colors.navy); rect(left, y, right - left, 24, 'f');
  fill('1 1 1'); write('SIZE', left + 12, y - 16, 8, 'F2');
  write('S', 150, y - 16, 8, 'F2'); write('M', 225, y - 16, 8, 'F2'); write('L', 300, y - 16, 8, 'F2'); write('XL', 375, y - 16, 8, 'F2'); write('2XL', 450, y - 16, 8, 'F2');
  y -= 24;
  fill(colors.ink); write('PIECES', left + 12, y - 17, 8, 'F2');
  SIZE_KEYS.forEach((size, index) => write(formatNumber(workOrder.sizeRatio[size]), 150 + (index * 75), y - 17, 10, 'F2'));
  stroke(colors.rule); line(left, y - 24, right, y - 24);
  y -= 39;
  fill(colors.gold); rect(left, y, 230, 44, 'f');
  fill(colors.navy); write('EXACT CUTTING YARDAGE', left + 12, y - 16, 8, 'F2');
  write(`${formatNumber(workOrder.cuttingYardage)} ${workOrder.yardageUnit}`, left + 12, y - 34, 14, 'F2');
  fill(colors.muted); write('Use this total for fabric issue and cutting layout.', 290, y - 18, 8);
  fill(colors.ink); write(`Ratio check: ${formatNumber(SIZE_KEYS.reduce((total, size) => total + workOrder.sizeRatio[size], 0))} pcs`, 290, y - 34, 9, 'F2');
  y -= 65;

  section('EMBROIDERY PLACEMENT SPECIFICATION');
  labelValue('Placement', workOrder.embroidery.placement, left, 245);
  labelValue('Dimensions', workOrder.embroidery.widthInches && workOrder.embroidery.heightInches ? `${workOrder.embroidery.widthInches} x ${workOrder.embroidery.heightInches} in` : 'See approved artwork', 311, 242);
  y -= 37;
  labelValue('Thread colors', workOrder.embroidery.threadColors?.join(', ') || 'Per approved artwork', left, 245);
  labelValue('Stitch count', workOrder.embroidery.stitchCount ? formatNumber(workOrder.embroidery.stitchCount) : 'Per digitized file', 311, 242);
  y -= 37;
  const embroideryNotes = wrap(workOrder.embroidery.notes || 'Follow approved embroidery artwork and placement sample.', 95);
  fill(colors.muted); write('NOTES', left, y, 7, 'F2');
  fill(colors.ink); embroideryNotes.slice(0, 2).forEach((note, index) => write(note, left, y - 13 - (index * 12), 9));
  y -= 43;

  section('DEADLINE AND HAND-OFF');
  fill(colors.gold); rect(left, y, 245, 46, 'f');
  fill(colors.navy); write('TARGET DEADLINE', left + 12, y - 16, 8, 'F2');
  write(workOrder.targetDeadline, left + 12, y - 35, 14, 'F2');
  fill(colors.muted); write('CUTTING COMPLETE', 315, y - 13, 7, 'F2');
  write('________________________', 315, y - 29, 10);
  fill(colors.muted); write('QC / RELEASE', 315, y - 43, 7, 'F2');
  y -= 63;

  if (workOrder.notes) {
    fill(colors.muted); write('PRODUCTION NOTES', left, y, 7, 'F2');
    fill(colors.ink); wrap(workOrder.notes, 105).slice(0, 2).forEach((note, index) => write(note, left, y - 13 - (index * 12), 9));
    y -= 40;
  }
  stroke(colors.rule); line(left, 43, right, 43);
  fill(colors.muted); write('Prepared for shop-floor use. Confirm artwork, fabric issue, and final count before cutting.', left, 29, 7);
  write('Linda / Jonathan sign-off: ____________________', 350, 29, 7);

  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = Buffer.byteLength(pdf, 'ascii'); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

function parseWorkOrder(body: unknown): { data?: WorkOrder; error?: string } {
  const result = workOrderSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { error: `${issue.path.join('.') || 'request'}: ${issue.message}` };
  }
  return { data: { ...result.data, workOrderNumber: result.data.workOrderNumber || `WO-${Date.now().toString().slice(-8)}` } };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = parseWorkOrder(body);
    if (parsed.error || !parsed.data) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    const pdf = buildPdf(parsed.data);
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${parsed.data.workOrderNumber.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Work order PDF generation error:', error);
    return NextResponse.json({ success: false, error: 'Invalid work order request' }, { status: 400 });
  }
}