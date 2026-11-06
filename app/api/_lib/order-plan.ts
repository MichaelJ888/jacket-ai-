import { PIPELINE_STAGES, stageNumber } from './order-stages.ts';
import { escapeTelegramHtml } from './integrations.ts';

export const RED_ALERT_AFTER_MS = 48 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 3600 * 1000;
const CLOSED_STAGES = ['COMPLETED', 'CANCELLED'];
const NO_STAGE_TIMER = new Set([...CLOSED_STAGES, 'ON_HOLD']);
const SECTION_LIMIT = 12;

export type OrderPlan = { next_action_item?: string | null; target_completion_date?: string | null };

export type PlanningOrder = OrderPlan & {
  order_number: string;
  client_name?: string | null;
  project_name?: string | null;
  stage: string;
  stage_entered_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export const manilaDateKey = (nowMs: number) => new Date(nowMs + MANILA_OFFSET_MS).toISOString().slice(0, 10);

// Forward moves into a pipeline stage or COMPLETED are phase-gated; ON_HOLD and CANCELLED are never gated.
export function isPhaseGatedTarget(to: string): boolean {
  return to === 'COMPLETED' || stageNumber(to) > 0;
}

export function missingPlanFields(order: OrderPlan): string[] {
  const missing: string[] = [];
  if (!order.next_action_item?.trim()) missing.push('next_action_item');
  if (!order.target_completion_date) missing.push('target_completion_date');
  return missing;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validatePlanInput(
  input: { nextActionItem?: unknown; targetCompletionDate?: unknown },
  todayKey: string,
): { plan: { next_action_item: string; target_completion_date: string } } | { error: string } {
  const next = typeof input.nextActionItem === 'string' ? input.nextActionItem.trim().slice(0, 300) : '';
  if (!next) return { error: 'Kailangan ang next action (hal. "send GCash details").' };
  const date = typeof input.targetCompletionDate === 'string' ? input.targetCompletionDate.trim() : '';
  const parsed = DATE_RE.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { error: 'Target date ay dapat YYYY-MM-DD, hal. 2026-11-05.' };
  }
  if (date < todayKey) return { error: `Nakaraan na ang target date na ${date}.` };
  return { plan: { next_action_item: next, target_completion_date: date } };
}

export const UPDATE_USAGE = 'Use: /update_<ORD-number o client> next: <next action> | target: YYYY-MM-DD';

// "next: send GCash details | target: 2026-11-05" (field order does not matter).
export function parseUpdateInput(raw: string, todayKey: string) {
  if (!/\bnext\s*:/i.test(raw)) return { error: UPDATE_USAGE };
  const target = /\btarget\s*:\s*([^\s|]+)/i.exec(raw)?.[1] ?? '';
  const next = (/\bnext\s*:\s*([^|]*)/i.exec(raw)?.[1] ?? '').replace(/\btarget\s*:.*$/i, '').trim();
  return validatePlanInput({ nextActionItem: next, targetCompletionDate: target }, todayKey);
}

export function stageAgeMs(order: Pick<PlanningOrder, 'stage_entered_at' | 'updated_at' | 'created_at'>, nowMs: number): number {
  const since = Date.parse(order.stage_entered_at || order.updated_at || order.created_at || '');
  return Number.isFinite(since) ? Math.max(0, nowMs - since) : 0;
}

// 48h+ in the same active phase = stagnant. ON_HOLD is deliberate, so it is never flagged.
export function isRedAlert(order: Pick<PlanningOrder, 'stage' | 'stage_entered_at' | 'updated_at' | 'created_at'>, nowMs: number): boolean {
  if (NO_STAGE_TIMER.has(order.stage)) return false;
  return stageAgeMs(order, nowMs) >= RED_ALERT_AFTER_MS;
}

export function stageLabel(stage: string): string {
  const no = stageNumber(stage);
  return no ? `Stage ${String(no).padStart(2, '0')}/${PIPELINE_STAGES.length} ${PIPELINE_STAGES[no - 1].label}` : stage.replaceAll('_', ' ').toLowerCase();
}

const orderTitle = (order: PlanningOrder) => escapeTelegramHtml(`${order.order_number} · ${order.client_name || order.project_name || 'client'}`);

function section(title: string, items: string[]): string {
  if (!items.length) return '';
  const shown = items.slice(0, SECTION_LIMIT);
  const more = items.length > shown.length ? `\n  …+${items.length - shown.length} pa` : '';
  return `\n\n<b>${title} (${items.length})</b>\n${shown.map((line) => `- ${line}`).join('\n')}${more}`;
}

// 6:00 AM briefing for CEO Richard and Ms. Anne (HTML, Telegram parse mode), prepping the day ahead.
export function buildExecutiveBriefing(input: { nowMs: number; orders: PlanningOrder[]; updatesLast24h: number }): string {
  const { nowMs, orders, updatesLast24h } = input;
  const today = manilaDateKey(nowMs);
  const weekOut = manilaDateKey(nowMs + 7 * 86400000);
  const open = orders.filter((order) => !CLOSED_STAGES.includes(order.stage));
  const redAlerts = open.filter((order) => isRedAlert(order, nowMs)).sort((a, b) => stageAgeMs(b, nowMs) - stageAgeMs(a, nowMs));
  const overdue = open.filter((order) => order.stage !== 'ON_HOLD' && order.target_completion_date && order.target_completion_date < today);
  const dueSoon = open
    .filter((order) => order.target_completion_date && order.target_completion_date >= today && order.target_completion_date <= weekOut)
    .sort((a, b) => String(a.target_completion_date).localeCompare(String(b.target_completion_date)));
  const unplanned = open.filter((order) => order.stage !== 'ON_HOLD' && missingPlanFields(order).length > 0);
  const onHold = open.filter((order) => order.stage === 'ON_HOLD');
  const dateLabel = new Date(nowMs).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  let text = `<b>6:00 AM EXECUTIVE PROGRESS BRIEFING</b>\nFor CEO Richard and Ms. Anne · ${escapeTelegramHtml(dateLabel)}\n\nOpen orders: <b>${open.length}</b> · Client updates (24h): <b>${updatesLast24h}</b> · 🚨 Red Alerts: <b>${redAlerts.length}</b>`;
  text += section(
    '🚨 RED ALERT: stuck 48h+',
    redAlerts.map((o) => `${orderTitle(o)} · ${escapeTelegramHtml(stageLabel(o.stage))} · ${Math.floor(stageAgeMs(o, nowMs) / 86400000)}d stuck · Next: ${escapeTelegramHtml(o.next_action_item || 'WALA PA')}`),
  );
  text += section(
    '⏰ Overdue target',
    overdue.map((o) => `${orderTitle(o)} · target ${escapeTelegramHtml(String(o.target_completion_date))} · ${escapeTelegramHtml(o.next_action_item || 'WALA PA')}`),
  );
  text += section(
    '📅 Due within 7 days',
    dueSoon.map((o) => `${orderTitle(o)} · ${escapeTelegramHtml(String(o.target_completion_date))} · ${escapeTelegramHtml(o.next_action_item || 'WALA PA')}`),
  );
  text += section(
    '📝 Missing plan (hindi pa naka-set)',
    unplanned.map((o) => `${orderTitle(o)} · ${escapeTelegramHtml(stageLabel(o.stage))}`),
  );
  if (onHold.length) text += `\n\n⏸ On hold: ${onHold.map(orderTitle).join(', ')}`;
  if (!redAlerts.length && !overdue.length && !unplanned.length) text += '\n\n✅ Walang red alert o overdue ngayon.';
  return text;
}
