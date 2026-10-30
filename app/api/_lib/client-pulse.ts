import { ORDER_STAGES, PIPELINE_STAGES, stageNumber } from './order-stages.ts';
import { escapeTelegramHtml, getSupabaseAdmin } from './integrations.ts';

export type OpenOrder = {
  id: string;
  order_number: string;
  client_name: string | null;
  project_name: string | null;
  quantity: number | null;
  total_amount: number | null;
  stage: string;
  updated_at: string | null;
  created_at: string | null;
};

// What the boss needs to do next for each pipeline stage (Taglish, action-first).
export const STAGE_NEXT_ACTION: Record<string, string> = {
  S01_INQUIRY: 'I-follow up ang brief: design, quantity, at deadline ng client.',
  S02_SOURCING: 'Kumuha ng fabric/material quotes at i-confirm ang availability.',
  S03_DESIGN_APPROVAL: 'Ipa-approve ang mockup/artwork sa client bago mag-quote.',
  S04_QUOTATION: 'I-send ang official quotation at hintayin ang sagot ng client.',
  S05_DEPOSIT: 'Kulitin ang client para sa 50% D.P. — i-send ang GCash details.',
  S06_SIZING: 'Kunin ang size breakdown, names, at numbers ng bawat piyesa.',
  S07_SAMPLE: 'I-ipa-approve ang sample/prototype sa client bago mass production.',
  S08_PRODUCTION: 'Bantayan ang cutting, printing/embroidery, at sewing ngayong araw.',
  S09_QC: 'I-QC: bilangin at hanapin ang depekto bago i-pack.',
  S10_BALANCE: 'Kolektahin ang balance payment bago i-release ang order.',
  S11_DISPATCH: 'I-book ang pickup/delivery (Lalamove) at i-update ang client.',
  COMPLETED: 'Tapos na — i-follow up para sa review at reorder.',
  ON_HOLD: 'May blocker — i-follow up kung ano ang hinihintay nito.',
};

const STAGE_ALIASES: Record<string, string> = {
  inquiry: 'S01_INQUIRY',
  brief: 'S01_INQUIRY',
  sourcing: 'S02_SOURCING',
  fabric: 'S02_SOURCING',
  materials: 'S02_SOURCING',
  po: 'S02_SOURCING',
  design: 'S03_DESIGN_APPROVAL',
  mockup: 'S03_DESIGN_APPROVAL',
  artwork: 'S03_DESIGN_APPROVAL',
  approval: 'S03_DESIGN_APPROVAL',
  quote: 'S04_QUOTATION',
  quotation: 'S04_QUOTATION',
  presyo: 'S04_QUOTATION',
  deposit: 'S05_DEPOSIT',
  downpayment: 'S05_DEPOSIT',
  'down payment': 'S05_DEPOSIT',
  dp: 'S05_DEPOSIT',
  paid: 'S10_BALANCE',
  fullpaid: 'S10_BALANCE',
  'full paid': 'S10_BALANCE',
  binayaran: 'S10_BALANCE',
  verified: 'DEPOSIT_RECEIVED',
  sizing: 'S06_SIZING',
  size: 'S06_SIZING',
  names: 'S06_SIZING',
  sample: 'S07_SAMPLE',
  prototype: 'S07_SAMPLE',
  production: 'S08_PRODUCTION',
  cutting: 'S08_PRODUCTION',
  cut: 'S08_PRODUCTION',
  embroidery: 'S08_PRODUCTION',
  burda: 'S08_PRODUCTION',
  sewing: 'S08_PRODUCTION',
  tahi: 'S08_PRODUCTION',
  print: 'S08_PRODUCTION',
  qc: 'S09_QC',
  checking: 'S09_QC',
  balance: 'S10_BALANCE',
  fullpay: 'S10_BALANCE',
  'full balance': 'S10_BALANCE',
  packing: 'S10_BALANCE',
  pack: 'S10_BALANCE',
  ready: 'S11_DISPATCH',
  dispatch: 'S11_DISPATCH',
  dispatched: 'S11_DISPATCH',
  shipped: 'S11_DISPATCH',
  delivery: 'S11_DISPATCH',
  delivered: 'S11_DISPATCH',
  pickup: 'S11_DISPATCH',
  done: 'COMPLETED',
  complete: 'COMPLETED',
  completed: 'COMPLETED',
  hold: 'ON_HOLD',
  cancel: 'CANCELLED',
  cancelled: 'CANCELLED',
};

