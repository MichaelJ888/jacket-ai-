// Normalizes client identifiers so the same customer is never created or processed twice.
const LEGAL_SUFFIXES = new Set(['inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'llc', 'opc', 'the']);

export function normalizeClientName(value: string | null | undefined): string {
  const tokens = (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

// Philippine mobile/landline digits as 0XXXXXXXXXX (drops +63, 63 and spacing/dashes).
export function normalizePhoneKey(value: string | null | undefined): string {
  let digits = (value || '').replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('9')) digits = `0${digits}`;
  return digits.length >= 10 ? digits : '';
}

export type ClientIdentity = { clientName?: string | null; company?: string | null; phone?: string | null };

export function clientIdentityKeys(identity: ClientIdentity): string[] {
  const keys: string[] = [];
  const name = normalizeClientName(identity.clientName);
  const company = normalizeClientName(identity.company);
  const phone = normalizePhoneKey(identity.phone);
  if (name) keys.push(`name:${name}`);
  if (company) keys.push(`company:${company}`);
  if (phone) keys.push(`phone:${phone}`);
  return keys;
}

// Keeps the first record for each person/company. A later record is a duplicate if it shares any name, company, or phone key with a kept one.
export function dedupeClientRecords<T extends ClientIdentity>(records: T[]): { unique: T[]; duplicates: T[] } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const record of records) {
    const keys = clientIdentityKeys(record);
    if (keys.length === 0) {
      unique.push(record);
      continue;
    }
    if (keys.some((key) => seen.has(key))) {
      duplicates.push(record);
      continue;
    }
    keys.forEach((key) => seen.add(key));
    unique.push(record);
  }
  return { unique, duplicates };
}
