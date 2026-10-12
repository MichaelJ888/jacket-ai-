export const ORDER_STAGES = [
  'AWAITING_DEPOSIT',
  'DEPOSIT_VERIFIED',
  'PO_DRAFTED',
  'CUTTING',
  'EMBROIDERY',
  'SEWING',
  'QC',
  'PACKING',
  'READY_FOR_DELIVERY',
  'DISPATCHED',
  'DELIVERED',
  'COMPLETED',
] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];
export type OrderStatus = OrderStage | 'ON_HOLD' | 'CANCELLED';

export function isOrderStage(value: unknown): value is OrderStage {
  return typeof value === 'string' && (ORDER_STAGES as readonly string[]).includes(value);
}

// Stages only move forward (skipping is allowed, e.g. no embroidery); ON_HOLD/CANCELLED are
// reachable from any open stage and ON_HOLD can resume to any stage.
export function canTransition(from: string, to: string) {
  if (from === to || from === 'CANCELLED' || from === 'COMPLETED') return false;
  if (to === 'ON_HOLD' || to === 'CANCELLED') return true;
  if (!isOrderStage(to)) return false;
  if (from === 'ON_HOLD') return true;
  if (!isOrderStage(from)) return false;
  return ORDER_STAGES.indexOf(to) > ORDER_STAGES.indexOf(from);
}

export function defaultDepositAmount(total: number, pct = 50) {
  return Number(((Math.max(0, total) * pct) / 100).toFixed(2));
}