// Accepts "sewing", "S08_PRODUCTION", "ready", "done", etc. Returns the canonical stage or null.
export function resolveStageInput(word: string): string | null {
  const key = word.trim().toLowerCase();
  if (!key) return null;
  if (STAGE_ALIASES[key]) return STAGE_ALIASES[key];
  const upper = key.toUpperCase();
  if ((ORDER_STAGES as readonly string[]).includes(upper) || upper === 'COMPLETED' || upper === 'ON_HOLD' || upper === 'CANCELLED') return upper;
  return null;
}

// "Stage 08/11 · Mass Production & Custom Branding" plus a progress bar.
export function stageProgressLine(stage: string): string | null {
  const no = stageNumber(stage);
  if (!no) return null;
  const label = PIPELINE_STAGES[no - 1].label;
  const bar = '▰'.repeat(no) + '▱'.repeat(PIPELINE_STAGES.length - no);
  return `Stage ${String(no).padStart(2, '0')}/${PIPELINE_STAGES.length} · ${escapeTelegramHtml(label)}\n   ${bar}`;
}

// "Juan | school uniforms 50pcs | 15000" -> create input. Total is optional.
export function parseOrderInput(raw: string): { clientName: string; projectName: string | null; totalAmount: number } | { error: string } {
  const parts = raw.split('|').map((part) => part.trim());
  const clientName = parts[0] || '';
  if (!clientName) return { error: 'Use: ORDER <client name> | <project/details> | <total halaga>\nHalimbawa: ORDER Juan Dela Cruz | 50pcs school uniforms | 15000' };
  const totalAmount = parts[2] ? Number(parts[2].replace(/[₱,\s]|php/gi, '')) : 0;
  if (parts[2] && !(totalAmount > 0)) return { error: `Hindi ko mabasa ang presyong "${parts[2]}". Numero lang, hal. 15000.` };
  return { clientName, projectName: parts[1] || null, totalAmount: totalAmount > 0 ? totalAmount : 0 };
}

const STAGE_HELP = 'Stages: 1 inquiry, 2 sourcing, 3 design, 4 quote, 5 deposit, 6 sizing, 7 sample, 8 production, 9 qc, 10 balance, 11 dispatch, done, hold, cancel';

// "Juan Dela Cruz sewing" -> { ref: 'Juan Dela Cruz', stage: 'S08_PRODUCTION' } (last word = stage).
export function parseMoveInput(raw: string): { ref: string; stage: string } | { error: string } {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { error: `Use: MOVE <client name o ORD-number> <stage>\n${STAGE_HELP}` };
  const stage = resolveStageInput(words[words.length - 1]);
  if (!stage) return { error: `Hindi kilala ang stage na "${words[words.length - 1]}". ${STAGE_HELP}` };
  return { ref: words.slice(0, -1).join(' '), stage };
}

export async function listOpenOrders(limit = 100): Promise<OpenOrder[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data } = await supabase
    .from('orders')
    .select('id, order_number, client_name, project_name, quantity, total_amount, stage, updated_at, created_at')
    .not('stage', 'in', '("COMPLETED","CANCELLED")')
    .order('updated_at', { ascending: true })
    .limit(limit);
  return (data as OpenOrder[] | null) || [];
}

// Match by ORD-number first, then by client/project name (case-insensitive substring).
export async function findOrdersByRef(ref: string): Promise<OpenOrder[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const cleaned = ref.trim();
  if (!cleaned) return [];
  const { data: byNumber } = await supabase
    .from('orders')
    .select('id, order_number, client_name, project_name, quantity, total_amount, stage, updated_at, created_at')
    .ilike('order_number', cleaned)
    .not('stage', 'in', '("COMPLETED","CANCELLED")')
    .limit(5);
  if (byNumber?.length) return byNumber as OpenOrder[];
  const pattern = `%${cleaned.replace(/[%_]/g, '')}%`;
  const { data } = await supabase
    .from('orders')
    .select('id, order_number, client_name, project_name, quantity, total_amount, stage, updated_at, created_at')
    .or(`client_name.ilike.${pattern},project_name.ilike.${pattern}`)
    .not('stage', 'in', '("COMPLETED","CANCELLED")')
    .order('updated_at', { ascending: true })
    .limit(10);
  return (data as OpenOrder[] | null) || [];
}

