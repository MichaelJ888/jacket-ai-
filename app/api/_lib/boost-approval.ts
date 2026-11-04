import { getSupabaseAdmin } from './integrations';
import { BOOST_TOTAL_PESOS, manilaDateKey, type BoostDecision } from './boost-approval-logic.ts';

// Records the CEO's decision only. Spend still happens manually in Meta Ads Manager.
export async function recordBoostDecision(postId: string, decision: BoostDecision, telegramUserId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { message: 'Supabase is not configured.', reply: 'Hindi na-save ang decision: Supabase is not configured.' };

  const { error } = await supabase.from('boost_decisions').insert({
    post_id: postId,
    boost_date: manilaDateKey(new Date()),
    budget_pesos: BOOST_TOTAL_PESOS,
    decision,
    decided_by_telegram_id: telegramUserId || null,
  });
  if (error?.code === '23505') {
    return { message: 'Already handled.', reply: 'Naka-record na po ang decision para sa post na ito ngayong araw.' };
  }
  if (error) {
    return { message: 'Could not save. Try again.', reply: 'Hindi na-save ang decision. Subukan ulit.' };
  }
  return decision === 'APPROVED'
    ? {
        message: 'Boost approved.',
        reply: `Approved: boost ₱${BOOST_TOTAL_PESOS} (2 araw). Manual pa rin ang bayad sa Meta Ads Manager. Walang automatic spend.`,
      }
    : { message: 'Boost cancelled.', reply: 'Cancelled: walang boost para sa post na ito ngayong araw.' };
}
