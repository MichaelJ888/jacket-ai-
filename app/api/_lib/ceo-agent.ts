import { generateText, isStepCount, tool } from 'ai';
import { withModelFallback } from './llm-pool';
import { z } from 'zod';
import { after } from 'next/server';
import { advanceSwarmJob, createSwarmJob } from './swarm-jobs';
import { getSetting, autonomyLimitPhp, isShadowMode, isVacationMode, setSetting } from './ceo-control';
import { buildActionTools } from './ceo-actions';
import { buildDataTools } from './ceo-data';
import { buildIntrospectionTools, describeTools } from './ceo-introspect';
import { getChatSummary } from './ceo-memory';
import { CEO_PERSONA } from './ceo-persona';

import {
  accruePayrollToLedger,
  createPaymentRequest,
  currentPeriod,
  getBucketBalances,
  getCashBalance,
  getPeriodReport,
  proposeProfitAllocation,
  recordLedgerEntry,
  saveStyleExample,
  setAllocationRule,
} from './ceo-finance';
import { demandForecast, pricingAdvice } from './insights';
import { checkQuoteMargin, forecastRunwayDays } from './finance-logic';
import { hindsightRecall, hindsightRetain } from './hindsight.ts';
import {
  composeBossStyleMessage,
  createStaffTask,
  escapeTelegramHtml,
  getStaffProfile,
  getSupabaseAdmin,
  sendTelegramDirectMessage,
  sendTelegramMessage,
} from './integrations';

const HISTORY_LIMIT = 30;

