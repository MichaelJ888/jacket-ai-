import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';
import { autonomyLimitPhp, isShadowMode, isVacationMode, setSetting } from './ceo-control';

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
import { checkQuoteMargin, forecastRunwayDays, formatPeso } from './finance-logic';
import {
  composeBossStyleMessage,
  createStaffTask,
  escapeTelegramHtml,
  getStaffProfile,
  getSupabaseAdmin,
  sendTelegramDirectMessage,
  sendTelegramMessage,
} from './integrations';

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const MODEL_ID = () => process.env.CEO_MODEL || 'gemini-3.6-flash';
const HISTORY_LIMIT = 12;

const SYSTEM_PROMPT = `You are the CEO's chief-of-staff AI for MJIC, a Philippine uniform/jacket/embroidery business. You talk ONLY with the CEO (the boss) in warm, concise Taglish. You run the business 24/7 for him.

How you work:
- For facts (cash, profit, orders, stock, tasks) ALWAYS call a tool. Never invent numbers, names, prices or statuses. If a tool lacks data, say so.
- Decide like a smart operator: when the CEO describes a problem, state the best option in one or two sentences with the reason and the cost, then do it with tools (or ask ONE short question if something critical is missing).
- You may never move money yourself. For any payment call propose_payment: it sends the CEO an Approve/Reject button, and money only moves after he taps Approve. Never say a payment was made until a tool reports it PAID.
- Messages to staff, suppliers: write the instruction plainly; the system rewrites it in the boss's own voice. Do not mention AI.
- Special errands, emergency deliveries, supplier chasing, task assignments: handle them with the matching tool, then confirm what you did in 1-3 lines.
- Prefer the cheapest option that meets the deadline and say the peso impact when you know it.
- Keep replies short (Telegram). No markdown tables. Use â‚± for pesos.`;

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
  };
}

export async function runCeoAgent(userText: string, audio?: { data: Uint8Array; mediaType: string }): Promise<string> {
  const supabase = getSupabaseAdmin();
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (supabase) {
    const { data } = await supabase.from('ceo_conversations').select('role, content').order('created_at', { ascending: false }).limit(HISTORY_LIMIT);
    history.push(...((data || []).reverse() as typeof history));
  }

  const userContent = audio
    ? [{ type: 'text' as const, text: userText || 'Transcribe this voice note from the CEO and act on it.' }, { type: 'file' as const, mediaType: audio.mediaType, data: audio.data }]
    : userText;

  const result = await generateText({
    model: google(MODEL_ID()),
    system: `${SYSTEM_PROMPT}\nToday (Asia/Manila): ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}.`,
    messages: [...history, { role: 'user', content: userContent }],
    tools: buildTools(),
    stopWhen: isStepCount(8),
    abortSignal: AbortSignal.timeout(50000),
  });

  const reply = result.text.trim() || 'Done po, Boss.';
  if (supabase) {
    await supabase.from('ceo_conversations').insert([
      { role: 'user', content: (userText || '[voice note]').slice(0, 2000) },
      { role: 'assistant', content: reply.slice(0, 2000) },
    ]);
  }
  return reply;
}
