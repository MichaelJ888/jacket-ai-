// Client project specification (sections 1-4 of client_project_status_template.md).
// Stored on public.orders as flat columns + jsonb arrays for itemized lines and the size matrix.

export const GARMENT_TYPES = ['Customized Jacket', 'Jersey', 'Uniform', 'Hoodie', 'Other'] as const;
export const PRINT_METHODS = ['Silkscreen', 'Sublimation', 'DTF', 'Embroidery', 'Applique'] as const;
export const SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] as const;

export type ItemizedLine = { description: string; qty: number; unitPrice: number; amount: number };
export type SizeRow = { no: number; name: string; size: string; customNumber: string | null };

export type OrderSpec = {
  organizationName: string | null;
  contactPerson: string | null;
  contactNumber: string | null;
  targetDeadline: string | null; // YYYY-MM-DD
  garmentType: string | null;
  fabricTypeGsm: string | null;
  colorwayPantone: string | null;
  printMethod: string | null;
  itemizedItems: ItemizedLine[];
  sizeMatrix: SizeRow[];
};

// Columns on public.orders that hold the spec (snake_case, matching schema.sql).
export const ORDER_SPEC_COLUMNS = {
  organizationName: 'organization_name',
  contactPerson: 'contact_person',
  targetDeadline: 'target_deadline',
  garmentType: 'garment_type',
  fabricTypeGsm: 'fabric_type_gsm',
  colorwayPantone: 'colorway_pantone',
  printMethod: 'print_method',
  itemizedItems: 'itemized_items',
  sizeMatrix: 'size_matrix',
} as const;

const text = (value: unknown, max = 200): string | null => {
  const cleaned = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return cleaned || null;
};

const money = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[₱,\s]|php/gi, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
};

export function normalizeItemizedLines(input: unknown): ItemizedLine[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      const item = (row ?? {}) as Record<string, unknown>;
      const qty = Math.max(0, Math.round(Number(item.qty) || 0));
      const unitPrice = money(item.unitPrice);
      return { description: text(item.description, 150) || 'Item', qty, unitPrice, amount: Math.round(qty * unitPrice * 100) / 100 };
    })
    .filter((line) => line.qty > 0 || line.unitPrice > 0)
    .slice(0, 50);
}

export function normalizeSizeMatrix(input: unknown): SizeRow[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row, index) => {
      const item = (row ?? {}) as Record<string, unknown>;
      const size = String(item.size || '').trim().toUpperCase();
      return {
        no: index + 1,
        name: text(item.name, 100) || '',
        size: (SIZE_LABELS as readonly string[]).includes(size) ? size : '',
        customNumber: text(item.customNumber, 20),
      };
    })
    .filter((row) => row.name || row.size || row.customNumber)
    .slice(0, 300);
}

// Accepts partial/untrusted input (API body, CEO tool) and returns a clean spec.
export function normalizeOrderSpec(input: unknown): OrderSpec {
  const raw = (input ?? {}) as Record<string, unknown>;
  const deadline = text(raw.targetDeadline, 10);
  const garment = text(raw.garmentType, 40);
  const print = text(raw.printMethod, 40);
  return {
    organizationName: text(raw.organizationName, 150),
    contactPerson: text(raw.contactPerson, 100),
    contactNumber: text(raw.contactNumber, 40),
    targetDeadline: deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null,
    garmentType: garment,
    fabricTypeGsm: text(raw.fabricTypeGsm, 120),
    colorwayPantone: text(raw.colorwayPantone, 120),
    printMethod: print,
    itemizedItems: normalizeItemizedLines(raw.itemizedItems),
    sizeMatrix: normalizeSizeMatrix(raw.sizeMatrix),
  };
}

export function itemizedTotal(lines: ItemizedLine[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
}

// Pieces per size, e.g. { S: 10, M: 25, XL: 5 }. Rows without a size are ignored.
export function sizeMatrixCounts(rows: SizeRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.size) continue;
    counts[row.size] = (counts[row.size] || 0) + 1;
  }
  return counts;
}

// Columns to write for an insert/update. Empty arrays are stored as [] (not null).
export function orderSpecToColumns(spec: OrderSpec): Record<string, unknown> {
  return {
    [ORDER_SPEC_COLUMNS.organizationName]: spec.organizationName,
    [ORDER_SPEC_COLUMNS.contactPerson]: spec.contactPerson,
    [ORDER_SPEC_COLUMNS.targetDeadline]: spec.targetDeadline,
    [ORDER_SPEC_COLUMNS.garmentType]: spec.garmentType,
    [ORDER_SPEC_COLUMNS.fabricTypeGsm]: spec.fabricTypeGsm,
    [ORDER_SPEC_COLUMNS.colorwayPantone]: spec.colorwayPantone,
    [ORDER_SPEC_COLUMNS.printMethod]: spec.printMethod,
    [ORDER_SPEC_COLUMNS.itemizedItems]: spec.itemizedItems,
    [ORDER_SPEC_COLUMNS.sizeMatrix]: spec.sizeMatrix,
  };
}
