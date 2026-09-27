import { z } from 'zod';

export const runtime = 'nodejs';

const itemSchema = z.object({
  category: z.enum(['cut_goods', 'accessories']),
  description: z.string().trim().min(1).max(100),
  colorOrSpecification: z.string().trim().max(80).default(''),
  quantity: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(20).default('pcs'),
}).strict();

const checklistSchema = z.object({
  checklistNumber: z.string().trim().min(1).max(40).optional(),
  date: z.string().trim().min(1).max(40).optional(),
  projectName: z.string().trim().min(1).max(100),
  workOrderNumber: z.string().trim().max(50).default(''),
  subcontractorName: z.string().trim().min(1).max(100),
  subcontractorContact: z.string().trim().max(50).default(''),
  pickupAddress: z.string().trim().max(120).default(''),
  deliveryAddress: z.string().trim().max(120).default(''),
  lalamoveBookingNumber: z.string().trim().max(50).default(''),
  riderName: z.string().trim().max(80).default(''),
  items: z.array(itemSchema).min(1).max(8),
  notes: z.string().trim().max(300).default(''),
}).strict();

type Checklist = z.infer<typeof checklistSchema> & { checklistNumber: string; date: string };

function ascii(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?');
}

function pdfEscape(value: string) {
  return ascii(value).replace(/[\\()]/g, (character) => `\\${character}`);
}

