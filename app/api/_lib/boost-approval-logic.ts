export const BOOST_BUDGET_PESOS = 350;
export const BOOST_DAYS = 2;
export const BOOST_TOTAL_PESOS = BOOST_BUDGET_PESOS * BOOST_DAYS;

export const BOOST_DECISIONS = ['APPROVED', 'CANCELLED'] as const;
export type BoostDecision = (typeof BOOST_DECISIONS)[number];

const BOOST_CALLBACK = /^boost_go:(yes|no):([A-Za-z0-9-]{8,40})$/;

export function parseBoostCallback(data: string): { decision: BoostDecision; postId: string } | null {
  const match = data.match(BOOST_CALLBACK);
  if (!match) return null;
  return { decision: match[1] === 'yes' ? 'APPROVED' : 'CANCELLED', postId: match[2] };
}

// Telegram callback_data is capped at 64 bytes; this stays well under that.
export function boostKeyboard(postId: string) {
  return {
    inline_keyboard: [[
      { text: `APPROVE BOOST ₱${BOOST_TOTAL_PESOS}`, callback_data: `boost_go:yes:${postId}` },
      { text: 'CANCEL', callback_data: `boost_go:no:${postId}` },
    ]],
  };
}

// Calendar day in Manila, used for the one-decision-per-post-per-day rule.
export function manilaDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(date);
}