function buildTools() {
  const supabase = getSupabaseAdmin();
  return {
    business_snapshot: tool({
      description: 'Live snapshot: cash balance, month-to-date P&L, runway, pending approvals, open staff tasks, low stock, pending deliveries, recent critical errors.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!supabase) return { error: 'Supabase is not configured' };
        const [cash, mtd, pay, tasks, dispatch, errors, stock] = await Promise.all([
          getCashBalance(),
          getPeriodReport(currentPeriod()),
          supabase.from('payment_requests').select('payee, amount, status').in('status', ['PENDING_APPROVAL', 'AWAITING_MANUAL_PAYMENT']),
          supabase.from('staff_tasks').select('staff_name, task_text, priority').eq('status', 'pending').limit(15),
          supabase.from('dispatch_requests').select('id, project_name, status').in('status', ['PENDING_APPROVAL', 'BOOKING_RETRY_QUEUED', 'BOOKING_FAILED']),
          supabase.from('system_logs').select('context, message').eq('severity', 'critical').gte('created_at', new Date(Date.now() - 86400000).toISOString()).limit(5),
          supabase.from('material_inventory').select('material_name, quantity_available, reorder_level').gt('reorder_level', 0).limit(100),
        ]);
        const low = (stock.data || []).filter((row) => Number(row.quantity_available) <= Number(row.reorder_level));
        const monthExpenses = mtd.report?.expenses ?? 0;
        return {
          cashBalance: cash, monthToDate: mtd.report, runwayDays: cash == null ? null : forecastRunwayDays(cash, monthExpenses),
          pendingPayments: pay.data, openTasks: tasks.data, pendingDeliveries: dispatch.data, criticalErrorsLast24h: errors.data, lowStock: low,
        };
      },
    }),

    period_report: tool({
      description: 'Profit & loss report for a month (YYYY-MM) or a year (YYYY): income, expenses by category, profit per project.',
      inputSchema: z.object({ period: z.string().describe('YYYY-MM or YYYY') }),
      execute: async ({ period }) => getPeriodReport(period),
    }),

    record_ledger_entry: tool({
      description: 'Record income or an expense in the books (e.g. a customer paid, rent paid in cash). Use a project name when it belongs to a project.',
      inputSchema: z.object({
        type: z.enum(['income', 'expense']),
        category: z.string().describe('e.g. sales, materials, rent, electricity_utilities, salaries, delivery, marketing'),
        amount: z.number().positive(),
        projectName: z.string().optional(),
        description: z.string().optional(),
      }),
      execute: async (input) => {
        const result = await recordLedgerEntry({ ...input, source: 'ceo_chat' });
        return result.error ? { error: result.error } : { recorded: true };
      },
    }),

    propose_payment: tool({
      description: 'Ask the CEO to approve a payment (supplier, rent, utilities, salary, delivery fee, etc). Sends Approve/Reject buttons; money moves only after he approves.',
      inputSchema: z.object({
        payee: z.string(),
        amount: z.number().positive(),
        purpose: z.string(),
        category: z.string().describe('materials, rent, electricity_utilities, salaries, delivery, marketing, tax_reserve, other'),
        projectName: z.string().optional(),
        payeeDetails: z.string().optional().describe('GCash/bank account number and name'),
      }),
      execute: async (input) => {
        const result = await createPaymentRequest(input);
        if (result.error) return { error: result.error };
        return { requestId: result.data?.id, status: result.data?.status, duplicate: Boolean((result as { duplicate?: boolean }).duplicate), note: 'Approval buttons sent to the CEO.' };
      },
    }),

    message_staff: tool({
      description: 'Send a message (and optionally create a tracked task) to a staff member on Telegram in the boss voice.',
      inputSchema: z.object({
        staffName: z.string(),
        message: z.string(),
        priority: z.enum(['normal', 'urgent', 'emergency']).default('normal'),
        trackAsTask: z.boolean().default(false),
      }),
      execute: async ({ staffName, message, priority, trackAsTask }) => {
        const profile = await getStaffProfile(staffName);
        const chatId = profile.data?.telegram_chat_id;
        if (!profile.data) return { error: `No staff named ${staffName}` };
        if (trackAsTask) await createStaffTask({ staffName: profile.data.staff_name, taskText: message, priority });
        if (!chatId) return { error: `${staffName} has not linked Telegram yet (use LINK ${staffName}).`, taskCreated: trackAsTask };
        await sendTelegramDirectMessage(chatId, await composeBossStyleMessage(message));
        return { sent: true, taskCreated: trackAsTask };
      },
    }),

    message_supplier: tool({
      description: 'Send a Telegram message to a supplier from suppliers_directory in the boss voice (e.g. ask price, chase delivery).',
      inputSchema: z.object({ supplierName: z.string(), message: z.string() }),
      execute: async ({ supplierName, message }) => {
        if (!supabase) return { error: 'Supabase is not configured' };
        const { data } = await supabase.from('suppliers_directory').select('supplier_name, telegram_chat_id').ilike('supplier_name', `%${supplierName}%`).limit(2);
        if (!data?.length) return { error: `No supplier matching "${supplierName}"` };
        if (data.length > 1) return { error: `Several suppliers match: ${data.map((row) => row.supplier_name).join(', ')}. Be more specific.` };
        if (!data[0].telegram_chat_id) return { error: `${data[0].supplier_name} has no Telegram chat linked. Draft for CEO to send manually.` };
        await sendTelegramDirectMessage(data[0].telegram_chat_id, await composeBossStyleMessage(message));
        return { sent: true, supplier: data[0].supplier_name };
      },
    }),

    request_delivery: tool({
      description: 'Create a Lalamove delivery/errand request (emergency or normal). The CEO gets an approve button; booking happens on approval.',
      inputSchema: z.object({
        projectName: z.string().optional(),
        pickupAddress: z.string(),
        deliveryAddress: z.string(),
        contactName: z.string(),
        contactPhone: z.string(),
        packageDescription: z.string().optional(),
        urgent: z.boolean().default(false),
      }),
      execute: async (input) => {
        if (!supabase) return { error: 'Supabase is not configured' };
        const { data, error } = await supabase.from('dispatch_requests').insert({
          project_name: input.projectName || null, pickup_address: input.pickupAddress, delivery_address: input.deliveryAddress,
          contact_name: input.contactName, contact_phone: input.contactPhone,
          package_description: `${input.urgent ? '[URGENT] ' : ''}${input.packageDescription || ''}`.trim() || null, status: 'PENDING_APPROVAL',
        }).select().single();
        if (error || !data) return { error: error?.message || 'Could not create dispatch' };
        await sendTelegramMessage(
          `ðŸšš <b>${input.urgent ? 'URGENT ' : ''}DELIVERY REQUEST</b>\nProject: ${escapeTelegramHtml(input.projectName || 'n/a')}\nPickup: ${escapeTelegramHtml(input.pickupAddress)}\nDeliver to: ${escapeTelegramHtml(input.deliveryAddress)}\nContact: ${escapeTelegramHtml(input.contactName)} ${escapeTelegramHtml(input.contactPhone)}`,
          { inline_keyboard: [[{ text: 'âœ… Book now', callback_data: `disp:approve:${data.id}` }, { text: 'âŒ Cancel', callback_data: `disp:reject:${data.id}` }]] },
        );
        return { dispatchId: data.id, status: 'PENDING_APPROVAL' };
      },
    }),

    propose_profit_allocation: tool({
      description: 'Compute how the profit of a project is divided (salaries, rent, electricity, tax, emergency fund, marketing, growth, CEO reward, rolling capital) and send it to the CEO for approval.',
      inputSchema: z.object({ projectName: z.string() }),
      execute: async ({ projectName }) => (await proposeProfitAllocation(projectName)).message,
    }),

    set_allocation_rule: tool({
      description: 'Change a profit bucket: percent of profit and optional monthly peso target (e.g. rent target 30000). Percentages across all buckets should add up to 100.',
      inputSchema: z.object({ bucket: z.string(), percent: z.number().min(0).max(100), monthlyTarget: z.number().nonnegative().nullable().optional() }),
      execute: async ({ bucket, percent, monthlyTarget }) => setAllocationRule(bucket, percent, monthlyTarget),
    }),

    bucket_balances: tool({
      description: 'Current envelope balances from approved profit splits minus paid expenses (rent, salaries, emergency fund, rolling capital, CEO reward...).',
      inputSchema: z.object({}),
      execute: async () => getBucketBalances(),
    }),

    run_payroll_accrual: tool({
      description: 'Book staff payroll for a month (YYYY-MM) into the ledger so reports include salaries. Safe to re-run.',
      inputSchema: z.object({ period: z.string() }),
      execute: async ({ period }) => accruePayrollToLedger(period),
    }),

    check_quote_margin: tool({
      description: 'Check whether a customer quote meets the target profit margin and give the minimum safe price.',
      inputSchema: z.object({ quotePrice: z.number(), totalCost: z.number(), targetMarginPercent: z.number().default(30) }),
      execute: async ({ quotePrice, totalCost, targetMarginPercent }) => checkQuoteMargin(quotePrice, totalCost, targetMarginPercent),
    }),

    business_insights: tool({
      description: 'Weekly-style business advice: material reorder forecast (weeks of cover) and per-style price recommendations vs target margin. Advice only.',
      inputSchema: z.object({}),
      execute: async () => ({ forecast: (await demandForecast()).slice(0, 12), pricing: await pricingAdvice() }),
    }),

    teach_style: tool({
      description: 'Save a real example of how the CEO writes to staff/suppliers/clients so all future messages copy his voice.',
      inputSchema: z.object({ kind: z.enum(['staff', 'supplier', 'client']), example: z.string() }),
      execute: async ({ kind, example }) => saveStyleExample(kind, example),
    }),

    delegate_to_swarm: tool({
      description: 'Hand a BIG parallelizable job (audit all orders/leads for issues, research many suppliers, review a large batch of items) to a team of AI agents: a lead splits it, workers do the parts, skeptics verify, a merger reports. Runs in the background and the result is sent to the CEO on Telegram in a few minutes. Costs real LLM tokens, so do NOT use for simple questions you can answer with the other tools. Default 24 agents, max 100.',
      inputSchema: z.object({
        goal: z.string().min(10).describe('The full job, self-contained.'),
        context: z.string().optional().describe('Facts/data the agents need (they cannot call tools).'),
        max_agents: z.number().int().min(3).max(100).optional(),
      }),
      execute: async ({ goal, context, max_agents }) => {
        const job = await createSwarmJob(goal, context, max_agents);
        if ('error' in job) return job;
        try {
          after(() => advanceSwarmJob(job.job_id).catch(() => undefined));
        } catch {
          // after() unavailable outside a request scope; the 5-minute scheduler picks the job up.
        }
        return { ...job, note: 'Started. Result will arrive on Telegram when finished (usually a few minutes).' };
      },
    }),

    set_operating_mode: tool({
      description: 'Switch the autopilot. shadow_mode on = AI only drafts customer replies and sends them to the CEO instead of the customer (dry run). vacation_mode on = CEO away; daily digest becomes detailed and risky items still need approval. autonomy_limit_php = peso amount above which the AI must ask. Call with no changes to just read current settings.',
      inputSchema: z.object({
        shadow_mode: z.enum(['on', 'off']).optional(),
        vacation_mode: z.enum(['on', 'off']).optional(),
        autonomy_limit_php: z.number().min(0).optional(),
      }),
      execute: async (input) => {
        if (input.shadow_mode) await setSetting('shadow_mode', input.shadow_mode);
        if (input.vacation_mode) await setSetting('vacation_mode', input.vacation_mode);
        if (input.autonomy_limit_php !== undefined) await setSetting('autonomy_limit_php', String(input.autonomy_limit_php));
        return { shadow_mode: (await isShadowMode()) ? 'on' : 'off', vacation_mode: (await isVacationMode()) ? 'on' : 'off', autonomy_limit_php: await autonomyLimitPhp() };
      },
    }),

    retain_memory: tool({
      description: 'Save a business rule, supplier deal, client term, pricing guideline, or operational decision into long-term memory so the AI never forgets it.',
      inputSchema: z.object({
        fact: z.string().describe('The clear rule, decision, supplier price, or customer preference to remember.'),
        category: z.enum(['decision', 'note', 'fix', 'issue']).default('decision'),
      }),
      execute: async ({ fact, category }) => {
        const ok = await hindsightRetain(fact, { scope: category, location: 'ceo_agent' });
        return ok ? { remembered: true, note: 'Saved to long-term memory.' } : { error: 'Could not save to memory' };
      },
    }),

    recall_memory: tool({
      description: 'Search long-term memory for business rules, past decisions, client preferences, supplier deals, or incident fixes.',
      inputSchema: z.object({
        query: z.string().describe('Keywords or topic to search for in memory (e.g. "discount policy", "San Miguel", "YKK zipper supplier").'),
      }),
      execute: async ({ query }) => {
        const results = await hindsightRecall(query, { limit: 5 });
        return results.length ? { memories: results } : { memories: [], note: 'No specific past memory found on this topic.' };
      },
    }),
  };
}

