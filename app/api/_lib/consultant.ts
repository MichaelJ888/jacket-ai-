import { generateText } from 'ai';

import { gatherSystemHealth } from './ceo-introspect';
import { groupCounts } from './ceo-introspect-logic';
import { getSupabaseAdmin } from './integrations';
import { withModelFallback } from './llm-pool';

// Weekly "AI business consultant": pulls 30 days of real numbers, then asks the strong model for 3 ranked, evidence-based recommendations.

const day = 86_400_000;

export async function gatherConsultantData() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const now = Date.now();
  const since30 = new Date(now - 30 * day).toISOString();
  const since7 = new Date(now - 7 * day).toISOString();

  const [leads, contacts, orders, costings, ledger, stock, voice] = await Promise.all([
    supabase.from('leads').select('created_at, source').gte('created_at', since30).limit(2000),
    supabase.from('crm_contacts').select('stage, ai_paused, last_inbound_at, last_outbound_at, next_followup_at').limit(5000),
    supabase.from('orders').select('stage, total_amount, created_at, updated_at, delivered_at').limit(3000),
    supabase.from('project_costings').select('status, total_cost, created_at').gte('created_at', since30).limit(2000),
    supabase.from('ledger_entries').select('entry_type, category, amount').gte('created_at', since30).limit(5000),
    supabase.from('material_inventory').select('material_name, quantity_available, reorder_level, unit').limit(300),
    supabase.from('voice_calls').select('status, duration_seconds, cost_usd, sentiment').gte('created_at', since30).limit(1000),
  ]);

  const contactRows = (contacts.data || []) as Array<{ stage: string; ai_paused: boolean | null; last_inbound_at: string | null; last_outbound_at: string | null; next_followup_at: string | null }>;
  const unanswered = contactRows.filter((c) => c.last_inbound_at && Date.parse(c.last_inbound_at) > now - 7 * day && Date.parse(c.last_inbound_at) < now - 2 * 3_600_000 && (!c.last_outbound_at || Date.parse(c.last_outbound_at) < Date.parse(c.last_inbound_at))).length;
  const orderRows = (orders.data || []) as Array<{ stage: string; total_amount: number | null; created_at: string; updated_at: string | null; delivered_at: string | null }>;
  const open = orderRows.filter((o) => !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(o.stage));
  const ledgerRows = (ledger.data || []) as Array<{ entry_type: string; category: string | null; amount: number }>;
  const sum = (type: string) => ledgerRows.filter((r) => r.entry_type === type).reduce((total, r) => total + Number(r.amount || 0), 0);
  const weeklyLeads = [0, 1, 2, 3].map((week) => (leads.data || []).filter((l) => { const age = now - Date.parse(l.created_at as string); return age >= week * 7 * day && age < (week + 1) * 7 * day; }).length);
  const expenseByCategory = groupCounts(ledgerRows.filter((r) => r.entry_type === 'expense').map((r) => ({ category: r.category })), 'category', 6);
  const costingRows = (costings.data || []) as Array<{ status: string | null; total_cost: number | null }>;
  const voiceRows = (voice.data || []) as Array<{ duration_seconds: number | null; cost_usd: number | null; sentiment: string | null }>;

  return {
    period: 'last 30 days (Asia/Manila)',
    leads: { last_4_weeks_newest_first: weeklyLeads, by_source: groupCounts((leads.data || []) as Array<{ source: string }>, 'source', 5) },
    crm_funnel: groupCounts(contactRows, 'stage', 7),
    followup: { unanswered_inbound_over_2h: unanswered, overdue_followups: contactRows.filter((c) => c.next_followup_at && Date.parse(c.next_followup_at) < now && !c.ai_paused).length, ai_paused_contacts: contactRows.filter((c) => c.ai_paused).length },
    orders: { by_stage: groupCounts(orderRows, 'stage', 12), open_count: open.length, open_value_php: Math.round(open.reduce((total, o) => total + Number(o.total_amount || 0), 0)), stuck_over_7d_no_update: open.filter((o) => Date.parse(o.updated_at || o.created_at) < now - 7 * day).length, created_last_7d: orderRows.filter((o) => o.created_at >= since7).length },
    quotes: { made: costingRows.length, by_status: groupCounts(costingRows, 'status', 5) },
    money_php: { income: Math.round(sum('income')), expenses: Math.round(sum('expense')), profit: Math.round(sum('income') - sum('expense')), top_expense_categories: expenseByCategory },
    low_stock: ((stock.data || []) as Array<{ material_name: string; quantity_available: number; reorder_level: number | null; unit: string | null }>).filter((m) => Number(m.reorder_level) > 0 && Number(m.quantity_available) <= Number(m.reorder_level)).slice(0, 10),
    phone_ai: { calls: voiceRows.length, minutes: Math.round(voiceRows.reduce((total, r) => total + (r.duration_seconds || 0), 0) / 60), cost_usd: Number(voiceRows.reduce((total, r) => total + Number(r.cost_usd || 0), 0).toFixed(2)) },
  };
}

const CONSULTANT_PROMPT = `You are the AI business consultant of MJIC, a Philippine uniform/jacket/embroidery business, writing the weekly report to the CEO in natural Taglish (warm, direct, no fluff).
Use ONLY the data given. If a section has no data, say it is missing instead of guessing. Never invent numbers.
Format (plain text, no markdown tables, ₱ for pesos, max ~1500 characters):
1) One-line verdict on the week.
2) "Top 3 na dapat gawin" - each: what to do, the evidence (number from data), expected peso/time impact, effort (Low/Med/High).
3) One risk to watch.
4) One suggestion to improve the AI system itself (based on the system health data), phrased so the CEO can answer "gawin mo" to start it.`;

export async function runConsultantReport() {
  const [business, system] = await Promise.all([gatherConsultantData(), gatherSystemHealth([])]);
  if (!business) return { ok: false as const, error: 'Supabase is not configured' };
  const systemSummary = {
    stale_or_failing_jobs: 'stale_or_failing_jobs' in system ? system.stale_or_failing_jobs : [],
    problems_last_7d: 'problems_last_7d' in system ? system.problems_last_7d : null,
    config_hints: system.config_hints,
  };
  // Leave time for data collection and Telegram delivery inside the 60-second route limit.
  const result = await withModelFallback({ tier: 'strong', budgetMs: 30_000, attemptMs: 12_000 }, (model, attemptMs) =>
    generateText({ model, system: CONSULTANT_PROMPT, prompt: JSON.stringify({ business, system: systemSummary }), maxOutputTokens: 1600, maxRetries: 0, abortSignal: AbortSignal.timeout(attemptMs) }),
  );
  if (!result.text.trim()) throw new Error('Consultant model returned an empty report');
  return { ok: true as const, report: result.text.trim(), business };
}