function daysInStage(order: OpenOrder, nowMs: number): number {
  const since = Date.parse(order.updated_at || order.created_at || '');
  if (!Number.isFinite(since)) return 0;
  return Math.max(0, Math.floor((nowMs - since) / 86400000));
}

const peso = (value: number | null) => (value ? `₱${Math.round(value).toLocaleString('en-PH')}` : 'walang presyo');

function stageRank(stage: string) {
  const idx = (ORDER_STAGES as readonly string[]).indexOf(stage);
  return idx === -1 ? ORDER_STAGES.length : idx; // ON_HOLD etc. go last
}

export function sortOrdersForPulse(orders: OpenOrder[]): OpenOrder[] {
  return [...orders].sort((a, b) => stageRank(a.stage) - stageRank(b.stage));
}

// One Telegram message per client: name, stage (x/11 with progress bar), age, and the next step.
export function buildOrderPulseMessage(order: OpenOrder, index: number, total: number, now = new Date()): string {
  const name = escapeTelegramHtml(order.client_name || order.project_name || 'Client');
  const project = order.project_name && order.project_name !== order.client_name ? ` — ${escapeTelegramHtml(order.project_name)}` : '';
  const days = daysInStage(order, now.getTime());
  const age = days >= 3 ? ` ⚠️ ${days} araw na!` : days >= 1 ? ` (${days} araw na)` : '';
  const action = STAGE_NEXT_ACTION[order.stage] || 'I-check ang status nito.';
  const progress = stageProgressLine(order.stage) || `Status: <b>${escapeTelegramHtml(order.stage.replaceAll('_', ' '))}</b>`;
  const lines = [
    `<b>${index + 1}/${total} · ${name}</b>${project} · ${peso(order.total_amount)}`,
    `${progress}${age}`,
    `👉 <b>${escapeTelegramHtml(action)}</b>`,
    `<i>Update: type "${escapeTelegramHtml(order.order_number)} &lt;update&gt;" o mag-send ng photo/voice.</i>`,
  ];
  return lines.join('\n');
}

// The 6AM / 1PM message: header plus one entry per open order (ordered by pipeline stage).
export function buildClientPulseMessage(orders: OpenOrder[], now = new Date()): string {
  const manilaTime = now.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const header = `<b>📋 CLIENT PULSE — ${escapeTelegramHtml(manilaTime)}</b>`;
  if (!orders.length) return `${header}\n\nWalang open orders ngayon. 🎉\nMag-add bago: ORDER &lt;client&gt; | &lt;project&gt; | &lt;total&gt;`;

  const sorted = sortOrdersForPulse(orders);
  const nowMs = now.getTime();

  const lines = sorted.slice(0, 25).map((order, index) => {
    const name = escapeTelegramHtml(order.client_name || order.project_name || 'Client');
    const project = order.project_name && order.project_name !== order.client_name ? ` — ${escapeTelegramHtml(order.project_name)}` : '';
    const days = daysInStage(order, nowMs);
    const age = days >= 3 ? ` ⚠️ ${days} araw na!` : days >= 1 ? ` (${days} araw na)` : ' (ngayon lang)';
    const action = STAGE_NEXT_ACTION[order.stage] || 'I-check ang status nito.';
    const progress = stageProgressLine(order.stage) || `Status: <b>${escapeTelegramHtml(order.stage.replaceAll('_', ' '))}</b>`;
    return `${index + 1}. <b>${name}</b>${project} · ${peso(order.total_amount)}\n   ${progress}${age}\n   👉 ${escapeTelegramHtml(action)}`;
  });
  const more = sorted.length > 25 ? `\n…+${sorted.length - 25} pang order(s). Type CLIENTS sa bot para sa full list.` : '';
  return `${header}\n${sorted.length} open order(s) — eto ang gagawin mo per client:\n\n${lines.join('\n\n')}${more}\n\nI-update: MOVE &lt;client&gt; &lt;stage&gt; (hal. MOVE Juan production)`;
}