function short(value: string, maxLength: number) {
  const normalized = ascii(value || '-');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function buildCopy(checklist: Checklist, copyLabel: string) {
  const commands: string[] = [];
  const colors = {
    navy: '0.08 0.18 0.29',
    teal: '0.06 0.42 0.43',
    ink: '0.12 0.15 0.19',
    muted: '0.38 0.43 0.48',
    rule: '0.72 0.76 0.79',
    paper: '1 1 1',
    pale: '0.93 0.96 0.95',
  };
  const left = 38;
  const right = 557;
  let y = 800;

  const fill = (color: string) => commands.push(`${color} rg`);
  const stroke = (color: string) => commands.push(`${color} RG`);
  const line = (x1: number, y1: number, x2: number, y2: number) => commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  const rect = (x: number, top: number, width: number, height: number, mode = 'S') => commands.push(`${x} ${top - height} ${width} ${height} re ${mode}`);
  const write = (value: string, x: number, top: number, size = 9, font = 'F1') => commands.push(`BT /${font} ${size} Tf ${x} ${top} Td (${pdfEscape(value)}) Tj ET`);
  const field = (label: string, value: string, x: number, top: number, width: number) => {
    fill(colors.muted);
    write(label.toUpperCase(), x, top, 6.5, 'F2');
    fill(colors.ink);
    write(short(value, Math.floor(width / 5.2)), x, top - 13, 9);
    stroke(colors.rule);
    line(x, top - 18, x + width, top - 18);
  };

  fill(colors.paper);
  rect(0, 842, 595, 842, 'f');
  fill(colors.navy);
  write('MICHAEL JEFFREY INTERNATIONAL CORPORATION', left, y, 12, 'F2');
  fill(colors.teal);
  write('SUBCONTRACTOR MATERIAL CHECKLIST', left, y - 24, 15, 'F2');
  fill(colors.muted);
  write(`COPY: ${copyLabel.toUpperCase()}`, 426, y - 5, 8, 'F2');
  write(`CHECKLIST: ${short(checklist.checklistNumber, 24)}`, 426, y - 20, 7.5);
  write(`DATE: ${short(checklist.date, 18)}`, 426, y - 33, 7.5);
  y -= 52;
  stroke(colors.teal);
  line(left, y, right, y);

  y -= 22;
  field('Project / Client', checklist.projectName, left, y, 285);
  field('Work order no.', checklist.workOrderNumber, 341, y, 216);
  y -= 36;
  field('Subcontractor', checklist.subcontractorName, left, y, 285);
  field('Contact no.', checklist.subcontractorContact, 341, y, 216);
  y -= 36;
  field('Lalamove booking / plate', checklist.lalamoveBookingNumber, left, y, 245);
  field('Rider name', checklist.riderName, 301, y, 256);
  y -= 36;
  field('Pickup address', checklist.pickupAddress, left, y, 245);
  field('Delivery address', checklist.deliveryAddress, 301, y, 256);
  y -= 31;

  fill(colors.navy);
  rect(left, y, right - left, 24, 'f');
  fill('1 1 1');
  write('MATERIAL DESCRIPTION', left + 8, y - 16, 7.5, 'F2');
  write('TYPE', 305, y - 16, 7.5, 'F2');
  write('QTY', 382, y - 16, 7.5, 'F2');
  write('UNIT', 429, y - 16, 7.5, 'F2');
  write('RECEIVED', 475, y - 16, 7.5, 'F2');
  write('OK', 536, y - 16, 7, 'F2');
  y -= 24;

  checklist.items.forEach((item, index) => {
    const rowTop = y;
    if (index % 2 === 0) {
      fill(colors.pale);
      rect(left, rowTop, right - left, 34, 'f');
    }
    fill(colors.ink);
    write(short(item.description, 47), left + 8, rowTop - 13, 8.5, 'F2');
    write(short(item.colorOrSpecification, 48), left + 8, rowTop - 26, 7, 'F1');
    write(item.category === 'cut_goods' ? 'Cut goods' : 'Accessories', 305, rowTop - 19, 7.5);
    write(Number.isInteger(item.quantity) ? item.quantity.toLocaleString('en-US') : String(item.quantity), 382, rowTop - 19, 8);
    write(short(item.unit, 9), 429, rowTop - 19, 7.5);
    stroke(colors.rule);
    line(475, rowTop - 25, 523, rowTop - 25);
    rect(538, rowTop - 8, 9, 9);
    y -= 34;
  });
  stroke(colors.rule);
  line(left, y, right, y);

  y -= 22;
  fill(colors.teal);
  write('RELEASE CHECK  |  Complete before the Lalamove rider departs', left, y, 8.5, 'F2');
  fill(colors.ink);
  write('I checked the listed items and quantities before dispatch. Any shortage or damage is noted below.', left, y - 14, 7.5);
  y -= 39;
  field('Discrepancy / remarks at release', '', left, y, right - left);
  y -= 35;
  field('Subcontractor signature over printed name', '', left, y, 300);
  field('Date and time released', '', 355, y, 202);
  y -= 34;
  field('Released by (MJIC)', '', left, y, 300);
  field('Lalamove rider signature / name', '', 355, y, 202);

  y -= 47;
  stroke(colors.rule);
  line(left, y, right, y);
  y -= 24;
  fill(colors.teal);
  write('RECEIPT CHECK  |  Complete after Lalamove delivery', left, y, 8.5, 'F2');
  fill(colors.ink);
  write('I received and recounted the items above. Received quantities and any discrepancy are marked on this form.', left, y - 14, 7.5);
  y -= 39;
  field('Discrepancy / remarks at receipt', checklist.notes, left, y, right - left);
  y -= 35;
  field('Subcontractor signature over printed name', '', left, y, 300);
  field('Date and time received', '', 355, y, 202);

  stroke(colors.rule);
  line(left, 43, right, 43);
  fill(colors.muted);
  write('Retain one signed copy with each party. Mark received quantities before signing.', left, 29, 7);
  write(`${copyLabel}  |  ${short(checklist.checklistNumber, 24)}`, 400, 29, 7);

  return commands.join('\n');
}

function buildPdf(checklist: Checklist) {
  const streams = [buildCopy(checklist, 'MJIC Copy'), buildCopy(checklist, 'Subcontractor Copy')];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(streams[0], 'ascii')} >>\nstream\n${streams[0]}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(streams[1], 'ascii')} >>\nstream\n${streams[1]}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, 'ascii');
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

function manilaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

export async function POST(request: Request) {
  try {
    const result = checklistSchema.safeParse(await request.json());
    if (!result.success) {
      const issue = result.error.issues[0];
      return Response.json({ success: false, error: `${issue.path.join('.') || 'request'}: ${issue.message}` }, { status: 400 });
    }

    const checklist: Checklist = {
      ...result.data,
      checklistNumber: result.data.checklistNumber || `SMC-${Date.now().toString().slice(-8)}`,
      date: result.data.date || manilaDate(),
    };
    const pdf = buildPdf(checklist);
    const filename = checklist.checklistNumber.replace(/[^a-zA-Z0-9_-]/g, '-');
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Subcon material checklist PDF generation error:', error);
    return Response.json({ success: false, error: 'Invalid subcontractor checklist request' }, { status: 400 });
  }
}