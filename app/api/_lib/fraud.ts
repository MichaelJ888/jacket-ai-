export type ReceiptFacts = {
  amount: number | null;
  expectedAmount: number;
  reference: string | null;
  transactionDate: string | null;
  recipient: string | null;
  tamperSigns: string[];
  duplicateReference: boolean;
  now?: Date;
};

// Recipient must match the GCash/Maya account in MJIC_SYSTEM_PROMPT.
export const EXPECTED_RECIPIENT_HINTS = ['venezuela', '1761'];

// Heuristic risk score 0..1. >= 0.5 means "do not auto-accept; CEO must review".
export function assessReceiptRisk(facts: ReceiptFacts) {
  const flags: string[] = [];
  let score = 0;
  const add = (flag: string, weight: number) => { flags.push(flag); score += weight; };

  if (facts.duplicateReference) add('DUPLICATE_REFERENCE (this reference was already used)', 0.7);
  if (!facts.reference) add('NO_REFERENCE_NUMBER', 0.25);
  if (facts.amount === null || !Number.isFinite(facts.amount)) add('AMOUNT_UNREADABLE', 0.3);
  else if (Math.abs(facts.amount - facts.expectedAmount) > 0.01) add('AMOUNT_MISMATCH', 0.3);

  const recipient = (facts.recipient || '').toLowerCase().replace(/\s|-/g, '');
  if (!recipient) add('NO_RECIPIENT_SHOWN', 0.2);
  else if (!EXPECTED_RECIPIENT_HINTS.some((hint) => recipient.includes(hint))) add('RECIPIENT_MISMATCH', 0.5);

  if (facts.transactionDate) {
    const parsed = new Date(facts.transactionDate);
    const now = facts.now || new Date();
    if (Number.isNaN(parsed.getTime())) add('DATE_UNREADABLE', 0.1);
    else if (parsed.getTime() > now.getTime() + 86400000) add('DATE_IN_FUTURE', 0.4);
    else if (now.getTime() - parsed.getTime() > 3 * 86400000) add('STALE_TRANSACTION_DATE', 0.35);
  } else add('NO_DATE', 0.15);

  for (const sign of facts.tamperSigns.slice(0, 5)) add(`TAMPER_SIGN: ${sign.slice(0, 80)}`, 0.4);
  return { score: Number(Math.min(1, score).toFixed(2)), flags, suspicious: score >= 0.5 };
}
