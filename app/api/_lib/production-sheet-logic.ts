export type ThreadColor = { code: string; name: string; hex: string; stitches: number };

export type ProductionSheetColumn = { label: string; items: ThreadColor[] };

const HEX = /^#?([\da-f]{6})$/i;

// Rec. 601 luma, the usual grayscale approximation for print.
export function toBlackAndWhite(hex: string): '#000000' | '#ffffff' {
  const match = hex.match(HEX);
  if (!match) throw new Error(`Invalid hex color: ${hex}`);
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma < 128 ? '#000000' : '#ffffff';
}

// Splits items into the fewest columns that fit maxPerColumn, sized evenly so no column is near-empty.
export function splitIntoColumns<T>(items: T[], maxPerColumn: number): T[][] {
  if (maxPerColumn < 1) throw new Error('maxPerColumn must be at least 1');
  if (items.length === 0) return [];
  const columnCount = Math.ceil(items.length / maxPerColumn);
  const base = Math.floor(items.length / columnCount);
  const extra = items.length % columnCount;
  const columns: T[][] = [];
  let index = 0;
  for (let c = 0; c < columnCount; c++) {
    const size = base + (c < extra ? 1 : 0);
    columns.push(items.slice(index, index + size));
    index += size;
  }
  return columns;
}

export function buildProductionSheet(colors: ThreadColor[], maxPerColumn = 12): ProductionSheetColumn[] {
  const sorted = [...colors].sort((a, b) => a.code.localeCompare(b.code));
  return splitIntoColumns(sorted, maxPerColumn).map((items, index, all) => ({
    label: all.length > 1 ? `Column ${index + 1} of ${all.length}` : 'Legend',
    items,
  }));
}
