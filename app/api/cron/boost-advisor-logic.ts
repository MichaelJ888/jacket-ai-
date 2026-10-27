export type BoostCategory = 'b2b' | 'safety' | 'team' | 'general';

export type BoostCandidate = {
  id: string;
  platform: string;
  media_type: string;
  caption: string;
  scheduled_at: string;
  published_at: string | null;
  post_url: string | null;
  reach: number | null;
  shares: number | null;
};

export function manilaWeekday(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short' }).format(date);
}

export function preferredCategory(weekday: string): BoostCategory {
  if (weekday === 'Mon' || weekday === 'Tue') return 'b2b';
  if (weekday === 'Wed' || weekday === 'Thu') return 'safety';
  if (weekday === 'Fri' || weekday === 'Sat') return 'team';
  return 'general';
}

export function classifyBoostCategory(text: string): BoostCategory {
  if (/\b(safety|reflectori[sz]ed|industrial|contractor|power industry|utility|workwear|ppe)\b/i.test(text)) return 'safety';
  if (/\b(varsity|sports?|team wear|team uniform|event|tournament|school team)\b/i.test(text)) return 'team';
  if (/\b(corporate|company|b2b|business|giveaway|executive|office uniform)\b/i.test(text)) return 'b2b';
  return 'general';
}

function engagementScore(candidate: BoostCandidate) {
  if (candidate.reach === null && candidate.shares === null) return null;
  return (candidate.reach || 0) + (candidate.shares || 0) * 10;
}

export function rankBoostCandidates(candidates: BoostCandidate[], weekday: string) {
  const category = preferredCategory(weekday);
  return [...candidates].sort((a, b) => {
    const scoreA = engagementScore(a);
    const scoreB = engagementScore(b);
    if (scoreA !== null || scoreB !== null) {
      if (scoreA === null) return 1;
      if (scoreB === null) return -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
      if ((a.reach || 0) !== (b.reach || 0)) return (b.reach || 0) - (a.reach || 0);
      if ((a.shares || 0) !== (b.shares || 0)) return (b.shares || 0) - (a.shares || 0);
    }

    const categoryA = classifyBoostCategory(a.caption) === category ? 0 : 1;
    const categoryB = classifyBoostCategory(b.caption) === category ? 0 : 1;
    if (categoryA !== categoryB) return categoryA - categoryB;
    if (a.media_type !== b.media_type) return a.media_type === 'video' ? -1 : 1;
    if (a.platform !== b.platform) return a.platform === 'facebook' ? -1 : 1;
    return (a.published_at || a.scheduled_at).localeCompare(b.published_at || b.scheduled_at);
  });
}
