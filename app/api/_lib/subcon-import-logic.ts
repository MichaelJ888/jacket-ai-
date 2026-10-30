import { parseCsv, type ColumnSpec } from './csv-import-logic.ts';

// Subcon directory import (CSV or JSON supplied by the user) plus m.me quick-dispatch links.
// Pure logic: no I/O. Use planImport from csv-import-logic.ts for the dry run.

export const SUBCON_IMPORT_COLUMNS: ColumnSpec[] = [
  { name: 'name', required: true },
  { name: 'specialty' },
  { name: 'contact_phone' },
  { name: 'location' },
  { name: 'daily_capacity_pcs', type: 'integer' },
  { name: 'rate_per_pc', type: 'number' },
  { name: 'messenger_handle' },
  { name: 'notes' },
];

export const SUBCON_IMPORT_KEY = 'name';

// Accepts a Facebook Page username, numeric page/user id, or an existing m.me URL.
// Returns null when the value cannot form a valid m.me link.
export function buildMessengerLink(handle: string | null | undefined) {
  const raw = (handle || '').trim();
  if (!raw) return null;
  const urlMatch = raw.match(/^(?:https?:\/\/)?(?:www\.)?m\.me\/([A-Za-z0-9.\-_]+)\/?$/i);
  const slug = urlMatch ? urlMatch[1] : raw.replace(/^@/, '');
  if (!/^[A-Za-z0-9.\-_]{1,80}$/.test(slug)) return null;
  return `https://m.me/${slug}`;
}

// Converts an uploaded JSON array of objects into the header + rows shape that planImport expects.
export function jsonRowsToTable(data: unknown): { header: string[]; rows: string[][] } | null {
  if (!Array.isArray(data)) return null;
  const header: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    for (const key of Object.keys(item)) if (!header.includes(key)) header.push(key);
  }
  const rows = data.map((item) =>
    header.map((key) => {
      const value = (item as Record<string, unknown>)[key];
      return value === null || value === undefined ? '' : String(value);
    }),
  );
  return { header, rows };
}

// Optional columns missing from the upload are added as blanks, so a minimal file (name + specialty) still imports.
export function fillOptionalColumns(table: { header: string[]; rows: string[][] }, columns = SUBCON_IMPORT_COLUMNS) {
  const missingOptional = columns.filter((spec) => !spec.required && !table.header.includes(spec.name)).map((spec) => spec.name);
  if (!missingOptional.length) return table;
  return {
    header: [...table.header, ...missingOptional],
    rows: table.rows.map((row) => [...row, ...missingOptional.map(() => '')]),
  };
}

export function csvToTable(text: string): { header: string[]; rows: string[][] } {
  const [header = [], ...rows] = parseCsv(text);
  return { header: header.map((cell) => cell.trim()), rows };
}
