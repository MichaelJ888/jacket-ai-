// Meta lead-ads (leadgen) parsing. Pure rules, no I/O — kept separate so the webhook handler stays testable.

export type LeadgenFieldData = Array<{ name?: string; values?: unknown[] }>;

export type ParsedLeadgen = {
  name: string;
  company: string;
  phone: string;
  email: string;
  contact: string; // best single contact handle: phone wins, else email
  message: string; // every captured field as "name: value" lines for sales context
};

const NAME_KEYS = new Set(['full_name', 'fullname', 'name', 'first_name', 'last_name']);
const COMPANY_KEYS = new Set(['company', 'company_name', 'business_name', 'organization']);
const PHONE_KEYS = new Set(['phone_number', 'phone', 'mobile', 'contact_number']);
const EMAIL_KEYS = new Set(['email', 'email_address']);

// Maps Meta leadgen field_data into contact fields. Unknown/custom questions are kept in the message lines.
export function parseLeadgenFieldData(fieldData: unknown): ParsedLeadgen {
  const rows = Array.isArray(fieldData) ? (fieldData as LeadgenFieldData) : [];
  let name = '';
  let company = '';
  let phone = '';
  let email = '';
  const lines: string[] = [];

  for (const row of rows) {
    const key = String(row?.name ?? '').trim().toLowerCase();
    const value = (Array.isArray(row?.values) ? row.values : []).map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
    if (!key || !value) continue;
    if (NAME_KEYS.has(key)) name ||= value;
    else if (COMPANY_KEYS.has(key)) company ||= value;
    else if (PHONE_KEYS.has(key)) phone ||= value;
    else if (EMAIL_KEYS.has(key)) email ||= value;
    lines.push(`${key}: ${value}`.slice(0, 300));
  }

  return {
    name: name.slice(0, 120),
    company: company.slice(0, 120),
    phone: phone.slice(0, 60),
    email: email.slice(0, 120),
    contact: (phone || email).slice(0, 120),
    message: lines.join('\n').slice(0, 1500),
  };
}
