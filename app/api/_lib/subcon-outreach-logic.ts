export type SubconOutreachTemplate = {
  subject: string;
  text: string;
};

export type SubconConsentState = {
  active: boolean;
  email: string | null;
  email_opt_in: boolean;
  email_opt_in_at: string | null;
  email_opt_in_evidence: string | null;
  email_opted_out_at: string | null;
  vetted: boolean;
  vetted_at: string | null;
  vetting_evidence: string | null;
};

export function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function maySendSubconOutreach(record: SubconConsentState) {
  return record.active
    && Boolean(record.email && isValidEmail(record.email))
    && record.email_opt_in
    && Boolean(record.email_opt_in_at)
    && Boolean(record.email_opt_in_evidence?.trim())
    && !record.email_opted_out_at
    && record.vetted
    && Boolean(record.vetted_at)
    && Boolean(record.vetting_evidence?.trim());
}

export function buildSubconOutreachTemplate(name: string, specialty: string | null): SubconOutreachTemplate {
  const greetingName = name.trim().slice(0, 120) || 'there';
  const specialtyLine = specialty?.trim()
    ? `We understand your work includes ${specialty.trim().slice(0, 200)}. `
    : '';
  return {
    subject: 'MJIC garment subcontracting capability inquiry',
    text: [
      `Hello ${greetingName},`,
      '',
      `Michael Jeffrey International Corporation (MJIC) is updating its garment subcontractor directory. ${specialtyLine}If you are open to being considered for future garment production work, please reply with your current services, location, available capacity, and an indicative rate range.`,
      '',
      'This inquiry is not a work order, price commitment, or guarantee of future projects. If you do not want further email from MJIC, please let us know and we will stop contacting you.',
      '',
      'Thank you,',
      'MJIC Operations',
    ].join('\n'),
  };
}
