// Strict fabric classification. Only these fabrics are Class B (no surcharge).
// Every other fabric, including custom, unlisted, or blank input, is Class A (+₱300 per piece).
const CLASS_B_FABRICS: ReadonlySet<string> = new Set(['microfiber', 'michael angelo', 'diamond ripstop']);

export type FabricClass = 'A' | 'B';

export function normalizeFabricName(fabric: unknown): string {
  return String(fabric ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function resolveFabricClass(fabric: unknown): FabricClass {
  return CLASS_B_FABRICS.has(normalizeFabricName(fabric)) ? 'B' : 'A';
}
