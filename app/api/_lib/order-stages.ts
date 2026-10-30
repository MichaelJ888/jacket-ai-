// Official 11-stage end-to-end production workflow (client_project_status_template.md).
// `key` is what gets stored in orders.stage; `no` and `label` are for display.
export const PIPELINE_STAGES = [
  { key: 'S01_INQUIRY', no: 1, label: 'Inquiry & Project Brief Received' },
  { key: 'S02_SOURCING', no: 2, label: 'Fabric & Material Sourcing' },
  { key: 'S03_DESIGN_APPROVAL', no: 3, label: 'Final Design / Mockup & Artwork Approval' },
  { key: 'S04_QUOTATION', no: 4, label: 'Official Quotation Issued' },
  { key: 'S05_DEPOSIT', no: 5, label: 'Down Payment (D.P.) Received' },
  { key: 'S06_SIZING', no: 6, label: 'Size Breakdown / Names & Numbers Finalized' },
  { key: 'S07_SAMPLE', no: 7, label: 'Sample / Prototype Development' },
  { key: 'S08_PRODUCTION', no: 8, label: 'Mass Production & Custom Branding' },
  { key: 'S09_QC', no: 9, label: 'Quality Control (QC) Inspection' },
  { key: 'S10_BALANCE', no: 10, label: 'Full Balance Payment Received' },
  { key: 'S11_DISPATCH', no: 11, label: 'Order Pickup / Dispatch & Delivery' },
] as const;

export const ORDER_STAGES = PIPELINE_STAGES.map((stage) => stage.key);
export const DEFAULT_ORDER_STAGE = 'S05_DEPOSIT';
export const DEPOSIT_STAGE_NO = 5;
// Pseudo-input (never stored): staff confirms the down payment, which moves the order to Stage 06.
export const DEPOSIT_RECEIVED = 'DEPOSIT_RECEIVED';

export type PipelineStage = (typeof PIPELINE_STAGES)[number]['key'];
export type OrderStage = PipelineStage | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';

// Legacy 12-stage values -> current keys (used by the SQL migration and import script).
export const LEGACY_STAGE_MAP: Record<string, PipelineStage> = {
  AWAITING_DEPOSIT: 'S05_DEPOSIT',
  DEPOSIT_VERIFIED: 'S06_SIZING',
  PO_DRAFTED: 'S08_PRODUCTION',
  CUTTING: 'S08_PRODUCTION',
  EMBROIDERY: 'S08_PRODUCTION',
  SEWING: 'S08_PRODUCTION',
  QC: 'S09_QC',
  PACKING: 'S10_BALANCE',
  READY_FOR_DELIVERY: 'S11_DISPATCH',
  DISPATCHED: 'S11_DISPATCH',
  DELIVERED: 'S11_DISPATCH',
};

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === 'string' && (ORDER_STAGES as readonly string[]).includes(value);
}

export function isOrderStage(value: unknown): value is OrderStage {
  return isPipelineStage(value) || value === 'COMPLETED' || value === 'ON_HOLD' || value === 'CANCELLED';
}

// 1-based stage number (1-11), or 0 for non-pipeline states (ON_HOLD, COMPLETED, ...).
export function stageNumber(stage: string): number {
  return isPipelineStage(stage) ? ORDER_STAGES.indexOf(stage) + 1 : 0;
}

// Production can't start before the down payment is confirmed (Stage 05).
export function requiresDepositFirst(from: string, to: string): boolean {
  return isPipelineStage(from) && stageNumber(from) <= DEPOSIT_STAGE_NO && stageNumber(to) > DEPOSIT_STAGE_NO;
}

// Stages only move forward (skipping is allowed); COMPLETED follows Stage 11. ON_HOLD/CANCELLED are
// reachable from any open stage and ON_HOLD can resume to any stage.
export function canTransition(from: string, to: string) {
  if (from === to || from === 'CANCELLED' || from === 'COMPLETED') return false;
  if (to === 'ON_HOLD' || to === 'CANCELLED') return true;
  if (from === 'ON_HOLD') return isOrderStage(to);
  if (!isPipelineStage(from)) return false;
  if (to === 'COMPLETED') return from === 'S11_DISPATCH';
  if (!isPipelineStage(to)) return false;
  return stageNumber(to) > stageNumber(from);
}

export function defaultDepositAmount(total: number, pct = 50) {
  return Number(((Math.max(0, total) * pct) / 100).toFixed(2));
}
