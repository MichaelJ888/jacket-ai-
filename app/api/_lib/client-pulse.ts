import { ORDER_STAGES } from './order-stages.ts';
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

// MJIC Client Project Status template (client_project_status_template.md) milestones
// mapped to the internal order pipeline stage. Used to phrase per-client updates.
export const STAGE_MILESTONE: Record<string, string> = {
  AWAITING_DEPOSIT: 'M5 Down Payment (50% D.P. required before production)',
  DEPOSIT_VERIFIED: 'M2 Fabric & Material Sourcing',
  PO_DRAFTED: 'M2 Fabric & Material Sourcing (PO to supplier)',
  CUTTING: 'M8 Mass Production — cutting',
  EMBROIDERY: 'M8 Mass Production — embroidery/branding',
  SEWING: 'M8 Mass Production — sewing',
  QC: 'M9 Quality Control Inspection',
  PACKING: 'M8→M11 Final packaging & brand-label check',
  READY_FOR_DELIVERY: 'M11 Order Pickup / Dispatch & Delivery',
  DISPATCHED: 'M11 Shipped — in transit',
  DELIVERED: 'M10 Full Balance Payment (settle before/after release)',
  ON_HOLD: 'On hold — blocker',
};

// What the boss needs to do next for each pipeline stage (Taglish, action-first).
export const STAGE_NEXT_ACTION: Record<string, string> = {
  AWAITING_DEPOSIT: 'Kulitin ang client para sa 50% deposit — i-send ang GCash details.',
  DEPOSIT_VERIFIED: 'I-draft ang supplier PO / materials list para makapag-start na.',
  PO_DRAFTED: 'I-approve at ipadala ang PO sa supplier, then order materials.',
  CUTTING: 'I-cut ang tela — bantayan ang cutting ngayong araw.',
  EMBROIDERY: 'Ipa-embroidery ang mga logo/patches.',
  SEWING: 'Tahiin — i-check kay Jonathan/Linda ang sewing progress.',
  QC: 'I-QC: bilangin at hanapin ang depekto bago i-pack.',
  PACKING: 'I-pack per size/color at ihanda ang delivery details.',
  READY_FOR_DELIVERY: 'I-book ang delivery (Lalamove) o i-schedule ang pickup.',
  DISPATCHED: 'I-track ang rider at i-update ang client na paparating na.',
  DELIVERED: 'I-collect ang balance payment, then MOVE to done.',
  ON_HOLD: 'May blocker — i-follow up kung ano ang hinihintay nito.',
};

const STAGE_ALIASES: Record<string, string> = {
  deposit: 'AWAITING_DEPOSIT',
  downpayment: 'AWAITING_DEPOSIT',
  dp: 'AWAITING_DEPOSIT',
  verified: 'DEPOSIT_VERIFIED',
  paid: 'DEPOSIT_VERIFIED',
  po: 'PO_DRAFTED',
  materials: 'PO_DRAFTED',
  cutting: 'CUTTING',
  cut: 'CUTTING',
  embroidery: 'EMBROIDERY',
  burda: 'EMBROIDERY',
  sewing: 'SEWING',
  tahi: 'SEWING',
  qc: 'QC',
  checking: 'QC',
  packing: 'PACKING',
  pack: 'PACKING',
  ready: 'READY_FOR_DELIVERY',
  dispatch: 'DISPATCHED',
  dispatched: 'DISPATCHED',
  shipped: 'DISPATCHED',
  delivery: 'DISPATCHED',
  delivered: 'DELIVERED',
  done: 'COMPLETED',
  complete: 'COMPLETED',
  completed: 'COMPLETED',
  hold: 'ON_HOLD',
  cancel: 'CANCELLED',
  cancelled: 'CANCELLED',
};

// Accepts "sewing", "SEWING", "ready", "done", etc. Returns the canonical stage or null.
export function resolveStageInput(word: string): string | null {
  const key = word.trim().toLowerCase();
  if (!key) return null;
  if (STAGE_ALIASES[key]) return STAGE_ALIASES[key];
  const upper = key.toUpperCase();
  if ((ORDER_STAGES as readonly string[]).includes(upper) || upper === 'ON_HOLD' || upper === 'CANCELLED') return upper;
  return null;
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

// "Juan Dela Cruz sewing" -> { ref: 'Juan Dela Cruz', stage: 'SEWING' } (last word = stage).
export function parseMoveInput(raw: string): { ref: string; stage: string } | { error: string } {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { error: 'Use: MOVE <client name o ORD-number> <stage>\nStages: deposit, paid, po, cutting, embroidery, sewing, qc, packing, ready, shipped, delivered, done, hold, cancel' };
  const stage = resolveStageInput(words[words.length - 1]);
  if (!stage) return { error: `Hindi kilala ang stage na "${words[words.length - 1]}". Stages: deposit, paid, po, cutting, embroidery, sewing, qc, packing, ready, shipped, delivered, done, hold, cancel` };
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

// One Telegram message per client: name, stage, milestone, and the next step to make it move.
export function buildOrderPulseMessage(order: OpenOrder, index: number, total: number, now = new Date()): string {
  const name = escapeTelegramHtml(order.client_name || order.project_name || 'Client');
  const project = order.project_name && order.project_name !== order.client_name ? ` — ${escapeTelegramHtml(order.project_name)}` : '';
  const days = daysInStage(order, now.getTime());
  const age = days >= 3 ? ` ⚠️ ${days} araw na!` : days >= 1 ? ` (${days} araw na)` : '';
  const action = STAGE_NEXT_ACTION[order.stage] || 'I-check ang status nito.';
  const milestone = STAGE_MILESTONE[order.stage];
  const lines = [
    `<b>${index + 1}/${total} · ${name}</b>${project} · ${peso(order.total_amount)}`,
    `Stage: <b>${escapeTelegramHtml(order.stage.replaceAll('_', ' '))}</b>${age}`,
  ];
  if (milestone) lines.push(`📋 ${escapeTelegramHtml(milestone)}`);
  lines.push(`👉 <b>${escapeTelegramHtml(action)}</b>`);
  lines.push(`<i>Update: type "${escapeTelegramHtml(order.order_number)} &lt;update&gt;" o mag-send ng photo/voice.</i>`);
  return lines.join('\n');
}

// The 6AM / 1PM message: every open order, its stage age, and the next action to do.
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
    const milestone = STAGE_MILESTONE[order.stage];
    const milestoneLine = milestone ? `\n   📋 ${escapeTelegramHtml(milestone)}` : '';
    return `${index + 1}. <b>${name}</b>${project} · ${peso(order.total_amount)}\n   Stage: <b>${escapeTelegramHtml(order.stage.replaceAll('_', ' '))}</b>${age}${milestoneLine}\n   👉 ${escapeTelegramHtml(action)}`;
  });
  const more = sorted.length > 25 ? `\n…+${sorted.length - 25} pang order(s). Type CLIENTS sa bot para sa full list.` : '';
  return `${header}\n${sorted.length} open order(s) — eto ang gagawin mo per client:\n\n${lines.join('\n\n')}${more}\n\nI-update: MOVE &lt;client&gt; &lt;stage&gt; (hal. MOVE Juan sewing)`;
}
