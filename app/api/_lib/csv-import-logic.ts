// Dry-run planner for bulk CSV imports (pricing sheets, fabric inventory, client lists).
// Pure logic: no I/O. It reports validation errors and the exact insert/update diffs so nothing is written until the caller confirms.

export type ColumnSpec = { name: string; required?: boolean; type?: 'string' | 'number' | 'integer' };
export type ImportError = { row: number; column: string; message: string };
export type FieldDiff = { column: string; before: string; after: string };
export type RowPlan =
  | { row: number; key: string; action: 'insert'; values: Record<string, string> }
  | { row: number; key: string; action: 'update'; values: Record<string, string>; diffs: FieldDiff[] }
  | { row: number; key: string; action: 'unchanged' };
export type ImportPlan = { ok: boolean; errors: ImportError[]; plan: RowPlan[]; counts: Record<'insert' | 'update' | 'unchanged', number> };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

function checkValue(value: string, spec: ColumnSpec): string | null {
  if (!value) return spec.required ? 'required value is missing' : null;
  if (spec.type === 'number' && !Number.isFinite(Number(value))) return `"${value}" is not a number`;
  if (spec.type === 'integer' && !Number.isInteger(Number(value))) return `"${value}" is not a whole number`;
  return null;
}

// rows: parsed CSV with the header row removed. existing: current DB rows keyed by the key column.
export function planImport(
  header: string[],
  rows: string[][],
  columns: ColumnSpec[],
  keyColumn: string,
  existing: Record<string, Record<string, string>> = {},
): ImportPlan {
  const errors: ImportError[] = [];
  const missing = columns.filter((spec) => !header.includes(spec.name));
  for (const spec of missing) errors.push({ row: 0, column: spec.name, message: 'column is missing from the header' });
  if (!header.includes(keyColumn)) errors.push({ row: 0, column: keyColumn, message: 'key column is missing from the header' });
  if (errors.length) return { ok: false, errors, plan: [], counts: { insert: 0, update: 0, unchanged: 0 } };

  const seenKeys = new Map<string, number>();
  const plan: RowPlan[] = [];
  rows.forEach((cells, index) => {
    const rowNumber = index + 2; // header is line 1
    const record = Object.fromEntries(header.map((name, col) => [name, (cells[col] ?? '').trim()]));
    const rowErrors = columns.map((spec) => ({ spec, message: checkValue(record[spec.name] ?? '', spec) })).filter((item) => item.message);
    for (const item of rowErrors) errors.push({ row: rowNumber, column: item.spec.name, message: item.message as string });

    const key = record[keyColumn];
    if (!key) {
      errors.push({ row: rowNumber, column: keyColumn, message: 'key is empty' });
      return;
    }
    if (seenKeys.has(key)) {
      errors.push({ row: rowNumber, column: keyColumn, message: `duplicate key "${key}" (first on row ${seenKeys.get(key)})` });
      return;
    }
    seenKeys.set(key, rowNumber);
    if (rowErrors.length) return;

    const values = Object.fromEntries(columns.map((spec) => [spec.name, record[spec.name] ?? '']));
    const before = existing[key];
    if (!before) {
      plan.push({ row: rowNumber, key, action: 'insert', values });
      return;
    }
    const diffs = columns
      .filter((spec) => (before[spec.name] ?? '') !== values[spec.name])
      .map((spec) => ({ column: spec.name, before: before[spec.name] ?? '', after: values[spec.name] }));
    plan.push(diffs.length ? { row: rowNumber, key, action: 'update', values, diffs } : { row: rowNumber, key, action: 'unchanged' });
  });

  const counts = { insert: 0, update: 0, unchanged: 0 };
  for (const item of plan) counts[item.action] += 1;
  return { ok: errors.length === 0, errors, plan, counts };
}

// Human-readable preview for Telegram or the dashboard. Caps output so it fits a Telegram message.
export function formatPlanPreview(result: ImportPlan, maxLines = 20): string {
  const lines = [
    `Dry run: ${result.counts.insert} new, ${result.counts.update} changed, ${result.counts.unchanged} unchanged.`,
    result.ok ? 'No validation errors. Nothing has been written yet.' : `${result.errors.length} validation error(s). Import blocked until fixed.`,
  ];
  for (const error of result.errors.slice(0, maxLines)) lines.push(`  row ${error.row} · ${error.column}: ${error.message}`);
  for (const item of result.plan.filter((entry) => entry.action === 'update').slice(0, maxLines)) {
    if (item.action !== 'update') continue;
    for (const diff of item.diffs) lines.push(`  ${item.key} · ${diff.column}: "${diff.before}" → "${diff.after}"`);
  }
  return lines.slice(0, maxLines + 2).join('\n');
}