export type CeoMedia = { data: Uint8Array; mediaType: string };

export async function runCeoAgent(userText: string, media?: CeoMedia): Promise<string> {
  const supabase = getSupabaseAdmin();
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const summary = await getChatSummary().catch(() => '');
  if (supabase) {
    // Everything newer than the rolling summary (compaction keeps this under ~30 messages).
    const upTo = await getSetting('ceo_chat_summary_upto', '1970-01-01T00:00:00Z');
    const { data } = await supabase.from('ceo_conversations').select('role, content').gt('created_at', upTo).order('created_at', { ascending: false }).limit(HISTORY_LIMIT);
    history.push(...((data || []).reverse() as typeof history));
  }

  // Auto-recall relevant long-term memories based on the CEO's input
  let memoryContext = '';
  try {
    const memories = await hindsightRecall(userText || '', { limit: 3 });
    if (memories.length) {
      memoryContext = `\nRelevant Long-Term Memories:\n${memories.map((m) => `- ${m}`).join('\n')}`;
    }
  } catch {
    // Non-blocking
  }
  const summaryContext = summary ? `\nEarlier conversation with the CEO (summary):\n${summary}` : '';

  const isAudio = media?.mediaType.startsWith('audio/');
  const fallbackText = isAudio ? 'Transcribe this voice note from the CEO and act on it.' : 'The CEO sent this image. Look at it, say what matters, and act on it if needed.';
  const userContent = media
    ? [{ type: 'text' as const, text: userText || fallbackText }, { type: 'file' as const, mediaType: media.mediaType, data: media.data }]
    : userText;

  const tools: Record<string, { description?: string }> = {};
  const manifest = () => describeTools(tools);
  Object.assign(tools, buildTools(), buildActionTools(), buildDataTools(), buildIntrospectionTools(manifest));

  let result;
  try {
    result = await withModelFallback({ tier: 'strong', tools: true, budgetMs: 52000, attemptMs: 26000 }, (model, attemptMs) =>
      generateText({
        model,
        system: `${CEO_PERSONA}\nToday (Asia/Manila): ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}.${summaryContext}${memoryContext}`,
        messages: [...history, { role: 'user', content: userContent }],
        tools: tools as ReturnType<typeof buildTools> & ReturnType<typeof buildActionTools> & ReturnType<typeof buildDataTools> & ReturnType<typeof buildIntrospectionTools>,
        stopWhen: isStepCount(8),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(attemptMs),
      }),
    );
  } catch (error) {
    // Never leave the CEO on "seen" with no reply — even if every model is down, acknowledge and tell him what still works.
    console.error('CEO agent all-models-failed:', error);
    return 'Sorry Boss, lahat ng AI models busy/down ngayon kaya hindi ko muna naproseso ang message/photo mo. ❌ WALA pang nai-save — pakipadala ulit in a few minutes, o gamitin ang exact commands na laging gumagana kahit down ang AI: ORDER <client> | <project> | <total>, MOVE <client> <stage>, CLIENTS.';
  }

  const reply = result.text.trim() || 'Done po, Boss.';
  if (supabase) {
    await supabase.from('ceo_conversations').insert([
      { role: 'user', content: (userText || (isAudio ? '[voice note]' : '[photo]')).slice(0, 2000) },
      { role: 'assistant', content: reply.slice(0, 2000) },
    ]);
  }
  return reply;
}
